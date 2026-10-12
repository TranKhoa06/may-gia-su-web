import { AudioLines, ChevronDown, ChevronRight, FileText, MessageCircle, ScanEye } from "lucide-react";
import type { Lesson, SourceRef } from "@/lib/types";

export type StudyFocusView = { pointIndex: number | null; cue: string; sourceRef?: SourceRef };
export type LiveTranscriptView = { role: "user" | "assistant"; text: string };

export function LessonOutline({ lesson, index, onSelect }: { lesson: Lesson; index: number; onSelect: (index: number) => void }) {
  return <nav className="study-outline" aria-label="Các phần của bài học"><span className="study-outline-label">BÀI HỌC</span><div>{lesson.segments.map((part, i) => <button type="button" key={i} className={i === index ? "active" : ""} aria-current={i === index ? "step" : undefined} onClick={() => onSelect(i)}><span>{i + 1}</span><strong>{part.title}</strong>{i === index && <ChevronRight size={14} />}</button>)}</div></nav>;
}

export function ListeningFocus({ lesson, index, points, focus, sourceName, sourceLabel, following, voiceConnected, speaking, reading, paused, boundaryKnown, transcript, onFollow, onPoint, onAsk }: {
  lesson: Lesson; index: number; points: string[]; focus: StudyFocusView | null; sourceName?: string; sourceLabel?: string; following: boolean;
  voiceConnected: boolean; speaking: boolean; reading: boolean; paused: boolean; boundaryKnown: boolean;
  transcript: LiveTranscriptView | null; onFollow: () => void; onPoint: (index: number, point: string) => void; onAsk: (prompt: string) => void;
}) {
  const current = lesson.segments[index];
  const label = focus?.sourceRef?.label || sourceLabel;
  const caption = transcript?.text ? transcript.text.length > 500 ? `…${transcript.text.slice(-500)}` : transcript.text : "";
  const selectedPoint = focus?.pointIndex !== null && focus?.pointIndex !== undefined ? points[focus.pointIndex] : null;
  return <section className="listening-focus" aria-label="Vị trí và điểm cần chú ý">
    <div className="focus-main"><span className={`focus-orb ${speaking || reading && !paused ? "playing" : ""}`}><AudioLines size={23} /></span><div><span className="focus-kicker">{reading ? paused ? "ĐỌC ĐANG TẠM DỪNG" : "ĐANG ĐỌC BÀI" : voiceConnected ? speaking ? "MÂY ĐANG GIẢNG" : "PHIÊN GIỌNG NÓI ĐANG MỞ" : "ĐANG HỌC"} · PHẦN {index + 1}/{lesson.segments.length}</span><h2 title={current?.title}>{current?.title}</h2>{(focus?.cue || voiceConnected) && <p title={focus?.cue}>{focus?.cue || "Chưa có điểm chú ý từ gia sư."}</p>}</div></div>
    <div className="focus-source"><span title={`${sourceName || "Học liệu của phần này"}${label ? ` · ${label}` : ""}`}><FileText size={14} />{focus?.sourceRef ? "Gia sư chỉ: " : "Nguồn của phần học: "}{sourceName || "Học liệu của phần này"}{label ? ` · ${label}` : ""}</span><button type="button" className={following ? "following" : ""} onClick={onFollow} aria-pressed={following}><ScanEye size={15} />{following ? "Đang theo gia sư" : "Theo gia sư"}</button></div>
    {transcript?.text && <div className="live-caption"><span>{transcript.role === "assistant" ? "Lời Mây đang tạo" : "Micro nghe được"}</span><p>{caption}</p>{transcript.role === "assistant" && <small>Chữ có thể xuất hiện trước âm thanh; điểm chú ý do gia sư chọn.</small>}</div>}
    {reading && <p className="focus-sync-note">{boundaryKnown ? "Đoạn có viền xanh bên dưới là đoạn giọng đọc trình duyệt đang đọc." : "Giọng đọc này chưa báo vị trí đọc. Mây đang hiển thị phần học, chưa đánh dấu chính xác đoạn đang đọc."}</p>}
    <details className="focus-details"><summary title={selectedPoint || undefined}><span>{selectedPoint ? `Cần chú ý · Ý ${(focus?.pointIndex ?? 0) + 1}: ${selectedPoint}` : `Cần chú ý · ${points.length} ý chính & hỏi nhanh`}</span><ChevronDown size={13} /></summary><div className="focus-expanded">{points.length > 0 && <div className="focus-points"><div>{points.map((point, i) => <button type="button" key={i} className={focus?.pointIndex === i ? "active" : ""} aria-pressed={focus?.pointIndex === i} title={point} onClick={() => onPoint(i, point)}><span>{i + 1}</span>{point}</button>)}</div></div>}<div className="focus-actions">{["Tôi đang ở đâu?", "Chỉ giúp tôi phần cần nhìn", "Giảng lại ý này", "Nói lại bằng tiếng Việt"].map(prompt => <button type="button" key={prompt} onClick={() => onAsk(prompt)}><MessageCircle size={13} />{prompt}</button>)}</div></div></details>
  </section>;
}

export type TextParagraph = { text: string; start: number; end: number };
export function readingParagraphs(text: string): TextParagraph[] {
  const parts: TextParagraph[] = [];
  const pattern = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const value = match[0].trimEnd();
    if (value) parts.push({ text: value, start, end: start + value.length });
  }
  return parts.length ? parts : text.trim() ? [{ text, start: 0, end: text.length }] : [];
}

export function paragraphAtBoundary(paragraphs: TextParagraph[], charIndex: number): number | null {
  if (!Number.isFinite(charIndex) || charIndex < 0) return null;
  const match = paragraphs.findIndex((part, i) => charIndex >= part.start && charIndex < (paragraphs[i + 1]?.start ?? part.end + 1));
  return match >= 0 ? match : null;
}

export function submitOnEnter(event: { key: string; shiftKey: boolean; nativeEvent: { isComposing?: boolean; keyCode?: number } }): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}

export function nearChatBottom(element: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 88;
}
