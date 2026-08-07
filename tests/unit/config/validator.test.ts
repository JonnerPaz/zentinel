import { describe, it, expect } from "vitest";
import { validateConfig, configSchema } from "../../../src/config/validator.js";

describe("validateConfig", () => {
  it("acepta una configuración completa válida", () => {
    const result = validateConfig({
      strategy: "sqlite",
      batch: { maxSize: 100, flushIntervalMs: 500 },
      retention: { requestDays: 7, logDays: 3 },
      monitoring: { username: "u", password: "p" },
      masking: { headers: ["x-secret"] },
      sqlite: { dbPath: "./x.db" },
      postgres: { connectionString: "postgresql://localhost/x" },
    });
    expect(result.strategy).toBe("sqlite");
    expect(result.batch).toEqual({ maxSize: 100, flushIntervalMs: 500 });
  });

  it("acepta objetos vacíos (todo opcional)", () => {
    expect(validateConfig({})).toEqual({});
    expect(validateConfig(undefined)).toEqual({});
  });

  it("normaliza la variante 'postgresql' a 'postgres'", () => {
    const result = validateConfig({ strategy: "postgresql" });
    expect(result.strategy).toBe("postgres");
  });

  it("rechaza estrategias desconocidas", () => {
    expect(() => validateConfig({ strategy: "mysql" })).toThrow();
    expect(() => validateConfig({ strategy: "memory " })).toThrow();
  });

  it("rechaza batch con valores inválidos", () => {
    expect(() => validateConfig({ batch: { maxSize: 0 } })).toThrow();
    expect(() => validateConfig({ batch: { maxSize: -1 } })).toThrow();
    expect(() => validateConfig({ batch: { maxSize: "50" } })).toThrow();
    expect(() => validateConfig({ batch: { flushIntervalMs: 0 } })).toThrow();
  });

  it("rechaza retention con días negativos o cero", () => {
    expect(() => validateConfig({ retention: { requestDays: 0 } })).toThrow();
    expect(() => validateConfig({ retention: { logDays: -5 } })).toThrow();
  });

  it("rechaza monitoreo sin username/password", () => {
    expect(() => validateConfig({ monitoring: { username: "" } })).toThrow();
    expect(() => validateConfig({ monitoring: { password: "" } })).toThrow();
  });

  it("configSchema parsea el enum completo", () => {
    for (const s of ["memory", "sqlite", "postgres", "postgresql"]) {
      expect(configSchema.parse({ strategy: s }).strategy).toBe(s);
    }
  });
});
