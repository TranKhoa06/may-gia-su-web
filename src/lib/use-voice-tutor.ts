"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, Lesson, LiveTranscript, StudyFocus } from "./types";
import { apiFetch } from "./client-api";
import { useGeminiVoiceTutor } from "./use-gemini-voice-tutor";
import { fitOpenAiVoiceVisual, loadVoiceContext, normalizeVoiceVisuals, openAiVisualEvent, VIETNAMESE_VOICE_GUIDANCE, voiceFocusInstructions, type VoiceContext } from "./voice-context";
import { parseStudyFocus } from "./study-focus";

type VoiceTutorOptions = {
  provider?: "gemini" | "openai";
  lesson: Lesson | null;
  segmentIndex: number;
  onMessage: (message: ChatMessage) => void;
  onSegmentChange?: (index: number) => void;
  onFocus?: (focus: StudyFocus | null) => void;
  onLiveTranscript?: (transcript: LiveTranscript | null) => void;
  onError: (message: string) => void;
};

type VoiceSession = {
  lessonId: string;
  peer: RTCPeerConnection;
  channel: RTCDataChannel;
  audio: HTMLAudioElement;
  microphone: MediaStream | null;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout> | null;
  responseActive: boolean;
  cancelling: boolean;
  playing: boolean;
  pendingResponse: string | null;
  transcriptIds: Set<string>;
  itemTimes: Map<string, string>;
  playbackWarning: boolean;
  context: VoiceContext;
  contextSegment: number;
  requestVersion: number;
  partialTranscripts: Map<string, string>;
  responseContexts: Map<string, ResponseContext>;
  pendingTools: Map<string, FocusToolCall>;
  toolIds: Set<string>;
  finishedResponses: Set<string>;
};

type ResponseContext = { segmentIndex: number; requestVersion: number };
type FocusToolCall = { call_id: string; name: string; arguments: string; responseId: string; context: ResponseContext };
type RealtimeOutputItem = { id?: string; type?: string; call_id?: string; name?: string; arguments?: string; status?: string };
type RealtimeEvent = {
  type?: string;
  item_id?: string;
  item?: RealtimeOutputItem;
  content_index?: number;
  transcript?: string;
  text?: string;
  delta?: string;
  response_id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  error?: { code?: string };
  response?: { id?: string; status?: string; output?: RealtimeOutputItem[] };
};

function teachingInstructions(lesson: Lesson, index: number): string {
  const segment = lesson.segments[index];
  return [
    "Tiếp tục làm gia sư theo hướng dẫn của phiên học. Giảng bằng tiếng Việt, rõ ràng và từng đoạn ngắn.",
    voiceFocusInstructions(lesson, index),
    `Bài học: ${lesson.title}. Phần đang học: ${index + 1}/${lesson.segments.length}: ${segment?.title ?? lesson.title}.`,
    segment?.explanation ? `Nội dung phần này: ${segment.explanation}` : "",
    segment?.illustration?.description ? `Sơ đồ minh họa đang hiển thị cho học viên: ${segment.illustration.description}. Hãy giải thích các thành phần và mối liên hệ trong sơ đồ.` : "",
    "Giải thích phần đang học, đưa một ví dụ dễ hiểu, sau đó hỏi một câu kiểm tra mức độ hiểu và chờ học viên trả lời. Không tự chuyển sang phần tiếp theo.",
    "Ưu tiên học liệu của phiên học. Nếu học viên hỏi chen, dừng giảng để trả lời rồi hỏi họ có muốn tiếp tục không.",
  ].filter(Boolean).join("\n");
}

function sendEvent(session: VoiceSession, event: Record<string, unknown>): boolean {
  if (session.channel.readyState !== "open") return false;
  try {
    const payload = JSON.stringify(event);
    const limit = session.peer.sctp?.maxMessageSize;
    if (limit && new TextEncoder().encode(payload).byteLength > limit) return false;
    session.channel.send(payload);
    return true;
  } catch {
    return false;
  }
}

