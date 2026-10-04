import { describe, expect, it } from "vitest";
import {
  redactCommands,
  scanForCommands
} from "../src/server/guardrails/command-scanner";

// The exact reply that leaked a command in a live Wi-Fi session.
const LIVE_LEAK = `Next: I need to see if the router actually gave you an address — not just show Wi-Fi as connected.
Go to the Terminal and run: ip -brief address
Look for a line that starts with wl (your Wi-Fi adapter), UP, and ends with a normal local address (like 192.168.x.x or 10.x.x.x).
What do you see when you run that command?`;

describe("command scanner: library commands in plain text", () => {
  it("flags the live leak even though it mentions Wi-Fi", () => {
    expect(scanForCommands(LIVE_LEAK).hit).toBe(true);
  });

  it("redacts the live leak and points to the step card", () => {
    const out = redactCommands(LIVE_LEAK);
    expect(out).not.toContain("ip -brief");
    expect(out).toContain("[the command on the step card]");
    expect(out).toContain("your Wi-Fi adapter");
  });

  it.each([
    ["nmcli device wifi list", "Try nmcli device wifi list and tell me"],
    ["rfkill list", "run: rfkill list"],
    ["Get-NetAdapter", "Open PowerShell and type Get-NetAdapter | Format-List"],
    ["ping -c 4 8.8.8.8", "Then ping -c 4 8.8.8.8 to test"],
    ["systemctl status", "Check systemctl status bluetooth for errors"],
    ["resolvectl status", "Run resolvectl status, then tell me what you see."]
  ])("redacts %s", (needle, text) => {
    expect(scanForCommands(text).hit).toBe(true);
    expect(redactCommands(text)).not.toContain(needle);
  });

  it.each([
    "Check that your Wi-Fi is turned on in Settings.",
    "The bluetooth service might be stopped.",
    "Can you ping the router? I mean, can your laptop reach it at all?",
    "Your IP address should start with 192.168.",
    "Open your terminal and I'll guide you.",
    "Did the command show your adapter as UP?"
  ])("leaves plain prose alone: %s", (text) => {
    expect(scanForCommands(text).hit).toBe(false);
    expect(redactCommands(text)).toBe(text);
  });
});
