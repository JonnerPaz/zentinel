import { describe, it, expect } from "vitest";
import { MemoryStorage } from "../../../src/storage/memory.js";
import { makeRequest, makeLog } from "../../helpers/fixtures.js";

const T1 = "2026-01-01T00:00:00.000Z";
const T2 = "2026-01-02T00:00:00.000Z";
const T3 = "2026-01-03T00:00:00.000Z";

describe("MemoryStorage", () => {
  it("store + getById recupera el registro", async () => {
    const storage = new MemoryStorage();
    const record = makeRequest();
    await storage.store(record);
    expect(await storage.getById(record.id)).toEqual(record);
    expect(await storage.getById("no-existe")).toBeNull();
  });

  it("storeLog + getLogs recupera los logs", async () => {
    const storage = new MemoryStorage();
    await storage.storeLog(makeLog({ level: "ERROR", message: "falló" }));
    await storage.storeLog(makeLog({ level: "INFO" }));
    const result = await storage.getLogs({});
    expect(result.data).toHaveLength(2);
    expect(result.pagination.totalCount).toBe(2);

    const errors = await storage.getLogs({ levels: ["ERROR"] });
    expect(errors.data).toHaveLength(1);
    expect(errors.data[0]?.level).toBe("ERROR");
  });

  it("query aplica filtros combinados", async () => {
    const storage = new MemoryStorage();
    await storage.store(makeRequest({ timestamp: T1, method: "GET", path: "/api/a", statusCode: 200, latencyMs: 10 }));
    await storage.store(makeRequest({ timestamp: T2, method: "POST", path: "/api/b", statusCode: 404, latencyMs: 50 }));
    await storage.store(makeRequest({ timestamp: T3, method: "GET", path: "/api/c", statusCode: 500, latencyMs: 200 }));

    expect((await storage.query({ methods: ["GET"] })).pagination.totalCount).toBe(2);
    expect((await storage.query({ statusCodes: [404, 500] })).pagination.totalCount).toBe(2);
    expect((await storage.query({ statusRange: { min: 400, max: 499 } })).pagination.totalCount).toBe(1);
    expect((await storage.query({ pathPattern: "/api/c" })).pagination.totalCount).toBe(1);
    expect((await storage.query({ dateFrom: T2 })).pagination.totalCount).toBe(2);
    expect((await storage.query({ dateTo: T2 })).pagination.totalCount).toBe(2);
    expect((await storage.query({ latencyMin: 50, latencyMax: 200 })).pagination.totalCount).toBe(2);
    expect((await storage.query({ hasError: true })).pagination.totalCount).toBe(2);
    expect((await storage.query({ hasError: false })).pagination.totalCount).toBe(1);
  });

  it("paginación por cursor: orden desc, hasMore y sin duplicados", async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 25; i++) {
      const ts = new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 60_000).toISOString();
      await storage.store(makeRequest({ timestamp: ts }));
    }

    const page1 = await storage.query({ limit: 10 });
    expect(page1.data).toHaveLength(10);
    expect(page1.pagination.hasMore).toBe(true);
    expect(page1.pagination.nextCursor).toBeTruthy();
    expect(page1.pagination.prevCursor).toBeTruthy();
    expect(page1.pagination.totalCount).toBe(25);

    const page2 = await storage.query({ limit: 10, cursor: page1.pagination.nextCursor! });
    expect(page2.data).toHaveLength(10);
    expect(page2.pagination.hasMore).toBe(true);

    const ids = new Set([...page1.data, ...page2.data].map((r) => r.id));
    expect(ids.size).toBe(20);

    const page3 = await storage.query({ limit: 10, cursor: page2.pagination.nextCursor! });
    expect(page3.data).toHaveLength(5);
    expect(page3.pagination.hasMore).toBe(false);
    expect(page3.pagination.nextCursor).toBeNull();
  });

  it("order asc ordena cronológicamente", async () => {
    const storage = new MemoryStorage();
    await storage.store(makeRequest({ timestamp: T3 }));
    await storage.store(makeRequest({ timestamp: T1 }));
    const result = await storage.query({ order: "asc", limit: 1 });
    expect(result.data[0]?.timestamp).toBe(T1);
    const desc = await storage.query({ order: "desc", limit: 1 });
    expect(desc.data[0]?.timestamp).toBe(T3);
  });

  it("getMetrics agrega totales, percentiles y top lists", async () => {
    const storage = new MemoryStorage();
    await storage.store(makeRequest({ timestamp: new Date().toISOString(), method: "GET", path: "/a", statusCode: 200, latencyMs: 10 }));
    await storage.store(makeRequest({ timestamp: new Date().toISOString(), method: "GET", path: "/a", statusCode: 404, latencyMs: 20 }));
    await storage.store(makeRequest({ timestamp: new Date().toISOString(), method: "POST", path: "/b", statusCode: 500, latencyMs: 300 }));

    const metrics = await storage.getMetrics();
    expect(metrics.requests.total).toBe(3);
    expect(metrics.requests.byMethod.GET).toBe(2);
    expect(metrics.requests.byMethod.POST).toBe(1);
    expect(metrics.requests.byStatus["2xx"]).toBe(1);
    expect(metrics.requests.byStatus["4xx"]).toBe(1);
    expect(metrics.requests.byStatus["5xx"]).toBe(1);
    expect(metrics.errors.total4xx).toBe(1);
    expect(metrics.errors.total5xx).toBe(1);
    expect(metrics.errors.byEndpoint).toContainEqual({ path: "/a", count: 1 });
    expect(metrics.topLists.topEndpoints[0]).toEqual({ path: "/a", count: 2 });
    expect(metrics.topLists.slowestEndpoints[0]).toEqual({ path: "/b", avgLatency: 300 });
    expect(metrics.performance.p50).toBeGreaterThan(0);
    expect(metrics.performance.maxLatencyMs).toBe(300);
    expect(metrics.system.version).toBeTruthy();
  });

  it("cleanup elimina registros viejos y retorna la cantidad", async () => {
    const oldTs = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const storage = new MemoryStorage({ retentionDays: 1, logRetentionDays: 1 });
    await storage.store(makeRequest({ timestamp: oldTs }));
    await storage.store(makeRequest({ timestamp: new Date().toISOString() }));
    await storage.storeLog(makeLog({ timestamp: oldTs }));

    const deleted = await storage.cleanup();
    expect(deleted).toBe(2);
    expect((await storage.query({})).pagination.totalCount).toBe(1);
    expect((await storage.getLogs({})).pagination.totalCount).toBe(0);
  });

  it("trim respeta maxEntries (buffer circular FIFO)", async () => {
    const storage = new MemoryStorage({ maxEntries: 5 });
    for (let i = 0; i < 10; i++) {
      await storage.store(makeRequest());
    }
    expect((await storage.query({})).pagination.totalCount).toBe(5);
  });
});
