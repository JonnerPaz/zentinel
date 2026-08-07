import { describe, it, expect, vi, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createMonitoringRouter, type MonitoringLogger } from "../../../src/monitoring/router.js";
import { DEFAULT_CONFIG, type LoggerConfig } from "../../../src/config/defaults.js";
import type { QueryFilters, LogFilters } from "../../../src/core/entities/filters.js";
import type { PaginationResult } from "../../../src/core/entities/pagination.js";
import type { RequestRecord } from "../../../src/core/entities/request-record.js";
import type { MetricsResult } from "../../../src/core/entities/metrics.js";
import { makeRequest, makeLog } from "../../helpers/fixtures.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers.length = 0;
});

const emptyPage: PaginationResult<never> = {
  data: [],
  pagination: { hasMore: false, nextCursor: null, prevCursor: null, totalCount: 0 },
};

function startApp(fake: MonitoringLogger, config: LoggerConfig = { ...DEFAULT_CONFIG, monitoring: { username: "admin", password: "secret" } }) {
  const app = express();
  app.use("/api/monitoring", createMonitoringRouter(fake, config));
  const server = app.listen(0);
  servers.push(server);
  return server;
}

async function urlOf(server: Server): Promise<string> {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/api/monitoring`;
}

const authHeader = () => `Basic ${Buffer.from("admin:secret").toString("base64")}`;

function makeFakeLogger(overrides: Partial<MonitoringLogger> = {}): MonitoringLogger {
  return {
    queryRequests: vi.fn().mockResolvedValue({ ...emptyPage, data: [makeRequest()] }),
    getRequestById: vi.fn().mockResolvedValue(makeRequest()),
    getLogs: vi.fn().mockResolvedValue({ ...emptyPage, data: [makeLog()] }),
    getMetrics: vi.fn().mockResolvedValue({ requests: { total: 1, byMethod: {}, byStatus: { "2xx": 1, "3xx": 0, "4xx": 0, "5xx": 0 }, ratePerMinute: 0 }, performance: { avgLatencyMs: 0, minLatencyMs: 0, maxLatencyMs: 0, p50: 0, p95: 0, p99: 0 }, errors: { total4xx: 0, total5xx: 0, byEndpoint: [] }, system: { uptime: 1, version: "test" }, topLists: { topEndpoints: [], slowestEndpoints: [] } }),
    ...overrides,
  };
}

describe("createMonitoringRouter", () => {
  it("sirve el dashboard HTML en / y /dashboard sin autenticación", async () => {
    const server = startApp(makeFakeLogger());
    const base = await urlOf(server);
    for (const path of ["", "/dashboard"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const body = await res.text();
      expect(body).toContain("Zentinel");
      expect(body).toContain("<html");
    }
  });

  it("requiere autenticación en los endpoints de datos", async () => {
    const server = startApp(makeFakeLogger());
    const base = await urlOf(server);
    for (const path of ["/metrics", "/requests", "/requests/abc", "/logs"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toContain("Basic");
    }
  });

  it("GET /metrics devuelve las métricas del logger", async () => {
    const fake = makeFakeLogger();
    const server = startApp(fake);
    const res = await fetch(`${await urlOf(server)}/metrics`, { headers: { Authorization: authHeader() } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetricsResult;
    expect(body.requests.total).toBe(1);
    expect(fake.getMetrics).toHaveBeenCalledTimes(1);
  });

  it("GET /requests traduce los query params a QueryFilters", async () => {
    const fake = makeFakeLogger();
    const server = startApp(fake);
    const qs = "limit=25&order=asc&methods=GET,POST&statusCodes=200,404&path=/api&from=2026-01-01&to=2026-01-31&latencyMin=10&latencyMax=500&errors=true&cursor=abc";
    const res = await fetch(`${await urlOf(server)}/requests?${qs}`, { headers: { Authorization: authHeader() } });
    expect(res.status).toBe(200);

    const filters = (fake.queryRequests as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as QueryFilters;
    expect(filters.limit).toBe(25);
    expect(filters.order).toBe("asc");
    expect(filters.methods).toEqual(["GET", "POST"]);
    expect(filters.statusCodes).toEqual([200, 404]);
    expect(filters.pathPattern).toBe("/api");
    expect(filters.dateFrom).toBe("2026-01-01");
    expect(filters.dateTo).toBe("2026-01-31");
    expect(filters.latencyMin).toBe(10);
    expect(filters.latencyMax).toBe(500);
    expect(filters.hasError).toBe(true);
    expect(filters.cursor).toBe("abc");
  });

  it("GET /requests clampa limit entre 1 y 200", async () => {
    const fake = makeFakeLogger();
    const server = startApp(fake);
    await fetch(`${await urlOf(server)}/requests?limit=9999`, { headers: { Authorization: authHeader() } });
    const filters = (fake.queryRequests as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as QueryFilters;
    expect(filters.limit).toBe(200);
  });

  it("GET /requests/:id devuelve el detalle o 404", async () => {
    const fake = makeFakeLogger({ getRequestById: vi.fn().mockResolvedValue(null) });
    const server = startApp(fake);
    const base = await urlOf(server);
    const headers = { Authorization: authHeader() };

    const ok = await fetch(`${base}/requests/id-1`, { headers });
    expect(ok.status).toBe(404);

    fake.getRequestById = vi.fn().mockResolvedValue(makeRequest({ id: "id-1" }));
    const found = await fetch(`${base}/requests/id-1`, { headers });
    expect(found.status).toBe(200);
    const body = (await found.json()) as RequestRecord;
    expect(body.id).toBe("id-1");
  });

  it("GET /logs traduce levels y paginación", async () => {
    const fake = makeFakeLogger();
    const server = startApp(fake);
    const res = await fetch(`${await urlOf(server)}/logs?levels=ERROR,WARNING&limit=10&order=asc`, {
      headers: { Authorization: authHeader() },
    });
    expect(res.status).toBe(200);
    const filters = (fake.getLogs as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as LogFilters;
    expect(filters.levels).toEqual(["ERROR", "WARNING"]);
    expect(filters.limit).toBe(10);
    expect(filters.order).toBe("asc");
  });

  it("devuelve 500 JSON ante errores del logger", async () => {
    const fake = makeFakeLogger({ getMetrics: vi.fn().mockRejectedValue(new Error("boom")) });
    const server = startApp(fake);
    const res = await fetch(`${await urlOf(server)}/metrics`, { headers: { Authorization: authHeader() } });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBeTruthy();
    expect(body.detail).toContain("boom");
  });
});
