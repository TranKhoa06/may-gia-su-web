import type { SourceImage } from "./types";

// This budget counts the complete ASCII data URLs, not their compressed byte size.
export const MAX_VISUAL_DATA_CHARACTERS = 10 * 1024 * 1024;
export const MAX_VISUALS_PER_DOCUMENT = 200;
export const MAX_VISUALS_PER_SLIDE = 6;
export const MAX_VISUAL_DIMENSION = 1100;

/** Compress a canvas to a bounded JPEG without retaining the original pixel buffer. */
export function fitCanvasImage(canvas: HTMLCanvasElement, maxCharacters: number, id: string, label: string): SourceImage {
  if (maxCharacters < 4_096) throw new Error("Không đủ dung lượng để lưu hình học liệu.");
  let output = canvas;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    for (const quality of [0.84, 0.68, 0.5, 0.35]) {
      const dataUrl = output.toDataURL("image/jpeg", quality);
      if (dataUrl.startsWith("data:image/jpeg;base64,") && dataUrl.length <= maxCharacters) {
        const result: SourceImage = { id, label: label.slice(0, 500), dataUrl, mimeType: "image/jpeg", width: output.width, height: output.height };
        if (output !== canvas) { output.width = 0; output.height = 0; }
        return result;
      }
    }
    if (Math.max(output.width, output.height) <= 64) break;
    const width = Math.max(1, Math.floor(output.width * 0.72));
    const height = Math.max(1, Math.floor(output.height * 0.72));
    if (width === output.width && height === output.height) break;
    const reduced = document.createElement("canvas");
    reduced.width = width; reduced.height = height;
    const context = reduced.getContext("2d");
    if (!context) throw new Error("Trình duyệt không hỗ trợ đọc hình học liệu.");
    context.fillStyle = "white"; context.fillRect(0, 0, width, height);
    context.drawImage(output, 0, 0, width, height);
    if (output !== canvas) { output.width = 0; output.height = 0; }
    output = reduced;
  }
  if (output !== canvas) { output.width = 0; output.height = 0; }
  throw new Error("Không thể nén hình học liệu trong giới hạn dung lượng.");
}

/** Decode only raster image files from PPTX; neither XML nor external URLs execute. */
export async function rasterImage(bytes: Uint8Array, mimeType: string, maxCharacters: number, id: string, label: string): Promise<SourceImage> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) {
      throw new Error("Hình quá lớn hoặc không đọc được.");
    }
    const scale = Math.min(1, MAX_VISUAL_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Trình duyệt không hỗ trợ đọc hình học liệu.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return fitCanvasImage(canvas, maxCharacters, id, label);
  } finally {
    image.src = "";
    URL.revokeObjectURL(url);
    canvas.width = 0; canvas.height = 0;
  }
}
