import type { Part } from "@google/genai";
import { apiFetch } from "./client-api";
import type { Lesson } from "./types";
import { getSegmentKeyPoints } from "./study-focus";

export type VoiceVisual = { dataUrl: string; label: string };
export type VoiceContext = { visualContext: VoiceVisual[]; instructions: string };

export const VIETNAMESE_VOICE_GUIDANCE = "Luôn giảng và trả lời bằng tiếng Việt, kể cả khi học liệu hoặc lời nhận dạng có tiếng Anh hay tiếng Tây Ban Nha. Chỉ đổi ngôn ngữ nếu học viên yêu cầu rõ ràng. Thuật ngữ chuyên môn có thể giữ nguyên nhưng phải giải thích bằng tiếng Việt.";

/** Exact point indices and source IDs let the provider guide the visible workspace. */
export function voiceFocusInstructions(lesson: Lesson, segmentIndex: number): string {
  const segment = lesson.segments[segmentIndex];
  if (!segment) return VIETNAMESE_VOICE_GUIDANCE;
  return [
    VIETNAMESE_VOICE_GUIDANCE,
    "Khi bắt đầu giải thích một ý hoặc hình, gọi set_study_focus để đánh dấu ý cần chú ý và trang/slide liên quan. Chỉ gọi khi trọng tâm thay đổi; không đọc tên công cụ, số chỉ mục hoặc mã nguồn cho học viên nghe.",
    "pointIndex là chỉ mục bắt đầu từ 0 trong danh sách dưới đây. Dùng null nếu đang trao đổi ngoài các ý này. materialId và index phải thuộc nguồn của phần hiện tại, hoặc đều null nếu không cần mở nguồn. cue là một câu tiếng Việt ngắn cho biết học viên nên chú ý điều gì.",
    `Các ý của phần hiện tại: ${JSON.stringify(getSegmentKeyPoints(segment).map((point, pointIndex) => ({ pointIndex, point })))}`,
    `Nguồn được phép mở của phần hiện tại: ${JSON.stringify(segment.sourceRefs.map(ref => ({ materialId: ref.materialId, index: ref.index, label: ref.label })))}`,
    "Không tự chuyển sang phần khác. Sau mỗi ý, đưa một ví dụ ngắn hoặc câu hỏi để học viên xác nhận đã hiểu.",
  ].join("\n");
}

/** Accept only bounded, embedded source images; never let a source trigger a URL fetch. */
export function normalizeVoiceVisuals(value: unknown): VoiceVisual[] {
  if (!Array.isArray(value)) return [];
  const result: VoiceVisual[] = [];
  let size = 0;
  for (const entry of value.slice(0, 8)) {
    if (!entry || typeof entry !== "object") continue;
    const { dataUrl, label } = entry as Partial<VoiceVisual>;
    if (typeof dataUrl !== "string" || typeof label !== "string" || dataUrl.length > 150000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) continue;
    size += dataUrl.length;
    if (size > 1200000) break;
    result.push({ dataUrl, label: label.slice(0, 300) });
  }
  return result;
}

export function openAiVisualEvent(visual: VoiceVisual): Record<string, unknown> {
  return {
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [
      { type: "input_text", text: `Hình từ học liệu: ${visual.label}. Giải thích hình này khi có liên quan đến phần đang học. Nói rõ nếu chi tiết quá nhỏ để đọc.` },
      { type: "input_image", image_url: visual.dataUrl },
    ] },
  };
}

/** Respect the negotiated SCTP limit instead of losing a large image at channel.send(). */
export async function fitOpenAiVoiceVisual(visual: VoiceVisual, limit: number): Promise<VoiceVisual | null> {
  const fits = (candidate: VoiceVisual) => new TextEncoder().encode(JSON.stringify(openAiVisualEvent(candidate))).byteLength <= limit;
  if (!limit || fits(visual)) return visual;
  let bitmap: ImageBitmap | null = null;
  try {
    const match = visual.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match || typeof createImageBitmap === "undefined") return null;
    const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
    bitmap = await createImageBitmap(new Blob([bytes.buffer], { type: match[1] }));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return null;
    let scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const candidate = { ...visual, dataUrl: canvas.toDataURL("image/jpeg", Math.max(0.45, 0.85 - attempt * 0.08)) };
      if (fits(candidate)) return candidate;
      scale *= 0.78;
    }
    return null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

export function geminiVisualParts(visuals: VoiceVisual[]): Part[] {
  return visuals.flatMap(visual => {
    const match = visual.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) return [];
    return [
      { text: `Hình từ học liệu: ${visual.label}. Giải thích khi liên quan đến phần đang học; nói rõ nếu không đọc được chi tiết.` },
      { inlineData: { mimeType: match[1], data: match[2] } },
    ];
  });
}

export async function loadVoiceContext(lessonId: string, segmentIndex: number, signal: AbortSignal): Promise<VoiceContext> {
  const response = await apiFetch("/api/voice/context", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lessonId, segmentIndex }), signal,
  });
  const context = await response.json() as { visualContext?: unknown; instructions?: unknown; error?: unknown };
  if (!response.ok) throw new Error(typeof context.error === "string" ? context.error : "Chưa đọc được học liệu của phần đang học.");
  return {
    visualContext: normalizeVoiceVisuals(context.visualContext),
    instructions: typeof context.instructions === "string" ? context.instructions.slice(0, 18000) : "",
  };
}
