type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD";

export interface QueryFilters {
  methods?: HttpMethod[];
  statusCodes?: number[];
  statusRange?: { min: number; max: number };
  pathPattern?: string; // búsqueda parcial
  dateFrom?: string; // ISO 8601
  dateTo?: string; // ISO 8601
  latencyMin?: number; // ms
  latencyMax?: number; // ms
  hasError?: boolean;
  cursor?: string;
  limit?: number; // default: 50, max: 200
  order?: "asc" | "desc"; // default: 'desc'
}
