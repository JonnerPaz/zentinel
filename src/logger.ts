// Punto de entrada del paquete: exporta el Logger público (ARCHITECTURE.md).
import type { Express } from "express";
import { createCaptureMiddleware } from "./middleware/capture.js";
import { AsyncQueue, BatchProcessor } from "./core/queue/processor.js";
import { CleanupScheduler } from "./core/queue/scheduler.js";
import type { Storage } from "./core/storage/interface.js";
import { StorageFactory } from "./storage/factory.js";
import type { StorageOptions } from "./storage/factory.js";
import { loadConfig } from "./config/loader.js";
import type { LoggerConfig } from "./config/defaults.js";
import type { RequestRecord } from "./core/entities/request-record.js";
import type { LogEntry, LogLevel } from "./core/entities/log-entry.js";
import type { QueryFilters, LogFilters } from "./core/entities/filters.js";
import type { PaginationResult } from "./core/entities/pagination.js";
import type { MetricsResult } from "./core/entities/metrics.js";
import { generateUUID } from "./core/utils/uuid.js";
import { getCurrentISOString } from "./core/utils/timestamp.js";

export interface LoggerOptions {
  /** Configuración parcial. Si se omite, se carga `logger.config.json` o los defaults. */
  config?: Partial<LoggerConfig> | Record<string, unknown>;
  /** Ruta alternativa al archivo de configuración. */
  configFile?: string;
}

/**
 * API pública de Zentinel. Encapsula storage, queue/batching y scheduler.
 */
export class Logger {
  private readonly config: LoggerConfig;
  private readonly storage: Storage;
  private readonly queue: AsyncQueue;
  private readonly processor: BatchProcessor;
  private readonly scheduler: CleanupScheduler;
  private readonly ready: Promise<void>;

  constructor(options: LoggerOptions = {}) {
    this.config = loadConfig(options.config, options.configFile);

    const commonOptions = {
      retentionDays: this.config.retention.requestDays,
      logRetentionDays: this.config.retention.logDays,
    };

    let storageOptions: StorageOptions;
    switch (this.config.strategy) {
      case "sqlite":
        storageOptions = { ...commonOptions, dbPath: this.config.sqlite.dbPath };
        break;
      case "postgres":
        storageOptions = {
          ...commonOptions,
          connectionString: this.config.postgres.connectionString,
        };
        break;
      default:
        storageOptions = { ...commonOptions };
        break;
    }

    this.storage = StorageFactory.create(this.config.strategy, storageOptions);
    // Inicialización diferida: tablas/colecciones. Los flushes y las consultas
    // esperan a `ready` antes de tocar el storage (evita la carrera de inicio).
    this.ready = this.storage.initialize();

    this.queue = new AsyncQueue();
    this.processor = new BatchProcessor(this.queue, this.storage, {
      batchSize: this.config.batch.maxSize,
      flushIntervalMs: this.config.batch.flushIntervalMs,
      beforeFlush: () => this.ready,
    });
    this.processor.start();

    this.scheduler = new CleanupScheduler(this.storage);
    this.scheduler.start();
  }

  /**
   * Middleware Express: captura cada request/response y lo encola.
   */
  middleware() {
    return createCaptureMiddleware({
      captureResponseBody: true,
      maskingHeaders: this.config.masking.headers,
      onRecordCaptured: (record) => {
        // Por ahora mostramos en consola el objeto capturado para verificar los datos de RF-02
        console.log("\n================ 📊 REGISTRO CAPTURADO ================");
        console.log("Request ID:", record.id);
        console.log("Método & URL:", record.method, record.fullUrl);
        console.log("IP Cliente:", record.clientIp);
        console.log("Request Headers:", record.requestHeaders);
        console.log("Request Body:", record.requestBody);
        console.log("------------------------------------------------------");
        console.log("Status Code:", record.statusCode);
        console.log("Latencia:", `${record.latencyMs} ms`);
        console.log("Tamaño Respuesta:", `${record.responseSizeBytes} bytes`);
        console.log("Response Body:", record.responseBody);
        if (record.errorMessage) {
          console.log("Error:", record.errorMessage);
        }
        console.log("======================================================\n");

        this.queue.enqueue({ kind: "request", record });
        this.processor.checkAutoFlush();
      },
    });
  }

