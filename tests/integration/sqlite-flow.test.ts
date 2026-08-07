import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { Logger } from "../../src/index.js";
import { waitFor } from "../helpers/fixtures.js";

let dir: string | null = null;
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
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

describe("Flujo integración: Middleware → Queue → SQLiteStorage → Métricas", () => {
  it("persiste requests y logs en disco y los agrega", async () => {
    dir = mkdtempSync(join(tmpdir(), "zentinel-flow-"));
    const app = express();
    logger = new Logger({
      config: {
        strategy: "sqlite",
        sqlite: { dbPath: join(dir, "flow.db") },
        batch: { maxSize: 1, flushIntervalMs: 1000 },
      },
    });
    await logger.mountMonitoring(app, "/api/monitoring");
    app.use(logger.middleware());
    app.use(express.json());
    app.get("/api/ping", (_req, res) => res.json({ ok: true }));

    server = app.listen(0);
    await new Promise((r) => server!.on("listening", r));
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/api/ping`);
    expect(res.status).toBe(200);
    logger.logWarning("ping hecho", undefined, { file: "sqlite-flow.test.ts" });

    await waitFor(async () => (await logger!.queryRequests({})).pagination.totalCount === 1, 3000);
    await waitFor(async () => (await logger!.getLogs({})).pagination.totalCount === 1, 3000);

    const requests = await logger!.queryRequests({});
    expect(requests.data[0]?.path).toBe("/api/ping");
    expect(requests.data[0]?.statusCode).toBe(200);

    const metrics = await logger!.getMetrics();
    expect(metrics.requests.total).toBe(1);
    expect(metrics.requests.byStatus["2xx"]).toBe(1);

    const logs = await logger!.getLogs({});
    expect(logs.data[0]?.level).toBe("WARNING");
  });

  it("los datos sobreviven a una nueva instancia (persistencia real)", async () => {
    dir = mkdtempSync(join(tmpdir(), "zentinel-flow-"));
    const dbPath = join(dir, "persist.db");

    const first = new Logger({ config: { strategy: "sqlite", sqlite: { dbPath } } });
    await first.queryRequests({}); // barrera de ready (espera initialize)
    first.logInfo("persistencia", undefined, { file: "sqlite-flow.test.ts" });
    await waitFor(async () => (await first.getLogs({})).pagination.totalCount === 1, 3000);
    await first.close();

    const second = new Logger({ config: { strategy: "sqlite", sqlite: { dbPath } } });
    await second.queryRequests({});
    const logs = await second.getLogs({});
    expect(logs.pagination.totalCount).toBe(1);
    expect(logs.data[0]?.message).toBe("persistencia");
    await second.close();
    logger = null;
  });
});
