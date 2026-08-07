import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig, resolveEnvPlaceholders } from "../../../src/config/loader.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function tempFile(content: string): string {
  dir = mkdtempSync(join(tmpdir(), "zentinel-config-"));
  const file = join(dir, "logger.config.json");
  writeFileSync(file, content);
  return file;
}

describe("resolveEnvPlaceholders", () => {
  it("reemplaza ${VAR} con variables de entorno", () => {
    process.env.ZENTINEL_TEST_DB = "./data/from-env.db";
    expect(resolveEnvPlaceholders('{"dbPath": "${ZENTINEL_TEST_DB}"}')).toBe('{"dbPath": "./data/from-env.db"}');
    delete process.env.ZENTINEL_TEST_DB;
  });

  it("deja el placeholder intacto si la variable no existe", () => {
    expect(resolveEnvPlaceholders('{"x": "${NO_EXISTE_12345}"}')).toBe('{"x": "${NO_EXISTE_12345}"}');
  });

  it("escapa valores con caracteres especiales", () => {
    process.env.ZENTINEL_ESC = 'C:\\path\\"quoted"';
    expect(resolveEnvPlaceholders('{"x": "${ZENTINEL_ESC}"}')).toBe('{"x": "C:\\\\path\\\\\\"quoted\\""}');
    delete process.env.ZENTINEL_ESC;
  });
});

describe("loadConfig", () => {
  it("usa los defaults si no existe el archivo", () => {
    dir = mkdtempSync(join(tmpdir(), "zentinel-config-"));
    const config = loadConfig(undefined, join(dir, "no-existe.json"));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("mergea una configuración parcial con los defaults", () => {
    const config = loadConfig({ strategy: "sqlite", batch: { maxSize: 10 } });
    expect(config.strategy).toBe("sqlite");
    expect(config.batch.maxSize).toBe(10);
    expect(config.batch.flushIntervalMs).toBe(DEFAULT_CONFIG.batch.flushIntervalMs);
    expect(config.retention).toEqual(DEFAULT_CONFIG.retention);
    expect(config.monitoring).toEqual(DEFAULT_CONFIG.monitoring);
  });

  it("lee un archivo JSON desde el cwd y resuelve ${VAR}", () => {
    process.env.ZENTINEL_TEST_DB = "./custom/db.sqlite";
    const file = tempFile('{"strategy": "sqlite", "sqlite": {"dbPath": "${ZENTINEL_TEST_DB}"}}');
    const config = loadConfig(undefined, file);
    expect(config.strategy).toBe("sqlite");
    expect(config.sqlite.dbPath).toBe("./custom/db.sqlite");
    delete process.env.ZENTINEL_TEST_DB;
  });

  it("lanza error ante un JSON inválido", () => {
    const file = tempFile("{ esto no es json");
    expect(() => loadConfig(undefined, file)).toThrow();
  });

  it("lanza error ante una estrategia inválida", () => {
    expect(() => loadConfig({ strategy: "mysql" })).toThrow();
  });
});
