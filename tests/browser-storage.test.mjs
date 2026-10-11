import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { openBrowserStorage } from "../src/lib/browser-storage.ts";

const settings = (subject = "Vật lý bán dẫn") => ({ subject, level: "Đại học", goal: "Nắm kiến thức cơ bản", notebookUrl: "" });
const timestamp = "2026-10-11T12:00:00.000Z";
const material = (id) => ({ id, name: `${id}.pdf`, type: "pdf", unitCount: 1, characters: 42, createdAt: timestamp });
const units = [{ index: 1, label: "Trang 1", text: "Dòng điện phụ thuộc vào mật độ hạt tải." }];
const lesson = (id, materialIds) => ({ id, title: "Dòng điện", summary: "Ôn kiến thức", durationMinutes: 10, materialIds, segments: [{ title: "Hạt tải", explanation: "Electron và lỗ trống.", sourceRefs: [] }], quiz: [], createdAt: timestamp });
const message = (id, content = "Giải thích giúp tôi.") => ({ id, role: "user", content, createdAt: timestamp });
const progress = (lessonId, completed = false, score) => ({ lessonId, segmentIndex: 0, completed, score, updatedAt: timestamp });

async function storageForTest(t) {
  const name = `may-storage-test-${crypto.randomUUID()}`;
  const storage = await openBrowserStorage(name);
  t.after(() => storage.close());
  return { name, storage };
}
function idbResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

test("courses, source Blob, AI settings and keys survive closing and reopening", async t => {
  const { storage, name } = await storageForTest(t);
  const course = await storage.addCourse(settings());
  await storage.addMaterial(course.id, material("pdf-1"), units, new Blob(["%PDF-original"], { type: "application/pdf" }));
  await storage.setActiveCourseId(course.id);
  const preferences = { provider: "gemini", openaiTextModel: "test-openai", openaiVoiceModel: "test-openai-voice", geminiTextModel: "test-gemini", geminiVoiceModel: "test-gemini-voice" };
  await storage.setAiPreferences(preferences);
  await storage.setProviderKey("gemini", "  test-private-key  ");
  storage.close();
  const reopened = await openBrowserStorage(name);
  t.after(() => reopened.close());
  assert.equal((await reopened.getCourse(course.id)).subject, settings().subject);
  const document = await reopened.getMaterial("pdf-1");
  assert.deepEqual(document.units, units);
  assert.equal(await document.blob.text(), "%PDF-original");
  assert.equal(await reopened.getActiveCourseId(), course.id);
  assert.deepEqual(await reopened.getAiPreferences(), preferences);
  assert.deepEqual(await reopened.getKeyAvailability(), { openai: false, gemini: true });
  assert.equal(await reopened.getProviderKey("gemini"), "test-private-key");
  assert.ok(!JSON.stringify(await reopened.listCourses()).includes("test-private-key"));
  await reopened.setProviderKey("gemini", "");
  assert.equal(await reopened.getProviderKey("gemini"), "");
});

test("course isolation prevents lessons and progress referring to another course", async t => {
  const { storage } = await storageForTest(t);
  const first = await storage.addCourse(settings("Vi điện tử"));
  const second = await storage.addCourse(settings("Mạch số"));
  await storage.addMaterial(first.id, material("pdf-1"), units, new Blob(["original"]));
  await storage.saveLesson(first.id, lesson("lesson-1", ["pdf-1"]));
  await assert.rejects(storage.saveLesson(second.id, lesson("wrong-course", ["pdf-1"])), { status: 400 });
  await assert.rejects(storage.saveProgress(second.id, progress("lesson-1")), { status: 404 });
  await assert.rejects(storage.addMessage(second.id, message("message-1"), "lesson-1"), { status: 404 });
  assert.equal((await storage.listMaterials(first.id)).length, 1);
  assert.deepEqual(await storage.listMaterials(second.id), []);
  assert.deepEqual(await storage.listLessons(second.id), []);
});

