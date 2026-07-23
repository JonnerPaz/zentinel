# Decisiones técnicas

## Indice

- [Decisiones de Arquitectura](#decisiones-de-arquitectura)
- [Tecnologías](#tecnologías)
- [Flujo de Datos](#flujo-de-datos)
- [Dependencias y Librerías](#dependencias-y-librerías)
- [Modelos de Datos](#modelos-de-datos)
- [Flujo de Datos](#flujo-de-datos)
- [Dependencias y Librerías](#dependencias-y-librerías)
- [Estructura de Carpetas](#estructura-de-carpetas)
- [Versionado y Publicación](#versionado-y-publicación)

---

## Tecnologías

El paquete se desarrolla en las siguientes tecnologías:

- **Framework Backend**: Express
- **Framework Frontend**: Preact
- **Lenguaje**: TypeScript
- **Base de Datos Local**: better-sqlite3
- **Base de Datos Remota**: PostgreSQL
- **Distribución**: NPM
- **Package Manager**: pnpm
- **Release Automation**: Release Please

### Por qué

- **TypeScript**: El lenguaje elegido para su facilidad de uso y comprensibilidad.

- **Express**: El framework de backend elegido para su simplicidad y facilidad de uso.

- **Preact**: El framework de frontend elegido para su simplicidad y facilidad de uso.

- **better-sqlite3**: La base de datos elegida para su facilidad de uso y comprensibilidad.

- **PostgreSQL**: La base de datos elegida para su facilidad de uso y comprensibilidad.

- **NPM**: La distribución elegida para su facilidad de uso y comprensibilidad.

- **pnpm**: Detecta dependencias no declaradas en `package.json` (crítico para un
  paquete publicado, donde una dependencia hoisteada que usas sin declararla rompe
  en casa del consumidor). Instalaciones rápidas vía hard links. `pnpm publish` publica
  al mismo registro npm sin restricciones. Sin impacto en consumidores del paquete.

- **Release Please**: Basado en conventional commits. Al pushear a main crea/actualiza
  una Release PR con el versionado y changelog propuestos. No publica, no taggea,
  no crea releases — solo deja la PR lista para que el equipo decida si mergea.
  Complementa a husky+commitlint (validan los commits en local) y es la pieza que
  garantiza SemVer (RF-08) sin automatizar nada que no deba automatizarse en etapas
  tempranas.

---

## Decisiones de Arquitectura

- **Separación RequestRecord / LogEntry**: tablas/colecciones separadas. Los campos,
  filtros e índices de cada uno son distintos; unificarlos con un discriminador
  forza a cargar columnas que no corresponden.

- **Paginación**: cursor-based, codificando `timestamp` + `id` en base64. Evita
  los saltos y duplicados del offset-based cuando llegan nuevos registros entre
  consultas.

- **Batching de escrituras**: `AsyncQueue` + `BatchProcessor` transversal a las tres
  estrategias. Escribir de a un registro por request superaría el overhead máximo
  de 5ms (RNF-01).

- **Patrón de storage**: interfaz `Storage` con implementaciones por estrategia
  (Strategy). Agregar una nueva estrategia implica solo una clase nueva; el resto
  del código no cambia.

- **Creación de instancias**: `StorageFactory` que lee `strategy` de la configuración
  y devuelve la implementación correspondiente. El middleware nunca conoce la clase
  concreta.

- **Generación de UUID**: `crypto.randomUUID()` (nativo Node 19+) con `uuid` como
  fallback para versiones anteriores.

- **Formato de timestamps**: ISO 8601 en strings. Se serializa directamente a JSON
  sin transformación y es legible tanto en BD como en logs.

- **Scheduler de retention**: `setInterval` + `Storage.cleanup()`. No requiere librerías
  externas; `cleanup()` ya forma parte del contrato `Storage`.

- **Enmascaramiento de headers sensibles**: función propia No justifica agregar
  una dependencia.

- **Cálculo de percentiles (p50/p95/p99)**: función propia (ordenar + acceso por índice).
  ~10 líneas; `simple-statistics` haría exactamente lo mismo.

- **Merge de defaults de configuración**: spread operator `{...defaults, ...config}`
  on lógica condicional para los objetos anidados. `lodash.merge` pesa ~7KB innecesarios.

- **Codificación de cursor**: `Buffer.from(cursor).toString('base64')`. API nativa de Node,
  cero dependencias.

- **Carpeta `core/` como base del sistema**: agrupa entidades de dominio, contrato Storage,
  queue/processor y utils. Todo lo que no depende de Express, better-sqlite3 ni pg vive acá.
  Middleware, storages concretos, monitoring y UI importan desde `core/`, nunca al revés.

- **Tests en `tests/`**: todos los tests (unitarios e integración)
  viven bajo esta carpeta. Evita contaminar el árbol de `src/` y centraliza la
  configuración de vitest en un solo `vitest.config.ts`. Para playwright,
  `playwright.config.ts` y `playwright-test.ts` en el mismo lugar.

---

## Modelos de Datos

### Entidades de Dominio

```typescript
type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "OPTIONS"
  | "HEAD";
type LogLevel = "INFO" | "WARNING" | "ERROR" | "DEBUG";

interface RequestRecord {
  id: string; // UUID v4
  timestamp: string; // ISO 8601
  method: HttpMethod;
  path: string;
  fullUrl: string;
  statusCode: number; // 100-599
  latencyMs: number;
  clientIp?: string; // soporta IPv6
  userAgent?: string;
  requestHeaders?: Record<string, string>;
  requestQuery?: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  responseSizeBytes?: number;
  errorMessage?: string;
  stackTrace?: string;
  createdAt: string; // ISO 8601
}

interface LogEntry {
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
```

### Consultas y Paginación

```typescript
interface QueryFilters {
  methods?: HttpMethod[];
  statusCodes?: number[];
  statusRange?: { min: number; max: number };
  pathPattern?: string; // búsqueda parcial
  dateFrom?: string; // ISO 8601
  dateTo?: string; // ISO 8601
  latencyMin?: number; // ms
  latencyMax?: number; // ms
  hasError?: boolean;
  cursor?: string;
  limit?: number; // default: 50, max: 200
  order?: "asc" | "desc"; // default: 'desc'
}

interface LogFilters {
  levels?: LogLevel[];
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
  order?: "asc" | "desc";
}

interface PaginationResult<T> {
  data: T[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    prevCursor: string | null;
    totalCount: number;
  };
}
```

### Métricas

```typescript
interface MetricsResult {
  requests: {
    total: number;
    byMethod: Record<HttpMethod, number>;
    byStatus: { "2xx": number; "3xx": number; "4xx": number; "5xx": number };
    ratePerMinute: number;
  };
  performance: {
    avgLatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    p50: number;
    p95: number;
    p99: number;
  };
  errors: {
    total4xx: number;
    total5xx: number;
    byEndpoint: Array<{ path: string; count: number }>;
  };
  system: {
    uptime: number; // segundos desde inicio
    version: string;
  };
  topLists: {
    topEndpoints: Array<{ path: string; count: number }>;
    slowestEndpoints: Array<{ path: string; avgLatency: number }>;
  };
}
```

### Contrato de Storage

```typescript
interface Storage {
  initialize(): Promise<void>;
  store(request: RequestRecord): Promise<void>;
  storeLog(entry: LogEntry): Promise<void>;
  getById(id: string): Promise<RequestRecord | null>;
  query(filters: QueryFilters): Promise<PaginationResult<RequestRecord>>;
  getLogs(filters: LogFilters): Promise<PaginationResult<LogEntry>>;
  getMetrics(): Promise<MetricsResult>;
  cleanup(): Promise<number>; // retorna cantidad de registros eliminados
  close(): Promise<void>;
}
```

El paquete expone tres implementaciones concretas de este contrato:

| Clase             | Estrategia             | Persistencia                     |
| ----------------- | ---------------------- | -------------------------------- |
| `MemoryStorage`   | Circular buffer en RAM | Volátil (se pierde al reiniciar) |
| `SQLiteStorage`   | better-sqlite3         | Archivo `.db` local              |
| `PostgresStorage` | pg (node-postgres)     | Servidor PostgreSQL remoto       |

La instancia correcta se obtiene mediante un `StorageFactory` que lee la configuración
(`strategy: "memory" | "sqlite" | "postgresql"`) y devuelve la implementación correspondiente.

---

## Flujo de Datos

```
Middleware (Express)
    ↓  (captura RequestRecord + LogEntry)
AsyncQueue / BatchProcessor
    ↓  (acumula en batches: tamaño/tiempo configurables)
Storage.store() / Storage.storeLog()
    ↓
┌─ MemoryStorage ─┬─ SQLiteStorage ─┬─ PostgresStorage ┐
│  ArrayBuffer    │  INSERT INTO    │  INSERT INTO      │
│  (FIFO)         │  requests       │  requests         │
└─────────────────┴─────────────────┴───────────────────┘
    ↓
Monitoring UI (lectura vía Storage.query / Storage.getMetrics)
```

**Notas del flujo**:

- `AsyncQueue` es transversal a las tres estrategias: encola los registros y los
  envía en batches para minimizar I/O.

- `Storage.cleanup()` es invocado por un scheduler común según la configuración
  de retention.

- El cursor de paginación se implementa como base64 del `timestamp` + `id`, y cada
  storage lo interpreta a su manera
  (`WHERE (timestamp, id) < (?, ?)` en SQL, búsqueda lineal en memory).

---

## Dependencias y Librerías

### Runtime

- **date-fns**: cálculo de rangos de fechas en filtros y métricas. Tree-shakeable,
  sin mutabilidad.
- **uuid**: generación de UUID v4. Fallback para Node < 19.
- **better-sqlite3**: base de datos local embebida. Decidido en el stack.
- **pg**: driver PostgreSQL. Decidido en el stack.

### Dev

- **typescript**: type checking.
- **vitest**: test runner unitario (exigido por RF-07).
- **tsup**: bundle del paquete Node con esbuild. Genera `dist/index.js` (ESM) + `dist/index.d.ts` en un solo comando. `--external better-sqlite3 --external pg` excluye drivers nativos del bundle.
- **@preact/preset-vite**: build de la UI de monitoreo con Preact.
- **@testing-library/preact**: testing de componentes Preact.
- **@playwright/experimental-ct-preact**: component testing en navegador real.
- **prettier**: formateo consistente de código.

### Frontend (vía CDN, sin empaquetar en el bundle)

- **Preact + htm**: framework reactivo en ~3kB desde CDN, sin build step.
- **Chart.js**: gráficos del dashboard.
- **Font Awesome**: iconos.

### Zero-dependency (implementado con APIs nativas)

- Enmascaramiento de headers sensibles.
- Cálculo de percentiles (p50/p95/p99).
- Merge de defaults de configuración.
- Codificación/decodificación de cursores de paginación.
- Generación de UUID con `crypto.randomUUID()`.

### Build

El paquete tiene dos builds independientes:

- **tsup**: bundlea `src/` a `dist/index.js` (ESM) + `dist/index.d.ts` con esbuild. Las dependencias nativas (`better-sqlite3`, `pg`) se marcan como externas y no se bundlean — el consumidor las instala desde su propio `node_modules`.
- **Vite + @preact/preset-vite**: build de la SPA de monitoreo a un solo HTML con CSS/JS inline, que se sirve desde el router de monitoring.

```json
{
  "scripts": {
    "build:lib": "tsup src/index.ts --format esm --dts --external better-sqlite3 --external pg",
    "build:ui": "vite build src/ui",
    "build": "pnpm build:ui && pnpm build:lib",
    "prepublishOnly": "pnpm build"
  }
}
```

El `dist/` generado no se incluye en el repositorio (`.gitignore`), pero sí en el paquete publicado (`"files": ["dist"]` en `package.json`).

---

## Estructura de Carpetas

```
metricsLogger/
├── src/
│   ├── index.ts                    # Punto de entrada: exporta Logger público
│   ├── core/                       # Capa base, sin dependencias de infraestructura
│   │   ├── entities/
│   │   │   ├── request-record.ts   # RequestRecord
│   │   │   ├── log-entry.ts        # LogEntry
│   │   │   ├── metrics.ts          # MetricsResult
│   │   │   ├── filters.ts          # QueryFilters, LogFilters
│   │   │   └── pagination.ts       # PaginationResult<T>
│   │   ├── storage/
│   │   │   └── interface.ts        # Contrato Storage
│   │   ├── queue/
│   │   │   ├── processor.ts        # AsyncQueue + BatchProcessor
│   │   │   └── scheduler.ts        # Cleanup periódico (setInterval)
│   │   └── utils/
│   │       ├── uuid.ts             # crypto.randomUUID() + fallback uuid
│   │       ├── masking.ts          # Enmascarar headers sensibles
│   │       ├── cursor.ts           # Base64 encode/decode para paginación
│   │       ├── percentiles.ts      # Cálculo p50/p95/p99
│   │       └── timestamp.ts        # Formateo ISO 8601
│   ├── middleware/
│   │   └── capture.ts              # Middleware Express
│   ├── storage/                    # Implementaciones concretas del contrato Storage
│   │   ├── memory.ts               # MemoryStorage (circular buffer FIFO)
│   │   ├── sqlite.ts               # SQLiteStorage (better-sqlite3)
│   │   ├── postgres.ts             # PostgresStorage (pg)
│   │   └── factory.ts              # StorageFactory
│   ├── config/
│   │   ├── loader.ts               # Carga JSON + .env + resolución ${VAR}
│   │   ├── validator.ts            # Zod schema de validación
│   │   └── defaults.ts             # Valores por defecto
│   ├── monitoring/
│   │   ├── router.ts               # Endpoints Express (/api/monitoring/*)
│   │   ├── metrics-cache.ts        # Cache de métricas con TTL
│   │   └── auth.ts                 # Basic auth
│   └── ui/                         # SPA Preact (se build a HTML inline)
│       ├── index.html              # Template HTML
│       ├── main.tsx                # Entry point de Preact
│       ├── components/
│       │   ├── Dashboard/
│       │   ├── RequestList/
│       │   ├── RequestDetail/
│       │   ├── Login/
│       │   └── common/
│       └── styles/
├── tests/                          # Todos los tests (unitarios + integración)
│   ├── unit/
│   │   ├── core/
│   │   │   ├── entities/
│   │   │   ├── queue/
│   │   │   │   ├── processor.test.ts
│   │   │   │   └── scheduler.test.ts
│   │   │   └── utils/
│   │   │       ├── cursor.test.ts
│   │   │       ├── percentiles.test.ts
│   │   │       ├── masking.test.ts
│   │   │       └── uuid.test.ts
│   │   ├── middleware/
│   │   │   └── capture.test.ts
│   │   ├── storage/
│   │   │   ├── memory.test.ts
│   │   │   └── sqlite.test.ts
│   │   ├── config/
│   │   │   ├── loader.test.ts
│   │   │   └── validator.test.ts
│   │   └── monitoring/
│   │       ├── router.test.ts
│   │       └── auth.test.ts
│   ├── integration/
│   │   ├── memory-flow.test.ts     # Middleware → Queue → Memory → Metrics
│   │   ├── sqlite-flow.test.ts     # Middleware → Queue → SQLite → Metrics
│   │   └── postgres-flow.test.ts   # Middleware → Queue → Postgres → Metrics
│   └── ui/
│       └── components/             # Component testing con Playwright CT
├── migrations/
│   ├── sqlite/
│   │   └── 001_initial.sql
│   └── postgres/
│       └── 001_initial.sql
├── examples/
│   ├── basic-express/              # Ejemplo con estrategia memory
│   └── with-postgres/              # Ejemplo con PostgreSQL
├── docs/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── logger.config.json
├── .env.example
├── CHANGELOG.md
├── MIGRATION.md
├── TESTING.md
├── README.md
└── .gitignore
```

## Versionado y Publicación

### Convención de commits

Todo commit debe seguir **Conventional Commits** (`@commitlint/config-conventional`):

```gitcommit
tipo(scope opcional): descripción en presente y minúscula

cuerpo opcional (saltos de línea)

BREAKING CHANGE: descripción si aplica (o pies de página: Fixes #123)
```

````

| Tipo | Release | Uso |
|---|---|---|
| `fix` | PATCH | Corrección de bugs |
| `feat` | MINOR | Nueva funcionalidad |
| `BREAKING CHANGE` (en body o footer) | MAJOR | Cambio incompatible |
| `chore`, `docs`, `refactor`, `style`, `test`, `perf` | — | No generan release |

### Local: validación automática en cada commit

- **husky**: activa git hooks desde `package.json` (script `prepare`).
- **@commitlint/cli + @commitlint/config-conventional**: hook `commit-msg`. Rechaza commits sin conventional format.
- **lint-staged**: hook `pre-commit`. Corre `prettier --write` y `vitest run --related` sobre archivos staged.

**`commitlint.config.js`**:

```js
export default { extends: ['@commitlint/config-conventional'] };
````

**package.json**:

```json
{
  "scripts": { "prepare": "husky" },
  "lint-staged": {
    "*.ts": ["prettier --write", "vitest run --related"],
    "*.tsx": ["prettier --write"]
  }
}
```

### CI: Release Please (solo PR, sin automatización post-merge)

El workflow se ejecuta al pushear a `main`. No publica a npm, no crea tags, no crea
GitHub Releases — solo abre o actualiza una Release PR.

**`.github/workflows/release-please.yml`**:

```yaml
name: Release Please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          release-type: node
          package-name: metricsLogger
```

Cada vez que se pushea a `main`, Release Please analiza los commits desde el último
tag, determina el bump (major/minor/patch), y crea o actualiza una PR que contiene:

- `package.json` con la versión incrementada
- `CHANGELOG.md` actualizado (formato Keep a Changelog)

Mergear la PR no dispara nada más — ni tag, ni release, ni publicación.

### Futuro: cómo activar la publicación automática

Cuando el equipo decida que el paquete está listo para publicación automatizada,
se añade un segundo workflow que responde al merge de la Release PR:

```yaml
# .github/workflows/publish.yml (deshabilitado hasta nuevo aviso)
# name: Publish to npm
#
# on:
#   release:
#     types: [published]
#
# jobs:
#   publish:
#     runs-on: ubuntu-latest
#     steps:
#       - uses: actions/checkout@v4
#       - uses: pnpm/action-setup@v4
#         with:
#           version: latest
#       - uses: actions/setup-node@v4
#         with:
#           node-version: 20
#           cache: pnpm
#           registry-url: https://registry.npmjs.org
#       - run: pnpm install --frozen-lockfile
#       - run: pnpm test
#       - run: pnpm build
#       - run: pnpm publish --no-git-checks
#         env:
#           NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Hasta entonces, la publicación es manual:

```bash
git tag v1.0.0
git push --tags
pnpm publish
```

### Flujo completo (etapa actual)

```
Local: git commit -m "feat: add logInfo method"
  ↓ (husky → commitlint valida formato)
  ↓ (husky → lint-staged: prettier + tests)
  ↓
Push a main
  ↓ (GitHub Actions: release-please.yml)
  ↓
Release Please crea/actualiza Release PR con versión bump + CHANGELOG
  ↓
Equipo revisa y decide si mergear o no
  ↓
(Si mergea) No pasa nada más — ni tag, ni release, ni publish
  ↓
(Cuando toque publicar) Se hace manual: git tag + pnpm publish
```

### Dependencias necesarias para CI

| Paquete                                               | Propósito                        |
| ----------------------------------------------------- | -------------------------------- |
| `husky`                                               | Gestor de git hooks              |
| `@commitlint/cli` + `@commitlint/config-conventional` | Validación de commits            |
| `lint-staged`                                         | Prettier + tests en staged files |
