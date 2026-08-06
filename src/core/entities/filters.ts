import type { HttpMethod } from "./request-record.js";
import type { LogLevel } from "./log-entry.js";

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

export interface LogFilters {
  levels?: LogLevel[];
  dateFrom?: string; // ISO 8601
  dateTo?: string; // ISO 8601
  cursor?: string;
  limit?: number; // default: 50, max: 200
  order?: "asc" | "desc"; // default: 'desc'
}
