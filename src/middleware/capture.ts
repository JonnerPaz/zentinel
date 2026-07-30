import type { Request, Response, NextFunction } from "express";
import type { RequestRecord, HttpMethod } from "../core/entities/request-record.js";
import { generateUUID } from "../core/utils/uuid.js";
import { maskHeaders } from "../core/utils/masking.js";

// Opción de configuración si necesitas deshabilitar o limitar el body
export interface CaptureOptions {
  captureResponseBody?: boolean;
  onRecordCaptured?: (record: RequestRecord) => void;
}

export function createCaptureMiddleware(options: CaptureOptions = {}) {
  const { captureResponseBody = true, onRecordCaptured } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    // 1. Iniciar medición de alta precisión (HR Time) y datos base del Request
    const startTime = process.hrtime.bigint();
    const requestId = generateUUID();
    const timestamp = new Date().toISOString();

    // Inyectamos el ID en los headers de la request/response para trazabilidad
    req.headers["x-request-id"] = requestId;
    res.setHeader("X-Request-Id", requestId);

    // Capturar Body original si existe
    const requestBody = req.body ?? null;

    // 2. Interceptar el Body de la Respuesta (Monkey-Patching de res.send / res.write)
    let responseBody: any = null;
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

      // 4. Construir la entidad RequestRecord requerida por RF-02
      const record: RequestRecord = {
        request: {
          request_id: requestId,
          timestamp,
          method: req.method as HttpMethod,
          full_url: fullUrl,
          path: req.path || req.baseUrl,
          headers: maskHeaders(req.headers), // Usamos tu util de enmascaramiento
          query_params: req.query || {},
          body: requestBody,
          client_ip: req.ip || req.socket.remoteAddress || "unknown",
          user_agent: req.get("user-agent") || "unknown",
        },
        response: {
          status_code: statusCode,
          headers: maskHeaders(res.getHeaders()),
          body: responseBody,
          latency_ms: Math.round(latencyMs),
          response_size_bytes: responseSizeBytes || Number(res.get("content-length") || 0),
          error_message: errorMessage,
          stack_trace: stackTrace,
        },
      };

      // 5. Enviar a tu cola asíncrona o procesador sin bloquear
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
