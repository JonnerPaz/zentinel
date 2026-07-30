/**
 * Retorna la fecha y hora actual en formato ISO 8601 (UTC)
 */
export function getCurrentISOString(): string {
  return new Date().toISOString();
}

/**
 * Valida si un string recibido cumple con la estructura de fecha ISO 8601 válida
 */
export function isValidISOString(dateString: string): boolean {
  if (!dateString) return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime()) && date.toISOString() === dateString;
}
