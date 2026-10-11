"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, Lesson } from "./types";
import { apiFetch } from "./client-api";
import { useGeminiVoiceTutor } from "./use-gemini-voice-tutor";
import { fitOpenAiVoiceVisual, loadVoiceContext, normalizeVoiceVisuals, openAiVisualEvent, type VoiceContext } from "./voice-context";

type VoiceTutorOptions = {
  provider?: "gemini" | "openai";
  lesson: Lesson | null;
  segmentIndex: number;
  onMessage: (message: ChatMessage) => void;
  onSegmentChange?: (index: number) => void;
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
};

type RealtimeEvent = {
  type?: string;
  item_id?: string;
  item?: { id?: string };
  content_index?: number;
  transcript?: string;
  text?: string;
  error?: { code?: string };
  response?: { status?: string };
};

function teachingInstructions(lesson: Lesson, index: number): string {
  const segment = lesson.segments[index];
  return [
    "Tiếp tục làm gia sư theo hướng dẫn của phiên học. Giảng bằng tiếng Việt, rõ ràng và từng đoạn ngắn.",
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

  const stop = useCallback(() => {
    const session = active.current;
    active.current = null;
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
  }, []);

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
        case "conversation.item.input_audio_transcription.completed":
          if (event.transcript) addTranscript("user", event.transcript, event.item_id, event.content_index);
          break;
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
          if (event.transcript) addTranscript("assistant", event.transcript, event.item_id, event.content_index);
          break;
        case "response.output_text.done":
          if (event.text) addTranscript("assistant", event.text, event.item_id, event.content_index);
          break;
        case "response.output_item.added":
          if (event.item?.id) session.itemTimes.set(event.item.id, new Date().toISOString());
          break;
        case "response.created":
          session.responseActive = true;
          break;
        case "output_audio_buffer.started":
          session.playing = true;
          setSpeaking(true);
          playAudio(session);
          break;
        case "input_audio_buffer.speech_started":
          if (event.item_id) session.itemTimes.set(event.item_id, new Date().toISOString());
          session.playing = false;
          setSpeaking(false);
          break;
        case "output_audio_buffer.cleared":
        case "output_audio_buffer.stopped":
          session.playing = false;
          setSpeaking(false);
          break;
        case "response.done": {
          session.responseActive = false;
          session.cancelling = false;
          const pending = session.pendingResponse;
          session.pendingResponse = null;
          if (pending !== null) createResponse(session, pending);
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
  }, [playAudio, refreshContext, sendContext, stop]);

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
    if (!sendEvent(session, { type: "conversation.item.create", item: { id: itemId, type: "message", role: "user", content: [{ type: "input_text", text: content }] } })) {
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
