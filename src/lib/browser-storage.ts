import type { AiPreferences, AiProvider, ChatMessage, Course, Lesson, Material, Progress, Settings, SourceUnit } from "./types";

const DATABASE_NAME = "may-gia-su-browser";
const DATABASE_VERSION = 1;
const ALL_STORES = ["courses", "materials", "materialContents", "lessons", "progress", "messages", "config"];

type MaterialMetadata = Material & { courseId: string };
type MaterialContent = { id: string; units: SourceUnit[]; blob: Blob };
export type StoredMaterial = Material & { courseId: string; units: SourceUnit[]; blob: Blob };
export type StoredLesson = Lesson & { courseId: string };
type StoredProgress = Progress & { courseId: string };
type StoredMessage = ChatMessage & { courseId: string; lessonId?: string };
type ConfigRecord = { key: string; value: unknown };

export class BrowserStorageError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 500, code = "BROWSER_STORAGE_ERROR") {
    super(message);
    this.name = "BrowserStorageError";
    this.status = status;
    this.code = code;
  }
}

function storageError(error: unknown): Error {
  if (error instanceof BrowserStorageError) return error;
  if (error && typeof error === "object" && "name" in error && error.name === "QuotaExceededError") {
    return new BrowserStorageError("Trình duyệt đã hết dung lượng. Hãy xóa học liệu không cần dùng rồi thử lại.", 507, "STORAGE_FULL");
  }
  return new BrowserStorageError("Không lưu được dữ liệu trên trình duyệt. Hãy kiểm tra quyền lưu trữ hoặc mở bằng chế độ duyệt thông thường.");
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storageError(transaction.error));
    transaction.onerror = () => { /* onabort reports the complete transaction failure. */ };
  });
}

function publicMaterial(record: MaterialMetadata): Material {
  const { courseId: _courseId, ...material } = record;
  return material;
}
function publicLesson(record: StoredLesson): Lesson {
  const { courseId: _courseId, ...lesson } = record;
  return lesson;
}
function publicProgress(record: StoredProgress): Progress {
  const { courseId: _courseId, ...progress } = record;
  return progress;
}
function publicMessage(record: StoredMessage): ChatMessage {
  const { courseId: _courseId, lessonId: _lessonId, ...message } = record;
  return message;
}
function newestFirst<T extends { id: string; createdAt: string }>(records: T[]): T[] {
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

// Queue cursor deletions in the same transaction as the parent deletion. A failed
// write aborts all of them, so a course cannot lose only some of its content.
function deleteFromIndex(transaction: IDBTransaction, storeName: string, indexName: string, value: string, onDelete?: (record: any) => void) {
  const request = transaction.objectStore(storeName).index(indexName).openCursor(IDBKeyRange.only(value));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    onDelete?.(cursor.value);
    cursor.delete();
    cursor.continue();
  };
}

export class BrowserStorage {
  private database: IDBDatabase;
  private closed = false;
  constructor(database: IDBDatabase) { this.database = database; }
  get isClosed() { return this.closed; }
  close() { this.closed = true; this.database.close(); }

