import { describe, it, expect } from "vitest";
import {
  runLoadTest,
  runReservationLoadTest,
  formatReport
} from "../load/load-runner";

describe("load test runner", () => {
  it("admits all sessions under cap", () => {
    const result = runLoadTest({ sessions: 5, maxActive: 10, burst: false });
    expect(result.admitted).toBe(5);
    expect(result.queued).toBe(0);
    expect(result.rejected).toBe(0);
  });

  it("queues over cap", () => {
    const result = runLoadTest({ sessions: 15, maxActive: 10, burst: false });
    expect(result.admitted).toBe(10);
    expect(result.queued).toBe(5);
  });

  it("rejects when queue full", () => {
    const result = runLoadTest({
      sessions: 70,
      maxActive: 10,
      burst: true
    });
    expect(result.admitted).toBe(10);
    expect(result.queued).toBe(50);
    expect(result.rejected).toBe(10);
  });

  it("measures p50 and p95 latency", () => {
    const result = runLoadTest({ sessions: 100, maxActive: 100, burst: false });
    expect(result.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.p95LatencyMs).toBeGreaterThanOrEqual(result.p50LatencyMs);
    expect(result.maxLatencyMs).toBeGreaterThanOrEqual(result.p95LatencyMs);
  });

  it("reservation load grants under limit", () => {
    const result = runReservationLoadTest(100, 30);
    expect(result.granted).toBe(30);
    expect(result.denied).toBe(70);
  });

  it("formatReport produces markdown", () => {
    const result = runLoadTest({ sessions: 5, maxActive: 10, burst: false });
    const report = formatReport(result, "Test");
    expect(report).toContain("## Test");
    expect(report).toContain("Admitted");
    expect(report).toContain("P50");
  });
});
