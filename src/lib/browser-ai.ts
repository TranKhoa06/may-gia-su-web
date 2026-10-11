import { GoogleGenAI, Modality } from "@google/genai";
import { z } from "zod";
import type { AiPreferences, AiProvider, AiSettingsState, SourceImage } from "./types";
import type { BrowserStorage } from "./browser-storage";

/** All credentials come from this browser's private profile, never the published bundle. */
export class BrowserAiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message); this.name = "BrowserAiError";
  }
}

const modelId = z.string().trim().min(1, "Nhập tên mô hình.").max(160).regex(/^[A-Za-z0-9._-]+$/, "Tên mô hình chỉ gồm chữ, số, dấu chấm, gạch dưới và gạch ngang.");
export const aiPreferencesSchema = z.object({
  provider: z.enum(["auto", "openai", "gemini"]),
  openaiTextModel: modelId, openaiVoiceModel: modelId,
  geminiTextModel: modelId, geminiVoiceModel: modelId,
}).strict();
export const credentialsSchema = z.object({
  gemini: z.string().trim().max(4000).refine(value => !/[\r\n]/.test(value), "Khóa API không được chứa xuống dòng.").optional(),
  openai: z.string().trim().max(4000).refine(value => !/[\r\n]/.test(value), "Khóa API không được chứa xuống dòng.").optional(),
}).strict();

export function defaultAiPreferences(): AiPreferences {
  return { provider: "auto", openaiTextModel: "gpt-4.1", openaiVoiceModel: "gpt-realtime", geminiTextModel: "gemini-3.8-flash", geminiVoiceModel: "gemini-3.8-live" };
}

function withSelected(models: { id: string; label: string }[], selected: string) {
  return models.some(model => model.id === selected) ? models : [...models, { id: selected, label: `${selected} (tùy chỉnh)` }];
}

