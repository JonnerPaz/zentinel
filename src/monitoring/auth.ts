import type { Request, Response, NextFunction } from "express";
import type { LoggerConfig } from "../config/defaults.js";

/**
 * Crea un middleware de autenticación HTTP Basic.
 * Si las credenciales están vacías en la config, el acceso es público.
 */
export function createAuthMiddleware(config: LoggerConfig) {
  const { username, password } = config.monitoring;

  // Si no hay credenciales configuradas, no hay autenticación
  if (!username || !password) {
    return (req: Request, res: Response, next: NextFunction) => next();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", "Basic realm=\"Zentinel Monitoring\"");
      return res.status(401).json({ error: "Autenticación requerida" });
    }

    const base64 = authHeader.split(" ")[1];
    const decoded = Buffer.from(base64!, "base64").toString("utf-8");
    const [user, pass] = decoded.split(":");

    if (user !== username || pass !== password) {
      res.setHeader("WWW-Authenticate", "Basic realm=\"Zentinel Monitoring\"");
      return res.status(401).json({ error: "Credenciales inválidas" });
    }

    next();
  };
}