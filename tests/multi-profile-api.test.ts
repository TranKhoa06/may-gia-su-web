import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFetch } from "../src/lib/client-api";
import { getBrowserStorage } from "../src/lib/browser-storage";
import { generateTutorText } from "../src/lib/browser-ai";

const jsonInit = (method: string, value: unknown): RequestInit => ({
  method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
});
const fakeKeys = {
  geminiA: "multi-profile-test-private-gemini-A",
  geminiB: "multi-profile-test-private-gemini-B",
  openai: "multi-profile-test-private-openai",
};
const geminiResponse = (value: unknown) => Response.json({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(value) }] } }],
});
type RequestRecord = { url: string; headers: Headers; payload: any };

test("multiple AI profiles keep credentials private and route text, voice, and profile tests independently", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const ids = { geminiA: crypto.randomUUID(), geminiB: crypto.randomUUID(), openai: crypto.randomUUID() };
  const profiles = [
    { id: ids.geminiA, label: "  Gemini học lý thuyết  ", provider: "gemini", textModel: "gemini-3.8-flash", voiceModel: "gemini-3.8-live", apiKey: fakeKeys.geminiA },
    { id: ids.geminiB, label: "Gemini khóa thứ hai", provider: "gemini", textModel: "gemini-3.1-pro-preview", voiceModel: null, apiKey: fakeKeys.geminiB },
    { id: ids.openai, label: "OpenAI hội thoại", provider: "openai", textModel: "gpt-4.1-mini", voiceModel: "gpt-realtime", apiKey: fakeKeys.openai },
  ];
  const selection = { textProfileId: ids.geminiA, voiceProfileId: ids.openai };
  const getSettings = async () => (await apiFetch("/api/ai-settings")).json();
  const assertNoKeys = (value: unknown) => {
    const encoded = typeof value === "string" ? value : JSON.stringify(value);
    for (const key of Object.values(fakeKeys)) assert.ok(!encoded.includes(key), "private credential must never appear in public responses");
  };
  const requests: RequestRecord[] = [];
  let rejectRequests = false;
  globalThis.fetch = (async (url, init) => {
    const request = { url: String(url), headers: new Headers(init?.headers), payload: JSON.parse(init?.body as string) };
    requests.push(request);
    for (const key of Object.values(fakeKeys)) assert.ok(!request.url.includes(key), "API keys belong only in headers");
    if (rejectRequests) return Response.json({ error: { message: Object.values(fakeKeys).join(" ") } }, { status: 401 });
    if (request.url === "https://api.openai.com/v1/realtime/client_secrets") return Response.json({ value: "multi-profile-openai-ephemeral" });
    if (request.url === "https://generativelanguage.googleapis.com/v1beta/auth_tokens") return Response.json({ name: "auth_tokens/multi-profile-gemini-ephemeral" });
    if (request.url === "https://api.openai.com/v1/responses") return Response.json({ status: "completed", output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }] });
    assert.match(request.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[A-Za-z0-9._-]+:generateContent$/);
    return geminiResponse({ ok: true });
  }) as typeof fetch;

  await t.test("saves three profiles, two independent keys for Gemini, and separate voice service", async () => {
    const saved = await apiFetch("/api/ai-settings", jsonInit("PUT", { profiles, selection }));
    assert.equal(saved.status, 200, await saved.clone().text());
    const value = await saved.json();
    assert.equal(value.profiles.length, 3);
    assert.deepEqual(value.selection, selection);
    assert.equal(value.selectedProvider, "gemini");
    assert.equal(value.selectedVoiceProvider, "openai");
    assert.equal(value.profiles.find((profile: any) => profile.id === ids.geminiA).label, "Gemini học lý thuyết");
    assert.ok(value.profiles.every((profile: any) => profile.keyConfigured === true));
    assert.ok(value.profiles.every((profile: any) => !("apiKey" in profile)));
    assertNoKeys(value);
    assertNoKeys(await (await apiFetch("/api/state")).json());
  });

  await t.test("tests a specific Gemini key and model without switching classroom selections", async () => {
    const before = await getSettings();
    const checked = await apiFetch("/api/ai/test", jsonInit("POST", { profileId: ids.geminiB }));
    assert.equal(checked.status, 200, await checked.clone().text());
    const request = requests.at(-1)!;
    assert.equal(request.headers.get("x-goog-api-key"), fakeKeys.geminiB);
    assert.ok(request.url.endsWith("/models/gemini-3.1-pro-preview:generateContent"));
    assert.deepEqual((await getSettings()).selection, before.selection);
    assertNoKeys(await checked.json());
  });

  const storage = await getBrowserStorage();
  const course = await storage.addCourse({ subject: "Mạch bán dẫn", level: "Đại học", goal: "Hiểu hạt tải", notebookUrl: "" });
  const materialId = crypto.randomUUID();
  await storage.addMaterial(course.id, {
    id: materialId, name: "hạt-tải.pdf", type: "pdf", unitCount: 1, characters: 90, createdAt: new Date().toISOString(),
  }, [{ index: 1, label: "Trang 1", text: "Electron và lỗ trống là các hạt tải tạo nên dòng điện trong vật liệu bán dẫn." }], new Blob(["%PDF-test-source"]));
  const lessonId = crypto.randomUUID();
  await storage.saveLesson(course.id, {
    id: lessonId, title: "Hạt tải", summary: "Nguồn gốc dòng điện", durationMinutes: 15, materialIds: [materialId],
    segments: [{ title: "Electron và lỗ trống", explanation: "Electron mang điện tích âm; lỗ trống biểu diễn sự thiếu electron trong mạng tinh thể.", sourceRefs: [{ materialId, index: 1, label: "Trang 1" }], illustration: null }],
    quiz: [{ question: "Electron mang điện tích gì?", options: ["Âm", "Dương", "Không có", "Luôn thay đổi"], correctIndex: 0, explanation: "Electron mang điện tích âm." }],
    createdAt: new Date().toISOString(),
  });
  const textInput = { instructions: "Kiểm tra định tuyến", messages: [{ role: "user" as const, content: "Trả ok=true" }], schemaName: "routing_test", schema: { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] }, maxOutputTokens: 1000 };

  await t.test("text uses its own selected key while voice uses the independent OpenAI profile", async () => {
    assert.equal(await generateTutorText(storage, textInput), '{"ok":true}');
    assert.equal(requests.at(-1)!.headers.get("x-goog-api-key"), fakeKeys.geminiA);
    assert.ok(requests.at(-1)!.url.endsWith("/models/gemini-3.8-flash:generateContent"));
    const voice = await apiFetch("/api/voice/session", jsonInit("POST", { lessonId, segmentIndex: 0 }));
    assert.equal(voice.status, 200, await voice.clone().text());
    const request = requests.at(-1)!;
    assert.equal(request.url, "https://api.openai.com/v1/realtime/client_secrets");
    assert.equal(request.headers.get("Authorization"), `Bearer ${fakeKeys.openai}`);
    assert.equal(request.payload.session.model, "gpt-realtime");
    const value = await voice.json();
    assert.equal(value.provider, "openai");
    assert.equal(value.value, "multi-profile-openai-ephemeral");
    assertNoKeys(value);
  });

  await t.test("OpenAI text and Gemini voice also route correctly when their services are reversed", async () => {
    const selected = await apiFetch("/api/ai-settings", jsonInit("PUT", {
      selection: { textProfileId: ids.openai, voiceProfileId: ids.geminiA },
    }));
    assert.equal(selected.status, 200, await selected.clone().text());
    assert.equal(await generateTutorText(storage, textInput), '{"ok":true}');
    assert.equal(requests.at(-1)!.url, "https://api.openai.com/v1/responses");
    assert.equal(requests.at(-1)!.headers.get("Authorization"), `Bearer ${fakeKeys.openai}`);
    assert.equal(requests.at(-1)!.payload.model, "gpt-4.1-mini");
    const voice = await apiFetch("/api/voice/session", jsonInit("POST", { lessonId, segmentIndex: 0 }));
    assert.equal(voice.status, 200, await voice.clone().text());
    assert.equal(requests.at(-1)!.url, "https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    assert.equal(requests.at(-1)!.headers.get("x-goog-api-key"), fakeKeys.geminiA);
    const state = await (await apiFetch("/api/state")).json();
    assert.equal(state.aiProvider, "openai");
    assert.equal(state.aiSettings.selectedVoiceProvider, "gemini");
  });

  await t.test("selection-only updates and reload retain keys; Gemini voice can use a different Gemini key", async () => {
    const changedSelection = { textProfileId: ids.geminiB, voiceProfileId: ids.geminiA };
    const selected = await apiFetch("/api/ai-settings", jsonInit("PUT", { selection: changedSelection }));
    assert.equal(selected.status, 200, await selected.clone().text());
    const editedProfiles = profiles.map(({ apiKey: _apiKey, ...profile }) => ({ ...profile, label: profile.label.trim() + " đã lưu", apiKey: "" }));
    const edited = await apiFetch("/api/ai-settings", jsonInit("PUT", { profiles: editedProfiles, selection: changedSelection }));
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.ok((await edited.json()).profiles.every((profile: any) => profile.keyConfigured));
    const omittedCredentials = editedProfiles.map(({ apiKey: _apiKey, ...profile }) => profile);
    const withoutKeys = await apiFetch("/api/ai-settings", jsonInit("PUT", { profiles: omittedCredentials, selection: changedSelection }));
    assert.equal(withoutKeys.status, 200, await withoutKeys.clone().text());
    assert.ok((await withoutKeys.json()).profiles.every((profile: any) => profile.keyConfigured));
    storage.close();
    const reopened = await getBrowserStorage();
    assert.deepEqual((await getSettings()).selection, changedSelection);
    assert.equal(await generateTutorText(reopened, textInput), '{"ok":true}');
    assert.equal(requests.at(-1)!.headers.get("x-goog-api-key"), fakeKeys.geminiB);
    const voice = await apiFetch("/api/voice/session", jsonInit("POST", { lessonId, segmentIndex: 0 }));
    assert.equal(voice.status, 200, await voice.clone().text());
    assert.equal(requests.at(-1)!.url, "https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    assert.equal(requests.at(-1)!.headers.get("x-goog-api-key"), fakeKeys.geminiA);
    assert.equal(requests.at(-1)!.payload.bidiGenerateContentSetup.model, "models/gemini-3.8-live");
    const value = await voice.json();
    assert.equal(value.provider, "gemini");
    assertNoKeys(value);
  });

  await t.test("invalid profile lists or selections never partially change saved settings", async () => {
    const previous = await getSettings();
    const validProfiles = previous.profiles.map(({ keyConfigured: _keyConfigured, ...profile }: any) => profile);
    const invalidCases = [
      { profiles: validProfiles.map((profile: any, index: number) => index ? profile : { ...profile, id: "not-an-id", apiKey: "must-not-be-saved" }), selection: previous.selection },
      { profiles: validProfiles.map((profile: any, index: number) => index ? profile : { ...profile, label: " ", apiKey: "must-not-be-saved" }), selection: previous.selection },
      { profiles: [...validProfiles, validProfiles[0]], selection: previous.selection },
      { profiles: validProfiles.map((profile: any, index: number) => index ? profile : { ...profile, textModel: "https://unexpected.example/secret", apiKey: "must-not-be-saved" }), selection: previous.selection },
      { profiles: Array.from({ length: 21 }, (_, index) => ({ ...validProfiles[0], id: crypto.randomUUID(), label: `Profile ${index}` })), selection: previous.selection },
      { profiles: validProfiles, selection: { ...previous.selection, textProfileId: crypto.randomUUID() } },
      { selection: { ...previous.selection, voiceProfileId: ids.geminiB } },
      { profiles: [...validProfiles, { ...validProfiles[0], id: crypto.randomUUID(), label: "Profile mới thiếu khóa" }], selection: previous.selection },
      { profiles: validProfiles.map((profile: any, index: number) => index ? profile : { ...profile, provider: "openai" }), selection: previous.selection },
    ];
    for (const input of invalidCases) {
      const invalid = await apiFetch("/api/ai-settings", jsonInit("PUT", input));
      assert.equal(invalid.status, 400, await invalid.clone().text());
      assertNoKeys(await invalid.json());
      assert.deepEqual(await getSettings(), previous);
    }
    // A rejected change must also leave the actual key used for API requests intact.
    await generateTutorText(await getBrowserStorage(), textInput);
    assert.equal(requests.at(-1)!.headers.get("x-goog-api-key"), fakeKeys.geminiB);
  });

  await t.test("provider and network failures are sanitized without exposing any profile key", async () => {
    rejectRequests = true;
    const failed = await apiFetch("/api/ai/test", jsonInit("POST", { profileId: ids.geminiB }));
    assert.equal(failed.status, 503, await failed.clone().text());
    assertNoKeys(await failed.json());
    rejectRequests = false;
    await assert.rejects(generateTutorText(await getBrowserStorage(), textInput, async () => { throw new TypeError(`network error containing ${fakeKeys.geminiB}`); }), error => {
      assert.equal((error as any).code, "AI_CONNECTION_ERROR");
      assertNoKeys(String(error));
      return true;
    });
  });

  await t.test("deleting a profile removes its key while independent voice can be disabled", async () => {
    const current = await getSettings();
    const kept = current.profiles.filter((profile: any) => profile.id !== ids.geminiB).map(({ keyConfigured: _keyConfigured, ...profile }: any) => profile);
    const selection = { textProfileId: ids.geminiA, voiceProfileId: null };
    const removed = await apiFetch("/api/ai-settings", jsonInit("PUT", { profiles: kept, selection }));
    assert.equal(removed.status, 200, await removed.clone().text());
    const value = await removed.json();
    assert.equal(value.profiles.length, 2);
    assert.equal(value.profiles.find((profile: any) => profile.id === ids.openai).keyConfigured, true);
    assert.equal(value.profiles.find((profile: any) => profile.id === ids.geminiA).keyConfigured, true);
    assertNoKeys(value);
    assert.equal(await (await getBrowserStorage()).getAiProfileKey(ids.geminiB), "");
    assert.equal(await (await getBrowserStorage()).getAiProfileKey(ids.geminiA), fakeKeys.geminiA);
    const state = await (await apiFetch("/api/state")).json();
    assert.equal(state.aiReady, true);
    assert.equal(state.voiceReady, false);
    const requestedBefore = requests.length;
    const deleted = await apiFetch("/api/ai/test", jsonInit("POST", { profileId: ids.geminiB }));
    assert.ok([400, 404].includes(deleted.status), await deleted.clone().text());
    assert.equal(requests.length, requestedBefore);
    const missingVoiceKey = await apiFetch("/api/voice/session", jsonInit("POST", { lessonId, segmentIndex: 0 }));
    assert.equal(missingVoiceKey.status, 503, await missingVoiceKey.clone().text());
    assert.equal(requests.length, requestedBefore);
    await generateTutorText(await getBrowserStorage(), textInput);
    assert.equal(requests.at(-1)!.headers.get("x-goog-api-key"), fakeKeys.geminiA);
    const cleaned = await apiFetch("/api/ai-settings", jsonInit("PUT", { profiles: [], selection: { textProfileId: null, voiceProfileId: null } }));
    assert.equal(cleaned.status, 200, await cleaned.clone().text());
    assert.equal((await cleaned.json()).profiles.length, 0);
    assert.equal((await (await apiFetch("/api/state")).json()).aiReady, false);
    (await getBrowserStorage()).close();
    assert.deepEqual((await getSettings()).profiles, []);
    assert.equal(await (await getBrowserStorage()).getAiProfileKey(ids.geminiA), "");
    assert.equal(await (await getBrowserStorage()).getAiProfileKey(ids.openai), "");
  });
});
