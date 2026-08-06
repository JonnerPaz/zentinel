import type { RequestRecord } from "../entities/request-record.js";
import type { LogEntry } from "../entities/log-entry.js";
import type { Storage } from "../storage/interface.js";

/**
 * Elementos que fluyen por AsyncQueue → BatchProcessor → Storage
 * (tanto RequestRecord como LogEntry, según el flujo de ARCHITECTURE.md).
 */
export type QueueItem = { kind: "request"; record: RequestRecord } | { kind: "log"; entry: LogEntry };

export interface BatchProcessorOptions {
  batchSize?: number; // Cantidad máxima de registros por lote (ej. 50)
  flushIntervalMs?: number; // Tiempo máximo de espera antes de vaciar (ej. 1000ms)
  /**
   * Hook opcional que se espera antes de persistir cada lote.
   * Permite que el Logger garantice que el storage terminó de inicializarse
   * (p. ej. tablas creadas) sin perder registros encolados.
   */
  beforeFlush?: () => Promise<void>;
}

export class AsyncQueue {
  private items: QueueItem[] = [];

  /**
   * Encola un elemento en memoria de forma no bloqueante.
   */
  public enqueue(item: QueueItem): void {
    this.items.push(item);
  }

  /**
   * Extrae todos los elementos acumulados actualmente en la cola.
   */
  public dequeueAll(): QueueItem[] {
    return this.items.splice(0, this.items.length);
  }

  /**
   * Retorna la cantidad de elementos en la cola.
   */
  public size(): number {
    return this.items.length;
  }
}

export class BatchProcessor {
  private queue: AsyncQueue;
  private storage: Storage;
  private batchSize: number;
  private flushIntervalMs: number;
  private beforeFlush: (() => Promise<void>) | undefined;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(queue: AsyncQueue, storage: Storage, options: BatchProcessorOptions = {}) {
    this.queue = queue;
    this.storage = storage;
    this.batchSize = options.batchSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
    this.beforeFlush = options.beforeFlush;
  }

  /**
   * Inicia el temporizador de fondo.
   */
  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Procesa la cola si pasó el tiempo O si la cola superó el batchSize.
   */
  public async flush(): Promise<void> {
    // Si ya se está procesando o la cola está vacía, no hace nada
    if (this.isProcessing || this.queue.size() === 0) return;

    this.isProcessing = true;

    try {
      if (this.beforeFlush) {
        await this.beforeFlush();
      }
      // Extrae los elementos acumulados de la cola
      const itemsToProcess = this.queue.dequeueAll();
      for (const item of itemsToProcess) {
        // Persiste a través del contrato Storage (store / storeLog)
        if (item.kind === "request") {
          await this.storage.store(item.record);
        } else {
          await this.storage.storeLog(item.entry);
        }
      }
    } catch (error) {
      console.error("[Logger BatchProcessor] Error guardando el lote:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Método de ayuda para verificar si alcanzamos el tamaño límite
   */
  public checkAutoFlush(): void {
    // Usamos batchSize para verificar si la cola se llenó
    if (this.queue.size() >= this.batchSize) {
      void this.flush();
    }
  }

  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush(); // Guarda lo que haya quedado pendiente antes de cerrar
  }
}
