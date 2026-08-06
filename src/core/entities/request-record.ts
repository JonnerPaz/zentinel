export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

export interface RequestRecord {
  id: string; // UUID v4
  timestamp: string; // ISO 8601
  method: HttpMethod;
  path: string;
  fullUrl: string;
  statusCode: number; // 100-599
  latencyMs: number;
  clientIp?: string; // soporta IPv6
  userAgent?: string;
  requestHeaders?: Record<string, string>;
  requestQuery?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  responseSizeBytes?: number;
  errorMessage?: string;
  stackTrace?: string;
  createdAt: string; // ISO 8601
}
