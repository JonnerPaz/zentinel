import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor } from "../../../../src/core/utils/cursor.js";

describe("encodeCursor / decodeCursor", () => {
  it("redondea el valor original", () => {
    const value = "2026-08-06T20:00:00.000Z::abc-123";
    expect(decodeCursor(encodeCursor(value))).toBe(value);
  });

  it("codifica timestamps + id (formato documentado)", () => {
    const cursor = encodeCursor("2026-08-06T20:00:00.000Z::a1b2c3");
    expect(cursor).not.toContain("::");
    const decoded = decodeCursor(cursor);
    expect(decoded?.split("::")).toEqual(["2026-08-06T20:00:00.000Z", "a1b2c3"]);
  });

  it("decodifica cursores estándar base64 (compat)", () => {
    expect(decodeCursor("MjAyNi0wOC0wNg==")).toBe("2026-08-06");
  });

  it("retorna null ante un cursor inválido", () => {
    // Buffer.from con base64url no lanza por caracteres inválidos, pero sí ante
    // entradas que no son strings (el try/catch de decodeCursor lo devuelve null).
    expect(decodeCursor(123 as unknown as string)).toBeNull();
    expect(decodeCursor(null as unknown as string)).toBeNull();
    expect(decodeCursor("")).toBe("");
  });
});
