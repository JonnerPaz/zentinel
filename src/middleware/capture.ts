import type { Request, Response, NextFunction } from "express";
import type { RequestRecord, HttpMethod } from "../core/entities/request-record.js";
import { generateUUID } from "../core/utils/uuid.js";
import { maskHeaders } from "../core/utils/masking.js";

export interface CaptureOptions {
  captureResponseBody?: boolean;
  /** Headers sensibles adicionales (masking.headers de la config). */
  maskingHeaders?: string[];
  onRecordCaptured?: (record: RequestRecord) => void;
}

export function createCaptureMiddleware(options: CaptureOptions = {}) {
  const { captureResponseBody = true, maskingHeaders = [], onRecordCaptured } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. Iniciar medición de alta precisión (HR Time) y datos base del Request
    const startTime = process.hrtime.bigint();
    const id = generateUUID();
    const timestamp = new Date().toISOString();

    // Inyectamos el ID en los headers de la request/response para trazabilidad
    req.headers["x-request-id"] = id;
    res.setHeader("X-Request-Id", id);

    // Capturar Body original si existe
    const requestBody = req.body ?? null;

    // 2. Interceptar el Body de la Respuesta (Monkey-Patching de res.send / res.write)
    let responseBody: unknown = null;
    let responseSizeBytes = 0;

    const originalSend = res.send;
    const originalWrite = res.write;

    if (captureResponseBody) {
      const chunks: Buffer[] = [];

      // Interceptamos res.write
      res.write = function (chunk: any, ...args: any[]): boolean {
        if (chunk) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return originalWrite.apply(res, [chunk, ...args] as any);
      };

      // Interceptamos res.send
      res.send = function (body: any): Response {
        if (body) {
          if (typeof body === "object" && !Buffer.isBuffer(body)) {
            responseBody = body;
            responseSizeBytes = Buffer.byteLength(JSON.stringify(body));
          } else if (typeof body === "string" || Buffer.isBuffer(body)) {
            responseBody = body.toString();
            responseSizeBytes = Buffer.byteLength(body);
          }
        }
        return originalSend.apply(res, [body]);
      };
    }

    // 3. Escuchar el evento 'finish' (se dispara al enviar la respuesta al cliente)
    res.on("finish", () => {
      const endTime = process.hrtime.bigint();
      // Duración en ms calculada con Nanosegundos (BigInt) para no perder precisión
      const latencyMs = Number(endTime - startTime) / 1_000_000;

      const statusCode = res.statusCode;

      // Obtener URL completa
      const protocol = req.protocol || "http";
      const host = req.get("host") || "localhost";
      const fullUrl = `${protocol}://${host}${req.originalUrl || req.url}`;

      // Extraer StackTrace o Error si ocurrió en Express (ej. adjunto por un errorHandler)
      const err = (res as any).locals?.error || (req as any).error;
      const errorMessage = statusCode >= 400 ? err?.message || res.statusMessage : undefined;
      const stackTrace = statusCode >= 500 && err ? err.stack : undefined;

      const clientIp = req.ip || req.socket.remoteAddress;
      const userAgent = req.get("user-agent");
      const responseHeaders = maskHeaders(res.getHeaders(), maskingHeaders);

      // 4. Construir la entidad RequestRecord documentada (RF-02)
      const record: RequestRecord = {
        id,
        timestamp,
        method: req.method as HttpMethod,
        path: req.path || req.baseUrl,
        fullUrl,
        statusCode,
        latencyMs: Math.round(latencyMs),
        ...(clientIp ? { clientIp } : {}),
        ...(userAgent ? { userAgent } : {}),
        requestHeaders: maskHeaders(req.headers, maskingHeaders) as Record<string, string>,
        ...(Object.keys(req.query).length > 0 ? { requestQuery: req.query as Record<string, string> } : {}),
        requestBody,
        ...(Object.keys(responseHeaders).length > 0 ? { responseHeaders: responseHeaders as Record<string, string> } : {}),
        ...(responseBody !== null ? { responseBody } : {}),
        responseSizeBytes: responseSizeBytes || Number(res.get("content-length") || 0),
        ...(errorMessage ? { errorMessage } : {}),
        ...(stackTrace ? { stackTrace } : {}),
        createdAt: timestamp,
      };

      // 5. Enviar al logger sin bloquear el evento HTTP
      if (onRecordCaptured) {
        // Usa setImmediate para no impactar los I/O del evento HTTP
        setImmediate(() => {
          onRecordCaptured(record);
        });
      }
    });

    next();
  };
}
