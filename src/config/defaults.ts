export type StorageStrategy = "memory" | "sqlite" | "postgres";

export interface LoggerConfig {
  strategy: StorageStrategy;
  batch: {
    maxSize: number;
    flushIntervalMs: number;
  };
  retention: {
    requestDays: number;
    logDays: number;
  };
  monitoring: {
    username: string;
    password: string;
  };
  masking: {
    headers: string[];
  };
  sqlite: {
    dbPath: string;
  };
  postgres: {
    connectionString: string;
  };
}

export const DEFAULT_CONFIG: LoggerConfig = {
  strategy: "memory",
  batch: {
    maxSize: 50,
    flushIntervalMs: 1000,
  },
  retention: {
    requestDays: 30,
    logDays: 14,
  },
  monitoring: {
    username: "admin",
    password: "admin",
  },
  masking: {
    headers: ["authorization", "cookie", "set-cookie", "x-api-key", "access_token", "refresh_token"],
  },
  sqlite: {
    dbPath: "./data/logs.db",
  },
  postgres: {
    connectionString: "postgresql://localhost:5432/zentinel",
  },
};

/**
 * Recorre recursivamente los objetos para permitir configuraciones parciales
 * en cada nivel (los arreglos se mantienen tal cual).
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<unknown> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function mergeSection<T extends object>(def: T, partial: DeepPartial<T> | undefined): T {
  return { ...def, ...partial } as T;
}

/**
 * Merge de defaults con la configuración parcial (spread + objetos anidados).
 */
export function mergeConfig(partial: DeepPartial<LoggerConfig> | undefined): LoggerConfig {
  return {
    strategy: partial?.strategy ?? DEFAULT_CONFIG.strategy,
    batch: mergeSection(DEFAULT_CONFIG.batch, partial?.batch),
    retention: mergeSection(DEFAULT_CONFIG.retention, partial?.retention),
    monitoring: mergeSection(DEFAULT_CONFIG.monitoring, partial?.monitoring),
    masking: mergeSection(DEFAULT_CONFIG.masking, partial?.masking),
    sqlite: mergeSection(DEFAULT_CONFIG.sqlite, partial?.sqlite),
    postgres: mergeSection(DEFAULT_CONFIG.postgres, partial?.postgres),
  };
}
