import type { Express } from "express";
import { Logger as InternalLogger, type LoggerOptions } from "./logger.js";

export { type LoggerOptions };

export default class Logger {
  private readonly engine: InternalLogger;

  constructor(options?: LoggerOptions) {
    this.engine = new InternalLogger(options);
  }

  /**
   * Conveniencia: monta el middleware de captura para toda la app y el
   * router de monitoreo bajo `basePath`.
   */
  async attach(app: Express, basePath = "/api/monitoring") {
    app.use(this.engine.middleware());
    await this.engine.mountMonitoring(app, basePath);
  }

  middleware() {
    return this.engine.middleware();
  }

  mountMonitoring(app: Express, basePath = "/api/monitoring") {
    return this.engine.mountMonitoring(app, basePath);
  }

  logInfo(...args: Parameters<InternalLogger["logInfo"]>) {
    this.engine.logInfo(...args);
  }

  logWarning(...args: Parameters<InternalLogger["logWarning"]>) {
    this.engine.logWarning(...args);
  }

  logError(...args: Parameters<InternalLogger["logError"]>) {
    this.engine.logError(...args);
  }

  logDebug(...args: Parameters<InternalLogger["logDebug"]>) {
    this.engine.logDebug(...args);
  }

  queryRequests(...args: Parameters<InternalLogger["queryRequests"]>) {
    return this.engine.queryRequests(...args);
  }

  getRequestById(...args: Parameters<InternalLogger["getRequestById"]>) {
    return this.engine.getRequestById(...args);
  }

  getLogs(...args: Parameters<InternalLogger["getLogs"]>) {
    return this.engine.getLogs(...args);
  }

  getMetrics(...args: Parameters<InternalLogger["getMetrics"]>) {
    return this.engine.getMetrics(...args);
  }

  close() {
    return this.engine.close();
  }
}
