type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

export interface MetricsResult {
  requests: {
    total: number;
    byMethod: Record<HttpMethod, number>;
    byStatus: { "2xx": number; "3xx": number; "4xx": number; "5xx": number };
    ratePerMinute: number;
  };
  performance: {
    avgLatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    p50: number;
    p95: number;
    p99: number;
  };
  errors: {
    total4xx: number;
    total5xx: number;
    byEndpoint: Array<{ path: string; count: number }>;
  };
  system: {
    uptime: number; // segundos desde inicio
    version: string;
  };
  topLists: {
    topEndpoints: Array<{ path: string; count: number }>;
    slowestEndpoints: Array<{ path: string; avgLatency: number }>;
  };
}
