import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { LEGACY_PROFILE_IDS, openBrowserStorage, type StoredAiProfile } from "../src/lib/browser-storage";
import type { AiPreferences } from "../src/lib/types";

const preferences: AiPreferences = { provider: "auto", openaiTextModel: "test-openai-model", openaiVoiceModel: "test-openai-live", geminiTextModel: "test-gemini-model", geminiVoiceModel: "test-gemini-live" };
const profile = (label: string, provider: "gemini" | "openai" = "gemini", voiceModel: string | null = "test-live"): StoredAiProfile => ({ id: crypto.randomUUID(), label, provider, textModel: "test-model", voiceModel });

async function storageForTest(t: TestContext) {
  const name = `multi-profile-test-${crypto.randomUUID()}`;
  const storage = await openBrowserStorage(name);
  t.after(() => storage.close());
  return { storage, name };
}

test("independent keys for the same provider persist with separate text and voice selections", async t => {
  const { storage, name } = await storageForTest(t);
  const first = profile("Gemini bài giảng");
  const second = profile("Gemini môn khác");
  const third = profile("OpenAI giọng nói", "openai");
  const keys = { [first.id]: "  fake-first-private-key  ", [second.id]: "fake-second-private-key", [third.id]: "fake-third-private-key" };
  const selection = { textProfileId: second.id, voiceProfileId: third.id };
  await storage.setAiPreferences(preferences);
  await storage.saveAiProfiles([first, second, third], keys, selection);
  storage.close();
  const reopened = await openBrowserStorage(name);
  t.after(() => reopened.close());
  assert.deepEqual(await reopened.getAiProfileSelection(), selection);
  assert.equal((await reopened.getAiPreferences()).textProfileId, second.id);
  assert.equal(await reopened.getAiProfileKey(first.id), "fake-first-private-key");
  assert.equal(await reopened.getAiProfileKey(second.id), "fake-second-private-key");
  assert.equal(await reopened.getAiProfileKey(third.id), "fake-third-private-key");
  const listed = await reopened.listAiProfiles();
  assert.deepEqual(listed, [first, second, third].map(value => ({ ...value, keyConfigured: true })));
  assert.ok(!JSON.stringify(listed).includes("private-key"));
  await reopened.saveAiProfiles([first, { ...second, textModel: "another-model" }, third]);
  assert.equal(await reopened.getAiProfileKey(second.id), "fake-second-private-key");
  assert.deepEqual(await reopened.getAiProfileSelection(), selection);
});

test("clearing one key and deleting one profile preserves unrelated credentials and clears stale selections", async t => {
  const { storage } = await storageForTest(t);
  const first = profile("Tài khoản 1");
  const second = profile("Tài khoản 2");
  const third = profile("Giữ nguyên", "openai");
  await storage.saveAiProfiles([first, second, third], { [first.id]: "first-private-key", [second.id]: "second-private-key", [third.id]: "third-private-key" }, { textProfileId: second.id, voiceProfileId: first.id });
  await storage.saveAiProfiles([first, third], { [first.id]: " " });
  assert.equal(await storage.getAiProfileKey(first.id), "");
  assert.equal(await storage.getAiProfileKey(second.id), "");
  assert.equal(await storage.getAiProfileKey(third.id), "third-private-key");
  assert.deepEqual(await storage.getAiProfileSelection(), { textProfileId: null, voiceProfileId: first.id });
  assert.deepEqual((await storage.listAiProfiles()).map(value => value.keyConfigured), [false, true]);
  await storage.saveAiProfiles([{ ...first, voiceModel: null }, third]);
  assert.deepEqual(await storage.getAiProfileSelection(), { textProfileId: null, voiceProfileId: null });
});

test("invalid profiles, unknown key targets and invalid voice selection reject without changing saved settings", async t => {
  const { storage } = await storageForTest(t);
  const first = profile("Bài giảng", "gemini", null);
  await storage.saveAiProfiles([first], { [first.id]: "saved-key" }, { textProfileId: first.id, voiceProfileId: null });
  await assert.rejects(storage.saveAiProfiles([first, first]), { status: 400 });
  await assert.rejects(storage.saveAiProfiles([first], { [crypto.randomUUID()]: "orphan-key" }), { status: 400 });
  await assert.rejects(storage.saveAiProfiles([first], { [first.id]: "replacement-key" }, { textProfileId: first.id, voiceProfileId: first.id }), { status: 400 });
  await assert.rejects(storage.setAiProfileSelection({ textProfileId: crypto.randomUUID(), voiceProfileId: null }), { status: 400 });
  assert.equal(await storage.getAiProfileKey(first.id), "saved-key");
  assert.deepEqual(await storage.getAiProfileSelection(), { textProfileId: first.id, voiceProfileId: null });
  assert.equal((await storage.listAiProfiles()).length, 1);
});

