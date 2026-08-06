import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import type { Storage } from "../core/storage/interface.js";
import type { RequestRecord, HttpMethod } from "../core/entities/request-record.js";
import type { LogEntry } from "../core/entities/log-entry.js";
import type { QueryFilters, LogFilters } from "../core/entities/filters.js";
import type { PaginationResult } from "../core/entities/pagination.js";
import type { MetricsResult } from "../core/entities/metrics.js";
import { decodeCursor, encodeCursor } from "../core/utils/cursor.js";
import { calculatePercentiles } from "../core/utils/percentiles.js";

export interface SQLiteStorageOptions {
  dbPath?: string;
  /** Días que se conservan los registros de requests (retención). */
  retentionDays?: number;
  /** Días que se conservan los logs (retención). */
  logRetentionDays?: number;
}

type RequestRow = {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  full_url: string;
  status_code: number;
  latency_ms: number;
  client_ip: string | null;
  user_agent: string | null;
  request_headers: string | null;
  request_query: string | null;
  request_body: string | null;
  response_headers: string | null;
  response_body: string | null;
  response_size_bytes: number | null;
  error_message: string | null;
  stack_trace: string | null;
  created_at: string;
};

type LogRow = {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  stack_trace: string | null;
  metadata: string | null;
  context_file: string | null;
  context_line: number | null;
  context_function: string | null;
  created_at: string;
};

/**
 * Implementación con better-sqlite3: archivo .db local embebido.
 * La interfaz es async; internamente el driver es síncrono.
 */
export class SQLiteStorage implements Storage {
  private db: Database.Database;
  private readonly retentionMs: number;
  private readonly logRetentionMs: number;

  constructor(options: SQLiteStorageOptions = {}) {
    const dbPath = options.dbPath ?? "./data/logs.db";
    const absolute = resolve(dbPath);
    mkdirSync(dirname(absolute), { recursive: true });
    this.db = new Database(absolute);
    this.db.pragma("journal_mode = WAL");
    this.retentionMs = (options.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
    this.logRetentionMs = (options.logRetentionDays ?? options.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  }

  public async initialize(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT,
        full_url TEXT,
        status_code INTEGER,
        latency_ms REAL,
        client_ip TEXT,
        user_agent TEXT,
        request_headers TEXT,
        request_query TEXT,
        request_body TEXT,
        response_headers TEXT,
        response_body TEXT,
        response_size_bytes INTEGER,
        error_message TEXT,
        stack_trace TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status_code);

      CREATE TABLE IF NOT EXISTS logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        stack_trace TEXT,
        metadata TEXT,
        context_file TEXT,
        context_line INTEGER,
        context_function TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
    `);
  }

  public async store(request: RequestRecord): Promise<void> {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO requests
          (id, timestamp, method, path, full_url, status_code, latency_ms,
           client_ip, user_agent, request_headers, request_query, request_body,
           response_headers, response_body, response_size_bytes,
           error_message, stack_trace, created_at)
        VALUES
          (@id, @timestamp, @method, @path, @full_url, @status_code, @latency_ms,
           @client_ip, @user_agent, @request_headers, @request_query, @request_body,
           @response_headers, @response_body, @response_size_bytes,
           @error_message, @stack_trace, @created_at)
      `)
      .run({
        id: request.id,
        timestamp: request.timestamp,
        method: request.method,
        path: request.path,
        full_url: request.fullUrl,
        status_code: request.statusCode,
        latency_ms: request.latencyMs,
        client_ip: request.clientIp ?? null,
        user_agent: request.userAgent ?? null,
        request_headers: jsonOrNull(request.requestHeaders),
        request_query: jsonOrNull(request.requestQuery),
        request_body: jsonOrNull(request.requestBody),
        response_headers: jsonOrNull(request.responseHeaders),
        response_body: jsonOrNull(request.responseBody),
        response_size_bytes: request.responseSizeBytes ?? null,
        error_message: request.errorMessage ?? null,
        stack_trace: request.stackTrace ?? null,
        created_at: request.createdAt,
      });
  }

