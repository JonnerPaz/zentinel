import type { Storage } from "../core/storage/interface.js";
import { MemoryStorage, type MemoryStorageOptions } from "./memory.js";
import { SQLiteStorage, type SQLiteStorageOptions } from "./sqlite.js";
import { PostgresStorage, type PostgresStorageOptions } from "./postgres.js";

export type StorageStrategy = "memory" | "sqlite" | "postgres";

export type StorageOptions = MemoryStorageOptions | SQLiteStorageOptions | PostgresStorageOptions;

/**
 * Lee la estrategia y devuelve la implementación de Storage correspondiente.
 * El middleware nunca conoce la clase concreta.
 * La inicialización (tablas) la ejecuta el Logger vía `Storage.initialize()`.
 */
export class StorageFactory {
  public static create(strategy: StorageStrategy, options?: StorageOptions): Storage {
    switch (strategy) {
      case "sqlite": {
        const sqliteOptions = options as SQLiteStorageOptions | undefined;
        return new SQLiteStorage({
          ...(sqliteOptions?.dbPath !== undefined ? { dbPath: sqliteOptions.dbPath } : {}),
          ...(sqliteOptions?.retentionDays !== undefined ? { retentionDays: sqliteOptions.retentionDays } : {}),
          ...(sqliteOptions?.logRetentionDays !== undefined ? { logRetentionDays: sqliteOptions.logRetentionDays } : {}),
        });
      }
      case "postgres": {
        const postgresOptions = options as PostgresStorageOptions | undefined;
        if (!postgresOptions?.connectionString) {
          throw new Error("PostgresStorage requiere connectionString");
        }
        return new PostgresStorage({
          connectionString: postgresOptions.connectionString,
          ...(postgresOptions.retentionDays !== undefined ? { retentionDays: postgresOptions.retentionDays } : {}),
          ...(postgresOptions.logRetentionDays !== undefined
            ? { logRetentionDays: postgresOptions.logRetentionDays }
            : {}),
        });
      }
      case "memory":
      default: {
        const memoryOptions = options as MemoryStorageOptions | undefined;
        return new MemoryStorage({
          ...(memoryOptions?.maxEntries !== undefined ? { maxEntries: memoryOptions.maxEntries } : {}),
          ...(memoryOptions?.retentionDays !== undefined ? { retentionDays: memoryOptions.retentionDays } : {}),
          ...(memoryOptions?.logRetentionDays !== undefined ? { logRetentionDays: memoryOptions.logRetentionDays } : {}),
        });
      }
    }
  }
}
