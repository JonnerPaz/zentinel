import type { RequestRecord } from "../entities/request-record.js";
import type { LogEntry } from "../entities/log-entry.js";
import type { QueryFilters, LogFilters } from "../entities/filters.js";
import type { PaginationResult } from "../entities/pagination.js";
import type { MetricsResult } from "../entities/metrics.js";

/**
 * Contrato de Storage (ARCHITECTURE.md).
 */
export interface Storage {
  /**
   * Prepara el almacenamiento (crea tablas/colecciones si no existen).
   */
  initialize(): Promise<void>;

  /**
   * Guarda un RequestRecord.
   */
  store(request: RequestRecord): Promise<void>;

  /**
   * Guarda una entrada de LogEntry.
   */
  storeLog(entry: LogEntry): Promise<void>;

  /**
   * Obtiene un RequestRecord por su id.
   */
  getById(id: string): Promise<RequestRecord | null>;

  /**
   * Consulta paginada de RequestRecords con filtros.
   */
  query(filters: QueryFilters): Promise<PaginationResult<RequestRecord>>;

  /**
   * Consulta paginada de LogEntries con filtros.
   */
  getLogs(filters: LogFilters): Promise<PaginationResult<LogEntry>>;

  /**
   * Calcula y retorna las métricas globales.
   */
  getMetrics(): Promise<MetricsResult>;

  /**
   * Elimina los registros vencidos según la retención configurada.
   * Retorna la cantidad de registros eliminados.
   */
  cleanup(): Promise<number>;

  /**
   * Cierra conexiones/recursos del almacenamiento.
   */
  close(): Promise<void>;
}
