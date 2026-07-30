export interface PercentilesResult {
  p50: number;
  p95: number;
  p99: number;
}

/**
 * Calcula p50, p95 y p99 a partir de una lista de latencias en ms.
 * @param latencies Arreglo de números representando la duración en milisegundos
 */
export function calculatePercentiles(latencies: number[]): PercentilesResult {
  if (!latencies || latencies.length === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }

  // Ordenar el arreglo de menor a mayor
  const sorted = [...latencies].sort((a, b) => a - b);

  const getPercentile = (p: number): number => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    const clampedIndex = Math.max(0, Math.min(index, sorted.length - 1));
    return Math.round(sorted[clampedIndex] ?? 0);
  };

  return {
    p50: getPercentile(50),
    p95: getPercentile(95),
    p99: getPercentile(99),
  };
}
