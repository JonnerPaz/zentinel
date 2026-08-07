import type { RequestRecord } from "../../src/core/entities/request-record.js";
import type { LogEntry } from "../../src/core/entities/log-entry.js";
import { generateUUID } from "../../src/core/utils/uuid.js";
import { getCurrentISOString } from "../../src/core/utils/timestamp.js";

export function makeRequest(overrides: Partial<RequestRecord> = {}): RequestRecord {
  const now = getCurrentISOString();
  return {
    id: generateUUID(),
    timestamp: now,
    method: "GET",
    path: "/api/test",
    fullUrl: "http://localhost:3000/api/test",
    statusCode: 200,
    latencyMs: 10,
    createdAt: now,
    ...overrides,
  };
}

export function makeLog(overrides: Partial<LogEntry> = {}): LogEntry {
  const now = getCurrentISOString();
  return {
    id: generateUUID(),
    timestamp: now,
    level: "INFO",
    message: "test message",
    createdAt: now,
    ...overrides,
  };
}

/**
 * Espera hasta que `predicate` sea verdadero (timeout por defecto 2s).
 * Útil para flujos asincrónicos (setImmediate, flushes, etc.).
 */
export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: timeout esperando la condición");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
