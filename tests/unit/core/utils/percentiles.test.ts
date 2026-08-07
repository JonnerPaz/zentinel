import { describe, it, expect } from "vitest";
import { calculatePercentiles } from "../../../../src/core/utils/percentiles.js";

describe("calculatePercentiles", () => {
  it("retorna 0 para listas vacías", () => {
    expect(calculatePercentiles([])).toEqual({ p50: 0, p95: 0, p99: 0 });
    expect(calculatePercentiles(null as unknown as number[])).toEqual({ p50: 0, p95: 0, p99: 0 });
  });

  it("un solo valor es el percentil para todos", () => {
    expect(calculatePercentiles([42])).toEqual({ p50: 42, p95: 42, p99: 42 });
  });

  it("calcula percentiles correctos en una secuencia ordenada", () => {
    // [10,20,30,40,50]: p50 → índice ceil(2.5)-1 = 2 → 30
    // p95/p99 → índice ceil(4.75/4.95)-1 = 4 → 50
    expect(calculatePercentiles([10, 20, 30, 40, 50])).toEqual({ p50: 30, p95: 50, p99: 50 });
  });

  it("ordena la entrada aunque venga desordenada", () => {
    expect(calculatePercentiles([50, 10, 40, 20, 30])).toEqual({ p50: 30, p95: 50, p99: 50 });
  });

  it("redondea los percentiles", () => {
    // [1,2,3,4]: p50 → índice 1 → 2; p95/p99 → índice 3 → 4
    expect(calculatePercentiles([4, 1, 3, 2])).toEqual({ p50: 2, p95: 4, p99: 4 });
  });
});
