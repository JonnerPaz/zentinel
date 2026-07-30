type LogLevel = "INFO" | "WARNING" | "ERROR" | "DEBUG";

export interface LogEntry {
  id: string; // UUID v4
  timestamp: string; // ISO 8601
  level: LogLevel;
  message: string;
  stackTrace?: string;
  metadata?: Record<string, unknown>;
  context?: {
    file: string;
    line?: number;
    function?: string;
  };
  createdAt: string; // ISO 8601
}
