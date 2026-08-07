import { describe, it, expect } from "vitest";
import { maskHeaders, maskData } from "../../../../src/core/utils/masking.js";

describe("maskHeaders", () => {
  it("enmascara headers sensibles por defecto", () => {
    const result = maskHeaders({ authorization: "Bearer x", "x-api-key": "k", host: "localhost" });
    expect(result.authorization).toBe("***MASKED***");
    expect(result["x-api-key"]).toBe("***MASKED***");
    expect(result.host).toBe("localhost");
  });

  it("es case-insensitive", () => {
    const result = maskHeaders({ Authorization: "Bearer x", COOKIE: "sid=1" });
    expect(result.Authorization).toBe("***MASKED***");
    expect(result.COOKIE).toBe("***MASKED***");
  });

  it("agrega claves extra configurables", () => {
    const result = maskHeaders({ "x-custom-secret": "v" }, ["x-custom-secret"]);
    expect(result["x-custom-secret"]).toBe("***MASKED***");
  });

  it("no toca valores no sensibles y retorna {} para inputs nulos", () => {
    expect(maskHeaders({ keep: "me" }).keep).toBe("me");
    expect(maskHeaders(null as unknown as Record<string, unknown>)).toEqual({});
  });
});

describe("maskData", () => {
  it("enmascara campos sensibles en objetos anidados", () => {
    const data = { user: { name: "ana", password: "1234" }, token: "abc" };
    const masked = maskData(data) as typeof data;
    expect(masked.user.password).toBe("***MASKED***");
    expect(masked.token).toBe("***MASKED***");
    expect(masked.user.name).toBe("ana");
  });

  it("recorre arreglos recursivamente", () => {
    const masked = maskData([{ secret: "s", ok: 1 }]) as Array<Record<string, unknown>>;
    expect(masked[0]?.secret).toBe("***MASKED***");
    expect(masked[0]?.ok).toBe(1);
  });

  it("deja pasar primitivos y null", () => {
    expect(maskData("text")).toBe("text");
    expect(maskData(null)).toBeNull();
    expect(maskData(undefined)).toBeUndefined();
    expect(maskData(7)).toBe(7);
  });
});
