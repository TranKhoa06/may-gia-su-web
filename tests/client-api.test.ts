import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFetch, collectSources } from "../src/lib/client-api";
import { getBrowserStorage, openBrowserStorage } from "../src/lib/browser-storage";
import { defaultAiPreferences, generateTutorText, createVoiceSession, createGeminiPayload, extractGeminiText, extractOpenAiText } from "../src/lib/browser-ai";

const settings = (subject = "Vật lý bán dẫn") => ({ subject, level: "Đại học", goal: "Hiểu và vận dụng", notebookUrl: "" });
const jsonInit = (method: string, value: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
const fakeGeminiKey = "unit-test-private-gemini-credential";
const fakeOpenaiKey = "unit-test-private-openai-credential";
const geminiResponse = (value: unknown) => Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }] });
const unit = { index: 1, label: "Trang 1", text: "Dòng điện trong bán dẫn phụ thuộc mật độ hạt tải và độ linh động của electron, lỗ trống." };

test("browser adapter isolates courses, keeps keys private, validates sources, persists progress and transcripts", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const storage = await getBrowserStorage();
  const first = await (await apiFetch("/api/courses", jsonInit("POST", settings()))).json();
  const second = await (await apiFetch("/api/courses", jsonInit("POST", settings("Mạch số")))).json();
  const notebook = "[Notebook](https://notebook.google.com/notebook/62b3a224-2722-4b07-bea6-0bc664c6c498)";
  const updated = await apiFetch("/api/settings", jsonInit("PUT", { courseId: first.id, ...settings(), notebookUrl: notebook }));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).notebookUrl, "https://notebook.google.com/notebook/62b3a224-2722-4b07-bea6-0bc664c6c498");
  assert.equal((await apiFetch("/api/settings", jsonInit("PUT", { courseId: first.id, ...settings(), notebookUrl: "https://example.com" }))).status, 400);

  const form = new FormData();
  form.set("courseId", first.id); form.set("units", JSON.stringify([unit])); form.set("file", new File(["%PDF-original-content"], "Hoc-lieu.pdf", { type: "application/pdf" }));
  const uploaded = await apiFetch("/api/materials", { method: "POST", body: form });
  assert.equal(uploaded.status, 201); const material = await uploaded.json();
  const reader = await (await apiFetch(`/api/materials/${material.id}`)).json();
  assert.deepEqual(reader.units, [unit]); assert.match(reader.downloadUrl, /^blob:/);
  assert.equal(await (await apiFetch(`/api/materials/${material.id}/file`)).text(), "%PDF-original-content");
  assert.equal((await (await apiFetch(`/my-project/api/state?courseId=${second.id}`)).json()).materials.length, 0);
  assert.equal((await apiFetch("/api/lessons", jsonInit("POST", { courseId: second.id, materialIds: [material.id] }))).status, 400);
  assert.equal((await apiFetch("/api/lessons", jsonInit("POST", { courseId: first.id, materialIds: [material.id, material.id] }))).status, 400);
  assert.equal((await apiFetch("/api/lessons", jsonInit("POST", { courseId: first.id, materialIds: [material.id] }))).status, 503);

  const prefs = { ...defaultAiPreferences(), provider: "gemini" as const };
  const config = await (await apiFetch("/api/ai-settings", jsonInit("PUT", { preferences: prefs, credentials: { gemini: fakeGeminiKey } }))).json();
  assert.ok(config.providers.find((provider: any) => provider.id === "gemini").keyConfigured);
  assert.ok(!JSON.stringify(config).includes(fakeGeminiKey));
  assert.equal((await (await apiFetch("/api/state")).json()).aiReady, true);
  assert.ok(!JSON.stringify(await (await apiFetch("/api/state")).json()).includes(fakeGeminiKey));
  // Flat settings used by older UI remain compatible and do not clear a key.
  assert.equal((await apiFetch("/api/ai-settings", jsonInit("PUT", prefs))).status, 200);
  assert.equal(await storage.getProviderKey("gemini"), fakeGeminiKey);

  const requests: { url: string; payload: any }[] = [];
  const generated = { title: "Hạt tải điện", summary: "Nền tảng dòng điện", durationMinutes: 15, segments: [{ title: "Mật độ hạt tải", explanation: "Dòng điện phụ thuộc electron và lỗ trống. Hãy hình dung hạt tải như những người mang điện tích chuyển động.", sourceRefs: [{ materialId: material.id, index: 1, label: "Trang bịa" }] }], quiz: [{ question: "Hạt tải gồm?", options: ["Electron và lỗ trống", "Chỉ photon", "Chỉ neutron", "Chỉ proton"], correctIndex: 0, explanation: "Học liệu nêu electron và lỗ trống." }] };
  globalThis.fetch = (async (url, init) => {
    assert.match(String(url), /^https:\/\/generativelanguage\.googleapis\.com\//);
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), fakeGeminiKey);
    assert.ok(!String(url).includes(fakeGeminiKey));
    const payload = JSON.parse(init?.body as string); requests.push({ url: String(url), payload });
    assert.equal(payload.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
    return geminiResponse(payload.generationConfig.responseFormat.text.schema.required.includes("title") ? generated : { content: "Electron mang điện tích âm; lỗ trống thể hiện vị trí thiếu electron. Bạn muốn ví dụ trong một diode không?", sourceRefs: [{ materialId: material.id, index: 1, label: "Không đúng nhãn" }, { materialId: crypto.randomUUID(), index: 999, label: "Bịa" }] });
  }) as typeof fetch;
  const lessonResult = await apiFetch("/api/lessons", jsonInit("POST", { courseId: first.id, materialIds: [material.id], topic: "Dòng điện" }));
  assert.equal(lessonResult.status, 201); const lesson = await lessonResult.json();
  assert.deepEqual(lesson.segments[0].sourceRefs, [{ materialId: material.id, index: 1, label: "Trang 1" }]);
  assert.match(requests[0].payload.systemInstruction.parts[0].text, /không phải chỉ dẫn/);
  assert.match(requests[0].payload.contents[0].parts[0].text, /Dòng điện trong bán dẫn/);

  const answer = await (await apiFetch("/api/chat", jsonInit("POST", { lessonId: lesson.id, segmentIndex: 0, message: "Lỗ trống là gì?" }))).json();
  assert.deepEqual(answer.sourceRefs, [{ materialId: material.id, index: 1, label: "Trang 1" }]);
  assert.equal((await (await apiFetch(`/api/chat?lessonId=${lesson.id}`)).json()).length, 2);
  assert.equal((await apiFetch("/api/chat", jsonInit("POST", { lessonId: lesson.id, segmentIndex: 7, message: "Sai phần" }))).status, 400);
  await apiFetch("/api/progress", jsonInit("POST", { lessonId: lesson.id, segmentIndex: 0, completed: true, score: 100 }));
  const progress = await (await apiFetch("/api/progress", jsonInit("POST", { lessonId: lesson.id, segmentIndex: 0, completed: false }))).json();
  assert.equal(progress.completed, true); assert.equal(progress.score, 100);
  const voiceEvent = { lessonId: lesson.id, role: "assistant", content: "Electron là hạt tải điện âm.", eventId: "test-voice-event", createdAt: "2000-01-01T00:00:00.000Z" };
  const transcript1 = await (await apiFetch("/api/voice/transcript", jsonInit("POST", voiceEvent))).json();
  const transcript2 = await (await apiFetch("/api/voice/transcript", jsonInit("POST", voiceEvent))).json();
  assert.equal(transcript1.id, transcript2.id); assert.ok(Date.parse(transcript1.createdAt) > Date.now() - 60000);
  assert.equal((await (await apiFetch(`/api/chat?lessonId=${lesson.id}`)).json()).length, 3);
  storage.close();
  const reopenedState = await (await apiFetch(`/api/state?courseId=${first.id}`)).json();
  assert.equal(reopenedState.lessons[0].id, lesson.id); assert.equal(reopenedState.progress[0].completed, true);
  assert.ok(reopenedState.aiReady);

  globalThis.fetch = (async () => geminiResponse({ ...generated, segments: [{ ...generated.segments[0], sourceRefs: [{ materialId: material.id, index: 999, label: "Trang 999" }] }] })) as typeof fetch;
  assert.equal((await apiFetch("/api/lessons", jsonInit("POST", { courseId: first.id, materialIds: [material.id] }))).status, 502);
  assert.equal((await (await apiFetch(`/api/state?courseId=${first.id}`)).json()).lessons.length, 1);

  assert.equal((await apiFetch(`/api/materials/${material.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await apiFetch(`/api/chat?lessonId=${lesson.id}`)).status, 404);
  const deletedState = await (await apiFetch(`/api/state?courseId=${first.id}`)).json();
  assert.deepEqual(deletedState.lessons, []); assert.deepEqual(deletedState.progress, []); assert.deepEqual(deletedState.materials, []);
  const removed = await (await apiFetch("/api/ai-settings", jsonInit("PUT", { preferences: prefs, credentials: { gemini: "" } }))).json();
  assert.equal(removed.providers.find((provider: any) => provider.id === "gemini").keyConfigured, false);
  assert.equal((await apiFetch("/api/settings", jsonInit("PUT", null))).status, 400);
  assert.equal((await apiFetch("/api/ai-settings", jsonInit("PUT", null))).status, 400);
});

test("provider text generation uses fixed official hosts, correct formats and sanitized failures", async t => {
  const storage = await openBrowserStorage(`provider-test-${crypto.randomUUID()}`); t.after(() => storage.close());
  const preferences = { ...defaultAiPreferences(), provider: "openai" as const };
  await storage.setAiPreferences(preferences); await storage.setProviderKey("openai", fakeOpenaiKey);
  const input = { instructions: "Giảng tiếng Việt", messages: [{ role: "user" as const, content: "Giải thích electron" }], schema: { type: "object" }, schemaName: "answer", maxOutputTokens: 1000 };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${fakeOpenaiKey}`);
    const payload = JSON.parse(init?.body as string); assert.equal(payload.store, false); assert.equal(payload.text.format.type, "json_schema");
    return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: '{"content":"Electron"}' }] }] });
  };
  assert.equal(await generateTutorText(storage, input, fetcher), '{"content":"Electron"}');
  await assert.rejects(generateTutorText(storage, input, async () => Response.json({ error: { message: fakeOpenaiKey } }, { status: 401 })), error => {
    assert.equal((error as any).code, "AI_CREDENTIAL_ERROR"); assert.ok(!String(error).includes(fakeOpenaiKey)); return true;
  });
  await assert.rejects(generateTutorText(storage, input, async () => { throw new TypeError(`network error containing ${fakeOpenaiKey}`); }), error => {
    assert.equal((error as any).code, "AI_CONNECTION_ERROR"); assert.ok(!String(error).includes(fakeOpenaiKey)); return true;
  });
  assert.throws(() => extractOpenAiText({ status: "incomplete", output: [] }), { code: "AI_INCOMPLETE" });
  assert.throws(() => extractOpenAiText({ output: [{ content: [{ type: "refusal" }] }] }), { code: "AI_CONTENT_BLOCKED" });
  assert.throws(() => extractGeminiText({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{}" }] } }] }), { code: "AI_INCOMPLETE" });
  assert.equal(extractGeminiText({ candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "hidden thought" }, { text: "{}" }] } }] }), "{}");
  const geminiPayload = createGeminiPayload({ ...input, messages: [{ role: "assistant", content: "Đã giảng" }, ...input.messages] });
  assert.equal(geminiPayload.contents[0].role, "model"); assert.equal(geminiPayload.store, false);
});