  private async transaction<T>(stores: string | string[], mode: IDBTransactionMode, action: (transaction: IDBTransaction) => Promise<T> | T): Promise<T> {
    const transaction = this.database.transaction(stores, mode);
    const done = transactionDone(transaction);
    try {
      const [result] = await Promise.all([Promise.resolve().then(() => action(transaction)), done]);
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* It has already aborted or completed. */ }
      throw storageError(error);
    }
  }

  private async courseInTransaction(transaction: IDBTransaction, courseId: string) {
    const course = await requestResult(transaction.objectStore("courses").get(courseId)) as Course | undefined;
    if (!course) throw new BrowserStorageError("Không tìm thấy môn học.", 404, "COURSE_NOT_FOUND");
    return course;
  }

  async listCourses(): Promise<Course[]> {
    return this.transaction("courses", "readonly", async transaction => newestFirst(await requestResult(transaction.objectStore("courses").getAll()) as Course[]));
  }
  async getCourse(id: string): Promise<Course | null> {
    return this.transaction("courses", "readonly", async transaction => (await requestResult(transaction.objectStore("courses").get(id))) || null);
  }
  async addCourse(settings: Settings | Course): Promise<Course> {
    const course: Course = { ...settings, id: "id" in settings ? settings.id : crypto.randomUUID(), createdAt: "createdAt" in settings ? settings.createdAt : new Date().toISOString() };
    await this.transaction("courses", "readwrite", transaction => requestResult(transaction.objectStore("courses").add(course)));
    return course;
  }
  async updateCourse(id: string, settings: Settings): Promise<Course> {
    return this.transaction("courses", "readwrite", async transaction => {
      const old = await this.courseInTransaction(transaction, id);
      const course: Course = { ...settings, id: old.id, createdAt: old.createdAt };
      await requestResult(transaction.objectStore("courses").put(course));
      return course;
    });
  }
  async deleteCourse(id: string): Promise<void> {
    await this.transaction(ALL_STORES, "readwrite", async transaction => {
      await this.courseInTransaction(transaction, id);
      transaction.objectStore("courses").delete(id);
      deleteFromIndex(transaction, "materials", "courseId", id, material => transaction.objectStore("materialContents").delete(material.id));
      for (const store of ["lessons", "progress", "messages"]) deleteFromIndex(transaction, store, "courseId", id);
      const active = await requestResult(transaction.objectStore("config").get("activeCourseId")) as ConfigRecord | undefined;
      if (active?.value === id) transaction.objectStore("config").delete("activeCourseId");
    });
  }

  async listMaterials(courseId: string): Promise<Material[]> {
    return this.transaction("materials", "readonly", async transaction => newestFirst((await requestResult(transaction.objectStore("materials").index("courseId").getAll(courseId)) as MaterialMetadata[]).map(publicMaterial)));
  }
  async addMaterial(courseId: string, material: Material, units: SourceUnit[], blob: Blob): Promise<Material> {
    await this.transaction(["courses", "materials", "materialContents"], "readwrite", async transaction => {
      await this.courseInTransaction(transaction, courseId);
      await Promise.all([
        requestResult(transaction.objectStore("materials").add({ ...material, courseId } satisfies MaterialMetadata)),
        requestResult(transaction.objectStore("materialContents").add({ id: material.id, units, blob } satisfies MaterialContent)),
      ]);
    });
    return material;
  }
  async getMaterial(id: string): Promise<StoredMaterial | null> {
    return this.transaction(["materials", "materialContents"], "readonly", async transaction => {
      const [metadata, content] = await Promise.all([
        requestResult(transaction.objectStore("materials").get(id)) as Promise<MaterialMetadata | undefined>,
        requestResult(transaction.objectStore("materialContents").get(id)) as Promise<MaterialContent | undefined>,
      ]);
      if (!metadata || !content) return null;
      return { ...metadata, units: content.units, blob: content.blob };
    });
  }
  async deleteMaterial(id: string): Promise<void> {
    await this.transaction(["materials", "materialContents", "lessons", "progress", "messages"], "readwrite", async transaction => {
      const material = await requestResult(transaction.objectStore("materials").get(id)) as MaterialMetadata | undefined;
      if (!material) throw new BrowserStorageError("Không tìm thấy học liệu.", 404, "MATERIAL_NOT_FOUND");
      transaction.objectStore("materials").delete(id);
      transaction.objectStore("materialContents").delete(id);
      const request = transaction.objectStore("lessons").index("courseId").openCursor(IDBKeyRange.only(material.courseId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const lesson = cursor.value as StoredLesson;
        if (lesson.materialIds.includes(id)) {
          transaction.objectStore("progress").delete(lesson.id);
          deleteFromIndex(transaction, "messages", "lessonId", lesson.id);
          cursor.delete();
        }
        cursor.continue();
      };
    });
  }

  async listLessons(courseId: string): Promise<Lesson[]> {
    return this.transaction("lessons", "readonly", async transaction => newestFirst((await requestResult(transaction.objectStore("lessons").index("courseId").getAll(courseId)) as StoredLesson[]).map(publicLesson)));
  }
  async getLesson(id: string): Promise<StoredLesson | null> {
    return this.transaction("lessons", "readonly", async transaction => (await requestResult(transaction.objectStore("lessons").get(id))) || null);
  }
  async saveLesson(courseId: string, lesson: Lesson): Promise<void> {
    await this.transaction(["courses", "lessons", "materials"], "readwrite", async transaction => {
      await this.courseInTransaction(transaction, courseId);
      const previous = await requestResult(transaction.objectStore("lessons").get(lesson.id)) as StoredLesson | undefined;
      if (previous && previous.courseId !== courseId) throw new BrowserStorageError("Bài học thuộc môn khác.", 409);
      const materials = await Promise.all(lesson.materialIds.map(id => requestResult(transaction.objectStore("materials").get(id)) as Promise<MaterialMetadata | undefined>));
      if (materials.some(material => !material || material.courseId !== courseId)) throw new BrowserStorageError("Học liệu không thuộc môn đang chọn.", 400);
      await requestResult(transaction.objectStore("lessons").put({ ...lesson, courseId } satisfies StoredLesson));
    });
  }

  async listProgress(courseId: string): Promise<Progress[]> {
    return this.transaction("progress", "readonly", async transaction => (await requestResult(transaction.objectStore("progress").index("courseId").getAll(courseId)) as StoredProgress[]).map(publicProgress));
  }
  async saveProgress(courseId: string, progress: Progress): Promise<Progress> {
    return this.transaction(["lessons", "progress"], "readwrite", async transaction => {
      const lesson = await requestResult(transaction.objectStore("lessons").get(progress.lessonId)) as StoredLesson | undefined;
      if (!lesson || lesson.courseId !== courseId) throw new BrowserStorageError("Không tìm thấy bài học trong môn này.", 404);
      const old = await requestResult(transaction.objectStore("progress").get(progress.lessonId)) as StoredProgress | undefined;
      const updated: Progress = { ...progress, completed: Boolean(old?.completed || progress.completed), score: progress.score ?? old?.score };
      await requestResult(transaction.objectStore("progress").put({ ...updated, courseId } satisfies StoredProgress));
      return updated;
    });
  }

  async listMessages(courseId: string, lessonId?: string): Promise<ChatMessage[]> {
    return this.transaction("messages", "readonly", async transaction => {
      const rows = await requestResult(transaction.objectStore("messages").index("courseId").getAll(courseId)) as StoredMessage[];
      return rows.filter(row => lessonId === undefined || row.lessonId === lessonId).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(publicMessage);
    });
  }
  async addMessage(courseId: string, message: ChatMessage, lessonId?: string): Promise<void> {
    await this.addMessages(courseId, [message], lessonId);
  }
  async addMessages(courseId: string, messages: ChatMessage[], lessonId?: string): Promise<void> {
    await this.transaction(["courses", "messages", "lessons"], "readwrite", async transaction => {
      await this.courseInTransaction(transaction, courseId);
      if (lessonId) {
        const lesson = await requestResult(transaction.objectStore("lessons").get(lessonId)) as StoredLesson | undefined;
        if (!lesson || lesson.courseId !== courseId) throw new BrowserStorageError("Bài học không thuộc môn đang chọn.", 404);
      }
      for (const message of messages) {
        const old = await requestResult(transaction.objectStore("messages").get(message.id)) as StoredMessage | undefined;
        if (old) {
          if (old.courseId !== courseId || old.lessonId !== lessonId) throw new BrowserStorageError("Hội thoại thuộc môn khác.", 409);
          continue; // Replayed voice transcript events must not create duplicates.
        }
        await requestResult(transaction.objectStore("messages").add({ ...message, courseId, lessonId } satisfies StoredMessage));
      }
    });
  }

  private async getConfig(key: string): Promise<unknown> {
    return this.transaction("config", "readonly", async transaction => (await requestResult(transaction.objectStore("config").get(key)) as ConfigRecord | undefined)?.value);
  }
  private async setConfig(key: string, value: unknown): Promise<void> {
    await this.transaction("config", "readwrite", transaction => requestResult(transaction.objectStore("config").put({ key, value } satisfies ConfigRecord)));
  }
  async getActiveCourseId(): Promise<string> { return (await this.getConfig("activeCourseId") as string) || ""; }
  async setActiveCourseId(courseId: string): Promise<void> {
    await this.transaction(["courses", "config"], "readwrite", async transaction => {
      if (courseId) await this.courseInTransaction(transaction, courseId);
      await requestResult(transaction.objectStore("config").put({ key: "activeCourseId", value: courseId } satisfies ConfigRecord));
    });
  }
  async getAiPreferences(defaults: AiPreferences = { provider: "auto", openaiTextModel: "gpt-4.1", openaiVoiceModel: "gpt-realtime", geminiTextModel: "gemini-3.8-flash", geminiVoiceModel: "gemini-3.8-live" }): Promise<AiPreferences> {
    return (await this.getConfig("aiPreferences") as AiPreferences) || { ...defaults };
  }
  async setAiPreferences(preferences: AiPreferences): Promise<void> { await this.setConfig("aiPreferences", preferences); }
  async getProviderKey(provider: AiProvider): Promise<string> { return (await this.getConfig(`providerKey:${provider}`) as string) || ""; }
  async setProviderKey(provider: AiProvider, key: string): Promise<void> {
    const trimmed = key.trim();
    await this.transaction("config", "readwrite", async transaction => {
      if (trimmed) await requestResult(transaction.objectStore("config").put({ key: `providerKey:${provider}`, value: trimmed } satisfies ConfigRecord));
      else await requestResult(transaction.objectStore("config").delete(`providerKey:${provider}`));
    });
  }
  async getKeyAvailability(): Promise<Record<AiProvider, boolean>> {
    const [openai, gemini] = await Promise.all([this.getProviderKey("openai"), this.getProviderKey("gemini")]);
    return { openai: Boolean(openai), gemini: Boolean(gemini) };
  }
}

