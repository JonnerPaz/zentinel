import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { Logger } from "../../src/index.js";
import { waitFor } from "../helpers/fixtures.js";

/**
 * Requiere un PostgreSQL real accesible vía DATABASE_URL.
 * Si no existe la variable, el suite se salta (decisión del equipo).
 */
const hasPostgres = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasPostgres)("Flujo integración: Logger → PostgresStorage → Métricas", () => {
  const connectionString = process.env.DATABASE_URL!;
  let logger: Logger | null = null;
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString });
    await pool.query("TRUNCATE requests, logs");
  });

  afterAll(async () => {
    if (logger) {
      await logger.close();
      logger = null;
    }
    await pool.query("TRUNCATE requests, logs");
    await pool.end();
  });

  it("persiste requests y logs en PostgreSQL y agrega métricas", async () => {
    logger = new Logger({
      config: {
        strategy: "postgres",
        postgres: { connectionString },
        batch: { maxSize: 1, flushIntervalMs: 1000 },
      },
    });
    // Barrera de ready: espera a que initialize cree las tablas
    await logger.queryRequests({});

    logger.logInfo("hola postgres", { env: "test" });
    await waitFor(async () => (await logger!.getLogs({})).pagination.totalCount === 1, 5000);

    const logs = await logger!.getLogs({ levels: ["INFO"] });
    expect(logs.data[0]?.message).toBe("hola postgres");

    const metrics = await logger!.getMetrics();
    expect(metrics.requests.total).toBe(0);
    expect(metrics.system.version).toBeTruthy();
  }, 30000);
});
