import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SQLiteStorage, type SQLiteStorageOptions } from "../../../src/storage/sqlite.js";
import { makeRequest, makeLog } from "../../helpers/fixtures.js";

let dir: string;
let storage: SQLiteStorage;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "zentinel-test-"));
});

afterEach(async () => {
  await storage?.close();
  rmSync(dir, { recursive: true, force: true });
});

function createStorage(options: SQLiteStorageOptions = {}): SQLiteStorage {
  storage = new SQLiteStorage({ dbPath: join(dir, "test.db"), ...options });
  return storage;
}

describe("SQLiteStorage", () => {
  it("initialize crea las tablas y permite store/getById", async () => {
    const s = createStorage();
    await s.initialize();
    const record = makeRequest();
    await s.store(record);
    // El deserializador agrega {} / 0 para columnas NULL; verificamos los campos
    // significativos con toMatchObject.
    expect(await s.getById(record.id)).toMatchObject(record);
  });

  it("es idempotente: initialize repetido no falla", async () => {
    const s = createStorage();
    await s.initialize();
    await s.initialize();
    await s.store(makeRequest());
    expect((await s.query({})).pagination.totalCount).toBe(1);
  });

  it("store sobre el mismo id reemplaza (INSERT OR REPLACE)", async () => {
    const s = createStorage();
    await s.initialize();
    const record = makeRequest();
    await s.store(record);
    await s.store({ ...record, statusCode: 201 });
    const result = await s.query({});
    expect(result.pagination.totalCount).toBe(1);
    expect(result.data[0]?.statusCode).toBe(201);
  });

  it("persiste campos opcionales: body, query, headers, error", async () => {
    const s = createStorage();
    await s.initialize();
    const record = makeRequest({
      method: "POST",
      path: "/api/create",
      statusCode: 500,
      requestBody: { a: 1 },
      requestQuery: { page: "2" },
      requestHeaders: { authorization: "***MASKED***" },
      responseHeaders: { "x-powered-by": "Express" },
      responseBody: { error: "boom" },
      errorMessage: "boom",
      stackTrace: "at handler (file.ts:1)",
      clientIp: "::1",
      userAgent: "test-agent",
    });
    await s.store(record);
    const stored = await s.getById(record.id);
    expect(stored?.requestBody).toEqual({ a: 1 });
    expect(stored?.requestQuery).toEqual({ page: "2" });
    expect(stored?.requestHeaders).toEqual({ authorization: "***MASKED***" });
    expect(stored?.responseBody).toEqual({ error: "boom" });
    expect(stored?.errorMessage).toBe("boom");
    expect(stored?.stackTrace).toBe("at handler (file.ts:1)");
  });

  it("query aplica filtros y paginación por cursor", async () => {
    const s = createStorage();
    await s.initialize();
    for (let i = 0; i < 25; i++) {
      const ts = new Date(Date.parse("2026-01-01T00:00:00.000Z") + i * 60_000).toISOString();
      await s.store(makeRequest({ timestamp: ts, method: i % 2 === 0 ? "GET" : "POST" }));
    }

    const page1 = await s.query({ limit: 10 });
    expect(page1.data).toHaveLength(10);
    expect(page1.pagination.hasMore).toBe(true);
    expect(page1.pagination.totalCount).toBe(25);

    const page2 = await s.query({ limit: 10, cursor: page1.pagination.nextCursor! });
    expect(page2.data).toHaveLength(10);
    const ids = new Set([...page1.data, ...page2.data].map((r) => r.id));
    expect(ids.size).toBe(20);

    expect((await s.query({ methods: ["GET"] })).pagination.totalCount).toBe(13);
    expect((await s.query({ pathPattern: "/api" })).pagination.totalCount).toBe(25);
  });

  it("getLogs filtra por nivel y pagina", async () => {
    const s = createStorage();
    await s.initialize();
    for (let i = 0; i < 5; i++) {
      await s.storeLog(makeLog({ level: "INFO", message: `info-${i}` }));
    }
    await s.storeLog(makeLog({ level: "ERROR", message: "fatal" }));

    const all = await s.getLogs({ limit: 10 });
    expect(all.pagination.totalCount).toBe(6);
    const errors = await s.getLogs({ levels: ["ERROR"] });
    expect(errors.data).toHaveLength(1);
    expect(errors.data[0]?.message).toBe("fatal");
  });

  it("getMetrics agrega por método, status y endpoints", async () => {
    const s = createStorage();
    await s.initialize();
    await s.store(makeRequest({ method: "GET", path: "/a", statusCode: 200, latencyMs: 5 }));
    await s.store(makeRequest({ method: "GET", path: "/a", statusCode: 500, latencyMs: 100 }));
    await s.store(makeRequest({ method: "POST", path: "/b", statusCode: 201, latencyMs: 15 }));

    const metrics = await s.getMetrics();
    expect(metrics.requests.total).toBe(3);
    expect(metrics.requests.byMethod.GET).toBe(2);
    expect(metrics.requests.byStatus["2xx"]).toBe(2);
    expect(metrics.requests.byStatus["5xx"]).toBe(1);
    expect(metrics.errors.total5xx).toBe(1);
    expect(metrics.topLists.topEndpoints[0]).toEqual({ path: "/a", count: 2 });
    expect(metrics.topLists.slowestEndpoints[0]).toEqual({ path: "/a", avgLatency: 52.5 });
  });

  it("cleanup elimina registros vencidos por retención", async () => {
    const s = createStorage({ retentionDays: 1, logRetentionDays: 1 });
    await s.initialize();
    const oldTs = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await s.store(makeRequest({ timestamp: oldTs }));
    await s.store(makeRequest({ timestamp: new Date().toISOString() }));
    await s.storeLog(makeLog({ timestamp: oldTs }));

    const deleted = await s.cleanup();
    expect(deleted).toBe(2);
    expect((await s.query({})).pagination.totalCount).toBe(1);
    expect((await s.getLogs({})).pagination.totalCount).toBe(0);
  });
});