export async function buildAiSettingsState(storage: BrowserStorage): Promise<AiSettingsState> {
  const preferences = aiPreferencesSchema.parse(await storage.getAiPreferences(defaultAiPreferences()));
  const keys = await storage.getKeyAvailability();
  const selectedProvider = preferences.provider === "auto" ? (keys.gemini ? "gemini" : "openai") : preferences.provider;
  return { preferences, selectedProvider, providers: [
    { id: "openai", label: "OpenAI (ChatGPT)", keyConfigured: keys.openai,
      textModels: withSelected([{ id: "gpt-4.1", label: "GPT-4.1" }, { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" }], preferences.openaiTextModel),
      voiceModels: withSelected([{ id: "gpt-realtime-1.5", label: "GPT-Realtime 1.5" }, { id: "gpt-realtime", label: "GPT-Realtime" }], preferences.openaiVoiceModel) },
    { id: "gemini", label: "Google Gemini", keyConfigured: keys.gemini,
      textModels: withSelected([{ id: "gemini-3.8-flash", label: "Gemini 3.8 Flash" }, { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)" }], preferences.geminiTextModel),
      voiceModels: withSelected([{ id: "gemini-3.8-live", label: "Gemini 3.8 Live" }], preferences.geminiVoiceModel) },
  ] };
}

export async function getAiConfig(storage: BrowserStorage) {
  const state = await buildAiSettingsState(storage);
  const provider = state.selectedProvider;
  const key = (await storage.getProviderKey(provider)).trim();
  if (!key) throw new BrowserAiError(503, "AI_NOT_CONFIGURED", "Hãy nhập khóa API trong Cài đặt để bật gia sư. Thêm link NotebookLM chưa bật AI cho web.");
  return { provider, key, textModel: provider === "gemini" ? state.preferences.geminiTextModel : state.preferences.openaiTextModel, voiceModel: provider === "gemini" ? state.preferences.geminiVoiceModel : state.preferences.openaiVoiceModel };
}
export type BrowserAiConfig = Awaited<ReturnType<typeof getAiConfig>>;
export type TextGeneration = {
  instructions: string;
  messages: { role: "user" | "assistant"; content: string; images?: SourceImage[] }[];
  schema: Record<string, unknown>; schemaName: string; maxOutputTokens: number; signal?: AbortSignal | null;
};

function providerError(provider: AiProvider, status: number): BrowserAiError {
  const name = provider === "gemini" ? "Gemini" : "OpenAI";
  if (status === 429) return new BrowserAiError(429, "AI_RATE_LIMIT", `${name} đang đạt giới hạn sử dụng hoặc hết hạn mức. Hãy kiểm tra tài khoản API hoặc thử lại sau.`);
  if (status === 401 || status === 403) return new BrowserAiError(503, "AI_CREDENTIAL_ERROR", `Khóa ${name} chưa có quyền sử dụng. Hãy kiểm tra khóa và quyền API trong Cài đặt.`);
  if (status === 404) return new BrowserAiError(503, "AI_MODEL_UNAVAILABLE", `Model ${name} đã chọn chưa khả dụng. Hãy chọn model khác trong Cài đặt.`);
  if (status === 400) return new BrowserAiError(502, "AI_REQUEST_REJECTED", `${name} chưa chấp nhận yêu cầu. Hãy kiểm tra model đã chọn và giới hạn học liệu.`);
  if (status === 408 || status === 504) return new BrowserAiError(504, "AI_TIMEOUT", "Gia sư cần thêm thời gian phản hồi. Hãy thử lại.");
  return new BrowserAiError(502, "AI_PROVIDER_ERROR", `${name} chưa xử lý được yêu cầu. Hãy thử lại sau.`);
}

function combinedSignal(signal?: AbortSignal | null, timeout = 90000) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
}

async function providerRequest(provider: AiProvider, url: string, init: RequestInit, fetchImplementation: typeof fetch): Promise<Record<string, any>> {
  let response: Response;
  try { response = await fetchImplementation(url, { ...init, redirect: "error" }); }
  catch (error) {
    if (init.signal?.aborted && init.signal.reason?.name === "AbortError") throw error;
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) throw new BrowserAiError(504, "AI_TIMEOUT", "Gia sư cần thêm thời gian phản hồi. Hãy thử lại.");
    throw new BrowserAiError(502, "AI_CONNECTION_ERROR", "Chưa kết nối được dịch vụ AI từ trình duyệt. Hãy kiểm tra Internet, quyền của khóa API và hạn chế truy cập của dịch vụ.");
  }
  if (!response.ok) throw providerError(provider, response.status);
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_provider_response");
    return value as Record<string, any>;
  }
  catch { throw new BrowserAiError(502, "AI_RESPONSE_INVALID", "Dịch vụ AI chưa trả về dữ liệu hợp lệ. Hãy thử lại."); }
}

export function createGeminiPayload(input: TextGeneration) {
  if (!input.messages.length || input.messages.some(message => !["user", "assistant"].includes(message.role) || !message.content.trim()) || !input.schema || Array.isArray(input.schema) || !Number.isInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 || input.maxOutputTokens > 65536) {
    throw new BrowserAiError(400, "AI_REQUEST_INVALID", "Yêu cầu gửi đến gia sư chưa hợp lệ.");
  }
  // https://ai.google.dev/api/generate-content#TextResponseFormat
  return {
    systemInstruction: { parts: [{ text: input.instructions }] },
    contents: input.messages.map(message => ({ role: message.role === "assistant" ? "model" : "user", parts: [
      { text: message.content },
      ...(message.images || []).flatMap(image => [{ text: image.label }, { inlineData: { mimeType: image.mimeType, data: image.dataUrl.slice(image.dataUrl.indexOf(",") + 1) } }]),
    ] })),
    generationConfig: { candidateCount: 1, maxOutputTokens: input.maxOutputTokens, responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: input.schema } } },
    store: false,
  };
}

const blockedFinish = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "ESCALATION", "PUP_LIMITED_DISABLED"]);
export function extractGeminiText(result: Record<string, any>): string {
  if (result.promptFeedback?.blockReason && result.promptFeedback.blockReason !== "BLOCK_REASON_UNSPECIFIED") throw new BrowserAiError(422, "AI_CONTENT_BLOCKED", "Gia sư chưa thể xử lý nội dung này. Hãy chọn phần học liệu khác.");
  const candidate = result.candidates?.[0];
  if (!candidate) throw new BrowserAiError(502, "AI_RESPONSE_EMPTY", "Gia sư chưa trả về nội dung. Hãy thử lại.");
  if (blockedFinish.has(candidate.finishReason)) throw new BrowserAiError(422, "AI_CONTENT_BLOCKED", "Gia sư chưa thể xử lý nội dung này. Hãy chọn phần học liệu khác.");
  if (candidate.finishReason !== "STOP") throw new BrowserAiError(502, "AI_INCOMPLETE", "Bài giảng chưa hoàn tất. Hãy thử lại với phần học liệu ngắn hơn.");
  const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
  const text = parts.filter((part: any) => part?.thought !== true && typeof part?.text === "string").map((part: any) => part.text).join("").trim();
  if (!text) throw new BrowserAiError(502, "AI_RESPONSE_EMPTY", "Gia sư chưa trả về nội dung. Hãy thử lại.");
  try { JSON.parse(text); } catch { throw new BrowserAiError(502, "AI_RESPONSE_INVALID", "Bài giảng chưa có cấu trúc đầy đủ. Hãy thử lại với chủ đề cụ thể hơn."); }
  return text;
}

