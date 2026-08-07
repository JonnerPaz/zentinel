import { z } from "zod";
import type { LoggerConfig, DeepPartial } from "./defaults.js";

/**
 * Schema Zod de validación (ARCHITECTURE.md: `config/validator.ts`).
 * Todos los campos son opcionales: se validan contra `mergeConfig` + defaults.
 */
export const configSchema = z.object({
  strategy: z.enum(["memory", "sqlite", "postgres", "postgresql"]).optional(),
  batch: z
    .object({
      maxSize: z.number().int().positive().optional(),
      flushIntervalMs: z.number().int().positive().optional(),
    })
    .optional(),
  retention: z
    .object({
      requestDays: z.number().positive().optional(),
      logDays: z.number().positive().optional(),
    })
    .optional(),
  monitoring: z
    .object({
      username: z.string().min(1).optional(),
      password: z.string().min(1).optional(),
    })
    .optional(),
  masking: z
    .object({
      headers: z.array(z.string().min(1)).optional(),
    })
    .optional(),
  sqlite: z
    .object({
      dbPath: z.string().min(1).optional(),
    })
    .optional(),
  postgres: z
    .object({
      connectionString: z.string().min(1).optional(),
    })
    .optional(),
});

export type RawConfig = z.infer<typeof configSchema>;

/**
 * Valida la configuración con Zod y devuelve una parcial tipada.
 * Normaliza la variante documentada `postgresql` a `postgres`.
 * Lanza un error de validación si los valores no cumplen el schema.
 */
export function validateConfig(raw: unknown): DeepPartial<LoggerConfig> {
  const parsed = configSchema.parse(raw ?? {});

  const result: DeepPartial<LoggerConfig> = {
    ...(parsed.batch !== undefined ? { batch: parsed.batch } : {}),
    ...(parsed.retention !== undefined ? { retention: parsed.retention } : {}),
    ...(parsed.monitoring !== undefined ? { monitoring: parsed.monitoring } : {}),
    ...(parsed.masking !== undefined ? { masking: parsed.masking } : {}),
    ...(parsed.sqlite !== undefined ? { sqlite: parsed.sqlite } : {}),
    ...(parsed.postgres !== undefined ? { postgres: parsed.postgres } : {}),
  } as DeepPartial<LoggerConfig>;

  if (parsed.strategy === "postgresql") {
    result.strategy = "postgres";
  } else if (parsed.strategy !== undefined) {
    result.strategy = parsed.strategy;
  }

  return result;
}