test("a failing selection write rolls back changed metadata, keys and profile deletion", async t => {
  const { storage } = await storageForTest(t);
  const first = profile("Bài giảng");
  const second = profile("Giọng nói", "openai");
  const selection = { textProfileId: first.id, voiceProfileId: second.id };
  await storage.setAiPreferences(preferences);
  await storage.saveAiProfiles([first, second], { [first.id]: "original-key", [second.id]: "retained-key" }, selection);
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
    if (this.name === "config" && (value as { key?: string }).key === "aiProfileSelection") {
      throw new DOMException("Simulated storage exhaustion", "QuotaExceededError");
    }
    return originalPut.call(this, value, key);
  };
  t.after(() => { IDBObjectStore.prototype.put = originalPut; });
  await assert.rejects(storage.saveAiProfiles([{ ...first, label: "Changed" }], { [first.id]: "replacement-key" }, { textProfileId: first.id, voiceProfileId: null }), { status: 507 });
  IDBObjectStore.prototype.put = originalPut;
  assert.deepEqual(await storage.listAiProfiles(), [first, second].map(value => ({ ...value, keyConfigured: true })));
  assert.equal(await storage.getAiProfileKey(first.id), "original-key");
  assert.equal(await storage.getAiProfileKey(second.id), "retained-key");
  assert.deepEqual(await storage.getAiProfileSelection(), selection);
  assert.equal((await storage.getAiPreferences()).voiceProfileId, second.id);
});

test("legacy keys migrate once, preserve models and provider choice, and support legacy preference updates", async t => {
  const { storage } = await storageForTest(t);
  await storage.setAiPreferences({ ...preferences, provider: "openai" });
  await storage.setProviderKey("gemini", "legacy-gemini-key");
  await storage.setProviderKey("openai", "legacy-openai-key");
  await storage.ensureLegacyAiProfiles(preferences);
  const initial = await storage.listAiProfiles();
  assert.equal(initial.length, 2);
  assert.deepEqual(await storage.getAiProfileSelection(), { textProfileId: LEGACY_PROFILE_IDS.openai, voiceProfileId: LEGACY_PROFILE_IDS.openai });
  assert.equal(initial.find(value => value.provider === "openai")?.textModel, preferences.openaiTextModel);
  assert.equal(await storage.getAiProfileKey(LEGACY_PROFILE_IDS.gemini), "legacy-gemini-key");
  await storage.ensureLegacyAiProfiles(preferences);
  assert.deepEqual(await storage.listAiProfiles(), initial);
  await storage.setAiPreferences({ ...preferences, provider: "gemini", geminiTextModel: "updated-gemini-model" });
  assert.equal((await storage.getAiProfileSelection()).textProfileId, LEGACY_PROFILE_IDS.gemini);
  assert.equal((await storage.listAiProfiles()).find(value => value.provider === "gemini")?.textModel, "updated-gemini-model");
  await storage.setProviderKey("gemini", "replacement-gemini-key");
  assert.equal(await storage.getAiProfileKey(LEGACY_PROFILE_IDS.gemini), "replacement-gemini-key");
  await storage.saveAiProfiles([], {}, { textProfileId: null, voiceProfileId: null });
  assert.deepEqual(await storage.getKeyAvailability(), { openai: false, gemini: false });
  await storage.ensureLegacyAiProfiles(preferences);
  await storage.setProviderKey("gemini", "new-legacy-key");
  assert.deepEqual(await storage.listAiProfiles(), []);
  assert.equal(await storage.getAiProfileKey(LEGACY_PROFILE_IDS.gemini), "");
});

test("empty installations can migrate a subsequently added legacy key and add a second legacy provider", async t => {
  const { storage } = await storageForTest(t);
  await storage.ensureLegacyAiProfiles(preferences);
  assert.deepEqual(await storage.listAiProfiles(), []);
  await storage.setProviderKey("gemini", "subsequent-key");
  await storage.ensureLegacyAiProfiles(preferences);
  assert.equal((await storage.listAiProfiles()).length, 1);
  await storage.setProviderKey("openai", "another-key");
  await storage.setAiPreferences({ ...preferences, provider: "openai" });
  assert.equal((await storage.listAiProfiles()).length, 2);
  assert.equal(await storage.getAiProfileKey(LEGACY_PROFILE_IDS.openai), "another-key");
  assert.equal((await storage.getAiProfileSelection()).voiceProfileId, LEGACY_PROFILE_IDS.openai);
});

test("metadata discards extra key properties and explicit profile mode resists old preference overrides", async t => {
  const { storage } = await storageForTest(t);
  const first = profile("Explicit profile");
  await storage.saveAiProfiles([{ ...first, apiKey: "should-never-be-returned" } as StoredAiProfile], { [first.id]: "actual-private-key" }, { textProfileId: first.id, voiceProfileId: first.id });
  await storage.setAiPreferences({ ...preferences, provider: "openai" });
  await storage.setProviderKey("openai", "legacy-key");
  await storage.ensureLegacyAiProfiles(preferences);
  assert.deepEqual(await storage.listAiProfiles(), [{ ...first, keyConfigured: true }]);
  assert.deepEqual(await storage.getAiProfileSelection(), { textProfileId: first.id, voiceProfileId: first.id });
  assert.ok(!JSON.stringify(await storage.listAiProfiles()).includes("should-never-be-returned"));
});

test("changing the provider clears its old credential unless an explicit replacement is supplied", async t => {
  const { storage } = await storageForTest(t);
  const first = profile("Change provider");
  await storage.saveAiProfiles([first], { [first.id]: "private-gemini-key" }, { textProfileId: first.id, voiceProfileId: first.id });
  await storage.saveAiProfiles([{ ...first, provider: "openai" }]);
  assert.equal(await storage.getAiProfileKey(first.id), "");
  assert.equal((await storage.listAiProfiles())[0].keyConfigured, false);
  assert.equal((await storage.getAiPreferences()).textProfileId, first.id);
  await storage.saveAiProfiles([first], { [first.id]: "replacement-gemini-key" });
  assert.equal(await storage.getAiProfileKey(first.id), "replacement-gemini-key");
});
