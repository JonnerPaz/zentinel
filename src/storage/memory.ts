import type { Storage } from "../core/storage/interface.js";
import type { RequestRecord } from "../core/entities/request-record.js";
import type { LogEntry } from "../core/entities/log-entry.js";
import type { QueryFilters, LogFilters } from "../core/entities/filters.js";
import type { PaginationResult } from "../core/entities/pagination.js";
import type { MetricsResult } from "../core/entities/metrics.js";
import { decodeCursor, encodeCursor } from "../core/utils/cursor.js";
import { calculatePercentiles } from "../core/utils/percentiles.js";

export interface MemoryStorageOptions {
  /** Tamaño máximo del buffer circular (FIFO). */
  maxEntries?: number;
  /** Días que se conservan los registros de requests (retención). */
  retentionDays?: number;
  /** Días que se conservan los logs (retención). */
  logRetentionDays?: number;
}

/**
 * Implementación en memoria: circular buffer FIFO.
 * Volátil: se pierde al reiniciar el proceso.
 */
export class MemoryStorage implements Storage {
  private requests: RequestRecord[] = [];
  private logs: LogEntry[] = [];
  private readonly maxEntries: number;
  private readonly retentionMs: number;
  private readonly logRetentionMs: number;
  private readonly startedAt: number = Date.now();

  constructor(options: MemoryStorageOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10000;
    this.retentionMs = (options.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
    this.logRetentionMs = (options.logRetentionDays ?? options.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  }

  public async initialize(): Promise<void> {
    // Sin setup necesario en memoria.
  }

  public async store(request: RequestRecord): Promise<void> {
    this.requests.push(request);
    this.trim();
  }

  public async storeLog(entry: LogEntry): Promise<void> {
    this.logs.push(entry);
    this.trim();
  }

  public async getById(id: string): Promise<RequestRecord | null> {
    return this.requests.find((r) => r.id === id) ?? null;
  }

  public async query(filters: QueryFilters): Promise<PaginationResult<RequestRecord>> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const order = filters.order ?? "desc";

    let filtered = this.requests.filter((r) => {
      if (filters.methods && filters.methods.length > 0 && !filters.methods.includes(r.method)) return false;
      if (filters.statusCodes && filters.statusCodes.length > 0 && !filters.statusCodes.includes(r.statusCode))
        return false;
      if (filters.statusRange) {
        const { min, max } = filters.statusRange;
        if (r.statusCode < min || r.statusCode > max) return false;
      }
      if (filters.pathPattern && !r.path.includes(filters.pathPattern)) return false;
      if (filters.dateFrom && r.timestamp < filters.dateFrom) return false;
      if (filters.dateTo && r.timestamp > filters.dateTo) return false;
      if (filters.latencyMin !== undefined && r.latencyMs < filters.latencyMin) return false;
      if (filters.latencyMax !== undefined && r.latencyMs > filters.latencyMax) return false;
      if (filters.hasError !== undefined && (r.statusCode >= 400) !== filters.hasError) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const byTimestamp =
        order === "desc" ? b.timestamp.localeCompare(a.timestamp) : a.timestamp.localeCompare(b.timestamp);
      if (byTimestamp !== 0) return byTimestamp;
      return order === "desc" ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
    });

    const totalCount = filtered.length;

    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        const [ts, id] = decoded.split("::");
        const ct = ts!;
        const ci = id!;
        filtered = filtered.filter((r) => {
          if (order === "desc") {
            if (r.timestamp !== ct) return r.timestamp < ct;
            return r.id < ci;
          }
          if (r.timestamp !== ct) return r.timestamp > ct;
          return r.id > ci;
        });
      }
    }

    const data = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextCursor =
      data.length > 0 && hasMore ? encodeCursor(`${data[data.length - 1]!.timestamp}::${data[data.length - 1]!.id}`) : null;
    const prevCursor = data.length > 0 ? encodeCursor(`${data[0]!.timestamp}::${data[0]!.id}`) : null;

