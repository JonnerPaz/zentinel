<p style= "text-align: center; font-size: 2.5em">Zentinel</p>

<p style= "text-align: center; font-size: 1em">A modular and simple TypeScript logging and monitoring library for Express applications</p>

---

## Features

- **Express middleware** — Captures every request/response pair: method, path,
  status code, latency, headers, query, body, client IP, user agent, and more.
- **Structured logging** — Emit log entries with levels (`INFO`, `WARNING`, `ERROR`, `DEBUG`),
  stack traces, metadata, and source context (file, line, function).
- **Multiple storage strategies** — Choose between in-memory (circular buffer),
  SQLite (local embedded), or PostgreSQL (remote server) without changing your
  application code.
- **Batch writes** — `AsyncQueue` + `BatchProcessor` accumulates records and flushes
  them in configurable batches, keeping I/O overhead under 5ms per request.
- **Cursor-based pagination** — Base64-encoded `timestamp` + `id` cursors avoid
  the pitfalls of offset-based pagination (skips, duplicates) under active writes.
- **Metrics dashboard** — Built-in Preact SPA with Chart.js showing request rates,
  latency percentiles (p50/p95/p99), error grouping, top endpoints, and slowest
  endpoints.
- **Configurable retention** — Automatic cleanup of old records via a configurable
  TTL scheduler.
- **Sensitive header masking** — Redact credentials and secrets from logged headers
  with zero external dependencies.
- **Config via JSON + env vars** — Load settings from `logger.config.json` with
  `${VAR}` environment variable resolution and Zod schema validation.
- **Basic auth** — Protect the monitoring endpoints with configurable credentials.

## Installation

```bash
pnpm add zentinel
# or
npm install zentinel
```

## Quick Start

```typescript
import express from "express";
import { Logger } from "zentinel";

const app = express();
const logger = new Logger({ strategy: "memory" });

app.use(logger.middleware());
app.get("/", (req, res) => res.send("OK"));

app.listen(3000);
```

Once your app is running, visit `http://localhost:3000/api/monitoring/dashboard`
to view the metrics dashboard.

## Configuration

Create a `logger.config.json` file in your project root:

```json
{
  "strategy": "sqlite",
  "sqlite": {
    "dbPath": "./data/logs.db"
  },
  "batch": {
    "maxSize": 50,
    "flushIntervalMs": 1000
  },
  "retention": {
    "requestDays": 30,
    "logDays": 14
  },
  "monitoring": {
    "username": "admin",
    "password": "secret"
  },
  "masking": {
    "headers": ["authorization", "cookie", "x-api-key"]
  }
}
```

Environment variables are resolved automatically: `${DB_PATH}` in the config file
is replaced with the value of the `DB_PATH` environment variable.

## Storage Strategies

| Strategy   | Class             | Persistence                       | Use case                    |
| ---------- | ----------------- | --------------------------------- | --------------------------- |
| `memory`   | `MemoryStorage`   | Circular buffer in RAM            | Development, ephemeral data |
| `sqlite`   | `SQLiteStorage`   | Local `.db` file (better-sqlite3) | Single-server production    |
| `postgres` | `PostgresStorage` | Remote PostgreSQL server (pg)     | Multi-server / production   |

The correct implementation is selected automatically via `StorageFactory` based on
the `strategy` field in the configuration.

## Monitoring Dashboard

Zentinel ships with a Preact single-page application served from the monitoring
router. It provides:

- Real-time request rate (req/min) indicator
- Latency distribution (average, p50, p95, p99)
- Status code breakdown (2xx, 3xx, 4xx, 5xx)
- Error grouping by endpoint
- Top 10 most requested endpoints
- Top 10 slowest endpoints
- System uptime and package version

Access it at `http://localhost:3000/api/monitoring/dashboard`.

## Data Models

### RequestRecord

| Field          | Type                 | Description                         |
| -------------- | -------------------- | ----------------------------------- |
| `id`           | `string` (UUID v4)   | Unique identifier                   |
| `timestamp`    | `string` (ISO 8601)  | When the request occurred           |
| `method`       | `HttpMethod`         | HTTP method (GET, POST, etc.)       |
| `path`         | `string`             | Request path                        |
| `statusCode`   | `number`             | HTTP response status code           |
| `latencyMs`    | `number`             | Response time in milliseconds       |
| `clientIp`     | `string` (optional)  | Client IP (supports IPv6)           |
| `userAgent`    | `string` (optional)  | User-Agent header                   |
| `requestBody`  | `unknown` (optional) | Parsed request body                 |
| `responseBody` | `unknown` (optional) | Parsed response body                |
| `errorMessage` | `string` (optional)  | Error message if the request failed |

### LogEntry

| Field        | Type                                    | Description                         |
| ------------ | --------------------------------------- | ----------------------------------- |
| `id`         | `string` (UUID v4)                      | Unique identifier                   |
| `timestamp`  | `string` (ISO 8601)                     | When the log was created            |
| `level`      | `LogLevel`                              | `INFO`, `WARNING`, `ERROR`, `DEBUG` |
| `message`    | `string`                                | Log message                         |
| `stackTrace` | `string` (optional)                     | Stack trace for errors              |
| `metadata`   | `Record<string, unknown>` (optional)    | Custom structured data              |
| `context`    | `{ file, line?, function? }` (optional) | Source code location                |

## API Endpoints

The monitoring router exposes the following endpoints under `/api/monitoring`:

| Endpoint        | Method | Description                       |
| --------------- | ------ | --------------------------------- |
| `/requests`     | GET    | Query request records (paginated) |
| `/requests/:id` | GET    | Get a single request record by ID |
| `/logs`         | GET    | Query log entries (paginated)     |
| `/metrics`      | GET    | Get aggregated metrics            |
| `/dashboard`    | GET    | SPA monitoring dashboard          |

## Development

```bash
git clone <repo-url>
pnpm install
pnpm test          # Run unit + integration tests
pnpm build         # Build library + monitoring UI
pnpm dev           # Start dev server with hot reload
```

### Commit conventions

This project follows **Conventional Commits**. Commits are validated via husky + commitlint:

```gitcommit
feat: add PostgreSQL storage strategy
fix: handle empty request body in capture middleware

BREAKING CHANGE: rename `store()` to `storeRequest()`
```

## License

MIT