test("deleting a material atomically removes its dependent lesson, progress and chat", async t => {
  const { storage } = await storageForTest(t);
  const course = await storage.addCourse(settings());
  for (const id of ["pdf-1", "pdf-2"]) await storage.addMaterial(course.id, material(id), units, new Blob([id]));
  await storage.saveLesson(course.id, lesson("dependent", ["pdf-1", "pdf-2"]));
  await storage.saveLesson(course.id, lesson("retained", ["pdf-2"]));
  await storage.saveProgress(course.id, progress("dependent", true, 100));
  await storage.addMessage(course.id, message("dependent-chat"), "dependent");
  await storage.addMessage(course.id, message("retained-chat"), "retained");
  await storage.deleteMaterial("pdf-1");
  assert.equal(await storage.getMaterial("pdf-1"), null);
  assert.equal(await storage.getLesson("dependent"), null);
  assert.deepEqual(await storage.listProgress(course.id), []);
  assert.deepEqual((await storage.listMessages(course.id)).map(row => row.id), ["retained-chat"]);
  assert.deepEqual((await storage.listMaterials(course.id)).map(row => row.id), ["pdf-2"]);
  assert.deepEqual((await storage.listLessons(course.id)).map(row => row.id), ["retained"]);
});

test("deleting a course removes all of its data and preserves a different course", async t => {
  const { storage } = await storageForTest(t);
  const first = await storage.addCourse(settings("Vi điện tử"));
  const second = await storage.addCourse(settings("Mạch số"));
  await storage.addMaterial(first.id, material("removed"), units, new Blob(["file"]));
  await storage.addMaterial(second.id, material("retained"), units, new Blob(["other"]));
  await storage.saveLesson(first.id, lesson("lesson-1", ["removed"]));
  await storage.saveProgress(first.id, progress("lesson-1", true));
  await storage.addMessage(first.id, message("message-1"), "lesson-1");
  await storage.addMessage(first.id, message("general-chat"));
  await storage.setActiveCourseId(first.id);
  await storage.deleteCourse(first.id);
  assert.equal(await storage.getCourse(first.id), null);
  assert.equal(await storage.getMaterial("removed"), null);
  assert.equal(await storage.getLesson("lesson-1"), null);
  assert.deepEqual(await storage.listMessages(first.id), []);
  assert.deepEqual(await storage.listProgress(first.id), []);
  assert.equal(await storage.getActiveCourseId(), "");
  assert.equal((await storage.getCourse(second.id)).subject, "Mạch số");
  assert.equal(await (await storage.getMaterial("retained")).blob.text(), "other");
});

test("a failed content write rolls back the successful metadata write", async t => {
  const { storage, name } = await storageForTest(t);
  const course = await storage.addCourse(settings());
  const raw = await idbResult(indexedDB.open(name));
  t.after(() => raw.close());
  const transaction = raw.transaction("materialContents", "readwrite");
  const committed = new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); });
  transaction.objectStore("materialContents").add({ id: "conflict", units, blob: new Blob(["orphan"] ) });
  await committed;
  await assert.rejects(storage.addMaterial(course.id, material("conflict"), units, new Blob(["new"])));
  assert.deepEqual(await storage.listMaterials(course.id), []);
  assert.equal(await storage.getMaterial("conflict"), null);
});

test("completed progress persists and replayed transcript ids do not duplicate or overwrite", async t => {
  const { storage } = await storageForTest(t);
  const course = await storage.addCourse(settings());
  await storage.addMaterial(course.id, material("pdf-1"), units, new Blob(["original"]));
  await storage.saveLesson(course.id, lesson("lesson-1", ["pdf-1"]));
  await storage.saveProgress(course.id, progress("lesson-1", true, 80));
  const updated = await storage.saveProgress(course.id, progress("lesson-1", false));
  assert.equal(updated.completed, true);
  assert.equal(updated.score, 80);
  await Promise.all([
    storage.addMessage(course.id, message("event-1", "first content"), "lesson-1"),
    storage.addMessage(course.id, message("event-1", "replayed content"), "lesson-1"),
  ]);
  const history = await storage.listMessages(course.id, "lesson-1");
  assert.equal(history.length, 1);
  assert.equal(history[0].content, "first content");
  assert.ok(!("courseId" in history[0]));
  assert.ok(!("lessonId" in history[0]));
});

test("an invalid message in a pair aborts the complete conversation write", async t => {
  const { storage } = await storageForTest(t);
  const first = await storage.addCourse(settings("Vi điện tử"));
  const second = await storage.addCourse(settings("Mạch số"));
  await storage.addMessage(second.id, message("other-course-id"));
  await assert.rejects(storage.addMessages(first.id, [message("new-message"), message("other-course-id")]), { status: 409 });
  assert.deepEqual(await storage.listMessages(first.id), []);
  assert.equal((await storage.listMessages(second.id)).length, 1);
});
