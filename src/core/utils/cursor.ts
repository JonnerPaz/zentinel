/**
 * Codifica una cadena o fecha a formato Base64 para ser usado como cursor
 */
export function encodeCursor(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64url");
}

/**
 * Decodifica un cursor en Base64 de vuelta a su valor original
 */
export function decodeCursor(cursor: string): string | null {
  try {
    return Buffer.from(cursor, "base64url").toString("utf-8");
  } catch {
    return null;
  }
}
