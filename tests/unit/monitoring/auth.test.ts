import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { createAuthMiddleware } from "../../../src/monitoring/auth.js";
import { DEFAULT_CONFIG } from "../../../src/config/defaults.js";
import type { LoggerConfig } from "../../../src/config/defaults.js";

const config = (overrides: Partial<LoggerConfig["monitoring"]> = {}): LoggerConfig => ({
  ...DEFAULT_CONFIG,
  monitoring: { ...DEFAULT_CONFIG.monitoring, ...overrides },
});

function run(auth: ReturnType<typeof createAuthMiddleware>, headers: Record<string, string> = {}) {
  const next = vi.fn();
  const req = { headers } as unknown as Request;
  const res = {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  auth(req, res, next);
  return { next, res };
}

describe("createAuthMiddleware", () => {
  it("deja pasar si no hay credenciales configuradas (acceso público)", () => {
    const { next, res } = run(createAuthMiddleware(config({ username: "", password: "" })));
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rechaza sin header Authorization con 401 y WWW-Authenticate", () => {
    const { next, res } = run(createAuthMiddleware(config()));
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.setHeader).toHaveBeenCalledWith("WWW-Authenticate", expect.stringContaining("Basic"));
  });

  it("rechaza credenciales inválidas", () => {
    const auth = createAuthMiddleware(config({ username: "admin", password: "secret" }));
    const token = Buffer.from("admin:wrong").toString("base64");
    const { next, res } = run(auth, { authorization: `Basic ${token}` });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("deja pasar con credenciales válidas", () => {
    const auth = createAuthMiddleware(config({ username: "admin", password: "secret" }));
    const token = Buffer.from("admin:secret").toString("base64");
    const { next, res } = run(auth, { authorization: `Basic ${token}` });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("ignora un header Authorization que no sea Basic", () => {
    const { next, res } = run(createAuthMiddleware(config()), { authorization: "Bearer xyz" });
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
