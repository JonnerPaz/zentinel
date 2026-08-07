import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { Logger } from "../../src/index.js";
import { waitFor } from "../helpers/fixtures.js";

let logger: Logger | null = null;
let server: Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise((r) => server!.close(r));
    server = null;
  }
  if (logger) {
    await logger.close();
    logger = null;
  }
});

async function startFlow() {
  const app = express();
  logger = new Logger({
    config: {
      strategy: "memory",
      batch: { maxSize: 1, flushIntervalMs: 1000 },
      monitoring: { username: "admin", password: "secret" },
    },
  });
  await logger.mountMonitoring(app, "/api/monitoring");
  app.use(logger.middleware());
  app.use(express.json());
  app.get("/api/users", (_req, res) => res.json([{ id: 1 }]));
  app.post("/api/users", (req, res) => res.status(201).json({ created: req.body }));

  server = app.listen(0);
  await new Promise((r) => server!.on("listening", r));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("Flujo integración: Middleware → Queue → MemoryStorage → Métricas", () => {
  it("captura requests, persiste en memoria y agrega métricas", async () => {
    const base = await startFlow();

    const getRes = await fetch(`${base}/api/users`);
    expect(getRes.status).toBe(200);
    const postRes = await fetch(`${base}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ana" }),
    });
    expect(postRes.status).toBe(201);

    // batch maxSize=1 → flush inmediato; esperamos a que se persista
    await waitFor(async () => (await logger!.queryRequests({})).pagination.totalCount === 2, 3000);

    const requests = await logger!.queryRequests({ limit: 10 });
    expect(requests.pagination.totalCount).toBe(2);
    const methods = new Set(requests.data.map((r) => r.method));
    expect(methods).toEqual(new Set(["GET", "POST"]));

    const metrics = await logger!.getMetrics();
    expect(metrics.requests.total).toBe(2);
    expect(metrics.requests.byMethod.GET).toBe(1);
    expect(metrics.requests.byStatus["2xx"]).toBe(2);
    expect(metrics.system.version).toBeTruthy();
  });

  it("captura errores 4xx/5xx como requests con errorMessage", async () => {
    const app = express();
    logger = new Logger({ config: { strategy: "memory", batch: { maxSize: 1 } } });
    app.use(logger.middleware());
    app.get("/api/error", (_req, res) => res.status(500).json({ error: "boom" }));
    server = app.listen(0);
    await new Promise((r) => server!.on("listening", r));
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/api/error`);
    expect(res.status).toBe(500);
    await waitFor(async () => (await logger!.queryRequests({})).pagination.totalCount === 1, 3000);

    const metrics = await logger!.getMetrics();
    expect(metrics.errors.total5xx).toBe(1);
    expect(metrics.errors.byEndpoint).toContainEqual({ path: "/api/error", count: 1 });
  });

  it("logInfo/logError persisten LogEntries y son consultables", async () => {
    await startFlow();
    logger!.logInfo("usuario creado", { userId: 7 });
    logger!.logError("falló algo", { retry: 2 }, { file: "flow.test.ts", line: 1 });

    await waitFor(async () => (await logger!.getLogs({})).pagination.totalCount === 2, 3000);

    const logs = await logger!.getLogs({ limit: 10 });
    expect(logs.data).toHaveLength(2);
    const levels = logs.data.map((l) => l.level).sort();
    expect(levels).toEqual(["ERROR", "INFO"]);
    expect(logs.data.find((l) => l.level === "ERROR")?.context?.file).toBe("flow.test.ts");
  });
});
