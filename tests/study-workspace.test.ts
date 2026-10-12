import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonOutline, ListeningFocus, nearChatBottom, paragraphAtBoundary, readingParagraphs, submitOnEnter } from "../src/app/components/study-workspace";
import type { Lesson } from "../src/lib/types";

const lesson: Lesson = { id: "lesson-ui", title: "MOSFET", summary: "", durationMinutes: 10, materialIds: ["source-ui"], createdAt: "2026-10-12T00:00:00Z", quiz: [], segments: [
  { title: "Cấu tạo", explanation: "Cổng cách điện.", sourceRefs: [{ materialId: "source-ui", index: 3, label: "Slide 3" }] },
  { title: "Vùng hoạt động", explanation: "Phân biệt các vùng.", sourceRefs: [] },
] };

test("speech boundaries preserve Vietnamese UTF-16 positions across paragraph gaps", () => {
  const text = "  Cổng và cực nguồn.\n\n  Điện áp ngưỡng.\n\nDòng điện qua kênh.";
  const parts = readingParagraphs(text);
  assert.equal(parts.length, 3);
  parts.forEach((part, i) => { assert.equal(text.slice(part.start, part.end), part.text); assert.equal(paragraphAtBoundary(parts, part.start), i); });
  assert.equal(paragraphAtBoundary(parts, text.indexOf("ngưỡng")), 1);
  assert.equal(paragraphAtBoundary(parts, text.indexOf("Dòng")), 2);
  assert.equal(paragraphAtBoundary(parts, -1), null);
  assert.equal(paragraphAtBoundary(parts, text.length + 4), null);
  assert.equal(paragraphAtBoundary(parts, Number.NaN), null);
  assert.deepEqual(readingParagraphs("  \n\n "), []);
});

test("Enter submits while Shift+Enter and IME confirmation stay in the composer", () => {
  assert.equal(submitOnEnter({ key: "Enter", shiftKey: false, nativeEvent: {} }), true);
  assert.equal(submitOnEnter({ key: "Enter", shiftKey: true, nativeEvent: {} }), false);
  assert.equal(submitOnEnter({ key: "Enter", shiftKey: false, nativeEvent: { isComposing: true } }), false);
  assert.equal(submitOnEnter({ key: "Enter", shiftKey: false, nativeEvent: { keyCode: 229 } }), false);
  assert.equal(submitOnEnter({ key: "a", shiftKey: false, nativeEvent: {} }), false);
});

test("conversation auto-follow respects a reader who scrolled back", () => {
  assert.equal(nearChatBottom({ scrollHeight: 1200, scrollTop: 700, clientHeight: 300 }), false);
  assert.equal(nearChatBottom({ scrollHeight: 1200, scrollTop: 845, clientHeight: 300 }), true);
  assert.equal(nearChatBottom({ scrollHeight: 200, scrollTop: 0, clientHeight: 300 }), true);
});

test("lesson outline identifies the active named part without implying completion", () => {
  const html = renderToStaticMarkup(createElement(LessonOutline, { lesson, index: 1, onSelect: () => {} }));
  assert.match(html, /Cấu tạo/);
  assert.match(html, /Vùng hoạt động/);
  assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
  assert.doesNotMatch(html, /đã hoàn thành|100%/i);
});

test("focus names the valid source and selected point and distinguishes captions from audio", () => {
  const html = renderToStaticMarkup(createElement(ListeningFocus, { lesson, index: 0, points: ["Cổng cách điện", "Điện áp điều khiển"], focus: { pointIndex: 1, cue: "Nhìn cực cổng", sourceRef: lesson.segments[0].sourceRefs[0] }, sourceName: "MOSFET.pdf", following: false, voiceConnected: true, speaking: true, reading: false, paused: false, boundaryKnown: false, transcript: { role: "assistant", text: "Quan sát cực cổng." }, onFollow: () => {}, onPoint: () => {}, onAsk: () => {} }));
  assert.match(html, /Slide 3/);
  assert.match(html, /Nhìn cực cổng/);
  assert.match(html, /class="active" aria-pressed="true"/);
  assert.match(html, /Chữ có thể xuất hiện trước âm thanh/);
  assert.match(html, /Theo gia sư/);
});

test("focus does not fake exact reading progress when a voice lacks boundary events", () => {
  const html = renderToStaticMarkup(createElement(ListeningFocus, { lesson, index: 0, points: [], focus: null, sourceLabel: "Slide 3", following: true, voiceConnected: false, speaking: false, reading: true, paused: false, boundaryKnown: false, transcript: null, onFollow: () => {}, onPoint: () => {}, onAsk: () => {} }));
  assert.match(html, /chưa đánh dấu chính xác đoạn đang đọc/);
  assert.match(html, /Slide 3/);
  assert.doesNotMatch(html, /Đang đọc đoạn này/);
});

test("manual attention selection does not attribute a source pointer to the AI", () => {
  const html = renderToStaticMarkup(createElement(ListeningFocus, { lesson, index: 0, points: ["Cổng cách điện"], focus: { pointIndex: 0, cue: "Bạn chọn ý này để hỏi lại." }, sourceName: "MOSFET.pdf", sourceLabel: "Slide 3", following: true, voiceConnected: false, speaking: false, reading: false, paused: false, boundaryKnown: false, transcript: null, onFollow: () => {}, onPoint: () => {}, onAsk: () => {} }));
  assert.match(html, /Nguồn của phần học:/);
  assert.doesNotMatch(html, /Gia sư chỉ:/);
  assert.match(html, /Cần chú ý · Ý 1: Cổng cách điện/);
  assert.match(html, /<details class="focus-details">/);
  assert.doesNotMatch(html, /<details class="focus-details" open/);
});

test("live caption shows the newest generated words while complete history stays elsewhere", () => {
  const html = renderToStaticMarkup(createElement(ListeningFocus, { lesson, index: 0, points: [], focus: null, following: true, voiceConnected: true, speaking: true, reading: false, paused: false, boundaryKnown: false, transcript: { role: "assistant", text: "Đầu lượt giảng " + "nội dung ".repeat(100) + "Cuối lượt giảng" }, onFollow: () => {}, onPoint: () => {}, onAsk: () => {} }));
  assert.match(html, /Cuối lượt giảng/);
  assert.doesNotMatch(html, /Đầu lượt giảng/);
  assert.match(html, /Chữ có thể xuất hiện trước âm thanh/);
});
