"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import type { ChatMessage, Lesson } from "./types";
import { apiFetch } from "./client-api";
import { base64ToBytes, bytesToBase64, PCM_WORKLET_SOURCE, pcm16ToFloat32 } from "./gemini-audio";
import { geminiVisualParts, loadVoiceContext, normalizeVoiceVisuals, type VoiceContext } from "./voice-context";

export type GeminiVoiceTutorOptions = {
  lesson: Lesson | null;
  segmentIndex: number;
  onMessage: (message: ChatMessage) => void;
  onSegmentChange?: (index: number) => void;
  onError: (message: string) => void;
};

type Transcript = { id: string; text: string; createdAt: string };
type GeminiSession = {
  lessonId: string;
  live: Session | null;
  microphone: MediaStream | null;
  captureContext: AudioContext;
  playbackContext: AudioContext;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  workletUrl: string | null;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  outputs: Set<AudioBufferSourceNode>;
  nextPlaybackTime: number;
  muted: boolean;
  input: Transcript | null;
  output: Transcript | null;
  inputStartedAt: string | null;
  outputStartedAt: string | null;
  transcriptIds: Set<string>;
  playbackWarning: boolean;
  context: VoiceContext;
  contextSegment: number;
  requestVersion: number;
};

function teachingRequest(lesson: Lesson, index: number) {
  const segment = lesson.segments[index];
  return [
    "Hãy tiếp tục làm gia sư theo hướng dẫn của phiên học. Giảng bằng tiếng Việt.",
    `Bài học: ${lesson.title}. Phần ${index + 1}/${lesson.segments.length}: ${segment?.title || lesson.title}.`,
    `Nội dung phần này: ${segment?.explanation || ""}`,
    segment?.illustration?.description ? `Sơ đồ minh họa đang hiển thị cho học viên: ${segment.illustration.description}. Giải thích các thành phần và mối liên hệ trong sơ đồ.` : "",
    "Giải thích trong 45–90 giây, đưa ví dụ rồi hỏi một câu kiểm tra mức độ hiểu. Chờ học viên trả lời; không tự chuyển phần. Khi học viên ngắt lời, dừng và giải thích điều họ chưa hiểu.",
  ].join("\n").slice(0, 9000);
}

