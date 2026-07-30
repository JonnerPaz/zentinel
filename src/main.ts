import { appendFile } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { Request, Response, NextFunction } from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));

const logFilePath = join(__dirname, "access.log");

// Middleware personalizado
const customLogger = (req: Request, res: Response, next: NextFunction) => {
  console.log("Logeger iniciado...");
  const startTime = process.hrtime(); // Captura tiempo con alta precisión
  const { method, url, ip } = req;
  const timestamp = new Date().toISOString();

  // El evento 'finish' se dispara cuando la respuesta se ha enviado al cliente
  res.on("finish", () => {
    const { statusCode } = res;
    const diff = process.hrtime(startTime);
    const durationInMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2); // Convierte a milisegundos

    // Crear el objeto de registro estructurado (JSON)
    const logEntry = {
      timestamp,
      method,
      url,
      statusCode,
      duration: `${durationInMs}ms`,
      ip: ip || req.socket.remoteAddress || "unknown",
    };

    const logString = JSON.stringify(logEntry) + "\n";

    // 1. Mostrar en consola automáticamente
    console.log(`[LOG] ${method} ${url} ${statusCode} - ${durationInMs}ms`);

    // 2. Guardar en archivo de forma asíncrona sin bloquear el servidor
    appendFile(logFilePath, logString, (err) => {
      if (err) console.error("Error escribiendo en el archivo de log:", err);
    });
  });

  next(); // Pasa el control al siguiente middleware o ruta
};

export default customLogger;