export function openBrowserStorage(databaseName = DATABASE_NAME): Promise<BrowserStorage> {
  if (typeof indexedDB === "undefined") return Promise.reject(new BrowserStorageError("Trình duyệt không hỗ trợ lưu học liệu. Hãy dùng phiên bản Chrome, Edge, Firefox hoặc Safari mới."));
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const courses = database.createObjectStore("courses", { keyPath: "id" });
      courses.createIndex("createdAt", "createdAt");
      database.createObjectStore("materials", { keyPath: "id" }).createIndex("courseId", "courseId");
      database.createObjectStore("materialContents", { keyPath: "id" });
      database.createObjectStore("lessons", { keyPath: "id" }).createIndex("courseId", "courseId");
      database.createObjectStore("progress", { keyPath: "lessonId" }).createIndex("courseId", "courseId");
      const messages = database.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("courseId", "courseId");
      messages.createIndex("lessonId", "lessonId");
      database.createObjectStore("config", { keyPath: "key" });
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      const storage = new BrowserStorage(database);
      database.onversionchange = () => storage.close();
      settled = true;
      resolve(storage);
    };
    request.onerror = () => { settled = true; reject(storageError(request.error)); };
    request.onblocked = () => { settled = true; reject(new BrowserStorageError("Hãy đóng tab Mây cũ rồi tải lại để nâng cấp dữ liệu trình duyệt.")); };
  });
}

let singleton: Promise<BrowserStorage> | undefined;
export async function getBrowserStorage(): Promise<BrowserStorage> {
  if (!singleton || (await singleton).isClosed) singleton = openBrowserStorage().catch(error => { singleton = undefined; throw error; });
  return singleton;
}
