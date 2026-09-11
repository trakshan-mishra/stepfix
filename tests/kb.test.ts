import { describe, it, expect } from "vitest";
import {
  sanitizeFts,
  sanitizeFtsOr,
  rrf,
  makeSnippet
} from "../src/server/kb/search";

describe("sanitizeFts", () => {
  it("handles simple word", () => {
    expect(sanitizeFts("bluetooth")).toBe('"bluetooth"');
  });

  it("handles multiple words (implicit AND)", () => {
    expect(sanitizeFts("soft blocked rfkill")).toBe(
      '"soft" "blocked" "rfkill"'
    );
  });

  it("handles can't (apostrophe stripped)", () => {
    const result = sanitizeFts("can't");
    expect(result).toBe('"can" "t"');
  });

  it("handles a-b (hyphen stripped)", () => {
    expect(sanitizeFts("a-b")).toBe('"a" "b"');
  });

  it("handles C:\\Users (backslash and colon stripped)", () => {
    const result = sanitizeFts("C:\\Users");
    expect(result).not.toContain(":");
    expect(result).not.toContain("\\");
  });

  it("handles 0x80070005 (hex error code)", () => {
    const result = sanitizeFts("0x80070005");
    expect(result).toBe('"0x80070005"');
  });

  it("handles org.bluez.Error.NotReady", () => {
    const result = sanitizeFts("org.bluez.Error.NotReady");
    expect(result).toContain('"org"');
    expect(result).toContain('"bluez"');
    expect(result).toContain('"Error"');
    expect(result).toContain('"NotReady"');
  });

  it("handles empty string", () => {
    expect(sanitizeFts("")).toBe("");
  });

  it("handles only punctuation", () => {
    expect(sanitizeFts("--- ::: ***")).toBe("");
  });

  it("strips FTS keywords (AND, OR, NOT, NEAR)", () => {
    const result = sanitizeFts("bluetooth AND wifi NOT ethernet");
    expect(result).not.toContain("AND");
    expect(result).not.toContain("NOT");
    expect(result).toContain('"bluetooth"');
    expect(result).toContain('"wifi"');
    expect(result).toContain('"ethernet"');
  });

  it("strips special FTS chars (* ^ ( ) etc)", () => {
    const result = sanitizeFts("bluetooth* (wifi) ^test");
    expect(result).not.toContain("*");
    expect(result).not.toContain("(");
    expect(result).not.toContain(")");
    expect(result).not.toContain("^");
  });
});

describe("sanitizeFtsOr", () => {
  it("joins with OR", () => {
    expect(sanitizeFtsOr("bluetooth wifi")).toBe('"bluetooth" OR "wifi"');
  });

  it("handles empty", () => {
    expect(sanitizeFtsOr("")).toBe("");
  });
});

describe("RRF (Reciprocal Rank Fusion)", () => {
  it("fuses two ranked lists", () => {
    const lexical = [
      { id: "a", score: -1 },
      { id: "b", score: -2 },
      { id: "c", score: -3 }
    ];
    const semantic = [
      { id: "b", score: 0.9 },
      { id: "d", score: 0.8 },
      { id: "a", score: 0.7 }
    ];
    const fused = rrf(lexical, semantic, 60);
    expect(fused.length).toBe(4);
    expect(fused.map((f) => f.id)).toContain("a");
    expect(fused.map((f) => f.id)).toContain("b");
    expect(fused.map((f) => f.id)).toContain("c");
    expect(fused.map((f) => f.id)).toContain("d");
  });

  it("items in both lists rank higher", () => {
    const lexical = [
      { id: "b", score: 1 },
      { id: "a", score: 0.5 }
    ];
    const semantic = [
      { id: "b", score: 0.9 },
      { id: "a", score: 0.8 }
    ];
    const fused = rrf(lexical, semantic, 60);
    const aScore = fused.find((f) => f.id === "a")?.score ?? 0;
    const bScore = fused.find((f) => f.id === "b")?.score ?? 0;
    expect(bScore).toBeGreaterThan(aScore);
  });

  it("handles empty lists", () => {
    expect(rrf([], [])).toEqual([]);
  });

  it("handles one empty list", () => {
    const fused = rrf([{ id: "a", score: 1 }], []);
    expect(fused.length).toBe(1);
    expect(fused[0].id).toBe("a");
  });

  it("respects k parameter", () => {
    const fused1 = rrf([{ id: "a", score: 1 }], [], 60);
    const fused2 = rrf([{ id: "a", score: 1 }], [], 10);
    expect(fused1[0].score).toBeLessThan(fused2[0].score);
  });
});

describe("makeSnippet", () => {
  it("returns short text as-is", () => {
    expect(makeSnippet("short text")).toBe("short text");
  });

  it("truncates long text with [...]", () => {
    const long = "A".repeat(1000);
    const snippet = makeSnippet(long, 100);
    expect(snippet.length).toBeLessThan(200);
    expect(snippet).toContain("[...]");
  });

  it("preserves beginning and end", () => {
    const long = "START" + "X".repeat(500) + "END";
    const snippet = makeSnippet(long, 50);
    expect(snippet).toContain("START");
    expect(snippet).toContain("END");
  });
});
