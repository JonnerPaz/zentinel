// Lista de campos por defecto que deben ser enmascarados (en minúsculas)
const SENSITIVE_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "token",
]);

/**
 * Recibe un objeto de headers y reemplaza los valores sensibles por '***MASKED***'.
 * `extraKeys` permite agregar headers configurables desde la config (masking.headers).
 */
export function maskHeaders(headers: Record<string, any>, extraKeys: string[] = []): Record<string, any> {
  if (!headers || typeof headers !== "object") return {};

  const keys = new Set(SENSITIVE_KEYS);
  for (const key of extraKeys) {
    keys.add(key.toLowerCase());
  }

  const masked: Record<string, any> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (keys.has(lowerKey)) {
      masked[key] = "***MASKED***";
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

/**
 * Recibe un objeto o body y enmascara de forma recursiva campos sensibles
 */
export function maskData(data: any): any {
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => maskData(item));
  }

  if (typeof data === "object") {
    const maskedObj: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        maskedObj[key] = "***MASKED***";
      } else if (typeof value === "object" && value !== null) {
        maskedObj[key] = maskData(value);
      } else {
        maskedObj[key] = value;
      }
    }

    return maskedObj;
  }

  return data;
}
