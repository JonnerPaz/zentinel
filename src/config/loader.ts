import { readFileSync } from "fs";
import { resolve } from "path";
import { mergeConfig, type LoggerConfig } from "./defaults.js";
import { validateConfig } from "./validator.js";

const DEFAULT_CONFIG_FILE = "logger.config.json";

/**
 * Reemplaza los placeholders `${VAR}` con el valor de `process.env[VAR]`.
 * El valor se escapa como string JSON para no romper el parseo (paths de Windows,
 * comillas, saltos de línea). Si la variable no existe, deja el placeholder intacto.
 */
export function resolveEnvPlaceholders(content: string): string {
  return content.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    const value = process.env[name];
    if (value === undefined) return match;
    return JSON.stringify(value).slice(1, -1);
  });
}

/**
 * Carga la configuración:
 * 1. Si se pasa un objeto parcial → se valida y mergea con los defaults.
 * 2. Si no, se intenta leer `logger.config.json` (o `configPath`) desde el cwd,
 *    resolviendo `${VAR}` con variables de entorno antes de parsear.
 * 3. Si el archivo no existe → se devuelven los defaults.
 */
export function loadConfig(partial?: unknown, configPath?: string): LoggerConfig {
  if (partial !== undefined) {
    return mergeConfig(validateConfig(partial));
  }

  const file = configPath ?? DEFAULT_CONFIG_FILE;
  try {
    const content = readFileSync(resolve(file), "utf-8");
    const json: unknown = JSON.parse(resolveEnvPlaceholders(content));
    return mergeConfig(validateConfig(json));
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return mergeConfig(undefined);
    }
    throw error;
  }
}
