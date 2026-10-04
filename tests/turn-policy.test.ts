import { describe, expect, it } from "vitest";
import { endsTurn } from "../src/server/llm/turn-policy";

describe("endsTurn", () => {
  it("ends the turn once the assistant has replied", () => {
    expect(
      endsTurn({
        text: "What operating system is on your laptop?",
        toolResults: [{ toolName: "update_case", output: { ok: true } }]
      })
    ).toBe(true);
  });

  it("keeps going after a tool call with no reply yet", () => {
    expect(
      endsTurn({
        text: "",
        toolResults: [{ toolName: "update_case", output: { ok: true } }]
      })
    ).toBe(false);
  });

  it("keeps going after a successful handoff so the technician can start", () => {
    expect(
      endsTurn({
        text: "Thanks, I have what I need. Let's fix it step by step.",
        toolResults: [
          { toolName: "handoff_to_technician", output: { ok: true } }
        ]
      })
    ).toBe(false);
  });

  it("ends the turn after a refused handoff", () => {
    expect(
      endsTurn({
        text: "stepfix covers Wi-Fi, Bluetooth and command-line tools today.",
        toolResults: [
          {
            toolName: "handoff_to_technician",
            output: { ok: false, reason: "out_of_scope" }
          }
        ]
      })
    ).toBe(true);
  });
});
