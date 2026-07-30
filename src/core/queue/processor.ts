import type { RequestRecord } from "../entities/request-record.js";
import type { Storage } from "../storage/interface.js";

export interface BatchProcessorOptions {
  batchSize?: number; // Cantidad máxima de registros por lote (ej. 50)
  flushIntervalMs?: number; // Tiempo máximo de espera antes de vaciar (ej. 1000ms)
}

export class AsyncQueue {
  private queue: RequestRecord[] = [];

  /**
   * Encola un registro en memoria de forma no bloqueante.
   */
  public enqueue(record: RequestRecord): void {
    this.queue.push(record);
  }

  /**
   * Extrae todos los elementos acumulados actualmente en la cola.
   */
  public dequeueAll(): RequestRecord[] {
    return this.queue.splice(0, this.queue.length);
  }

  /**
   * Retorna la cantidad de elementos en la cola.
   */
  public size(): number {
    return this.queue.length;
  }
}

export class BatchProcessor {
  private queue: AsyncQueue;
  private storage: Storage;
  private batchSize: number; // ¡Ahora sí la usamos!
  private flushIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(queue: AsyncQueue, storage: Storage, options: BatchProcessorOptions = {}) {
    this.queue = queue;
    this.storage = storage;
    this.batchSize = options.batchSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 1000;
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
      // Extrae registros de la cola
      const recordsToProcess = this.queue.dequeueAll();
      if (recordsToProcess.length > 0) {
        // Guarda todos los registros de un solo viaje a la base de datos / archivo
        await this.storage.saveBatch(recordsToProcess);
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
