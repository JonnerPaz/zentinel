import { Router } from "express";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import type Logger from "../logger.js";
import type { LoggerConfig } from "../config/defaults.js";
import { createAuthMiddleware } from "./auth.js";
import type { LogLevel } from "../core/entities/log-entry.js";
import type { LogFilters } from "../core/entities/filters.js";
import type { QueryFilters } from "../core/entities/filters.js";
import type { HttpMethod } from "../core/entities/request-record.js";
import type { Request } from "express";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let dashboardHtml: string | null = null;

function getDashboardHtml(): string {
  if (!dashboardHtml) {
    dashboardHtml = readFileSync(resolve(__dirname, "dashboard.html"), "utf-8");
  }
  return dashboardHtml;
}

/**
 * Crea un router Express con los endpoints de monitoreo:
 *
 * GET  /              → Sirve la interfaz web (HTML/CSS/JS)
 * GET  /metrics       → Métricas en JSON
 * GET  /requests      → Lista paginada de requests
 * GET  /requests/:id  → Detalle de una request específica
 * GET  /logs          → Lista paginada de logs
 *
 * La autenticación se aplica según la configuración.
 */
export function createMonitoringRouter(logger: Logger, config: LoggerConfig): Router {
  const router = Router();
  const auth = createAuthMiddleware(config);

  // GET / — Sirve la interfaz web
  router.get("/", auth, (req, res) => {
    res.type("html").send(getDashboardHtml());
  });

  // GET /metrics — Métricas en JSON
  router.get("/metrics", auth, async (req, res) => {
    try {
      const metrics = await logger.getMetrics();
      res.json(metrics);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      res.status(500).json({ error: "Error al obtener métricas", detail: message });
    }
  });

  // GET /requests — Lista paginada de requests
  router.get("/requests", auth, async (req, res) => {
    try {
      const filters: QueryFilters = {
        limit: req.query.limit ? Math.min(Math.max(Number(req.query.limit), 1), 200) : 50,

        order: (req.query.order as "asc" | "desc") ?? "desc",
      };

      if (req.query.cursor) {
        filters.cursor = req.query.cursor as string;
      }

      if (req.query.methods) {
        filters.methods = (req.query.methods as string).split(",") as HttpMethod[];
      }

      if (req.query.statusCodes) {
        filters.statusCodes = (req.query.statusCodes as string).split(",").map(Number);
      }

      if (req.query.path) {
        filters.pathPattern = req.query.path as string;
      }

      if (req.query.from) {
        filters.dateFrom = req.query.from as string;
      }

      if (req.query.to) {
        filters.dateTo = req.query.to as string;
      }

      if (req.query.latencyMin) {
        filters.latencyMin = Number(req.query.latencyMin);
      }

      if (req.query.latencyMax) {
        filters.latencyMax = Number(req.query.latencyMax);
      }

      if (req.query.errors !== undefined) {
        filters.hasError = req.query.errors === "true";
      }

      const result = await logger.queryRequests(filters);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      res.status(500).json({ error: "Error al obtener requests", detail: message });
    }
  });

  // GET /requests/:id — Detalle de una request
  router.get("/requests/:id", auth, async (req: Request<{ id: string }>, res) => {
    try {
      if (!req.params.id) {
        return res.status(400).json({ error: "ID de request no proporcionada" });
      }
      const record = await logger.getRequestById(req.params.id);
      if (!record) return res.status(404).json({ error: "Request no encontrada" });
      res.json(record);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      res.status(500).json({ error: "Error al obtener detalle", detail: message });
    }
  });

  // GET /logs — Lista paginada de logs
  router.get("/logs", auth, async (req, res) => {
    try {
      const filters: LogFilters = {
        limit: req.query.limit ? Math.min(Math.max(Number(req.query.limit), 1), 200) : 50,

        order: (req.query.order as "asc" | "desc") ?? "desc",
      };

      if (req.query.cursor) {
        filters.cursor = req.query.cursor as string;
      }

      if (req.query.levels) {
        filters.levels = (req.query.levels as string).split(",") as LogLevel[];
      }

      if (req.query.from) {
        filters.dateFrom = req.query.from as string;
      }

      if (req.query.to) {
        filters.dateTo = req.query.to as string;
      }

      const result = await logger.getLogs(filters);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      res.status(500).json({ error: "Error al obtener logs", detail: message });
    }
  });

  return router;
}
