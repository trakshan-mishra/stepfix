import { describe, it, expect } from "vitest";
import {
  signToken,
  verifyToken,
  revokeToken,
  isRevoked,
  purgeExpiredRevocations,
  getRevokedCount
} from "../src/server/http/token";

const SECRET = "test-secret-key-for-testing-32chars!";

describe("token sign/verify", () => {
  it("signs and verifies a valid token", async () => {
    const token = await signToken("session-123", SECRET);
    const result = await verifyToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sessionId).toBe("session-123");
  });

  it("rejects a tampered token", async () => {
    const token = await signToken("session-123", SECRET);
    const tampered = token.slice(0, -2) + "XX";
    const result = await verifyToken(tampered, SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tampered");
  });

  it("rejects an expired token", async () => {
    const now = Date.now();
    const expiredToken = await signToken(
      "session-123",
      SECRET,
      now - 25 * 60 * 60 * 1000
    );
    const result = await verifyToken(expiredToken, SECRET, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signToken("session-123", SECRET);
    const result = await verifyToken(token, "wrong-secret");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tampered");
  });

  it("rejects a malformed token", async () => {
    const result = await verifyToken("not-a-token", SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("rejects a token with no dot", async () => {
    const result = await verifyToken("justastring", SECRET);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("malformed");
  });

  it("accepts a token that is exactly 24h old", async () => {
    const now = Date.now();
    const token = await signToken(
      "session-123",
      SECRET,
      now - 24 * 60 * 60 * 1000
    );
    const result = await verifyToken(token, SECRET, now);
    expect(result.ok).toBe(true);
  });

  it("produces different tokens for different sessions", async () => {
    const t1 = await signToken("session-1", SECRET);
    const t2 = await signToken("session-2", SECRET);
    expect(t1).not.toBe(t2);
  });

  it("produces the same token for the same session+time", async () => {
    const now = Date.now();
    const t1 = await signToken("session-1", SECRET, now);
    const t2 = await signToken("session-1", SECRET, now);
    expect(t1).toBe(t2);
  });
});

describe("token revocation / tombstone", () => {
  it("rejects a revoked token until expiry", async () => {
    const now = Date.now();
    const token = await signToken("session-revoked", SECRET, now);
    const expiry = now + 24 * 60 * 60 * 1000;
    revokeToken("session-revoked", expiry);

    const result = await verifyToken(token, SECRET, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("revoked");
  });

  it("isRevoked returns true for revoked session", () => {
    revokeToken("session-test", Date.now() + 3600000);
    expect(isRevoked("session-test")).toBe(true);
  });

  it("isRevoked returns false for non-revoked session", () => {
    expect(isRevoked("session-nonexistent")).toBe(false);
  });

  it("purgeExpiredRevocations removes expired tombstones", () => {
    const now = Date.now();
    revokeToken("expired-1", now - 1000);
    revokeToken("expired-2", now - 2000);
    revokeToken("active-1", now + 3600000);
    const purged = purgeExpiredRevocations(now);
    expect(purged).toBe(2);
    expect(isRevoked("expired-1")).toBe(false);
    expect(isRevoked("expired-2")).toBe(false);
    expect(isRevoked("active-1")).toBe(true);
  });

  it("getRevokedCount returns current count", () => {
    revokeToken("count-1", Date.now() + 3600000);
    revokeToken("count-2", Date.now() + 3600000);
    expect(getRevokedCount()).toBeGreaterThanOrEqual(2);
  });

  it("a valid non-revoked token still verifies", async () => {
    const token = await signToken("session-valid", SECRET);
    const result = await verifyToken(token, SECRET);
    expect(result.ok).toBe(true);
  });

  it("different sessions are independently revocable", async () => {
    const now = Date.now();
    const t1 = await signToken("session-a", SECRET, now);
    const t2 = await signToken("session-b", SECRET, now);
    revokeToken("session-a", now + 3600000);

    const r1 = await verifyToken(t1, SECRET, now);
    const r2 = await verifyToken(t2, SECRET, now);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(true);
  });
});
