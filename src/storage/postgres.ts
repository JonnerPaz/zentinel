import { Pool } from "pg";
import type { Storage } from "../core/storage/interface.js";
import type { RequestRecord, HttpMethod } from "../core/entities/request-record.js";
import type { LogEntry } from "../core/entities/log-entry.js";
import type { QueryFilters, LogFilters } from "../core/entities/filters.js";
import type { PaginationResult } from "../core/entities/pagination.js";
import type { MetricsResult } from "../core/entities/metrics.js";
import { decodeCursor, encodeCursor } from "../core/utils/cursor.js";
import { calculatePercentiles } from "../core/utils/percentiles.js";

export interface PostgresStorageOptions {
  connectionString: string;
  /** Días que se conservan los registros de requests (retención). */
  retentionDays?: number;
  /** Días que se conservan los logs (retención). */
  logRetentionDays?: number;
}

/**
 * Implementación con pg (node-postgres): servidor PostgreSQL remoto.
 */
export class PostgresStorage implements Storage {
  private pool: Pool;
  private readonly retentionMs: number;
  private readonly logRetentionMs: number;

  constructor(options: PostgresStorageOptions) {
    this.pool = new Pool({ connectionString: options.connectionString });
    this.retentionMs = (options.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
    this.logRetentionMs = (options.logRetentionDays ?? options.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  }

  public async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        method TEXT NOT NULL,
        path TEXT,
        full_url TEXT,
        status_code INTEGER,
        latency_ms DOUBLE PRECISION,
        client_ip TEXT,
        user_agent TEXT,
        request_headers JSONB,
        request_query JSONB,
        request_body JSONB,
        response_headers JSONB,
        response_body JSONB,
        response_size_bytes INTEGER,
        error_message TEXT,
        stack_trace TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status_code);

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TIMESTAMPTZ NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        stack_trace TEXT,
        metadata JSONB,
        context_file TEXT,
        context_line INTEGER,
        context_function TEXT,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    `);
  }

  public async store(request: RequestRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO requests
        (id, timestamp, method, path, full_url, status_code, latency_ms,
         client_ip, user_agent, request_headers, request_query, request_body,
         response_headers, response_body, response_size_bytes,
         error_message, stack_trace, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO NOTHING`,
      [
        request.id,
        request.timestamp,
        request.method,
        request.path,
        request.fullUrl,
        request.statusCode,
        request.latencyMs,
        request.clientIp ?? null,
        request.userAgent ?? null,
        jsonOrNull(request.requestHeaders),
        jsonOrNull(request.requestQuery),
        jsonOrNull(request.requestBody),
        jsonOrNull(request.responseHeaders),
        jsonOrNull(request.responseBody),
        request.responseSizeBytes ?? null,
        request.errorMessage ?? null,
        request.stackTrace ?? null,
        request.createdAt,
      ],
    );
  }

  public async storeLog(entry: LogEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO logs
        (id, timestamp, level, message, stack_trace, metadata,
         context_file, context_line, context_function, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.timestamp,
        entry.level,
        entry.message,
        entry.stackTrace ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.context?.file ?? null,
        entry.context?.line ?? null,
        entry.context?.function ?? null,
        entry.createdAt,
      ],
    );
  }

  public async getById(id: string): Promise<RequestRecord | null> {
    const result = await this.pool.query("SELECT * FROM requests WHERE id = $1", [id]);
    return result.rows[0] ? this.recordFromRow(result.rows[0]) : null;
  }

  public async query(filters: QueryFilters): Promise<PaginationResult<RequestRecord>> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const order = filters.order ?? "desc";

    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.methods && filters.methods.length > 0) {
      where.push(`method = ANY($${params.length + 1})`);
      params.push(filters.methods);
    }
    if (filters.statusCodes && filters.statusCodes.length > 0) {
      where.push(`status_code = ANY($${params.length + 1})`);
      params.push(filters.statusCodes);
    }
    if (filters.statusRange) {
      params.push(filters.statusRange.min, filters.statusRange.max);
      where.push(`status_code >= $${params.length - 1} AND status_code <= $${params.length}`);
    }
    if (filters.pathPattern) {
      params.push(`%${filters.pathPattern}%`);
      where.push(`path ILIKE $${params.length}`);
    }
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      where.push(`timestamp >= $${params.length}`);
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      where.push(`timestamp <= $${params.length}`);
    }
    if (filters.latencyMin !== undefined) {
      params.push(filters.latencyMin);
      where.push(`latency_ms >= $${params.length}`);
    }
    if (filters.latencyMax !== undefined) {
      params.push(filters.latencyMax);
      where.push(`latency_ms <= $${params.length}`);
    }
    if (filters.hasError !== undefined) {
      where.push(filters.hasError ? "status_code >= 400" : "status_code < 400");
    }

    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        const [ts, id] = decoded.split("::");
        params.push(ts!, id!);
        where.push(
          order === "desc"
            ? `(timestamp < $${params.length - 1} OR (timestamp = $${params.length - 1} AND id < $${params.length}))`
            : `(timestamp > $${params.length - 1} OR (timestamp = $${params.length - 1} AND id > $${params.length}))`,
        );
      }
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await this.pool.query(`SELECT COUNT(*)::int as c FROM requests ${whereSql}`, params);

    const rowsResult = await this.pool.query(
      `SELECT * FROM requests ${whereSql} ORDER BY timestamp ${order}, id ${order} LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );

    const rows = rowsResult.rows;
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((r) => this.recordFromRow(r));
    const nextCursor =
      data.length > 0 && hasMore ? encodeCursor(`${data[data.length - 1]!.timestamp}::${data[data.length - 1]!.id}`) : null;
    const prevCursor = data.length > 0 ? encodeCursor(`${data[0]!.timestamp}::${data[0]!.id}`) : null;

    return {
      data,
      pagination: { hasMore, nextCursor, prevCursor, totalCount: countResult.rows[0].c },
    };
  }

  public async getLogs(filters: LogFilters): Promise<PaginationResult<LogEntry>> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const order = filters.order ?? "desc";

    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.levels && filters.levels.length > 0) {
      where.push(`level = ANY($${params.length + 1})`);
      params.push(filters.levels);
    }
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      where.push(`timestamp >= $${params.length}`);
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      where.push(`timestamp <= $${params.length}`);
    }

    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        const [ts, id] = decoded.split("::");
        params.push(ts!, id!);
        where.push(
          order === "desc"
            ? `(timestamp < $${params.length - 1} OR (timestamp = $${params.length - 1} AND id < $${params.length}))`
            : `(timestamp > $${params.length - 1} OR (timestamp = $${params.length - 1} AND id > $${params.length}))`,
        );
      }
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const countResult = await this.pool.query(`SELECT COUNT(*)::int as c FROM logs ${whereSql}`, params);
    const rowsResult = await this.pool.query(
      `SELECT * FROM logs ${whereSql} ORDER BY timestamp ${order}, id ${order} LIMIT $${params.length + 1}`,
      [...params, limit + 1],
    );

    const rows = rowsResult.rows;
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((r) => this.logFromRow(r));
    const nextCursor =
      data.length > 0 && hasMore ? encodeCursor(`${data[data.length - 1]!.timestamp}::${data[data.length - 1]!.id}`) : null;
    const prevCursor = data.length > 0 ? encodeCursor(`${data[0]!.timestamp}::${data[0]!.id}`) : null;

    return {
      data,
      pagination: { hasMore, nextCursor, prevCursor, totalCount: countResult.rows[0].c },
    };
  }

  public async getMetrics(): Promise<MetricsResult> {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60_000).toISOString();

    const requestCount = await this.pool.query("SELECT COUNT(*)::int as c FROM requests");
    const recentCount = await this.pool.query("SELECT COUNT(*)::int as c FROM requests WHERE timestamp >= $1", [
      oneMinuteAgo,
    ]);

    const byMethodRows = await this.pool.query("SELECT method, COUNT(*)::int as c FROM requests GROUP BY method");
    const byStatusRows = await this.pool.query(
      "SELECT (status_code / 100) * 100 as bucket, COUNT(*)::int as c FROM requests GROUP BY bucket",
    );

    const byMethod = {
      GET: 0,
      POST: 0,
      PUT: 0,
      DELETE: 0,
      PATCH: 0,
      OPTIONS: 0,
      HEAD: 0,
    } as MetricsResult["requests"]["byMethod"];

    for (const row of byMethodRows.rows) {
      if (row.method in byMethod) byMethod[row.method as keyof typeof byMethod] = row.c;
    }

    const byStatus: MetricsResult["requests"]["byStatus"] = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
    for (const row of byStatusRows.rows) {
      const key = `${row.bucket / 100}xx` as keyof typeof byStatus;
      if (key in byStatus) byStatus[key] = row.c;
    }

    const latencyRow = await this.pool.query(
      "SELECT AVG(latency_ms)::float as avg, MIN(latency_ms)::float as min, MAX(latency_ms)::float as max FROM requests",
    );

    const latencyRows = await this.pool.query("SELECT latency_ms as l FROM requests");
    const percentiles = calculatePercentiles(latencyRows.rows.map((r) => Number(r.l)));

    const errorRows = await this.pool.query(
      "SELECT path, COUNT(*)::int as c FROM requests WHERE status_code >= 400 GROUP BY path",
    );
    const total4xx = await this.pool.query(
      "SELECT COUNT(*)::int as c FROM requests WHERE status_code >= 400 AND status_code < 500",
    );
    const total5xx = await this.pool.query("SELECT COUNT(*)::int as c FROM requests WHERE status_code >= 500");

    const topEndpoints = await this.pool.query(
      "SELECT path, COUNT(*)::int as c FROM requests GROUP BY path ORDER BY c DESC LIMIT 10",
    );
    const slowestEndpoints = await this.pool.query(
      "SELECT path, AVG(latency_ms)::float as avg FROM requests GROUP BY path ORDER BY avg DESC LIMIT 10",
    );

    const avg = latencyRow.rows[0].avg;
    const min = latencyRow.rows[0].min;
    const max = latencyRow.rows[0].max;

    return {
      requests: {
        total: requestCount.rows[0].c,
        byMethod,
        byStatus,
        ratePerMinute: recentCount.rows[0].c,
      },
      performance: {
        avgLatencyMs: Math.round((avg ?? 0) * 100) / 100,
        minLatencyMs: Math.round(min ?? 0),
        maxLatencyMs: Math.round(max ?? 0),
        p50: percentiles.p50,
        p95: percentiles.p95,
        p99: percentiles.p99,
      },
      errors: {
        total4xx: total4xx.rows[0].c,
        total5xx: total5xx.rows[0].c,
        byEndpoint: errorRows.rows.map((r) => ({ path: r.path ?? "", count: r.c })),
      },
      system: {
        uptime: Math.round(process.uptime()),
        version: "1.3.0",
      },
      topLists: {
        topEndpoints: topEndpoints.rows.map((r) => ({ path: r.path ?? "", count: r.c })),
        slowestEndpoints: slowestEndpoints.rows.map((r) => ({
          path: r.path ?? "",
          avgLatency: Math.round(r.avg * 100) / 100,
        })),
      },
    };
  }

  public async cleanup(): Promise<number> {
    const requestCutoff = new Date(Date.now() - this.retentionMs).toISOString();
    const logCutoff = new Date(Date.now() - this.logRetentionMs).toISOString();
    const r1 = await this.pool.query("DELETE FROM requests WHERE timestamp < $1", [requestCutoff]);
    const r2 = await this.pool.query("DELETE FROM logs WHERE timestamp < $1", [logCutoff]);
    return Number(r1.rowCount) + Number(r2.rowCount);
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }

  private recordFromRow(row: Record<string, unknown>): RequestRecord {
    return {
      id: row.id as string,
      timestamp: new Date(row.timestamp as string).toISOString(),
      method: row.method as HttpMethod,
      path: (row.path as string) ?? "",
      fullUrl: (row.full_url as string) ?? "",
      statusCode: row.status_code as number,
      latencyMs: Number(row.latency_ms),
      ...(row.client_ip ? { clientIp: row.client_ip as string } : {}),
      ...(row.user_agent ? { userAgent: row.user_agent as string } : {}),
      requestHeaders: (row.request_headers as Record<string, string>) ?? {},
      requestQuery: (row.request_query as Record<string, string>) ?? {},
      ...(row.request_body !== null && row.request_body !== undefined ? { requestBody: row.request_body } : {}),
      responseHeaders: (row.response_headers as Record<string, string>) ?? {},
      ...(row.response_body !== null && row.response_body !== undefined ? { responseBody: row.response_body } : {}),
      responseSizeBytes: Number(row.response_size_bytes ?? 0),
      ...(row.error_message ? { errorMessage: row.error_message as string } : {}),
      ...(row.stack_trace ? { stackTrace: row.stack_trace as string } : {}),
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }

  private logFromRow(row: Record<string, unknown>): LogEntry {
    const context =
      row.context_file !== null && row.context_file !== undefined
        ? {
            file: row.context_file as string,
            ...(row.context_line !== null && row.context_line !== undefined ? { line: row.context_line as number } : {}),
            ...(row.context_function !== null && row.context_function !== undefined
              ? { function: row.context_function as string }
              : {}),
          }
        : undefined;

    return {
      id: row.id as string,
      timestamp: new Date(row.timestamp as string).toISOString(),
      createdAt: new Date((row.created_at as string) ?? (row.timestamp as string)).toISOString(),
      level: row.level as LogEntry["level"],
      message: row.message as string,
      ...(row.stack_trace ? { stackTrace: row.stack_trace as string } : {}),
      ...(row.metadata ? { metadata: row.metadata as Record<string, unknown> } : {}),
      ...(context ? { context } : {}),
    };
  }
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}
