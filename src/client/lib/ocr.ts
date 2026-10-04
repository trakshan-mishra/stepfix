export interface OcrResult {
  text: string;
  confidence: number;
  timestamp: number;
}

export interface FrameCandidate {
  imageId: string;
  blob: Blob;
  ocr?: OcrResult;
  timestamp: number;
}

const MIN_CLOUD_FRAME_INTERVAL_MS = 5000;
const MAX_FRAMES_PER_SESSION = 6;
const MAX_FRAME_LONG_EDGE = 1280;
const MAX_FRAME_BYTES = 256 * 1024;

export class FrameManager {
  private lastCloudFrameAt = 0;
  private cloudFramesCount = 0;
  private inFlight: AbortController | null = null;
  private frameQueue: FrameCandidate[] = [];
  private hasSentFrame = false;

  canSendCloudFrame(now: number = Date.now()): boolean {
    if (this.cloudFramesCount >= MAX_FRAMES_PER_SESSION) return false;
    if (this.inFlight !== null) return false;
    if (!this.hasSentFrame) return true;
    return now - this.lastCloudFrameAt >= MIN_CLOUD_FRAME_INTERVAL_MS;
  }

  startCloudFrame(now: number = Date.now()): boolean {
    if (!this.canSendCloudFrame(now)) return false;
    this.inFlight = new AbortController();
    this.lastCloudFrameAt = now;
    this.hasSentFrame = true;
    return true;
  }

  completeCloudFrame(_now: number = Date.now()): void {
    this.inFlight = null;
    this.cloudFramesCount++;
  }

  cancelCloudFrame(): void {
    if (this.inFlight) {
      this.inFlight.abort();
      this.inFlight = null;
    }
  }

  getCloudFrameCount(): number {
    return this.cloudFramesCount;
  }

  getRemainingFrames(): number {
    return Math.max(0, MAX_FRAMES_PER_SESSION - this.cloudFramesCount);
  }

  getLastCloudFrameAt(): number {
    return this.lastCloudFrameAt;
  }

  isInFlight(): boolean {
    return this.inFlight !== null;
  }

  getInFlightSignal(): AbortSignal | null {
    return this.inFlight?.signal ?? null;
  }
}

export function validateFrame(blob: Blob): {
  ok: boolean;
  reason?: string;
} {
  if (blob.size > MAX_FRAME_BYTES) {
    return { ok: false, reason: "Frame exceeds 256 KiB" };
  }
  if (!blob.type.startsWith("image/")) {
    return { ok: false, reason: "Not an image" };
  }
  return { ok: true };
}

export async function cropFrame(
  blob: Blob,
  maxLongEdge: number = MAX_FRAME_LONG_EDGE
): Promise<Blob> {
  const img = await createImageBitmap(blob);
  const scale = Math.min(1, maxLongEdge / Math.max(img.width, img.height));
  if (scale >= 1) return blob;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob((result) => resolve(result ?? blob), "image/jpeg", 0.7);
  });
}

export {
  MIN_CLOUD_FRAME_INTERVAL_MS,
  MAX_FRAMES_PER_SESSION,
  MAX_FRAME_LONG_EDGE,
  MAX_FRAME_BYTES
};