function createResponse(session: VoiceSession, instructions = ""): void {
  if (session.responseActive) {
    session.pendingResponse = instructions;
    if (!session.cancelling) {
      session.cancelling = sendEvent(session, { type: "response.cancel" });
    }
    sendEvent(session, { type: "output_audio_buffer.clear" });
    return;
  }
  if (session.playing) sendEvent(session, { type: "output_audio_buffer.clear" });
  if (instructions && !sendEvent(session, {
    type: "conversation.item.create",
    item: { type: "message", role: "user", content: [{ type: "input_text", text: instructions }] },
  })) return;
  session.responseActive = sendEvent(session, {
    type: "response.create",
    // Per-response instructions override the server's entire system prompt.
    // Keep its subject, sources and safety guidance by adding the request above.
    response: { output_modalities: ["audio"] },
  });
}

/** WebRTC uses a short-lived token; the personal key stays in this browser's private settings. */
function useOpenAIVoiceTutor(options: VoiceTutorOptions) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const latest = useRef(options);
  const mounted = useRef(true);
  const active = useRef<VoiceSession | null>(null);

  latest.current = options;

  const clearGuidance = useCallback((session?: VoiceSession | null) => {
    session?.partialTranscripts.clear();
    if (mounted.current) {
      latest.current.onLiveTranscript?.(null);
      latest.current.onFocus?.(null);
    }
  }, []);

  const stop = useCallback(() => {
    const session = active.current;
    active.current = null;
    if (session) clearGuidance(session);
    if (session) {
      session.abort.abort();
      if (session.timer) clearTimeout(session.timer);
      session.channel.onopen = null;
      session.channel.onmessage = null;
      session.channel.onclose = null;
      session.channel.onerror = null;
      session.peer.ontrack = null;
      session.peer.onconnectionstatechange = null;
      session.peer.oniceconnectionstatechange = null;
      session.microphone?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      session.peer.getReceivers().forEach((receiver) => receiver.track?.stop());
      session.channel.close();
      session.peer.close();
      session.audio.pause();
      session.audio.srcObject = null;
      session.audio.remove();
    }
    if (mounted.current) {
      setConnected(false);
      setConnecting(false);
      setSpeaking(false);
      setMuted(false);
    }
  }, [clearGuidance]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (active.current && active.current.lessonId !== options.lesson?.id) stop();
  }, [options.lesson?.id, stop]);

  useEffect(() => {
    const session = active.current;
    if (!session || session.contextSegment === options.segmentIndex) return;
    ++session.requestVersion;
    session.pendingResponse = null;
    clearGuidance(session);
    if (session.responseActive && !session.cancelling) session.cancelling = sendEvent(session, { type: "response.cancel" });
    sendEvent(session, { type: "output_audio_buffer.clear" });
    session.playing = false;
    setSpeaking(false);
  }, [options.segmentIndex, clearGuidance]);

  const playAudio = useCallback((session: VoiceSession) => {
    if (!session.audio.srcObject) return;
    void session.audio.play().then(() => {
      session.playbackWarning = false;
    }).catch(() => {
      if (active.current !== session || session.playbackWarning) return;
      session.playbackWarning = true;
      latest.current.onError("Trình duyệt đang chặn âm thanh. Bấm “Giảng tiếp” để bật tiếng của gia sư.");
    });
  }, []);

  const sendContext = useCallback(async (session: VoiceSession, context: VoiceContext, includeInstructions = false, requestVersion = session.requestVersion) => {
    let complete = true;
    for (const visual of context.visualContext) {
      const fitted = await fitOpenAiVoiceVisual(visual, session.peer.sctp?.maxMessageSize || 262144);
      if (active.current !== session || session.requestVersion !== requestVersion) return;
      if (!fitted || !sendEvent(session, openAiVisualEvent(fitted))) {
        complete = false;
        sendEvent(session, { type: "conversation.item.create", item: { type: "message", role: "user", content: [{
          type: "input_text", text: `Không truyền được hình ${visual.label} trong phiên giọng nói. Không đoán chi tiết của hình này; nói rõ cần xem hình ở phần Hỏi gia sư.`,
        }] } });
      }
    }
    if (active.current !== session || session.requestVersion !== requestVersion) return;
    if (includeInstructions && context.instructions) {
      complete = sendEvent(session, { type: "conversation.item.create", item: {
        type: "message", role: "user", content: [{ type: "input_text", text: `Cập nhật phần đang học và nguồn để giảng tiếp:\n${context.instructions}` }],
      } }) && complete;
    }
    if (!complete) latest.current.onError("Một hình trong học liệu vượt giới hạn kênh giọng nói. Gia sư có thể giảng nội dung chữ; hãy dùng phần Hỏi gia sư để giải thích hình đó.");
  }, []);

  const refreshContext = useCallback(async (session: VoiceSession, segmentIndex: number, requestVersion: number) => {
    if (session.contextSegment === segmentIndex) return true;
    const context = await loadVoiceContext(session.lessonId, segmentIndex, session.abort.signal);
    if (active.current !== session || session.requestVersion !== requestVersion || latest.current.segmentIndex !== segmentIndex) return false;
    await sendContext(session, context, true);
    if (active.current !== session || session.requestVersion !== requestVersion || latest.current.segmentIndex !== segmentIndex) return false;
    session.context = context;
    session.contextSegment = segmentIndex;
    return true;
  }, [sendContext]);

  const start = useCallback(async () => {
    if (active.current) {
      playAudio(active.current);
      return;
    }
    const { lesson, segmentIndex } = latest.current;
    if (!lesson || !lesson.segments.length) {
      latest.current.onError("Hãy chọn một bài học trước khi bắt đầu học bằng giọng nói.");
      return;
    }
    if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      latest.current.onError("Trình duyệt này chưa hỗ trợ micro trực tuyến. Hãy mở web bằng Chrome, Edge hoặc Safari qua HTTPS.");
      return;
    }

    let peer: RTCPeerConnection;
    try {
      peer = new RTCPeerConnection();
    } catch {
      latest.current.onError("Trình duyệt chưa tạo được kết nối giọng nói. Hãy tải lại trang và thử lại.");
      return;
    }
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "");
    let channel: RTCDataChannel;
    try {
      channel = peer.createDataChannel("oai-events");
    } catch {
      peer.close();
      latest.current.onError("Trình duyệt chưa tạo được kênh giọng nói. Hãy tải lại trang và thử lại.");
      return;
    }
    const session: VoiceSession = {
      lessonId: lesson.id,
      peer,
      channel,
      audio,
      microphone: null,
      abort: new AbortController(),
      timer: null,
      responseActive: false,
      cancelling: false,
      playing: false,
      pendingResponse: null,
      transcriptIds: new Set(),
      itemTimes: new Map(),
      playbackWarning: false,
      context: { visualContext: [], instructions: "" },
      contextSegment: segmentIndex,
      requestVersion: 0,
      partialTranscripts: new Map(), responseContexts: new Map(), pendingTools: new Map(), toolIds: new Set(), finishedResponses: new Set(),
    };
    active.current = session;
    setConnecting(true);
    setMuted(false);

    const fail = (message: string) => {
      if (active.current !== session) return;
      stop();
      latest.current.onError(message);
    };

    const addTranscript = (role: ChatMessage["role"], content: string, itemId?: string, contentIndex = 0) => {
      const text = content.trim();
      if (!text || active.current !== session) return;
      const id = itemId ? `voice-${role}-${itemId}-${contentIndex}` : `voice-${crypto.randomUUID()}`;
      if (session.transcriptIds.has(id)) return;
      session.transcriptIds.add(id);
      const createdAt = (itemId && session.itemTimes.get(itemId)) || new Date().toISOString();
      latest.current.onMessage({ id, role, content: text, createdAt });
      // Persist completed transcripts only; the session token is never stored.
      void apiFetch("/api/voice/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: session.lessonId, role, content: text, eventId: id, createdAt }),
        keepalive: true,
      }).then((response) => {
        if (!response.ok) throw new Error("transcript_save_failed");
      }).catch(() => {
        if (mounted.current && active.current === session) {
          latest.current.onError("Cuộc trò chuyện vẫn tiếp tục, nhưng chưa lưu được bản ghi trên trình duyệt. Hãy kiểm tra bộ nhớ của trình duyệt.");
        }
      });
    };

    const currentContext = (): ResponseContext => ({ segmentIndex: session.contextSegment, requestVersion: session.requestVersion });
    const contextIsCurrent = (context: ResponseContext) => active.current === session
      && latest.current.lesson?.id === session.lessonId
      && latest.current.segmentIndex === context.segmentIndex
      && session.contextSegment === context.segmentIndex
      && session.requestVersion === context.requestVersion;
    const caption = (role: ChatMessage["role"], event: RealtimeEvent, final?: string) => {
      const context = event.response_id ? session.responseContexts.get(event.response_id) : currentContext();
      if (!context || !contextIsCurrent(context)) return;
      const key = `${role}:${event.item_id || "current"}:${event.content_index || 0}`;
      if (!session.partialTranscripts.has(key) && session.partialTranscripts.size >= 32) session.partialTranscripts.delete(session.partialTranscripts.keys().next().value!);
      const text = (final ?? `${session.partialTranscripts.get(key) || ""}${event.delta || ""}`).slice(0, 20000);
      if (final !== undefined) session.partialTranscripts.delete(key);
      else session.partialTranscripts.set(key, text);
      if (text.trim()) latest.current.onLiveTranscript?.({ role, text });
    };
    const queueTool = (item: RealtimeOutputItem, responseId: string) => {
      if (!item.call_id || item.call_id.length > 256 || typeof item.name !== "string" || typeof item.arguments !== "string" || session.toolIds.has(item.call_id)) return;
      const context = session.responseContexts.get(responseId);
      if (!context || session.pendingTools.size >= 32) return;
      session.pendingTools.set(item.call_id, { call_id: item.call_id, name: item.name.slice(0, 100), arguments: item.arguments.length <= 4000 ? item.arguments : "", responseId, context });
    };
    const finishTools = (event: RealtimeEvent, cancelled: boolean) => {
      const responseId = event.response?.id || event.response_id || "";
      if (!responseId || session.finishedResponses.has(responseId)) return false;
      if (session.finishedResponses.size >= 256) session.finishedResponses.delete(session.finishedResponses.values().next().value!);
      session.finishedResponses.add(responseId);
      for (const item of (event.response?.output || []).slice(0, 16)) {
        if (item.type === "function_call") queueTool(item, responseId);
      }
      let acknowledged = false;
      for (const call of [...session.pendingTools.values()]) {
        if (call.responseId !== responseId) continue;
        session.pendingTools.delete(call.call_id);
        if (session.toolIds.has(call.call_id)) continue;
        // Arguments-done also fires for cancelled/incomplete responses. Never move
        // the visible source until the enclosing response has actually completed.
        if (session.toolIds.size >= 512) session.toolIds.delete(session.toolIds.values().next().value!);
        session.toolIds.add(call.call_id);
        if (cancelled || event.response?.status !== "completed") continue;
        let args: unknown;
        try { args = JSON.parse(call.arguments); } catch { args = null; }
        const focus = call.name === "set_study_focus" && contextIsCurrent(call.context) && latest.current.lesson
          ? parseStudyFocus(args, latest.current.lesson, call.context.segmentIndex) : null;
        const output = focus ? { result: "ok" } : { error: "invalid_or_stale_study_focus", guidance: "Dùng ý và nguồn của phần hiện tại, hoặc để các chỉ mục nguồn là null. Tiếp tục trả lời bằng tiếng Việt." };
        if (sendEvent(session, { type: "conversation.item.create", item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) } })) {
          acknowledged = true;
          if (focus) latest.current.onFocus?.(focus);
        }
      }
      return acknowledged;
    };

    session.channel.onopen = async () => {
      if (active.current !== session) return;
      if (session.timer) clearTimeout(session.timer);
      session.timer = null;
      setConnecting(false);
      setConnected(true);
      playAudio(session);
      const current = latest.current;
      const currentIndex = current.lesson?.id === lesson.id ? current.segmentIndex : segmentIndex;
      const requestVersion = ++session.requestVersion;
      try {
        if (currentIndex === segmentIndex) await sendContext(session, session.context);
        else if (!await refreshContext(session, currentIndex, requestVersion)) return;
        if (active.current === session && session.requestVersion === requestVersion) createResponse(session, teachingInstructions(lesson, currentIndex));
      } catch {
        if (active.current === session) latest.current.onError("Chưa đọc được học liệu của phần đang học. Hãy bấm giảng tiếp lại.");
      }
    };
    session.channel.onclose = () => fail("Phiên giọng nói đã kết thúc. Bạn có thể bấm bắt đầu để kết nối lại.");
    session.channel.onerror = () => fail("Kết nối giọng nói bị gián đoạn. Hãy thử bắt đầu lại.");
    session.channel.onmessage = (message: MessageEvent) => {
      if (active.current !== session || typeof message.data !== "string") return;
      let event: RealtimeEvent;
      try { event = JSON.parse(message.data) as RealtimeEvent; } catch { return; }
      switch (event.type) {
        case "conversation.item.input_audio_transcription.delta":
          caption("user", event);
          break;
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta":
        case "response.output_text.delta":
          caption("assistant", event);
          break;
        case "conversation.item.input_audio_transcription.completed":
          if (event.transcript) caption("user", event, event.transcript);
          if (event.transcript) addTranscript("user", event.transcript, event.item_id, event.content_index);
          break;
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
          if (event.transcript) caption("assistant", event, event.transcript);
          if (event.transcript) addTranscript("assistant", event.transcript, event.item_id, event.content_index);
          break;
        case "response.output_text.done":
          if (event.text) caption("assistant", event, event.text);
          if (event.text) addTranscript("assistant", event.text, event.item_id, event.content_index);
          break;
        case "response.output_item.added":
          if (event.item?.id) session.itemTimes.set(event.item.id, new Date().toISOString());
          break;
        case "response.created":
          session.responseActive = true;
          if (event.response?.id) {
            if (session.responseContexts.size >= 64) session.responseContexts.delete(session.responseContexts.keys().next().value!);
            session.responseContexts.set(event.response.id, currentContext());
          }
          session.partialTranscripts.clear();
          latest.current.onLiveTranscript?.(null);
          break;
        case "response.function_call_arguments.done":
          if (!event.response_id || !session.finishedResponses.has(event.response_id)) queueTool({ call_id: event.call_id, name: event.name, arguments: event.arguments }, event.response_id || "");
          break;
        case "output_audio_buffer.started":
          session.playing = true;
          setSpeaking(true);
          playAudio(session);
          break;
        case "input_audio_buffer.speech_started":
          ++session.requestVersion;
          clearGuidance(session);
          if (event.item_id) session.itemTimes.set(event.item_id, new Date().toISOString());
          session.playing = false;
          setSpeaking(false);
          break;
        case "output_audio_buffer.cleared":
          session.partialTranscripts.clear();
          latest.current.onLiveTranscript?.(null);
          session.playing = false;
          setSpeaking(false);
          break;
        case "output_audio_buffer.stopped":
          session.playing = false;
          setSpeaking(false);
          break;
        case "response.done": {
          const responseId = event.response?.id || event.response_id;
          if (responseId && session.finishedResponses.has(responseId)) break;
          const cancelled = session.cancelling || session.pendingResponse !== null;
          const toolsAcknowledged = finishTools(event, cancelled);
          session.responseActive = false;
          session.cancelling = false;
          const pending = session.pendingResponse;
          session.pendingResponse = null;
          if (pending !== null) createResponse(session, pending);
          else if (toolsAcknowledged) createResponse(session);
          if (event.response?.status === "failed") latest.current.onError("Gia sư chưa trả lời được. Hãy thử hỏi lại.");
          break;
        }
        case "conversation.item.input_audio_transcription.failed":
          latest.current.onError("Chưa nhận được bản ghi lời nói. Bạn có thể nói lại hoặc nhập câu hỏi.");
          break;
        case "error": {
          // A cancellation racing VAD can harmlessly find no active response.
          if (event.error?.code === "response_cancel_not_active") {
            session.responseActive = false;
            session.cancelling = false;
            const pending = session.pendingResponse;
            session.pendingResponse = null;
            if (pending !== null) createResponse(session, pending);
          } else {
            session.responseActive = false;
            session.cancelling = false;
            session.pendingResponse = null;
            latest.current.onError("Dịch vụ giọng nói gặp lỗi. Hãy thử hỏi lại hoặc kết nối lại.");
          }
          break;
        }
      }
    };
    peer.ontrack = (event) => {
      if (active.current !== session) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      playAudio(session);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        fail("Không thể duy trì kết nối giọng nói. Hãy kiểm tra mạng và bắt đầu lại.");
      } else if (peer.connectionState === "disconnected") {
        if (session.timer) clearTimeout(session.timer);
        session.timer = setTimeout(() => {
          if (peer.connectionState === "disconnected") fail("Kết nối giọng nói đã mất. Hãy bắt đầu lại.");
        }, 8_000);
      } else if (peer.connectionState === "connected" && session.channel.readyState === "open" && session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
      }
    };

    try {
      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (active.current !== session) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      session.microphone = microphone;
      microphone.getAudioTracks().forEach((track) => {
        track.onended = () => fail("Micro đã bị ngắt. Kiểm tra micro rồi bắt đầu lại.");
        peer.addTrack(track, microphone);
      });
      session.timer = setTimeout(() => fail("Kết nối giọng nói quá lâu. Hãy kiểm tra mạng và thử lại."), 30_000);
      const tokenResponse = await apiFetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id, segmentIndex }),
        signal: session.abort.signal,
      });
      if (active.current !== session) return;
      const token = await tokenResponse.json() as { value?: string; model?: string; provider?: string; error?: string; instructions?: string; visualContext?: unknown };
      if (!tokenResponse.ok) throw new Error(token.error || "Chưa khởi tạo được phiên giọng nói OpenAI.");
      if (!token.value || token.provider !== "openai") throw new Error("Cấu hình giọng nói đã thay đổi. Hãy tải lại trang.");
      session.context = { visualContext: normalizeVoiceVisuals(token.visualContext), instructions: token.instructions || "" };
      const offer = await peer.createOffer();
      if (active.current !== session) return;
      await peer.setLocalDescription(offer);
      if (active.current !== session) return;
      const answerResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
        signal: session.abort.signal,
      });
      if (active.current !== session) return;
      if (!answerResponse.ok) throw new Error("voice_connection_failed");
      const sdp = await answerResponse.text();
      if (active.current !== session) return;
      await peer.setRemoteDescription({ type: "answer", sdp });
    } catch (error) {
      if (active.current !== session) return;
      const code = error instanceof Error ? error.message : "";
      const name = error instanceof Error ? error.name : "";
      fail(name === "NotAllowedError"
        ? "Bạn cần cho phép truy cập micro để trò chuyện với gia sư."
        : name === "NotFoundError"
          ? "Chưa tìm thấy micro. Hãy kết nối micro và thử lại."
          : /^(Chưa |Cấu hình |Dịch vụ |Hãy |Khóa |Model |OpenAI |Gemini )/.test(code)
            ? code
            : "Chưa kết nối được gia sư bằng giọng nói. Hãy kiểm tra mạng và thử lại.");
    }
  }, [clearGuidance, playAudio, refreshContext, sendContext, stop]);

  const toggleMute = useCallback(() => {
    const session = active.current;
    if (!session?.microphone) return;
    const tracks = session.microphone.getAudioTracks();
    const next = tracks.some((track) => track.enabled);
    tracks.forEach((track) => { track.enabled = !next; });
    if (mounted.current) setMuted(next);
  }, []);

  const ask = useCallback(async (text: string) => {
    const content = text.trim().slice(0, 4000);
    if (!content) return;
    const session = active.current;
    if (!session || session.channel.readyState !== "open") {
      latest.current.onError("Hãy bắt đầu phiên giọng nói trước khi gửi câu hỏi cho gia sư.");
      return;
    }
    playAudio(session);
    const requestVersion = ++session.requestVersion;
    try {
      if (!await refreshContext(session, latest.current.segmentIndex, requestVersion)) return;
    } catch {
      if (active.current === session) latest.current.onError("Chưa đọc được học liệu của phần đang học. Hãy thử gửi câu hỏi lại.");
      return;
    }
    if (active.current !== session || session.requestVersion !== requestVersion) return;
    const itemId = crypto.randomUUID().replace(/-/g, "");
    const id = `voice-user-${itemId}`;
    const createdAt = new Date().toISOString();
    if (!sendEvent(session, { type: "conversation.item.create", item: { id: itemId, type: "message", role: "user", content: [{ type: "input_text", text: `${VIETNAMESE_VOICE_GUIDANCE}\nCâu hỏi của học viên: ${content}` }] } })) {
      latest.current.onError("Chưa gửi được câu hỏi. Hãy kết nối lại phiên giọng nói.");
      return;
    }
    session.transcriptIds.add(id);
    session.itemTimes.set(itemId, createdAt);
    latest.current.onMessage({ id, role: "user", content, createdAt });
    void apiFetch("/api/voice/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId: session.lessonId, role: "user", content, eventId: id, createdAt }),
      keepalive: true,
    }).then((response) => {
      if (!response.ok) throw new Error("transcript_save_failed");
    }).catch(() => {
      if (mounted.current && active.current === session) latest.current.onError("Chưa lưu được câu hỏi trên trình duyệt. Hãy kiểm tra bộ nhớ trình duyệt.");
    });
    createResponse(session);
  }, [playAudio, refreshContext]);

  const teach = useCallback(async () => {
    const session = active.current;
    const { lesson, segmentIndex } = latest.current;
    if (!lesson || !session || session.channel.readyState !== "open") {
      latest.current.onError("Hãy chọn bài học và bắt đầu phiên giọng nói trước khi giảng tiếp.");
      return;
    }
    playAudio(session);
    const requestVersion = ++session.requestVersion;
    try {
      if (!await refreshContext(session, segmentIndex, requestVersion)) return;
    } catch {
      if (active.current === session) latest.current.onError("Chưa đọc được học liệu của phần đang học. Hãy bấm giảng tiếp lại.");
      return;
    }
    if (active.current !== session || session.requestVersion !== requestVersion) return;
    createResponse(session, teachingInstructions(lesson, segmentIndex));
  }, [playAudio, refreshContext]);

  return { connected, connecting, speaking, muted, start, stop, toggleMute, ask, teach };
}

export function useVoiceTutor(options: VoiceTutorOptions) {
  const openAI = useOpenAIVoiceTutor(options);
  const gemini = useGeminiVoiceTutor(options);
  useEffect(() => {
    openAI.stop(); gemini.stop();
  }, [options.provider, openAI.stop, gemini.stop]);
  return options.provider === "gemini" ? gemini : openAI;
}
