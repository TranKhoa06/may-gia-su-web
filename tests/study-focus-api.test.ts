import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFetch } from "../src/lib/client-api";
import { getBrowserStorage } from "../src/lib/browser-storage";
import { defaultAiPreferences } from "../src/lib/browser-ai";
import { studyFocusTool } from "../src/lib/study-focus";

const post = (value: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
test("voice context supplies only current verified focus targets and enforces Vietnamese teaching", async t => {
  const storage = await getBrowserStorage(); const nativeFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = nativeFetch; storage.close(); });
  const course = await storage.addCourse({ subject: "Mạch điện", level: "Đại học", goal: "Hiểu dòng điện", notebookUrl: "" });
  const sourceId = crypto.randomUUID();
  await storage.addMaterial(course.id, { id: sourceId, name: "Điện trường.pdf", type: "pdf", unitCount: 3, characters: 120, createdAt: new Date().toISOString() }, [1,2,3].map(index => ({ index, label: `Trang ${index}`, text: "Điện trường tác động lên hạt tải. Hạt tải dịch chuyển tạo dòng điện." })), new Blob(["%PDF-synthetic"]));
  const lessonId = crypto.randomUUID();
  await storage.saveLesson(course.id, { id: lessonId, title: "Dòng điện bán dẫn", summary: "Học từng ý", durationMinutes: 10, materialIds: [sourceId], createdAt: new Date().toISOString(), quiz: [], segments: [
    { title: "Điện trường", explanation: "Điện trường tác động lên hạt tải trong bán dẫn.", keyPoints: ["Điện trường tác động lên hạt tải.", "Hạt tải dịch chuyển có hướng."], sourceRefs: [{ materialId: sourceId, index: 2, label: "Trang 2" }] },
    { title: "Dòng điện", explanation: "Dòng điện là sự vận chuyển điện tích.", sourceRefs: [{ materialId: sourceId, index: 3, label: "Trang 3" }] },
  ] });
  const contextResult = await apiFetch("/api/voice/context", post({ lessonId, segmentIndex: 0 }));
  assert.equal(contextResult.status, 200); const context = await contextResult.json();
  assert.match(context.instructions, /luôn giảng và trả lời bằng tiếng Việt/);
  assert.match(context.instructions, /set_study_focus/);
  assert.match(context.instructions, /"pointIndex":0/);
  const focusData = context.instructions.match(/\{"part":"Điện trường"[^\n]+/)?.[0];
  assert.ok(focusData); assert.deepEqual(JSON.parse(focusData!).allowedSources, [{ materialId: sourceId, index: 2, label: "Trang 2" }]);
  await storage.setProviderKey("openai", "synthetic-focus-provider-key");
  await storage.setAiPreferences({ ...defaultAiPreferences(), provider: "openai" });
  globalThis.fetch = (async (_url, init) => {
    const payload = JSON.parse(init?.body as string);
    assert.deepEqual(payload.session.tools, [{ type: "function", ...studyFocusTool }]);
    assert.equal(payload.session.tool_choice, "auto");
    assert.match(payload.session.instructions, /Không tự đọc liên tục hết bài/);
    assert.ok(!JSON.stringify(payload).includes("synthetic-focus-provider-key"));
    return Response.json({ value: "synthetic-short-lived-token" });
  }) as typeof fetch;
  const voice = await apiFetch("/api/voice/session", post({ lessonId, segmentIndex: 0 }));
  assert.equal(voice.status, 200);
  assert.ok(!JSON.stringify(await voice.json()).includes("synthetic-focus-provider-key"));
});