export function extractOpenAiText(result: Record<string, any>): string {
  if (result.status && result.status !== "completed") throw new BrowserAiError(502, "AI_INCOMPLETE", "Bài giảng chưa hoàn tất. Hãy thử lại với phần học liệu ngắn hơn.");
  const output = (Array.isArray(result.output) ? result.output : []).flatMap((item: any) => Array.isArray(item.content) ? item.content : []);
  if (output.some((item: any) => item.type === "refusal")) throw new BrowserAiError(422, "AI_CONTENT_BLOCKED", "Gia sư chưa thể xử lý nội dung này. Hãy chọn phần học liệu khác.");
  const text = output.filter((item: any) => item.type === "output_text").map((item: any) => item.text).join("\n");
  if (!text) throw new BrowserAiError(502, "AI_RESPONSE_EMPTY", "Gia sư chưa trả về nội dung. Hãy thử lại.");
  return text;
}

export async function generateTutorText(storage: BrowserStorage, input: TextGeneration, fetchImplementation: typeof fetch = fetch): Promise<string> {
  const config = await getAiConfig(storage);
  const signal = combinedSignal(input.signal);
  if (config.provider === "gemini") {
    const result = await providerRequest("gemini", `https://generativelanguage.googleapis.com/v1beta/models/${config.textModel}:generateContent`, {
      method: "POST", headers: { "x-goog-api-key": config.key, "Content-Type": "application/json" }, body: JSON.stringify(createGeminiPayload(input)), signal,
    }, fetchImplementation);
    return extractGeminiText(result);
  }
  const result = await providerRequest("openai", "https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" }, signal,
    body: JSON.stringify({ model: config.textModel, store: false, max_output_tokens: input.maxOutputTokens, instructions: input.instructions, input: input.messages.map(message => ({ role: message.role, content: [
      { type: "input_text", text: message.content },
      ...(message.images || []).flatMap(image => [{ type: "input_text", text: image.label }, { type: "input_image", image_url: image.dataUrl, detail: "high" }]),
    ] })), text: { format: { type: "json_schema", name: input.schemaName, strict: true, schema: input.schema } } }),
  }, fetchImplementation);
  return extractOpenAiText(result);
}

/** A user supplies their own key. No site owner's shared key or token server is published. */
export async function createVoiceSession(storage: BrowserStorage, instructions: string, signal?: AbortSignal | null, fetchImplementation: typeof fetch = fetch): Promise<{ value: string; model: string; provider: AiProvider }> {
  const config = await getAiConfig(storage);
  if (config.provider === "gemini") {
    try {
      // The browser SDK supports authTokens.create; only Google receives the key.
      // https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
      const client = new GoogleGenAI({ apiKey: config.key, httpOptions: { apiVersion: "v1beta", timeout: 25000, fetch: fetchImplementation } });
      const now = Date.now();
      const token = await client.authTokens.create({ config: {
        uses: 1, expireTime: new Date(now + 30 * 60 * 1000).toISOString(), newSessionExpireTime: new Date(now + 60000).toISOString(),
        abortSignal: combinedSignal(signal, 25000), liveConnectConstraints: { model: config.voiceModel, config: {
          responseModalities: [Modality.AUDIO], maxOutputTokens: 1500, systemInstruction: instructions,
          inputAudioTranscription: {}, outputAudioTranscription: {},
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
          realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 150, silenceDurationMs: 700 } },
        } },
      } });
      if (!token.name) throw new BrowserAiError(502, "AI_RESPONSE_INVALID", "Chưa khởi tạo được token giọng nói Gemini.");
      return { value: token.name, model: config.voiceModel, provider: config.provider };
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof BrowserAiError) throw error;
      const status = (error as { status?: number })?.status;
      if (typeof status === "number") throw providerError("gemini", status);
      throw new BrowserAiError(502, "AI_VOICE_CONNECTION_ERROR", "Chưa kết nối được Gemini Live từ trình duyệt. Hãy kiểm tra model giọng nói, quyền của khóa API và kết nối mạng.");
    }
  }
  const result = await providerRequest("openai", "https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST", headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" }, signal: combinedSignal(signal, 25000),
    body: JSON.stringify({ expires_after: { anchor: "created_at", seconds: 60 }, session: {
      type: "realtime", model: config.voiceModel, output_modalities: ["audio"], max_output_tokens: 1500, instructions,
      audio: { input: { noise_reduction: { type: "near_field" }, transcription: { model: "gpt-4o-mini-transcribe", language: "vi" }, turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true } }, output: { voice: "marin" } },
    } }),
  }, fetchImplementation);
  if (typeof result.value !== "string") throw new BrowserAiError(502, "AI_RESPONSE_INVALID", "Chưa khởi tạo được phiên giọng nói.");
  return { value: result.value, model: config.voiceModel, provider: config.provider };
}
