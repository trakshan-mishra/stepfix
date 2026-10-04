import { describe, it, expect } from "vitest";
import {
  FrameManager,
  validateFrame,
  MIN_CLOUD_FRAME_INTERVAL_MS,
  MAX_FRAMES_PER_SESSION,
  MAX_FRAME_BYTES
} from "../src/client/lib/ocr";

describe("FrameManager", () => {
  it("allows first cloud frame", () => {
    const fm = new FrameManager();
    expect(fm.canSendCloudFrame(1000)).toBe(true);
  });

  it("blocks second frame within 5 seconds", () => {
    const fm = new FrameManager();
    fm.startCloudFrame(1000);
    fm.completeCloudFrame(1500);
    expect(fm.canSendCloudFrame(2000)).toBe(false);
    expect(fm.canSendCloudFrame(1000 + MIN_CLOUD_FRAME_INTERVAL_MS)).toBe(true);
  });

  it("enforces one in-flight at a time", () => {
    const fm = new FrameManager();
    expect(fm.startCloudFrame(1000)).toBe(true);
    expect(fm.isInFlight()).toBe(true);
    expect(fm.canSendCloudFrame(1000 + MIN_CLOUD_FRAME_INTERVAL_MS)).toBe(
      false
    );
    fm.completeCloudFrame();
    expect(fm.isInFlight()).toBe(false);
  });

  it("cancels in-flight frame", () => {
    const fm = new FrameManager();
    fm.startCloudFrame(1000);
    expect(fm.isInFlight()).toBe(true);
    fm.cancelCloudFrame();
    expect(fm.isInFlight()).toBe(false);
  });

  it("enforces max 6 frames per session", () => {
    const fm = new FrameManager();
    for (let i = 0; i < MAX_FRAMES_PER_SESSION; i++) {
      const t = 1000 + i * MIN_CLOUD_FRAME_INTERVAL_MS;
      expect(fm.startCloudFrame(t)).toBe(true);
      fm.completeCloudFrame(t + 500);
    }
    expect(fm.getCloudFrameCount()).toBe(MAX_FRAMES_PER_SESSION);
    expect(fm.canSendCloudFrame(Date.now() + 999999)).toBe(false);
    expect(fm.getRemainingFrames()).toBe(0);
  });

  it("tracks remaining frames", () => {
    const fm = new FrameManager();
    expect(fm.getRemainingFrames()).toBe(MAX_FRAMES_PER_SESSION);
    fm.startCloudFrame(1000);
    fm.completeCloudFrame(1500);
    expect(fm.getRemainingFrames()).toBe(MAX_FRAMES_PER_SESSION - 1);
  });

  it("tracks last cloud frame timestamp", () => {
    const fm = new FrameManager();
    fm.startCloudFrame(5000);
    fm.completeCloudFrame(6000);
    expect(fm.getLastCloudFrameAt()).toBe(5000);
  });
});

describe("validateFrame", () => {
  it("accepts a valid image blob", () => {
    const blob = new Blob(["data"], { type: "image/jpeg" });
    const result = validateFrame(blob);
    expect(result.ok).toBe(true);
  });

  it("rejects oversized blob", () => {
    const largeBlob = new Blob([new Uint8Array(MAX_FRAME_BYTES + 1)], {
      type: "image/jpeg"
    });
    const result = validateFrame(largeBlob);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("256 KiB");
  });

  it("rejects non-image blob", () => {
    const blob = new Blob(["text"], { type: "text/plain" });
    const result = validateFrame(blob);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Not an image");
  });
});
