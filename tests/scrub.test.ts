import { describe, it, expect } from "vitest";
import { scrub } from "../src/server/guardrails/scrub";

const SECRET_SAMPLES: Array<[string, string]> = [
  ["anthropic key", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
  ["openai key", "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
  ["groq key", "gsk_AbCdEfGhIjKlMnOpQrStUv0123456789"],
  ["github token", "ghp_0123456789abcdefghijABCDEFGHIJ012345"],
  ["github pat", "github_pat_0123456789_ABCDEFGHIJabcdefghij0123456789ABCD"],
  ["aws key id", "AKIAIOSFODNN7EXAMPLE"],
  ["google api key", "AIzaSyDQ8bB3xV9mKpL2nQ4rS7tU0vW3xY6zA9bC"],
  ["slack token", "xoxb-1234567890-abcdefghij"],
  [
    "jwt",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
  ],
  [
    "private key",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
  ],
  ["url with credentials", "https://user:password@example.com/path"],
  ["password assignment", "password=hunter2"],
  ["api_key assignment", "api_key=sk_test_12345678"],
  ["token assignment", "token: abc123def456"],
  ["secret assignment", "secret = mySecretValue"]
];

const HARMLESS_LINES: Array<string> = [
  "The bluetooth service is running.",
  "Open your terminal and type the command.",
  "Wi-Fi is connected to the network.",
  "Your adapter is powered on.",
  "The driver loaded successfully.",
  "Bluetooth is not blocked.",
  "Press the function key to toggle wireless.",
  "Restart your computer and try again.",
  "The network adapter shows as Up.",
  "DNS resolution is working correctly.",
  "You can find the setting in Bluetooth & devices.",
  "The service status is Running.",
  "Check if the device is in pairing mode.",
  "The package is already the newest version.",
  "Your PATH variable looks correct.",
  "The command ran successfully.",
  "No errors in the log.",
  "The firmware loaded without issues.",
  "Hard blocked: no",
  "Soft blocked: no",
  "The adapter is detected over USB.",
  "Name resolution works.",
  "The cache was cleared.",
  "Your kernel version is 6.8.0.",
  "The service is active and running.",
  "Open Settings and check Bluetooth.",
  "The ping returned 0% packet loss.",
  "Your default route is via 192.168.1.1.",
  "The device is connected.",
  "Try loading a website.",
  "The DNS servers are configured.",
  "The adapter restarted.",
  "Open a new terminal window.",
  "The toggle is set to On.",
  "Your system is up to date.",
  "The installation completed.",
  "The module is in use.",
  "The journal shows no errors.",
  "The block was removed.",
  "The service started.",
  "The adapter is enabled.",
  "Network is reachable.",
  "DNS lookup works.",
  "The cache refills automatically.",
  "The route to the internet exists.",
  "The interface is up.",
  "The connection is stable.",
  "No firmware errors.",
  "The tool is installed.",
  "Everything looks good."
];

describe("scrub — secret patterns", () => {
  for (const [name, sample] of SECRET_SAMPLES) {
    it(`redacts ${name}`, () => {
      const result = scrub(sample);
      expect(result.totalRemoved).toBeGreaterThan(0);
      expect(result.text).not.toBe(sample);
    });
  }

  it("redacts multiple secrets in one text", () => {
    const text =
      "My Groq key is gsk_AbCdEfGhIjKlMnOpQrStUv0123456789 and my GitHub token is ghp_0123456789abcdefghijABCDEFGHIJ012345";
    const result = scrub(text);
    expect(result.totalRemoved).toBe(2);
    expect(result.counts.groq).toBe(1);
    expect(result.counts.github).toBe(1);
    expect(result.text).not.toContain("gsk_");
    expect(result.text).not.toContain("ghp_");
  });

  it("preserves the scheme in URL credentials", () => {
    const result = scrub("https://user:password@example.com/path");
    expect(result.text).toContain("https://");
    expect(result.text).not.toContain("user:password");
  });
});

describe("scrub — path username mapping", () => {
  it("maps /home/<name> to $HOME", () => {
    const result = scrub("The file is at /home/trakshan/.config/bluetooth");
    expect(result.usernameHidden).toBe(true);
    expect(result.text).toContain("$HOME");
    expect(result.text).not.toContain("/home/trakshan");
  });

  it("maps /Users/<name> to $HOME", () => {
    const result = scrub("Installed to /Users/john/.npm-global");
    expect(result.usernameHidden).toBe(true);
    expect(result.text).toContain("$HOME");
    expect(result.text).not.toContain("/Users/john");
  });

  it("maps C:\\Users\\<name>\\ to %USERPROFILE%\\", () => {
    const result = scrub(
      "The file is at C:\\Users\\jane\\AppData\\Roaming\\npm"
    );
    expect(result.usernameHidden).toBe(true);
    expect(result.text).toContain("%USERPROFILE%");
    expect(result.text).not.toContain("C:\\Users\\jane");
  });
});

describe("scrub — sensitive patterns", () => {
  it("redacts OTP (4-4-4 digits)", () => {
    const result = scrub("Your OTP is 1234-5678-9012");
    expect(result.counts.otp).toBe(1);
    expect(result.text).not.toContain("1234-5678-9012");
  });

  it("redacts Aadhaar (12 digits)", () => {
    const result = scrub("My Aadhaar is 123456789012");
    expect(result.counts.aadhaar).toBe(1);
    expect(result.text).not.toContain("123456789012");
  });

  it("redacts PAN", () => {
    const result = scrub("PAN: ABCDE1234F");
    expect(result.counts.pan).toBe(1);
    expect(result.text).not.toContain("ABCDE1234F");
  });
});

describe("scrub — false positives (50 harmless lines)", () => {
  for (const line of HARMLESS_LINES) {
    it(`does not redact: "${line.slice(0, 50)}${line.length > 50 ? "..." : ""}"`, () => {
      const result = scrub(line);
      expect(result.totalRemoved).toBe(0);
      expect(result.text).toBe(line);
    });
  }
});