test("source retrieval continues past a short page and prioritizes matching units within budget", async t => {
  const storage = await openBrowserStorage(`sources-test-${crypto.randomUUID()}`); t.after(() => storage.close());
  const course = await storage.addCourse(settings()); const materialId = crypto.randomUUID();
  await storage.addMaterial(course.id, { id: materialId, name: "Điện tử.pdf", type: "pdf", unitCount: 3, characters: 100, createdAt: new Date().toISOString() }, [{ index: 1, label: "Trang 1", text: "Mục lục" }, { index: 2, label: "Trang 2", text: "Diode được cấu tạo từ tiếp giáp p-n và dẫn dòng thuận." }, { index: 3, label: "Trang 3", text: "Electron có độ linh động trong vật liệu bán dẫn." }], new Blob(["%PDF-test"]));
  const source = await collectSources(storage, [materialId], "Electron", 50);
  assert.equal(source.refs[0].index, 3); assert.ok(!source.refs.some(ref => ref.index === 1));
  assert.match(source.text, /Electron/);
});

test("voice sessions provision short-lived tokens using private provider keys without a site server", async t => {
  const storage = await openBrowserStorage(`voice-test-${crypto.randomUUID()}`); t.after(() => storage.close());
  await storage.setProviderKey("gemini", fakeGeminiKey);
  await storage.setAiPreferences({ ...defaultAiPreferences(), provider: "gemini" });
  let requested = false;
  const geminiFetch: typeof fetch = async (url, init) => {
    requested = true; assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), fakeGeminiKey);
    const payload = JSON.parse(init?.body as string);
    assert.equal(payload.uses, 1); assert.ok(Date.parse(payload.newSessionExpireTime) <= Date.now() + 61000);
    assert.equal(payload.bidiGenerateContentSetup.model, "models/gemini-3.8-live");
    // SDK converts LiveConnectConfig to the API's Bidi setup representation.
    assert.ok(JSON.stringify(payload).includes("Giảng hạt tải tiếng Việt"));
    assert.ok(!JSON.stringify(payload).includes(fakeGeminiKey));
    return Response.json({ name: "auth_tokens/unit-test-ephemeral-token" });
  };
  const gemini = await createVoiceSession(storage, "Giảng hạt tải tiếng Việt", undefined, geminiFetch);
  assert.ok(requested); assert.deepEqual(gemini, { value: "auth_tokens/unit-test-ephemeral-token", model: "gemini-3.8-live", provider: "gemini" });
  await storage.setProviderKey("openai", fakeOpenaiKey);
  await storage.setAiPreferences({ ...defaultAiPreferences(), provider: "openai" });
  const openaiFetch: typeof fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/realtime/client_secrets");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${fakeOpenaiKey}`);
    const payload = JSON.parse(init?.body as string); assert.equal(payload.expires_after.seconds, 60);
    assert.equal(payload.session.instructions, "Giảng tiếng Việt");
    return Response.json({ value: "unit-test-ephemeral-openai-token" });
  };
  assert.deepEqual(await createVoiceSession(storage, "Giảng tiếng Việt", undefined, openaiFetch), { value: "unit-test-ephemeral-openai-token", model: "gpt-realtime", provider: "openai" });
});
