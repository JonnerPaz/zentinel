import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CleanupScheduler } from "../../../../src/core/queue/scheduler.js";
import type { Storage } from "../../../../src/core/storage/interface.js";

describe("CleanupScheduler", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = {
      initialize: vi.fn(),
      store: vi.fn(),
      storeLog: vi.fn(),
      getById: vi.fn(),
      query: vi.fn(),
      getLogs: vi.fn(),
      getMetrics: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(0),
      close: vi.fn(),
    } as unknown as Storage;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ejecuta una limpieza inmediata al arrancar", async () => {
    const scheduler = new CleanupScheduler(storage);
    scheduler.start();
    scheduler.stop();
    await vi.runAllTimersAsync();
    expect(storage.cleanup).toHaveBeenCalledTimes(1);
  });

  it("vuelve a ejecutar cleanup según el intervalo", async () => {
    const scheduler = new CleanupScheduler(storage, { checkIntervalMs: 1000 });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(3000);
    scheduler.stop();
    // 1 inicial + 3 intervalos
    expect(storage.cleanup).toHaveBeenCalledTimes(4);
  });

  it("stop detiene el intervalo", async () => {
    const scheduler = new CleanupScheduler(storage, { checkIntervalMs: 1000 });
    scheduler.start();
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(storage.cleanup).toHaveBeenCalledTimes(1);
  });

  it("no se duplica con start() repetido", async () => {
    const scheduler = new CleanupScheduler(storage, { checkIntervalMs: 1000 });
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(2000);
    scheduler.stop();
    expect(storage.cleanup).toHaveBeenCalledTimes(3);
  });

  it("tolera errores del cleanup", async () => {
    (storage.cleanup as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));
    const scheduler = new CleanupScheduler(storage);
    scheduler.start();
    scheduler.stop();
    await vi.runAllTimersAsync();
    expect(storage.cleanup).toHaveBeenCalled();
  });
});