  public async storeLog(entry: LogEntry): Promise<void> {
    this.db
      .prepare(`
        INSERT OR REPLACE INTO logs
          (id, timestamp, level, message, stack_trace, metadata,
           context_file, context_line, context_function, created_at)
        VALUES
          (@id, @timestamp, @level, @message, @stack_trace, @metadata,
           @context_file, @context_line, @context_function, @created_at)
      `)
      .run({
        id: entry.id,
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        stack_trace: entry.stackTrace ?? null,
        metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        context_file: entry.context?.file ?? null,
        context_line: entry.context?.line ?? null,
        context_function: entry.context?.function ?? null,
        created_at: entry.createdAt,
      });
  }

  public async getById(id: string): Promise<RequestRecord | null> {
    const row = this.db.prepare("SELECT * FROM requests WHERE id = ?").get(id) as RequestRow | undefined;
    return row ? this.recordFromRow(row) : null;
  }

  public async query(filters: QueryFilters): Promise<PaginationResult<RequestRecord>> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const order = filters.order ?? "desc";

    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.methods && filters.methods.length > 0) {
      where.push(`method IN (${filters.methods.map((_, i) => `@m${i}`).join(", ")})`);
      filters.methods.forEach((m, i) => (params[`m${i}`] = m));
    }
    if (filters.statusCodes && filters.statusCodes.length > 0) {
      where.push(`status_code IN (${filters.statusCodes.map((_, i) => `@s${i}`).join(", ")})`);
      filters.statusCodes.forEach((s, i) => (params[`s${i}`] = s));
    }
    if (filters.statusRange) {
      where.push("status_code >= @minStatus AND status_code <= @maxStatus");
      params.minStatus = filters.statusRange.min;
      params.maxStatus = filters.statusRange.max;
    }
    if (filters.pathPattern) {
      where.push("path LIKE @pathPattern");
      params.pathPattern = `%${filters.pathPattern}%`;
    }
    if (filters.dateFrom) {
      where.push("timestamp >= @dateFrom");
      params.dateFrom = filters.dateFrom;
    }
    if (filters.dateTo) {
      where.push("timestamp <= @dateTo");
      params.dateTo = filters.dateTo;
    }
    if (filters.latencyMin !== undefined) {
      where.push("latency_ms >= @latencyMin");
      params.latencyMin = filters.latencyMin;
    }
    if (filters.latencyMax !== undefined) {
      where.push("latency_ms <= @latencyMax");
      params.latencyMax = filters.latencyMax;
    }
    if (filters.hasError !== undefined) {
      where.push(filters.hasError ? "status_code >= 400" : "status_code < 400");
    }

    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        const [ts, id] = decoded.split("::");
        params.ct = ts!;
        params.ci = id!;
        where.push(
          order === "desc"
            ? "(timestamp < @ct OR (timestamp = @ct AND id < @ci))"
            : "(timestamp > @ct OR (timestamp = @ct AND id > @ci))",
        );
      }
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql = `ORDER BY timestamp ${order}, id ${order}`;

    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM requests ${whereSql}`).get(params) as {
      c: number;
    };

    const rows = this.db
      .prepare(`SELECT * FROM requests ${whereSql} ${orderSql} LIMIT @limit`)
      .all({ ...params, limit: limit + 1 }) as RequestRow[];

    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((r) => this.recordFromRow(r));
    const nextCursor =
      data.length > 0 && hasMore ? encodeCursor(`${data[data.length - 1]!.timestamp}::${data[data.length - 1]!.id}`) : null;
    const prevCursor = data.length > 0 ? encodeCursor(`${data[0]!.timestamp}::${data[0]!.id}`) : null;

    return {
      data,
      pagination: { hasMore, nextCursor, prevCursor, totalCount: countRow.c },
    };
  }

  public async getLogs(filters: LogFilters): Promise<PaginationResult<LogEntry>> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const order = filters.order ?? "desc";

    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.levels && filters.levels.length > 0) {
      where.push(`level IN (${filters.levels.map((_, i) => `@l${i}`).join(", ")})`);
      filters.levels.forEach((l, i) => (params[`l${i}`] = l));
    }
    if (filters.dateFrom) {
      where.push("timestamp >= @dateFrom");
      params.dateFrom = filters.dateFrom;
    }
    if (filters.dateTo) {
      where.push("timestamp <= @dateTo");
      params.dateTo = filters.dateTo;
    }

    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        const [ts, id] = decoded.split("::");
        params.ct = ts!;
        params.ci = id!;
        where.push(
          order === "desc"
            ? "(timestamp < @ct OR (timestamp = @ct AND id < @ci))"
            : "(timestamp > @ct OR (timestamp = @ct AND id > @ci))",
        );
      }
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql = `ORDER BY timestamp ${order}, id ${order}`;

    const countRow = this.db.prepare(`SELECT COUNT(*) as c FROM logs ${whereSql}`).get(params) as {
      c: number;
    };
    const rows = this.db
      .prepare(`SELECT * FROM logs ${whereSql} ${orderSql} LIMIT @limit`)
      .all({ ...params, limit: limit + 1 }) as LogRow[];

    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).map((r) => this.logFromRow(r));
    const nextCursor =
      data.length > 0 && hasMore ? encodeCursor(`${data[data.length - 1]!.timestamp}::${data[data.length - 1]!.id}`) : null;
    const prevCursor = data.length > 0 ? encodeCursor(`${data[0]!.timestamp}::${data[0]!.id}`) : null;

    return {
      data,
      pagination: { hasMore, nextCursor, prevCursor, totalCount: countRow.c },
    };
  }

  public async getMetrics(): Promise<MetricsResult> {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60_000).toISOString();

    const requestCount = this.db.prepare("SELECT COUNT(*) as c FROM requests").get() as { c: number };
    const recentCount = this.db
      .prepare("SELECT COUNT(*) as c FROM requests WHERE timestamp >= ?")
      .get(oneMinuteAgo) as { c: number };

    const byMethodRows = this.db
      .prepare("SELECT method, COUNT(*) as c FROM requests GROUP BY method")
      .all() as { method: string; c: number }[];

    const byMethod = {
      GET: 0,
      POST: 0,
      PUT: 0,
      DELETE: 0,
      PATCH: 0,
      OPTIONS: 0,
      HEAD: 0,
    } as MetricsResult["requests"]["byMethod"];

    for (const row of byMethodRows) {
      if (row.method in byMethod) byMethod[row.method as keyof typeof byMethod] = row.c;
    }

    const byStatusRows = this.db
      .prepare("SELECT (status_code / 100) * 100 as bucket, COUNT(*) as c FROM requests GROUP BY bucket")
      .all() as { bucket: number; c: number }[];

    const byStatus: MetricsResult["requests"]["byStatus"] = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
    for (const row of byStatusRows) {
      const key = `${row.bucket / 100}xx` as keyof typeof byStatus;
      if (key in byStatus) byStatus[key] = row.c;
    }

    const latencyRow = this.db
      .prepare("SELECT AVG(latency_ms) as avg, MIN(latency_ms) as min, MAX(latency_ms) as max FROM requests")
      .get() as { avg: number | null; min: number | null; max: number | null };

    const latencies = (this.db.prepare("SELECT latency_ms as l FROM requests").all() as { l: number }[]).map((r) => r.l);
    const percentiles = calculatePercentiles(latencies);

    const errorRows = this.db
      .prepare("SELECT path, COUNT(*) as c FROM requests WHERE status_code >= 400 GROUP BY path")
      .all() as { path: string | null; c: number }[];

    const total4xxRow = this.db
      .prepare("SELECT COUNT(*) as c FROM requests WHERE status_code >= 400 AND status_code < 500")
      .get() as { c: number };
    const total5xxRow = this.db
      .prepare("SELECT COUNT(*) as c FROM requests WHERE status_code >= 500")
      .get() as { c: number };

    const topEndpoints = (
      this.db
        .prepare("SELECT path, COUNT(*) as c FROM requests GROUP BY path ORDER BY c DESC LIMIT 10")
        .all() as { path: string | null; c: number }[]
    ).map((r) => ({ path: r.path ?? "", count: r.c }));

    const slowestEndpoints = (
      this.db
        .prepare("SELECT path, AVG(latency_ms) as avg FROM requests GROUP BY path ORDER BY avg DESC LIMIT 10")
        .all() as { path: string | null; avg: number }[]
    ).map((r) => ({ path: r.path ?? "", avgLatency: Math.round(r.avg * 100) / 100 }));

    return {
      requests: {
        total: requestCount.c,
        byMethod,
        byStatus,
        ratePerMinute: recentCount.c,
      },
      performance: {
        avgLatencyMs: Math.round((latencyRow.avg ?? 0) * 100) / 100,
        minLatencyMs: latencyRow.min ?? 0,
        maxLatencyMs: latencyRow.max ?? 0,
        p50: percentiles.p50,
        p95: percentiles.p95,
        p99: percentiles.p99,
      },
      errors: {
        total4xx: total4xxRow.c,
        total5xx: total5xxRow.c,
        byEndpoint: errorRows.map((r) => ({ path: r.path ?? "", count: r.c })),
      },
      system: {
        uptime: Math.round(process.uptime()),
        version: "1.3.0",
      },
      topLists: {
        topEndpoints,
        slowestEndpoints,
      },
    };
  }

  public async cleanup(): Promise<number> {
    const requestCutoff = new Date(Date.now() - this.retentionMs).toISOString();
    const logCutoff = new Date(Date.now() - this.logRetentionMs).toISOString();
    return (
      this.db.prepare("DELETE FROM requests WHERE timestamp < ?").run(requestCutoff).changes +
      this.db.prepare("DELETE FROM logs WHERE timestamp < ?").run(logCutoff).changes
    );
  }

  public async close(): Promise<void> {
    this.db.close();
  }

  private recordFromRow(row: RequestRow): RequestRecord {
    return {
      id: row.id,
      timestamp: row.timestamp,
      method: row.method as HttpMethod,
      path: row.path ?? "",
      fullUrl: row.full_url ?? "",
      statusCode: row.status_code,
      latencyMs: row.latency_ms,
      ...(row.client_ip ? { clientIp: row.client_ip } : {}),
      ...(row.user_agent ? { userAgent: row.user_agent } : {}),
      requestHeaders: (safeJsonParse(row.request_headers) as Record<string, string>) ?? {},
      requestQuery: (safeJsonParse(row.request_query) as Record<string, string>) ?? {},
      ...(row.request_body !== null && row.request_body !== undefined ? { requestBody: safeJsonParse(row.request_body) } : {}),
      responseHeaders: (safeJsonParse(row.response_headers) as Record<string, string>) ?? {},
      ...(row.response_body !== null && row.response_body !== undefined ? { responseBody: safeJsonParse(row.response_body) } : {}),
      responseSizeBytes: row.response_size_bytes ?? 0,
      ...(row.error_message ? { errorMessage: row.error_message } : {}),
      ...(row.stack_trace ? { stackTrace: row.stack_trace } : {}),
      createdAt: row.created_at,
    };
  }

  private logFromRow(row: LogRow): LogEntry {
    const context =
      row.context_file !== null
        ? {
            file: row.context_file,
            ...(row.context_line !== null && row.context_line !== undefined ? { line: row.context_line } : {}),
            ...(row.context_function !== null && row.context_function !== undefined
              ? { function: row.context_function }
              : {}),
          }
        : undefined;

    return {
      id: row.id,
      timestamp: row.timestamp,
      createdAt: row.created_at ?? row.timestamp,
      level: row.level as LogEntry["level"],
      message: row.message,
      ...(row.stack_trace ? { stackTrace: row.stack_trace } : {}),
      ...(row.metadata ? { metadata: safeJsonParse(row.metadata) as Record<string, unknown> } : {}),
      ...(context ? { context } : {}),
    };
  }
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function safeJsonParse(value: string | null | undefined): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
