import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("runs inside the workers runtime", () => {
    expect(1 + 1).toBe(2);
  });
});
