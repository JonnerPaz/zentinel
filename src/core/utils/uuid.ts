import crypto from "crypto";

export function generateUUID(): string {
  return crypto.randomUUID();
}
