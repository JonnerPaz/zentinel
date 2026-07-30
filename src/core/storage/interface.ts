import type { RequestRecord } from "../entities/request-record.js";
import type { QueryFilters } from "../entities/filters.js";
import type { PaginationResult } from "../entities/pagination.js";
import type { MetricsResult } from "../entities/metrics.js";

export interface Storage {
  /**
   * Guarda un lote (batch) de registros de peticiones de forma masiva.
   */
  saveBatch(records: RequestRecord[]): Promise<void>;

  /**
   * Recupera una lista paginada de peticiones aplicando filtros.
   */
  getRequests(filters: QueryFilters): Promise<PaginationResult<RequestRecord>>;

  /**
   * Obtiene una petición específica por su ID único.
   */
  getRequestById(id: string): Promise<RequestRecord | null>;

  /**
   * Calcula y retorna las métricas globales para la API de monitoreo (RF-03).
   */
  getMetrics(): Promise<MetricsResult>;

  /**
   * Elimina registros anteriores a una fecha específica (retención/limpieza).
   */
  deleteOlderThan(date: Date): Promise<number>;
}
