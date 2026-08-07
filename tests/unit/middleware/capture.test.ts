import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { createCaptureMiddleware } from "../../../src/middleware/capture.js";
import type { RequestRecord } from "../../../src/core/entities/request-record.js";
import { waitFor } from "../../helpers/fixtures.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers.length = 0;
});

function startServer(records: RequestRecord[], options?: Parameters<typeof createCaptureMiddleware>[0]) {
  const app = express();
  app.use(express.json());
  app.use(createCaptureMiddleware({ onRecordCaptured: (r) => records.push(r), ...options }));
  app.get("/api/users", (_req, res) => res.json([{ id: 1, name: "Alice" }]));
  app.post("/api/users", (req, res) => res.status(201).json({ created: req.body }));
  app.get("/api/error-400", (_req, res) => res.status(400).json({ error: "Parámetros inválidos" }));
  app.get("/api/error-500", (_req, res) => res.status(500).json({ error: "Error interno" }));
  const server = app.listen(0);
  servers.push(server);
  return server;
}

async function baseUrl(server: Server): Promise<string> {
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe("createCaptureMiddleware", () => {
  it("captura un GET con método, path, status y latencia", async () => {
    const records: RequestRecord[] = [];
    const server = startServer(records);
    const url = await baseUrl(server);

    const res = await fetch(`${url}/api/users`);
    expect(res.status).toBe(200);
    await waitFor(() => records.length === 1);

    const record = records[0]!;
    expect(record.method).toBe("GET");
    expect(record.path).toBe("/api/users");
    expect(record.statusCode).toBe(200);
    expect(record.latencyMs).toBeGreaterThanOrEqual(0);
    expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(record.fullUrl).toContain("/api/users");
    expect(record.clientIp).toBeDefined();
  });

  it("enmascara headers sensibles (configurables y por defecto)", async () => {
    const records: RequestRecord[] = [];
    const server = startServer(records, { maskingHeaders: ["x-custom-secret"] });
    const url = await baseUrl(server);

    await fetch(`${url}/api/users`, {
      headers: { Authorization: "Bearer token-123", "X-Custom-Secret": "valor" },
    });
    await waitFor(() => records.length === 1);

    const headers = records[0]!.requestHeaders ?? {};
    expect(headers.authorization).toBe("***MASKED***");
    expect(headers["x-custom-secret"]).toBe("***MASKED***");
    expect(headers.host).toBeDefined();
  });

  it("captura el body de la respuesta y el request body en POST", async () => {
    const records: RequestRecord[] = [];
    const server = startServer(records);
    const url = await baseUrl(server);

    const res = await fetch(`${url}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Charlie" }),
    });
    expect(res.status).toBe(201);
    await waitFor(() => records.length === 1);

    const record = records[0]!;
    expect(record.method).toBe("POST");
    expect(record.requestBody).toEqual({ name: "Charlie" });
    // Express 5 serializa con res.json() antes de llamar a res.send, así que el
    // body capturado llega como string JSON.
    expect(JSON.parse(record.responseBody as string)).toEqual({ created: { name: "Charlie" } });
    expect(record.responseSizeBytes).toBeGreaterThan(0);
  });

  it("no captura el response body si captureResponseBody es false", async () => {
    const records: RequestRecord[] = [];
    const server = startServer(records, { captureResponseBody: false });
    const url = await baseUrl(server);

    await fetch(`${url}/api/users`);
    await waitFor(() => records.length === 1);

    expect(records[0]!.responseBody).toBeUndefined();
  });

  it("incluye errorMessage para status >= 400", async () => {
    const records: RequestRecord[] = [];
    const server = startServer(records);
    const url = await baseUrl(server);

    await fetch(`${url}/api/error-400`);
    await fetch(`${url}/api/error-500`);
    await waitFor(() => records.length === 2);

    const byStatus = Object.fromEntries(records.map((r) => [r.statusCode, r]));
    expect(byStatus[400]?.errorMessage).toBeTruthy();
    expect(byStatus[500]?.errorMessage).toBeTruthy();
    expect(records.find((r) => r.statusCode === 200)?.errorMessage).toBeUndefined();
  });
});
