import { describe, it, expect } from "vitest";
import { generateUUID } from "../../../../src/core/utils/uuid.js";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateUUID", () => {
  it("genera UUIDs v4 válidos", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateUUID()).toMatch(UUID_V4_RE);
    }
  });

  it("genera valores únicos", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateUUID()));
    expect(ids.size).toBe(1000);
  });
});
