import type { Storage } from "../storage/interface.js";

export interface SchedulerOptions {
  /** Frecuencia con la que revisa y purga (ej. 24 horas). */
  checkIntervalMs?: number;
}

/**
 * Ejecuta Storage.cleanup() periódicamente según la configuración de retención.
 */
export class CleanupScheduler {
  private storage: Storage;
  private checkIntervalMs: number;
  private timer: NodeJS.Timeout | null = null;

  constructor(storage: Storage, options: SchedulerOptions = {}) {
    this.storage = storage;
    // Por defecto revisa cada 24 horas (86,400,000 ms)
    this.checkIntervalMs = options.checkIntervalMs ?? 24 * 60 * 60 * 1000;
  }

  /**
   * Inicia la tarea programada de limpieza.
   */
  public start(): void {
    if (this.timer) return;

    // Ejecuta una limpieza inicial al arrancar
    void this.runCleanup();

    // Programa ejecuciones periódicas
    this.timer = setInterval(() => {
      void this.runCleanup();
    }, this.checkIntervalMs);
  }

  /**
   * Detiene la tarea programada.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Ejecuta el proceso de purga de registros vencidos.
   */
  private async runCleanup(): Promise<void> {
    try {
      const deletedCount = await this.storage.cleanup();
      if (deletedCount > 0) {
        console.log(`[Logger Scheduler] Se eliminaron ${deletedCount} registros vencidos`);
      }
    } catch (error) {
      console.error("[Logger Scheduler] Error durante la purga de logs antiguos:", error);
    }
  }
}
