interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
}

const MAX_WIDTH = 1280;
const MAX_JPEG_SIZE = 400 * 1024;
const JPEG_QUALITY_STEPS = [0.8, 0.6, 0.4, 0.2];

export async function captureScreen(): Promise<CaptureResult | null> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor" } as MediaTrackConstraints,
      audio: false
    });

    const video = document.createElement("video");
    video.srcObject = stream;
    await new Promise((resolve) => {
      video.onloadedmetadata = resolve;
    });
    await video.play();

    await new Promise((r) => setTimeout(r, 200));

    const canvas = document.createElement("canvas");
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);

    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    stream.getTracks().forEach((t) => t.stop());

    let blob = await canvasToJpeg(canvas, JPEG_QUALITY_STEPS[0]);
    for (const quality of JPEG_QUALITY_STEPS) {
      blob = await canvasToJpeg(canvas, quality);
      if (blob.size <= MAX_JPEG_SIZE) break;
    }

    return { blob, width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

async function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Blob> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? new Blob()), "image/jpeg", quality);
  });
}

export interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function applyBlur(
  canvas: HTMLCanvasElement,
  regions: BlurRegion[]
): void {
  const ctx = canvas.getContext("2d")!;
  for (const region of regions) {
    const imageData = ctx.getImageData(
      region.x,
      region.y,
      region.width,
      region.height
    );
    const data = imageData.data;
    const blockSize = 10;
    for (let y = 0; y < region.height; y += blockSize) {
      for (let x = 0; x < region.width; x += blockSize) {
        let r = 0,
          g = 0,
          b = 0,
          count = 0;
        for (let dy = 0; dy < blockSize && y + dy < region.height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < region.width; dx++) {
            const i = ((y + dy) * region.width + (x + dx)) * 4;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        for (let dy = 0; dy < blockSize && y + dy < region.height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < region.width; dx++) {
            const i = ((y + dy) * region.width + (x + dx)) * 4;
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          }
        }
      }
    }
    ctx.putImageData(imageData, region.x, region.y);
  }
}
