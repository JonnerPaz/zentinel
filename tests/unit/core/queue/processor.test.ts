import { describe, it, expect, vi, beforeEach } from "vitest";
import { AsyncQueue, BatchProcessor } from "../../../../src/core/queue/processor.js";
import type { Storage } from "../../../../src/core/storage/interface.js";
import { makeRequest, makeLog } from "../../../helpers/fixtures.js";

describe("AsyncQueue", () => {
  let queue: AsyncQueue;

  beforeEach(() => {
    queue = new AsyncQueue();
  });

  it("encola y mide su tamaño", () => {
    queue.enqueue({ kind: "request", record: makeRequest() });
    queue.enqueue({ kind: "log", entry: makeLog() });
    expect(queue.size()).toBe(2);
  });

  it("dequeueAll extrae todo y vacía la cola", () => {
    queue.enqueue({ kind: "request", record: makeRequest() });
    queue.enqueue({ kind: "log", entry: makeLog() });
    const items = queue.dequeueAll();
    expect(items).toHaveLength(2);
    expect(queue.size()).toBe(0);
    expect(queue.dequeueAll()).toHaveLength(0);
  });
});

describe("BatchProcessor", () => {
  let storage: Storage;
  let queue: AsyncQueue;

  beforeEach(() => {
    storage = {
      initialize: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      storeLog: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn(),
      query: vi.fn(),
      getLogs: vi.fn(),
      getMetrics: vi.fn(),
      cleanup: vi.fn().mockResolvedValue(0),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Storage;
    queue = new AsyncQueue();
  });

  it("flush persiste requests vía store y logs vía storeLog", async () => {
    const processor = new BatchProcessor(queue, storage);
    queue.enqueue({ kind: "request", record: makeRequest() });
    queue.enqueue({ kind: "log", entry: makeLog() });
    await processor.flush();
    expect(storage.store).toHaveBeenCalledTimes(1);
    expect(storage.storeLog).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it("no hace nada si la cola está vacía", async () => {
    const processor = new BatchProcessor(queue, storage);
    await processor.flush();
    expect(storage.store).not.toHaveBeenCalled();
    expect(storage.storeLog).not.toHaveBeenCalled();
  });

  it("checkAutoFlush dispara flush al alcanzar batchSize", async () => {
    const processor = new BatchProcessor(queue, storage, { batchSize: 2 });
    queue.enqueue({ kind: "request", record: makeRequest() });
    processor.checkAutoFlush();
    expect(storage.store).not.toHaveBeenCalled();
    queue.enqueue({ kind: "request", record: makeRequest() });
    processor.checkAutoFlush();
    await vi.waitFor(() => expect(storage.store).toHaveBeenCalledTimes(2));
  });

  it("espera el hook beforeFlush antes de persistir", async () => {
    const beforeFlush = vi.fn().mockResolvedValue(undefined);
    const processor = new BatchProcessor(queue, storage, { beforeFlush });
    queue.enqueue({ kind: "request", record: makeRequest() });
    await processor.flush();
    expect(beforeFlush).toHaveBeenCalled();
    expect(storage.store).toHaveBeenCalled();
  });

  it("errores del storage no rompen el processor", async () => {
    (storage.store as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db caída"));
    const processor = new BatchProcessor(queue, storage);
    queue.enqueue({ kind: "request", record: makeRequest() });
    await processor.flush();
    expect(queue.size()).toBe(0);
    // Puede seguir procesando
    (storage.store as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    queue.enqueue({ kind: "request", record: makeRequest() });
    await processor.flush();
    expect(storage.store).toHaveBeenCalledTimes(2);
  });

  it("stop limpia el timer y hace flush final", async () => {
    const processor = new BatchProcessor(queue, storage, { flushIntervalMs: 5000 });
    processor.start();
    queue.enqueue({ kind: "request", record: makeRequest() });
    await processor.stop();
    expect(storage.store).toHaveBeenCalledTimes(1);
  });
});