  /**
   * Emite una entrada de log con el nivel indicado.
   */
  private emit(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    context?: LogEntry["context"],
  ): void {
    const timestamp = getCurrentISOString();
    const entry: LogEntry = {
      id: generateUUID(),
      timestamp,
      level,
      message,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(context !== undefined ? { context } : {}),
      createdAt: timestamp,
    };
    this.queue.enqueue({ kind: "log", entry });
    this.processor.checkAutoFlush();
  }

  public logInfo(
    message: string,
    metadata?: Record<string, unknown>,
    context?: LogEntry["context"],
  ): void {
    this.emit("INFO", message, metadata, context);
  }

  public logWarning(
    message: string,
    metadata?: Record<string, unknown>,
    context?: LogEntry["context"],
  ): void {
    this.emit("WARNING", message, metadata, context);
  }

  public logError(
    message: string,
    metadata?: Record<string, unknown>,
    context?: LogEntry["context"],
  ): void {
    this.emit("ERROR", message, metadata, context);
  }

  public logDebug(
    message: string,
    metadata?: Record<string, unknown>,
    context?: LogEntry["context"],
  ): void {
    this.emit("DEBUG", message, metadata, context);
  }

  /**
   * Consulta paginada de RequestRecords con filtros.
   */
  public async queryRequests(filters?: QueryFilters): Promise<PaginationResult<RequestRecord>> {
    await this.ready;
    return this.storage.query(filters ?? {});
  }

  /**
   * Obtiene un RequestRecord por su id.
   */
  public async getRequestById(id: string): Promise<RequestRecord | null> {
    await this.ready;
    return this.storage.getById(id);
  }

  /**
   * Consulta paginada de LogEntries con filtros.
   */
  public async getLogs(filters?: LogFilters): Promise<PaginationResult<LogEntry>> {
    await this.ready;
    return this.storage.getLogs(filters ?? {});
  }

  /**
   * Métricas agregadas globales.
   */
  public async getMetrics(): Promise<MetricsResult> {
    await this.ready;
    return this.storage.getMetrics();
  }

  /**
   * Monta el router de monitoreo (API + dashboard) bajo `basePath`.
   * El middleware de captura se monta por separado vía `middleware()`.
   */
  public async mountMonitoring(app: Express, basePath = "/api/monitoring"): Promise<void> {
    const { createMonitoringRouter } = await import("./monitoring/router.js");
    const router = createMonitoringRouter(this, this.config);
    app.use(basePath, router);
  }

  /**
   * Vacía la cola, detiene el scheduler y cierra el storage.
   */
  public async close(): Promise<void> {
    await this.processor.stop();
    this.scheduler.stop();
    await this.ready;
    await this.storage.close();
  }
}

export { AsyncQueue, BatchProcessor } from "./core/queue/processor.js";
export type { QueueItem, BatchProcessorOptions } from "./core/queue/processor.js";
export { CleanupScheduler } from "./core/queue/scheduler.js";
export { StorageFactory } from "./storage/factory.js";
export type { Storage } from "./core/storage/interface.js";
export { loadConfig } from "./config/loader.js";
export { validateConfig, configSchema } from "./config/validator.js";
export { DEFAULT_CONFIG, mergeConfig } from "./config/defaults.js";
export type { LoggerConfig, StorageStrategy } from "./config/defaults.js";
export type { RequestRecord, HttpMethod } from "./core/entities/request-record.js";
export type { LogEntry, LogLevel } from "./core/entities/log-entry.js";
export type { QueryFilters, LogFilters } from "./core/entities/filters.js";
export type { PaginationResult } from "./core/entities/pagination.js";
export type { MetricsResult } from "./core/entities/metrics.js";
export { MemoryStorage } from "./storage/memory.js";
export type { MemoryStorageOptions } from "./storage/memory.js";
export { SQLiteStorage } from "./storage/sqlite.js";
export type { SQLiteStorageOptions } from "./storage/sqlite.js";
export { PostgresStorage } from "./storage/postgres.js";
export type { PostgresStorageOptions } from "./storage/postgres.js";
