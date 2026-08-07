import { describe, it, expect } from "vitest";
import { getCurrentISOString, isValidISOString } from "../../../../src/core/utils/timestamp.js";

describe("timestamp utils", () => {
  it("getCurrentISOString devuelve ISO 8601 válido", () => {
    const now = getCurrentISOString();
    expect(isValidISOString(now)).toBe(true);
    expect(now.endsWith("Z")).toBe(true);
  });

  it("isValidISOString acepta fechas ISO exactas", () => {
    expect(isValidISOString("2026-08-06T20:00:00.000Z")).toBe(true);
  });

  it("isValidISOString rechaza formatos inválidos", () => {
    expect(isValidISOString("06/08/2026")).toBe(false);
    expect(isValidISOString("no es fecha")).toBe(false);
    expect(isValidISOString("")).toBe(false);
    expect(isValidISOString(undefined as unknown as string)).toBe(false);
  });
});