    return { data, pagination: { hasMore, nextCursor, prevCursor, totalCount } };
  }

  public async getLogs(filters: LogFilters): Promise<PaginationResult<LogEntry>> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const order = filters.order ?? "desc";

    let filtered = this.logs.filter((l) => {
      if (filters.levels && filters.levels.length > 0 && !filters.levels.includes(l.level)) return false;
      if (filters.dateFrom && l.timestamp < filters.dateFrom) return false;
      if (filters.dateTo && l.timestamp > filters.dateTo) return false;
      return true;
    });

    filtered.sort((a, b) => {
      const byTimestamp =
        order === "desc" ? b.timestamp.localeCompare(a.timestamp) : a.timestamp.localeCompare(b.timestamp);
      if (byTimestamp !== 0) return byTimestamp;
      return order === "desc" ? b.id.localeCompare(a.id) : a.id.localeCompare(b.id);
    });

    const totalCount = filtered.length;

    if (filters.cursor) {
      const decoded = decodeCursor(filters.cursor);
      if (decoded) {
        const [ts, id] = decoded.split("::");
        const ct = ts!;
        const ci = id!;
        filtered = filtered.filter((l) => {
          if (order === "desc") {
            if (l.timestamp !== ct) return l.timestamp < ct;
            return l.id < ci;
          }
          if (l.timestamp !== ct) return l.timestamp > ct;
          return l.id > ci;
        });
      }
    }

    const data = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextCursor =
      data.length > 0 && hasMore ? encodeCursor(`${data[data.length - 1]!.timestamp}::${data[data.length - 1]!.id}`) : null;
    const prevCursor = data.length > 0 ? encodeCursor(`${data[0]!.timestamp}::${data[0]!.id}`) : null;

    return { data, pagination: { hasMore, nextCursor, prevCursor, totalCount } };
  }

  public async getMetrics(): Promise<MetricsResult> {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60_000).toISOString();

    const recentCount = this.requests.filter((r) => r.timestamp >= oneMinuteAgo).length;

    const byMethod = {
      GET: 0,
      POST: 0,
      PUT: 0,
      DELETE: 0,
      PATCH: 0,
      OPTIONS: 0,
      HEAD: 0,
    } as MetricsResult["requests"]["byMethod"];

    const byStatus: MetricsResult["requests"]["byStatus"] = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
    const byStatusAsRecord = byStatus as Record<string, number>;

    const errorsByEndpoint = new Map<string, number>();
    const topEndpoints = new Map<string, number>();
    const latencyByEndpoint = new Map<string, number[]>();

    let total4xx = 0;
    let total5xx = 0;

    for (const r of this.requests) {
      const status = r.statusCode;
      byMethod[r.method] = (byMethod[r.method] ?? 0) + 1;
      const bucket = `${status.toString()[0]}xx`;
      if (bucket in byStatusAsRecord) {
        byStatusAsRecord[bucket] = (byStatusAsRecord[bucket] ?? 0) + 1;
      }
      if (status >= 400) {
        errorsByEndpoint.set(r.path, (errorsByEndpoint.get(r.path) ?? 0) + 1);
        if (status < 500) total4xx++;
        else total5xx++;
      }
      topEndpoints.set(r.path, (topEndpoints.get(r.path) ?? 0) + 1);
      const latencies = latencyByEndpoint.get(r.path) ?? [];
      latencies.push(r.latencyMs);
      latencyByEndpoint.set(r.path, latencies);
    }

    const latencies = this.requests.map((r) => r.latencyMs);
    const percentiles = calculatePercentiles(latencies);

    const avgLatencyMs = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    const minLatencyMs = latencies.length > 0 ? Math.min(...latencies) : 0;
    const maxLatencyMs = latencies.length > 0 ? Math.max(...latencies) : 0;

    return {
      requests: {
        total: this.requests.length,
        byMethod,
        byStatus,
        ratePerMinute: recentCount,
      },
      performance: {
        avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
        minLatencyMs,
        maxLatencyMs,
        p50: percentiles.p50,
        p95: percentiles.p95,
        p99: percentiles.p99,
      },
      errors: {
        total4xx,
        total5xx,
        byEndpoint: [...errorsByEndpoint.entries()].map(([path, count]) => ({ path, count })),
      },
      system: {
        uptime: Math.round((now - this.startedAt) / 1000),
        version: "1.3.0",
      },
      topLists: {
        topEndpoints: [...topEndpoints.entries()]
          .map(([path, count]) => ({ path, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10),
        slowestEndpoints: [...latencyByEndpoint.entries()]
          .map(([path, lats]) => ({
            path,
            avgLatency: lats.reduce((a, b) => a + b, 0) / lats.length,
          }))
          .sort((a, b) => b.avgLatency - a.avgLatency)
          .slice(0, 10),
      },
    };
  }

  public async cleanup(): Promise<number> {
    const requestCutoff = new Date(Date.now() - this.retentionMs).toISOString();
    const logCutoff = new Date(Date.now() - this.logRetentionMs).toISOString();
    const before = this.requests.length + this.logs.length;
    this.requests = this.requests.filter((r) => r.timestamp >= requestCutoff);
    this.logs = this.logs.filter((l) => l.timestamp >= logCutoff);
    return before - (this.requests.length + this.logs.length);
  }

  public async close(): Promise<void> {
    // Sin recursos que liberar.
  }

  private trim(): void {
    if (this.requests.length > this.maxEntries) {
      this.requests.splice(0, this.requests.length - this.maxEntries);
    }
    if (this.logs.length > this.maxEntries) {
      this.logs.splice(0, this.logs.length - this.maxEntries);
    }
  }
}