/** Direct Gemini Live uses a short-lived token made with the user's own browser key. */
export function useGeminiVoiceTutor(options: GeminiVoiceTutorOptions) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const latest = useRef(options);
  const active = useRef<GeminiSession | null>(null);
  const mounted = useRef(true);
  latest.current = options;

  const persist = useCallback((session: GeminiSession, role: "user" | "assistant", transcript: Transcript | null) => {
    const content = transcript?.text.trim().slice(0, 20000);
    if (!transcript || !content || session.transcriptIds.has(transcript.id)) return;
    session.transcriptIds.add(transcript.id);
    if (mounted.current && latest.current.lesson?.id === session.lessonId) {
      latest.current.onMessage({ id: transcript.id, role, content, createdAt: transcript.createdAt });
    }
    void apiFetch("/api/voice/transcript", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId: session.lessonId, role, content, eventId: transcript.id, createdAt: transcript.createdAt }),
      keepalive: true,
    }).then(response => {
      if (!response.ok) throw new Error("transcript_save_failed");
    }).catch(() => {
      if (mounted.current && active.current === session) latest.current.onError("Chưa lưu được bản ghi lời nói trên trình duyệt. Hãy kiểm tra bộ nhớ trình duyệt.");
    });
  }, []);

  const flush = useCallback((session: GeminiSession, role: "user" | "assistant") => {
    const transcript = role === "user" ? session.input : session.output;
    if (role === "user") { session.input = null; session.inputStartedAt = null; }
    else { session.output = null; session.outputStartedAt = null; }
    persist(session, role, transcript);
  }, [persist]);

  const clearPlayback = useCallback((session: GeminiSession) => {
    for (const output of session.outputs) {
      output.onended = null;
      try { output.stop(); } catch { /* The buffer may already have ended. */ }
      output.disconnect();
    }
    session.outputs.clear();
    session.nextPlaybackTime = session.playbackContext.currentTime;
    if (mounted.current && active.current === session) setSpeaking(false);
  }, []);

  const stop = useCallback(() => {
    const session = active.current;
    active.current = null;
    if (session) {
      // Flush while this lesson is still visible. The caller clears its UI afterwards.
      flush(session, "user"); flush(session, "assistant");
      session.abort.abort();
      if (session.timer) clearTimeout(session.timer);
      session.live?.close();
      session.microphone?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      if (session.worklet) { session.worklet.port.onmessage = null; session.worklet.port.close(); session.worklet.disconnect(); }
      session.source?.disconnect();
      clearPlayback(session);
      void session.captureContext.close().catch(() => {});
      void session.playbackContext.close().catch(() => {});
      if (session.workletUrl) URL.revokeObjectURL(session.workletUrl);
    }
    if (mounted.current) { setConnected(false); setConnecting(false); setSpeaking(false); setMuted(false); }
  }, [clearPlayback, flush]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; stop(); };
  }, [stop]);
  useEffect(() => {
    if (active.current && active.current.lessonId !== options.lesson?.id) stop();
  }, [options.lesson?.id, stop]);

  const resumeAudio = useCallback(async (session: GeminiSession) => {
    try {
      await Promise.all([session.captureContext.resume(), session.playbackContext.resume()]);
      session.playbackWarning = false;
    } catch {
      if (active.current === session && !session.playbackWarning) {
        session.playbackWarning = true;
        latest.current.onError("Trình duyệt đang chặn âm thanh. Bấm “Giảng phần này” để bật tiếng của gia sư.");
      }
    }
  }, []);

  const queueAudio = useCallback((session: GeminiSession, data: string) => {
    const floats = pcm16ToFloat32(base64ToBytes(data));
    if (!floats.length) return;
    const context = session.playbackContext;
    const buffer = context.createBuffer(1, floats.length, 24000);
    buffer.copyToChannel(floats, 0);
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination);
    const begin = Math.max(context.currentTime + 0.015, session.nextPlaybackTime);
    session.nextPlaybackTime = begin + buffer.duration;
    session.outputs.add(source);
    source.onended = () => {
      session.outputs.delete(source); source.disconnect();
      if (mounted.current && active.current === session && !session.outputs.size) setSpeaking(false);
    };
    source.start(begin);
    if (mounted.current && active.current === session) setSpeaking(true);
  }, []);

  const refreshContext = useCallback(async (session: GeminiSession, segmentIndex: number, requestVersion: number) => {
    if (session.contextSegment === segmentIndex) return true;
    const context = await loadVoiceContext(session.lessonId, segmentIndex, session.abort.signal);
    if (active.current !== session || !session.live || session.requestVersion !== requestVersion || latest.current.segmentIndex !== segmentIndex) return false;
    session.live.sendClientContent({ turns: [{ role: "user", parts: [
      { text: `Cập nhật phần đang học và nguồn để giảng tiếp:\n${context.instructions}` },
      ...geminiVisualParts(context.visualContext),
    ] }], turnComplete: false });
    session.context = context;
    session.contextSegment = segmentIndex;
    return true;
  }, []);

  const start = useCallback(async () => {
    if (active.current) { await resumeAudio(active.current); return; }
    const { lesson, segmentIndex } = latest.current;
    if (!lesson?.segments.length) { latest.current.onError("Hãy chọn bài học trước khi bắt đầu trò chuyện bằng giọng nói."); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined" || typeof AudioWorkletNode === "undefined") {
      latest.current.onError("Trình duyệt chưa hỗ trợ giọng nói trực tiếp. Hãy mở web bằng Chrome hoặc Edge trên máy này."); return;
    }
    let captureContext: AudioContext;
    let playbackContext: AudioContext;
    try {
      captureContext = new AudioContext({ sampleRate: 16000 });
      try { playbackContext = new AudioContext({ sampleRate: 24000 }); }
      catch (error) { void captureContext.close(); throw error; }
    } catch { latest.current.onError("Không khởi tạo được âm thanh. Hãy kiểm tra thiết bị và thử lại."); return; }
    const session: GeminiSession = {
      lessonId: lesson.id, live: null, microphone: null, captureContext, playbackContext,
      source: null, worklet: null, workletUrl: null, abort: new AbortController(), timer: null,
      outputs: new Set(), nextPlaybackTime: 0, muted: false, input: null, output: null,
      inputStartedAt: null, outputStartedAt: null, transcriptIds: new Set(), playbackWarning: false,
      context: { visualContext: [], instructions: "" }, contextSegment: segmentIndex, requestVersion: 0,
    };
    active.current = session; setConnecting(true); setMuted(false);
    const fail = (message: string) => {
      if (active.current !== session) return;
      stop(); if (mounted.current) latest.current.onError(message);
    };
    const appendTranscript = (role: "user" | "assistant", text: string | undefined, finished?: boolean) => {
      const field = role === "user" ? "input" : "output";
      if (text) {
        session[field] ||= { id: `gemini-${role}-${crypto.randomUUID()}`, text: "", createdAt: (role === "user" ? session.inputStartedAt : session.outputStartedAt) || new Date().toISOString() };
        session[field]!.text = (session[field]!.text + text).slice(0, 20000);
      }
      if (finished) flush(session, role);
    };
    const receive = (message: LiveServerMessage) => {
      if (active.current !== session) return;
      if (message.voiceActivity?.voiceActivityType === "ACTIVITY_START") session.inputStartedAt ||= new Date().toISOString();
      if (message.goAway) latest.current.onError("Phiên giọng nói sắp hết thời gian. Kết nối lại khi phiên dừng để tiếp tục bài học.");
      const content = message.serverContent;
      if (!content) return;
      appendTranscript("user", content.inputTranscription?.text, content.inputTranscription?.finished);
      appendTranscript("assistant", content.outputTranscription?.text, content.outputTranscription?.finished);
      if (content.interrupted) { clearPlayback(session); flush(session, "assistant"); }
      for (const part of content.interrupted ? [] : content.modelTurn?.parts || []) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/pcm")) {
          session.outputStartedAt ||= new Date().toISOString();
          try { queueAudio(session, part.inlineData.data); }
          catch { fail("Chưa phát được âm thanh của gia sư. Hãy kết nối lại phiên giọng nói."); return; }
        }
      }
      if (content.turnComplete) { flush(session, "user"); flush(session, "assistant"); }
    };
    try {
      await resumeAudio(session);
      if (active.current !== session) return;
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (active.current !== session) { microphone.getTracks().forEach(track => track.stop()); return; }
      session.microphone = microphone;
      microphone.getAudioTracks().forEach(track => { track.onended = () => fail("Micro đã bị ngắt. Kiểm tra micro rồi bắt đầu lại."); });
      session.timer = setTimeout(() => fail("Kết nối Gemini Live quá lâu. Hãy kiểm tra mạng và thử lại."), 35000);
      session.workletUrl = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "text/javascript" }));
      await captureContext.audioWorklet.addModule(session.workletUrl);
      if (active.current !== session) return;
      const response = await apiFetch("/api/voice/session", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id, segmentIndex }), signal: session.abort.signal,
      });
      const token = await response.json() as { value?: string; model?: string; provider?: string; error?: string; instructions?: string; visualContext?: unknown };
      if (active.current !== session) return;
      if (!response.ok) throw new Error(token.error || "Chưa khởi tạo được phiên giọng nói Gemini.");
      if (!token.value || !token.model || token.provider !== "gemini") throw new Error("Cấu hình giọng nói đã thay đổi. Hãy tải lại trang.");
      session.context = { visualContext: normalizeVoiceVisuals(token.visualContext), instructions: token.instructions || "" };
      const client = new GoogleGenAI({ apiKey: token.value, httpOptions: { apiVersion: "v1beta" } });
      const live = await client.live.connect({
        model: token.model, config: { responseModalities: [Modality.AUDIO], abortSignal: session.abort.signal },
        callbacks: {
          onmessage: receive,
          onerror: () => fail("Kết nối Gemini Live gặp lỗi. Hãy kiểm tra khóa có quyền dùng model giọng nói và thử lại."),
          onclose: () => fail("Phiên giọng nói đã kết thúc. Bắt đầu lại để tiếp tục học."),
        },
      });
      if (active.current !== session) { live.close(); return; }
      session.live = live;
      session.source = captureContext.createMediaStreamSource(microphone);
      session.worklet = new AudioWorkletNode(captureContext, "may-pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      session.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (active.current !== session || session.muted || !session.live || !(event.data instanceof ArrayBuffer)) return;
        try { session.live.sendRealtimeInput({ audio: { data: bytesToBase64(new Uint8Array(event.data)), mimeType: "audio/pcm;rate=16000" } }); }
        catch { fail("Không gửi được âm thanh. Hãy kết nối lại phiên giọng nói."); }
      };
      session.source.connect(session.worklet); session.worklet.connect(captureContext.destination);
      if (session.timer) clearTimeout(session.timer); session.timer = null;
      setConnected(true); setConnecting(false);
      const currentIndex = latest.current.segmentIndex;
      const requestVersion = ++session.requestVersion;
      if (!await refreshContext(session, currentIndex, requestVersion)) return;
      if (active.current !== session) return;
      live.sendClientContent({ turns: [{ role: "user", parts: [
        ...(currentIndex === segmentIndex ? geminiVisualParts(session.context.visualContext) : []),
        { text: teachingRequest(lesson, currentIndex) },
      ] }], turnComplete: true });
    } catch (error) {
      if (active.current !== session) return;
      const name = error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : "";
      fail(name === "NotAllowedError" ? "Bạn cần cho phép truy cập micro để trò chuyện với gia sư."
        : name === "NotFoundError" ? "Chưa tìm thấy micro. Hãy kết nối micro rồi thử lại."
          : /^(Chưa |Cấu hình |Dịch vụ |Hãy |Khóa |Model |OpenAI |Gemini )/.test(message) ? message
            : "Chưa kết nối được Gemini Live. Hãy kiểm tra khóa API, quyền model và kết nối mạng.");
    }
  }, [clearPlayback, flush, queueAudio, refreshContext, resumeAudio, stop]);

  const toggleMute = useCallback(() => {
    const session = active.current; if (!session?.microphone || !session.live) return;
    session.muted = !session.muted;
    session.microphone.getAudioTracks().forEach(track => { track.enabled = !session.muted; });
    session.worklet?.port.postMessage({ reset: true });
    if (session.muted) {
      try { session.live.sendRealtimeInput({ audioStreamEnd: true }); }
      catch { latest.current.onError("Chưa cập nhật được trạng thái micro. Hãy kết nối lại."); }
    }
    setMuted(session.muted);
  }, []);

  const ask = useCallback(async (text: string) => {
    const content = text.trim().slice(0, 4000); if (!content) return;
    const session = active.current;
    if (!session?.live) { latest.current.onError("Hãy bắt đầu phiên giọng nói trước khi gửi câu hỏi."); return; }
    await resumeAudio(session); if (active.current !== session) return;
    clearPlayback(session); flush(session, "assistant");
    const requestVersion = ++session.requestVersion;
    try {
      if (!await refreshContext(session, latest.current.segmentIndex, requestVersion)) return;
      if (active.current !== session || session.requestVersion !== requestVersion) return;
      session.live.sendClientContent({ turns: [{ role: "user", parts: [{ text: content }] }], turnComplete: true });
      persist(session, "user", { id: `gemini-user-${crypto.randomUUID()}`, text: content, createdAt: new Date().toISOString() });
    } catch { latest.current.onError("Chưa gửi được câu hỏi. Hãy kết nối lại phiên giọng nói."); }
  }, [clearPlayback, flush, persist, refreshContext, resumeAudio]);

  const teach = useCallback(async () => {
    const session = active.current; const { lesson, segmentIndex } = latest.current;
    if (!session?.live || !lesson) { latest.current.onError("Hãy chọn bài học và bắt đầu phiên giọng nói trước khi giảng tiếp."); return; }
    await resumeAudio(session); if (active.current !== session) return;
    clearPlayback(session); flush(session, "assistant");
    const requestVersion = ++session.requestVersion;
    try {
      if (!await refreshContext(session, segmentIndex, requestVersion)) return;
      if (active.current !== session || session.requestVersion !== requestVersion) return;
      session.live.sendClientContent({ turns: [{ role: "user", parts: [{ text: teachingRequest(lesson, segmentIndex) }] }], turnComplete: true });
    }
    catch { latest.current.onError("Chưa yêu cầu giảng tiếp được. Hãy kết nối lại phiên giọng nói."); }
  }, [clearPlayback, flush, refreshContext, resumeAudio]);

  return { connected, connecting, speaking, muted, start, stop, toggleMute, ask, teach };
}
