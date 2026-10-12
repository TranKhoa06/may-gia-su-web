"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Cloud, ExternalLink, FileText, GraduationCap, Headphones, Layers, Library, LoaderCircle, Menu, MessageCircle, Mic, MicOff, Pause, Play, Plus, Search, Send, Settings2, Sparkles, Square, Trash2, Upload, Volume2, Waypoints, X } from "lucide-react";
import type { AiSettingsState, AppState, ChatMessage, Course, Lesson, Material, Progress, Settings, SourceRef, SourceUnit } from "@/lib/types";
import { parseMaterial } from "@/lib/material-parser";
import { useVoiceTutor } from "@/lib/use-voice-tutor";
import { getNotebookUrl, notebookHref } from "@/lib/notebook";
import { AiModelSettings } from "@/app/components/ai-model-settings";
import { TutorModelPicker } from "@/app/components/tutor-model-picker";
import { LessonDiagram, LinkedSourceImages, SourceImages } from "@/app/components/lesson-visuals";
import { PdfPagePreview } from "@/app/components/pdf-page-preview";
import { apiFetch } from "@/lib/client-api";
import { getSegmentKeyPoints } from "@/lib/study-focus";
import { LessonOutline, ListeningFocus, nearChatBottom, paragraphAtBoundary, readingParagraphs, submitOnEnter, type StudyFocusView, type LiveTranscriptView } from "@/app/components/study-workspace";

type View = "classroom" | "library" | "roadmap" | "settings";
type MaterialDetail = { material: Material; units: SourceUnit[]; downloadUrl: string };
const emptySettings: Settings = { subject: "", level: "", goal: "", notebookUrl: "" };
const navigation = [{ id: "classroom" as View, label: "Lớp học", icon: GraduationCap }, { id: "library" as View, label: "Thư viện", icon: Library }, { id: "roadmap" as View, label: "Lộ trình", icon: Waypoints }, { id: "settings" as View, label: "Cài đặt", icon: Settings2 }];
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, options);
  const data = await response.json().catch(() => ({})) as { error?: string; code?: string };
  if (!response.ok) { const error = new Error(data.error || "Không thể thực hiện lúc này. Vui lòng thử lại.") as Error & { code?: string }; error.code = data.code; throw error; }
  return data as T;
}
function percent(lesson: Lesson, progress: Progress[]) { const p = progress.find((item) => item.lessonId === lesson.id); return p?.completed ? 100 : Math.round(((p?.segmentIndex ?? 0) / Math.max(lesson.segments.length, 1)) * 100); }

export default function Home() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>("classroom");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [courseOpen, setCourseOpen] = useState(false);
  const [pendingMaterial, setPendingMaterial] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newCourse, setNewCourse] = useState<Settings>(emptySettings);
  const [courseBusy, setCourseBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStep, setUploadStep] = useState("");
  const [dragging, setDragging] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeLesson, setActiveLesson] = useState<Lesson | null>(null);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [sourceIndex, setSourceIndex] = useState(0);
  const [sourceDetail, setSourceDetail] = useState<MaterialDetail | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState("");
  const [readerMode, setReaderMode] = useState<"text" | "original">("text");
  const [lessonTab, setLessonTab] = useState<"lesson" | "chat" | "quiz">("lesson");
  const [workspacePane, setWorkspacePane] = useState<"source" | "tutor">("tutor");
  const [studyFocus, setStudyFocus] = useState<StudyFocusView | null>(null);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptView | null>(null);
  const [followSource, setFollowSource] = useState(true);
  const [newChatMessages, setNewChatMessages] = useState(false);
  const [readingParagraph, setReadingParagraph] = useState<number | null>(null);
  const [boundaryKnown, setBoundaryKnown] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [progressBusy, setProgressBusy] = useState(false);
  const [draft, setDraft] = useState<Settings>(emptySettings);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [readPaused, setReadPaused] = useState(false);
  const [readSpeed, setReadSpeed] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const lessonScrollRef = useRef<HTMLDivElement>(null);
  const chatNearBottom = useRef(true);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const speechGeneration = useRef(0);
  const followSourceRef = useRef(true);
  const sourceViewRef = useRef<{ materialId: string; index: number } | null>(null);
  const materialCache = useRef<Record<string, MaterialDetail>>({});
  const sourceRequest = useRef(0);
  const courseEpoch = useRef(0);
  const lessonEpoch = useRef(0);
  const reportError = useCallback((value: string) => setError(value), []);
  const receiveVoiceMessage = useCallback((entry: ChatMessage) => { setMessages((current) => [...current.filter((m) => m.id !== entry.id), entry]); }, []);
  followSourceRef.current = followSource;
  sourceViewRef.current = sourceDetail && sourceId ? { materialId: sourceId, index: sourceDetail.units[sourceIndex]?.index ?? -1 } : null;
  const receiveStudyFocus = useCallback((focus: StudyFocusView | null) => { setStudyFocus(focus); const ref = focus?.sourceRef; if (ref && followSourceRef.current && (sourceViewRef.current?.materialId !== ref.materialId || sourceViewRef.current.index !== ref.index)) void loadSource(ref.materialId, ref.index); }, []);
  const receiveLiveTranscript = useCallback((value: LiveTranscriptView | null) => setLiveTranscript(value), []);
  const voice = useVoiceTutor({ provider: state?.voiceProvider || "openai", lesson: activeLesson, segmentIndex, onMessage: receiveVoiceMessage, onSegmentChange: changeSegment, onFocus: receiveStudyFocus, onLiveTranscript: receiveLiveTranscript, onError: reportError });

  useEffect(() => {
    request<AppState>("/api/state").then((data) => { setState(data); setDraft(data.settings); }).catch((e) => { setError(e.message); }).finally(() => setLoading(false));
    return () => { if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel(); };
  }, []);
  useEffect(() => {
    const scroll = chatScrollRef.current;
    if (lessonTab !== "chat" || !scroll) { if (messages.length) setNewChatMessages(true); return; }
    if (chatNearBottom.current) { scroll.scrollTop = scroll.scrollHeight; setNewChatMessages(false); }
    else setNewChatMessages(true);
  }, [messages, chatBusy, lessonTab]);
  useEffect(() => {
    const scroll = lessonScrollRef.current;
    const paragraph = scroll?.querySelector<HTMLElement>(".being-read");
    if (!scroll || !paragraph || !reading || lessonTab !== "lesson") return;
    const top = paragraph.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
    if (top < scroll.scrollTop || top + paragraph.offsetHeight > scroll.scrollTop + scroll.clientHeight) scroll.scrollTo({ top: Math.max(0, top - 22), behavior: "smooth" });
  }, [readingParagraph, reading, lessonTab]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!uploadOpen && !courseOpen && !pendingMaterial) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]') || []);
    if (pendingMaterial) { if (deleting) dialog?.focus(); else deleteCancelRef.current?.focus(); }
    else (focusable().find((element) => element.tagName === "INPUT") || focusable()[0])?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !uploading && !courseBusy && !deleting) { event.preventDefault(); setUploadOpen(false); setCourseOpen(false); setPendingMaterial(null); }
      if (event.key !== "Tab") return;
      const elements = focusable(); const first = elements[0]; const last = elements[elements.length - 1];
      if (!elements.length) { event.preventDefault(); return; }
      if (!dialog?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); if (previous?.isConnected) previous.focus(); };
  }, [uploadOpen, courseOpen, pendingMaterial, uploading, courseBusy, deleting]);
  function navigate(next: View) { if (next !== "classroom") { stopReading(); voice.stop(); } setView(next); setMobileOpen(false); }
  function stopReading() { ++speechGeneration.current; if ("speechSynthesis" in window) window.speechSynthesis.cancel(); setReading(false); setReadPaused(false); setReadingParagraph(null); setBoundaryKnown(false); }
  function resetClassroom() { ++courseEpoch.current; ++lessonEpoch.current; stopReading(); voice.stop(); setPendingMaterial(null); setDeleting(false); setActiveLesson(null); setSourceId(""); setSourceDetail(null); setSelectedIds([]); setMessages([]); setSegmentIndex(0); setQuizAnswers({}); setQuizSubmitted(false); setSearch(""); setTopic(""); setMessage(""); setChatBusy(false); setProgressBusy(false); setSettingsBusy(false); materialCache.current = {}; ++sourceRequest.current; }
  async function switchCourse(id: string) {
    if (!id || courseBusy || uploading || creating || deleting) return;
    setCourseBusy(true); setError(""); resetClassroom();
    const epoch = courseEpoch.current;
    try { const data = await request<AppState>(`/api/state?courseId=${encodeURIComponent(id)}`); if (epoch !== courseEpoch.current) return; setState(data); setDraft(data.settings); setView("classroom"); }
    catch (e) { setError((e as Error).message); } finally { setCourseBusy(false); }
  }
  async function createCourse(event: React.FormEvent) {
    event.preventDefault();
    if (courseBusy || uploading || creating || deleting) return;
    setCourseBusy(true); setError("");
    try { const course = await request<Course>("/api/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newCourse) }); const data = await request<AppState>(`/api/state?courseId=${encodeURIComponent(course.id)}`); resetClassroom(); setState(data); setDraft(data.settings); setNewCourse(emptySettings); setCourseOpen(false); setView("classroom"); setNotice(`Đã tạo góc học tập cho môn ${course.subject}.`); }
    catch (e) { setError((e as Error).message); } finally { setCourseBusy(false); }
  }
  async function loadSource(id: string, originalIndex?: number) {
    if (!id) return;
    const seq = ++sourceRequest.current; setSourceId(id); setReaderMode("text");
    const apply = (detail: MaterialDetail) => { setSourceDetail(detail); setSourceIndex(originalIndex === undefined ? 0 : Math.max(0, detail.units.findIndex((unit) => unit.index === originalIndex))); };
    const cached = materialCache.current[id];
    if (cached) { apply(cached); setSourceLoading(false); return; }
    setSourceDetail(null); setSourceLoading(true);
    try { const detail = await request<MaterialDetail>(`/api/materials/${encodeURIComponent(id)}`); materialCache.current[id] = detail; if (seq === sourceRequest.current) apply(detail); }
    catch (e) { if (seq === sourceRequest.current) setError((e as Error).message); }
    finally { if (seq === sourceRequest.current) setSourceLoading(false); }
  }
  async function downloadMaterial(material: Material) {
    if (downloadingId) return;
    setDownloadingId(material.id); setError("");
    try {
      const response = await apiFetch(`/api/materials/${encodeURIComponent(material.id)}/file`);
      if (!response.ok) throw new Error("Không tìm thấy bản gốc của học liệu này.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = material.name;
      document.body.append(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) { setError(error instanceof Error ? error.message : "Chưa tải được học liệu."); }
    finally { setDownloadingId(""); }
  }
  function openMaterial(id: string) {
    ++lessonEpoch.current; stopReading(); voice.stop(); setActiveLesson(null); setMessages([]); setView("classroom");
    void loadSource(id);
  }
  function closeWorkspace() {
    ++lessonEpoch.current; ++sourceRequest.current; stopReading(); voice.stop();
    setActiveLesson(null); setSourceId(""); setSourceDetail(null); setMessages([]); setSourceLoading(false);
  }
  async function openLesson(lesson: Lesson) {
    const course = courseEpoch.current; const epoch = ++lessonEpoch.current;
    stopReading(); voice.stop(); setActiveLesson(lesson); setView("classroom"); setLessonTab("lesson");
    const saved = state?.progress.find((p) => p.lessonId === lesson.id); const index = Math.min(saved?.segmentIndex ?? 0, Math.max(lesson.segments.length - 1, 0));
    setSegmentIndex(index); setQuizAnswers({}); setQuizSubmitted(false); setMessages([]); setChatBusy(false); setStudyFocus(null); setLiveTranscript(null); setFollowSource(true); setNewChatMessages(false); chatNearBottom.current = true; setWorkspacePane("tutor");
    const ref = lesson.segments[index]?.sourceRefs[0];
    if (ref) void loadSource(ref.materialId, ref.index); else if (lesson.materialIds[0]) void loadSource(lesson.materialIds[0]);
    try { const history = await request<ChatMessage[]>(`/api/chat?lessonId=${encodeURIComponent(lesson.id)}`); if (epoch === lessonEpoch.current && course === courseEpoch.current) setMessages((current) => [...history, ...current.filter((entry) => !history.some((savedMessage) => savedMessage.id === entry.id))]); } catch (e) { if (epoch === lessonEpoch.current && course === courseEpoch.current) setError((e as Error).message); }
  }
  function changeSegment(index: number) { if (!activeLesson || index < 0 || index >= activeLesson.segments.length || index === segmentIndex) return; stopReading(); if (voice.connected || voice.connecting) { voice.stop(); setNotice("Đã chuyển phần. Bấm Trò chuyện bằng giọng nói để nghe phần mới."); } setSegmentIndex(index); setLessonTab("lesson"); setStudyFocus(null); setLiveTranscript(null); const ref = activeLesson.segments[index]?.sourceRefs[0]; if (ref && followSourceRef.current) void loadSource(ref.materialId, ref.index); }
  function showReference(ref: SourceRef) { setFollowSource(false); setWorkspacePane("source"); void loadSource(ref.materialId, ref.index); }
  function restoreFollowing() { if (followSource) { setFollowSource(false); return; } setFollowSource(true); const ref = studyFocus?.sourceRef || activeLesson?.segments[segmentIndex]?.sourceRefs[0]; if (ref) void loadSource(ref.materialId, ref.index); }
  function showChat() { chatNearBottom.current = true; setNewChatMessages(false); setLessonTab("chat"); setWorkspacePane("tutor"); }
  function latestChat() { const scroll = chatScrollRef.current; if (scroll) scroll.scrollTo({ top: scroll.scrollHeight, behavior: "smooth" }); chatNearBottom.current = true; setNewChatMessages(false); }
  function askTutor(content: string) { if (voice.connected) void voice.ask(content); else if (state?.aiReady) { showChat(); void sendChat(content); } else { setNotice("Nhập khóa API trong Cài đặt để hỏi gia sư. Bạn vẫn có thể đọc và nghe nội dung bài giảng."); } }
  function askPoint(index: number, point: string) { setStudyFocus({ pointIndex: index, cue: "Bạn chọn ý này để hỏi lại." }); askTutor(`Giải thích lại ý ${index + 1} của phần ${segmentIndex + 1}: ${point}. Chỉ giúp tôi cần nhìn phần nào trong học liệu.`); }
  function submitQuestion() { const content = message.trim(); if (!content || chatBusy || voice.connecting) return; if (voice.connected) { void voice.ask(content); setMessage(""); } else void sendChat(content); chatNearBottom.current = true; }
  async function uploadFiles(files: FileList | File[]) {
    if (!state?.activeCourseId) { setUploadOpen(false); setCourseOpen(true); return; }
    const list = Array.from(files); if (!list.length || uploading || courseBusy) return; setUploading(true); setError("");
    const epoch = courseEpoch.current; const uploaded: Material[] = []; const failures: string[] = [];
    try {
      for (const file of list) {
        try {
          setUploadStep(`Đang đọc ${file.name}…`); const units = await parseMaterial(file);
          if (epoch !== courseEpoch.current) return;
          setUploadStep(`Đang lưu ${file.name}…`);
          const form = new FormData(); form.append("file", file); form.append("units", JSON.stringify(units)); form.append("courseId", state.activeCourseId);
          const material = await request<Material>("/api/materials", { method: "POST", body: form });
          if (epoch !== courseEpoch.current) return;
          uploaded.push(material); setState(current => current ? { ...current, materials: [material, ...current.materials] } : current);
          setSelectedIds(current => [...new Set([...current, material.id])]);
        } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : "Chưa đọc được file."}`); }
      }
      if (epoch !== courseEpoch.current) return;
      if (uploaded.length) { setUploadOpen(false); setView("library"); setNotice(`Đã thêm ${uploaded.length} học liệu vào thư viện.`); }
      if (failures.length) setError(failures.join(" "));
    } finally { setUploading(false); setUploadStep(""); if (inputRef.current) inputRef.current.value = ""; }
  }
  async function deleteMaterial(material: Material) {
    if (deleting || pendingMaterial?.id !== material.id) return;
    setDeleting(true); setError("");
    const epoch = courseEpoch.current; const courseId = state?.activeCourseId;
    try { await request(`/api/materials/${encodeURIComponent(material.id)}`, { method: "DELETE" }); const refreshed = await request<AppState>(`/api/state?courseId=${encodeURIComponent(courseId || "")}`); if (epoch !== courseEpoch.current) return; if (activeLesson?.materialIds.includes(material.id) || sourceId === material.id) { ++lessonEpoch.current; stopReading(); voice.stop(); setActiveLesson(null); setSourceId(""); setSourceDetail(null); setMessages([]); ++sourceRequest.current; } setState(refreshed); setSelectedIds((current) => current.filter((id) => id !== material.id)); delete materialCache.current[material.id]; setPendingMaterial(null); setNotice("Đã xóa học liệu và cập nhật những bài học liên quan."); }
    catch (e) { if (epoch === courseEpoch.current) setError((e as Error).message); }
    finally { setDeleting(false); }
  }
  async function createLesson() {
    if (!selectedIds.length || creating) return; setCreating(true); setError("");
    const epoch = courseEpoch.current;
    try { const lesson = await request<Lesson>("/api/lessons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId: state?.activeCourseId, materialIds: selectedIds, topic: topic.trim() || undefined }) }); if (epoch !== courseEpoch.current) return; setState((current) => current ? { ...current, lessons: [lesson, ...current.lessons] } : current); await openLesson(lesson); if (epoch === courseEpoch.current) setNotice("Bài học của bạn đã sẵn sàng."); }
    catch (e) { if (epoch === courseEpoch.current) setError((e as Error).message); } finally { if (epoch === courseEpoch.current) setCreating(false); }
  }
  async function sendChat(content = message) {
    if (!activeLesson || !content.trim() || chatBusy || !state?.aiReady) return; stopReading();
    const course = courseEpoch.current; const epoch = lessonEpoch.current;
    const entry: ChatMessage = { id: `local-${Date.now()}`, role: "user", content: content.trim(), createdAt: new Date().toISOString() }; setMessages((current) => [...current, entry]); setMessage(""); setChatBusy(true);
    try {
      const response = await request<ChatMessage>("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lessonId: activeLesson.id, segmentIndex, message: content.trim() }) });
      if (epoch !== lessonEpoch.current || course !== courseEpoch.current) return;
      setMessages((current) => [...current, response]);
      if (response.illustration && voice.connected) void voice.ask(`Hãy giải thích bằng giọng nói sơ đồ vừa hiển thị: ${response.illustration.title}\n${response.illustration.description}`);
    }
    catch (e) { if (epoch === lessonEpoch.current && course === courseEpoch.current) setError((e as Error).message); } finally { if (epoch === lessonEpoch.current && course === courseEpoch.current) setChatBusy(false); }
  }
  async function saveProgress(completed: boolean, score?: number) {
    if (!activeLesson || progressBusy) return false; setProgressBusy(true);
    const course = courseEpoch.current; const epoch = lessonEpoch.current;
    try { const progress = await request<Progress>("/api/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lessonId: activeLesson.id, segmentIndex: completed ? activeLesson.segments.length - 1 : segmentIndex, completed, score }) }); if (epoch !== lessonEpoch.current || course !== courseEpoch.current) return; setState((current) => current ? { ...current, progress: [...current.progress.filter((p) => p.lessonId !== activeLesson.id), progress] } : current); setNotice(completed ? "Đã lưu kết quả. Bạn đã hoàn thành bài học!" : "Đã lưu vị trí học để tiếp tục vào lần sau."); return true; }
    catch (e) { if (epoch === lessonEpoch.current && course === courseEpoch.current) setError((e as Error).message); return false; } finally { if (epoch === lessonEpoch.current && course === courseEpoch.current) setProgressBusy(false); }
  }
  async function saveSettings(event: React.FormEvent) {
    event.preventDefault(); setSettingsBusy(true); setError("");
    const epoch = courseEpoch.current;
    try { const notebookUrl = draft.notebookUrl.trim() ? getNotebookUrl(draft.notebookUrl) : ""; if (notebookUrl === null) throw new Error("Dán đường link NotebookLM của Google: notebook.google.com, notebooklm.google.com hoặc notebooklm.google."); const settings = await request<Settings>("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, notebookUrl, courseId: state?.activeCourseId }) }); if (epoch !== courseEpoch.current) return; setDraft(settings); setState((current) => current ? { ...current, settings, courses: current.courses.map((course) => course.id === current.activeCourseId ? { ...course, ...settings } : course) } : current); setNotice("Đã lưu hồ sơ môn học."); }
    catch (e) { if (epoch === courseEpoch.current) setError((e as Error).message === "Invalid URL" ? "Liên kết NotebookLM chưa hợp lệ." : (e as Error).message); } finally { if (epoch === courseEpoch.current) setSettingsBusy(false); }
  }
  function readAloud() {
    if (!("speechSynthesis" in window)) { setError("Trình duyệt này chưa hỗ trợ đọc bằng giọng nói. Hãy sử dụng Chrome hoặc Edge."); return; }
    if (reading) { if (readPaused) window.speechSynthesis.resume(); else window.speechSynthesis.pause(); setReadPaused(!readPaused); return; }
    const text = activeLesson?.segments[segmentIndex]?.explanation || sourceDetail?.units[sourceIndex]?.text; if (!text) return;
    if (!activeLesson && /^(Trang này là ảnh quét|Slide chỉ có hình|Slide chứa hình chưa đọc được)/.test(text.trim())) { setError("Trang này cần AI đọc hình. Tạo bài học từ học liệu để Mây giải thích hình rồi nghe bài giảng."); return; }
    const generation = ++speechGeneration.current;
    const paragraphs = readingParagraphs(text);
    setReadingParagraph(null); setBoundaryKnown(false);
    const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "vi-VN"; utterance.rate = readSpeed;
    const vietnameseVoice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("vi")); if (vietnameseVoice) utterance.voice = vietnameseVoice;
    utterance.onboundary = event => { if (generation !== speechGeneration.current) return; const index = paragraphAtBoundary(paragraphs, event.charIndex); if (index === null) return; setReadingParagraph(index); setBoundaryKnown(true); };
    utterance.onend = () => { if (generation !== speechGeneration.current) return; setReading(false); setReadPaused(false); setReadingParagraph(null); }; utterance.onerror = (event) => { if (generation !== speechGeneration.current) return; setReading(false); setReadPaused(false); setReadingParagraph(null); if (!["canceled", "interrupted"].includes(event.error)) setError("Trình duyệt chưa đọc được nội dung bằng giọng nói. Kiểm tra giọng đọc tiếng Việt hoặc dùng trò chuyện giọng nói AI."); };
    window.speechSynthesis.cancel(); window.speechSynthesis.speak(utterance); setReading(true); setReadPaused(false);
  }
  const segment = activeLesson?.segments[segmentIndex];
  const keyPoints = segment ? getSegmentKeyPoints(segment) : [];
  const paragraphs = readingParagraphs(segment?.explanation || "");
  const focusSource = studyFocus?.sourceRef || segment?.sourceRefs[0];
  const focusSourceName = state?.materials.find(material => material.id === focusSource?.materialId)?.name;
  const unit = sourceDetail?.units[sourceIndex];
  const sourceReadable = !!unit?.text.trim() && !/^(Trang này là ảnh quét|Slide chỉ có hình|Slide chứa hình chưa đọc được)/.test(unit.text.trim());
  const materials = state?.materials ?? [];
  const lessons = state?.lessons ?? [];
  const filtered = materials.filter((m) => m.name.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi")));
  const quizScore = activeLesson?.quiz.length ? Math.round(activeLesson.quiz.filter((q, i) => quizAnswers[i] === q.correctIndex).length / activeLesson.quiz.length * 100) : 0;
  const openUpload = () => { setError(""); if (state?.activeCourseId) setUploadOpen(true); else setCourseOpen(true); };
  const savedNotebookUrl = getNotebookUrl(state?.settings.notebookUrl);
  const configureNotebook = () => {
    setError("");
    navigate("settings");
    if (!state?.activeCourseId) {
      setNotice("Tạo môn học để lưu liên kết notebook riêng cho môn đó.");
      setCourseOpen(true);
    } else {
      setTimeout(() => document.getElementById("notebook-url")?.focus(), 100);
    }
  };
  const saveAiSelection = (next: AiSettingsState) => {
    voice.stop(); stopReading(); setError("");
    const textProfile = next.profiles.find(profile => profile.id === next.selection.textProfileId);
    const voiceProfile = next.profiles.find(profile => profile.id === next.selection.voiceProfileId);
    const available = !!textProfile?.keyConfigured;
    const voiceAvailable = !!voiceProfile?.keyConfigured && !!voiceProfile.voiceModel;
    setState(current => current ? { ...current, aiSettings: next, aiReady: available, voiceReady: voiceAvailable, aiProvider: available ? textProfile!.provider : null, voiceProvider: voiceAvailable ? voiceProfile!.provider : null } : current);
  };
  const refs = (references: SourceRef[]) => <div className="source-refs">{references.map((ref, i) => <button key={`${ref.materialId}-${i}`} onClick={() => showReference(ref)}><FileText size={12} />{ref.label}</button>)}</div>;
  const aiProviderName = state?.aiProvider === "gemini" ? "Gemini" : state?.aiProvider === "openai" ? "OpenAI" : "AI";
  const aiStatus = state?.aiReady ? `Đã lưu khóa ${aiProviderName}` : "Chưa cấu hình";
  const aiSetup = <div className="local-ai-setup"><strong>Học trên thiết bị của bạn</strong><p>Nhập khóa API riêng trong bộ chọn AI ở phía trên, chọn model rồi lưu. Bạn có thể mở Mây từ điện thoại hoặc máy tính; mỗi trình duyệt có khóa và góc học tập riêng.</p><p>Môn học, PDF/PPTX và tiến độ được lưu trong trình duyệt này. Chúng không tự chuyển sang thiết bị khác. Xóa dữ liệu trang web sẽ xóa dữ liệu học đã lưu.</p><p>Khóa chỉ lưu trong trình duyệt này và gửi tới dịch vụ AI khi bạn sử dụng. Không đăng lên GitHub. Hạn mức và phí phụ thuộc dịch vụ API, không phụ thuộc ChatGPT Plus.</p></div>;

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`}>
      <a className="brand" href="#" aria-label="Mây — về lớp học" onClick={(e) => { e.preventDefault(); navigate("classroom"); }}><Cloud size={30} strokeWidth={1.7} /><span>Mây<span className="brand-dot">.</span></span></a><p className="brand-caption">Gia sư của riêng bạn</p>
      <div className="course-selector"><span>MÔN ĐANG HỌC</span><div><select aria-label="Chuyển môn học" disabled={courseBusy || uploading || creating || deleting} value={state?.activeCourseId || ""} onChange={(e) => void switchCourse(e.target.value)}>{!state?.courses.length && <option value="">Chọn môn học của bạn</option>}{state?.courses.map((course) => <option key={course.id} value={course.id}>{course.subject}</option>)}</select><ChevronDown size={14} /></div><button onClick={() => setCourseOpen(true)}><Plus size={13} />Thêm môn học</button></div>
      <div className="sidebar-section-label">GÓC HỌC TẬP</div><nav aria-label="Điều hướng chính">{navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => navigate(id)}><Icon size={20} /><span>{label}</span>{view === id && <i />}</button>)}</nav>
      <div className="sidebar-notebook"><a href={notebookHref(savedNotebookUrl)} target="_blank" rel="noopener noreferrer" aria-label="Mở NotebookLM" style={{ display: "block", color: "inherit" }}><span className="notebook-symbol"><BookOpen size={21} /></span><strong>NotebookLM</strong><p>{savedNotebookUrl ? "Notebook của môn đang học." : "Mở NotebookLM để khám phá học liệu."}</p><span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "#708760" }}>Mở NotebookLM <ExternalLink size={13} /></span></a><button type="button" onClick={configureNotebook} style={{ marginTop: 13 }}>{savedNotebookUrl ? "Sửa liên kết" : "Liên kết notebook"}<Plus size={14} /></button></div>
      <div className="sidebar-bottom"><span className="avatar">B</span><div><strong>Không gian của bạn</strong><p>Không cần tài khoản</p></div><button className="icon-button" aria-label="Cài đặt" onClick={() => navigate("settings")}><Settings2 size={17} /></button></div>
    </aside>{mobileOpen && <button className="sidebar-scrim" aria-label="Đóng điều hướng" onClick={() => setMobileOpen(false)} />}
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Mở điều hướng" onClick={() => setMobileOpen(true)}><Menu size={21} /></button><span>Không gian học tập</span><ChevronRight size={13} /><strong>{navigation.find((n) => n.id === view)?.label}</strong></div><div className="topbar-actions"><span className="private-label"><i />Lưu trong trình duyệt</span><button className="button primary small" onClick={openUpload}><Plus size={17} />Thêm học liệu</button></div></header>
      <main className={`content ${view === "classroom" && (activeLesson || sourceId) ? "has-workspace" : ""}`}>
        {error && !uploadOpen && !courseOpen && !pendingMaterial && <div className="alert error" role="alert"><CircleHelp size={18} /><span>{error}</span><button aria-label="Đóng thông báo lỗi" className="icon-button" onClick={() => setError("")}><X size={16} /></button></div>}{notice && <div className="toast" role="status"><CheckCheck size={18} />{notice}<button className="icon-button" aria-label="Đóng thông báo" onClick={() => setNotice("")}><X size={15} /></button></div>}
        {loading ? <div className="loading-screen"><span className="empty-icon"><Cloud size={36} /></span><LoaderCircle className="spin" size={21} /><p>Đang mở góc học tập của bạn…</p></div> : !state ? <div className="loading-screen"><span className="empty-icon"><Cloud size={36} /></span><h1>Chưa thể mở lớp học</h1><p>{error}</p><button className="button primary" onClick={() => window.location.reload()}>Tải lại trang</button></div> : <>
          {view !== "settings" && (view === "classroom" && (activeLesson || sourceId) ? <details className="workspace-ai-picker"><summary><Settings2 size={15} />AI đang dùng: {aiProviderName}<span>Đổi cấu hình và model</span><ChevronDown size={14} /></summary><TutorModelPicker busy={creating || chatBusy || voice.connecting} value={state.aiSettings} onSaved={saveAiSelection} onError={reportError} onSettings={() => navigate("settings")} /></details> : <TutorModelPicker busy={creating || chatBusy || voice.connecting} value={state.aiSettings} onSaved={saveAiSelection} onError={reportError} onSettings={() => navigate("settings")} />)}
          {view === "classroom" && !activeLesson && !sourceId && <>
            <div className="page-heading"><div><span className="eyebrow"><i className="sun-dot" />MỖI NGÀY, MỘT CHÚT TIẾN BỘ</span><h1>Hôm nay, mình học gì?</h1><p>Môn học, học liệu và tiến độ được lưu trong trình duyệt này. Mở web ở bất cứ đâu, không cần tài khoản ChatGPT.</p></div><span className="date-pill">Góc học tập của bạn <Cloud size={16} /></span></div>
            <section className="welcome-card"><div className="welcome-copy"><span className="pill pale"><Sparkles size={14} />Học theo cách của bạn</span><h2>Từ trang tài liệu,<br />đến điều bạn <em>thật sự hiểu.</em></h2><p>Một người giảng bài, một nơi để hỏi lại.<br />Bắt đầu với PDF hoặc slide của môn bạn đang học.</p><div className="welcome-actions"><button className="button primary" onClick={state.activeCourseId ? openUpload : () => setCourseOpen(true)}>{state.activeCourseId ? <Upload size={17} /> : <Plus size={17} />}{state.activeCourseId ? "Tải học liệu lên" : "Tạo môn học đầu tiên"}<ArrowRight size={16} /></button><span>{state.activeCourseId ? "PDF, PPTX · tối đa 20 MB" : "Mỗi môn, một góc học tập"}</span></div></div><div className="hero-art" aria-hidden="true"><div className="art-orbit" /><div className="art-orbit outer" /><span className="art-star one">✦</span><span className="art-star two">✧</span><div className="art-paper"><div className="paper-fold" /><div className="art-paper-tag"><FileText size={15} />HỌC LIỆU CỦA BẠN</div><div className="paper-title" /><div className="paper-line" /><div className="paper-line short" /><div className="paper-diagram"><i /><span /><i /></div><div className="paper-line" /><div className="paper-line short" /></div><div className="art-voice"><span className="voice-orb"><AudioLines size={23} /></span><div><strong>Cùng hiểu bài nào.</strong><span>Nghe · Hỏi · Hiểu</span></div><span className="art-wave"><i /><i /><i /><i /><i /></span></div><span className="art-check"><Check size={19} /></span></div></section>
            <div className="section-heading"><h2>Ba bước để bắt đầu</h2><span>Một lớp học vừa vặn với bạn</span></div><div className="steps-grid">{[{ icon: Upload, color: "peach", title: "Mang theo học liệu", text: "Tải giáo trình PDF hoặc slide PPTX. Mây đọc nội dung từng trang." }, { icon: Headphones, color: "lavender", title: "Nghe và hỏi bất cứ lúc nào", text: "Học từng phần ngắn. Ngắt lời hoặc hỏi lại khi có chỗ chưa hiểu." }, { icon: Waypoints, color: "mint", title: "Thấy mình tiến bộ", text: "Luyện tập sau bài học và lưu tiến độ để tiếp tục vào lần sau." }].map(({ icon: Icon, color, title, text }, i) => <div className="step-card" key={title}><span className={`step-icon ${color}`}><Icon size={20} /></span><span className="step-number">0{i + 1}</span><h3>{title}</h3><p>{text}</p></div>)}</div>
            <div className="home-bottom-grid"><section className="recent-panel"><div className="section-heading"><h2>{lessons.length ? "Tiếp tục hành trình" : "Bài học của bạn"}</h2>{lessons.length > 0 && <button className="text-button" onClick={() => navigate("roadmap")}>Xem tất cả <ArrowRight size={15} /></button>}</div>{lessons.length ? <div className="recent-lessons">{lessons.slice(0, 3).map((lesson) => <button className="recent-lesson" key={lesson.id} onClick={() => void openLesson(lesson)}><span className="lesson-mini-icon"><BookOpen size={19} /></span><div><strong>{lesson.title}</strong><span>{lesson.segments.length} phần · {lesson.durationMinutes} phút</span></div><ChevronRight size={17} /></button>)}</div> : <div className="small-empty"><BookOpen size={24} /><div><strong>Chưa có bài học nào</strong><p>{materials.length ? "Chọn học liệu trong thư viện để tạo bài học đầu tiên." : "Bài học đầu tiên bắt đầu từ học liệu bạn tải lên."}</p></div>{materials.length > 0 && <button className="text-button" onClick={() => navigate("library")}>Mở thư viện <ArrowRight size={15} /></button>}</div>}</section><section className="thought-card"><span className="quote-mark">“</span><p>Không cần hiểu hết ngay.<br />Chỉ cần tò mò thêm một chút.</p><span>MÂY, CÙNG BẠN HỌC</span></section></div>
            {!state.aiReady && <div className="service-notice"><CircleHelp size={18} /><div><strong>Chưa bật dịch vụ AI</strong><span>Bạn có thể tải và đọc học liệu ngay. Cấu hình dịch vụ AI riêng để tạo bài giảng và hỏi đáp; không cần ChatGPT Plus.</span></div><button className="text-button" onClick={() => navigate("settings")}>Xem cài đặt <ArrowRight size={15} /></button></div>}
          </>}

          {view === "library" && <><div className="page-heading"><div><span className="eyebrow">NHỮNG TRANG KIẾN THỨC CỦA BẠN</span><h1>Thư viện học liệu</h1><p>{state.settings.subject ? `Học liệu dành riêng cho môn ${state.settings.subject}.` : "Mỗi môn học có thư viện và bài giảng riêng."}</p></div><span className="count-pill">{materials.length} học liệu</span></div><div className="library-toolbar"><label className="search-input"><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm trong thư viện…" aria-label="Tìm học liệu" /></label><span className="muted-text">Chọn học liệu để tạo bài học</span></div>{materials.length ? <div className="material-grid">{filtered.map((m) => <article className={`material-card ${selectedIds.includes(m.id) ? "selected" : ""}`} key={m.id}><div className="material-top"><span className={`file-icon ${m.type}`}><FileText size={26} /><small>{m.type.toUpperCase()}</small></span><input type="checkbox" checked={selectedIds.includes(m.id)} onChange={(e) => setSelectedIds((ids) => e.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id))} aria-label={`Chọn ${m.name}`} /></div><h3>{m.name}</h3><p>{m.unitCount} {m.type === "pdf" ? "trang" : "slide"}<span>·</span>{new Date(m.createdAt).toLocaleDateString("vi-VN")}</p><div className="material-actions"><button className="text-button" onClick={() => openMaterial(m.id)}>Đọc học liệu <ArrowRight size={14} /></button><button className="icon-button" disabled={!!downloadingId} onClick={() => void downloadMaterial(m)} aria-label={`Tải xuống ${m.name}`}>{downloadingId === m.id ? <LoaderCircle className="spin" size={16} /> : <ArrowDownToLine size={16} />}</button><button className="icon-button danger" aria-label={`Xóa ${m.name}`} disabled={deleting} onClick={() => { setError(""); setPendingMaterial(m); }}><Trash2 size={16} /></button></div></article>)}<button className="material-add" onClick={openUpload}><span><Plus size={24} /></span><strong>Thêm một học liệu</strong><p>PDF hoặc PowerPoint</p></button></div> : <div className="library-empty" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void uploadFiles(e.dataTransfer.files); }}><span className="empty-icon"><Library size={30} /></span><h2>Thư viện đang chờ những điều hay</h2><p>Thêm giáo trình hoặc bài giảng của bạn.<br />Bạn cũng có thể kéo thả file vào đây.</p><button className="button primary" onClick={openUpload}><Upload size={17} />{state.activeCourseId ? "Tải học liệu đầu tiên" : "Tạo môn học để bắt đầu"}</button></div>}{materials.length > 0 && !filtered.length && <p className="search-empty">Không tìm thấy học liệu phù hợp với “{search}”.</p>}{selectedIds.length > 0 && <div className="create-panel"><div><span className="pill pale"><Check size={13} />Đã chọn {selectedIds.length} học liệu</span><h2>Biến học liệu thành bài giảng</h2><p>Mây chia kiến thức thành từng phần và chuẩn bị câu hỏi luyện tập.</p></div><div className="create-controls"><label htmlFor="lesson-topic">Bạn muốn tập trung vào nội dung nào?</label><input id="lesson-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ví dụ: Ôn chương 1 (không bắt buộc)" /><button className="button primary" disabled={creating || !state.aiReady} onClick={() => void createLesson()}>{creating ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}{creating ? "Đang chuẩn bị bài giảng…" : "Tạo bài học cho tôi"}<ArrowRight size={16} /></button>{!state.aiReady && <span className="field-note">Chưa bật dịch vụ AI. <button onClick={() => navigate("settings")}>Xem cài đặt</button></span>}</div></div>}</>}

          {view === "roadmap" && <><div className="page-heading"><div><span className="eyebrow">TỪNG BƯỚC ĐỀU CÓ Ý NGHĨA</span><h1>Hành trình học tập</h1><p>Những gì bạn đã học và điều đang chờ phía trước.</p></div><button className="button secondary small" onClick={() => navigate("library")}><Plus size={16} />Tạo bài học</button></div><div className="stats-grid">{[{ icon: BookOpen, color: "mint", count: lessons.length, label: "Bài học đã tạo" }, { icon: CheckCheck, color: "peach", count: state.progress.filter((p) => p.completed).length, label: "Bài học hoàn thành" }, { icon: FileText, color: "lavender", count: materials.length, label: "Học liệu trong thư viện" }].map(({ icon: Icon, color, count, label }) => <div key={label}><span className={`stat-icon ${color}`}><Icon size={20} /></span><strong>{count}</strong><p>{label}</p></div>)}</div>{lessons.length ? <div className="roadmap-list">{lessons.map((lesson, i) => { const progress = state.progress.find((p) => p.lessonId === lesson.id); const value = percent(lesson, state.progress); return <article className="roadmap-card" key={lesson.id}><span className={`roadmap-number ${progress?.completed ? "done" : ""}`}>{progress?.completed ? <Check size={20} /> : String(i + 1).padStart(2, "0")}</span><div className="roadmap-copy"><span className="eyebrow">{progress?.completed ? "ĐÃ HOÀN THÀNH" : progress ? "ĐANG HỌC" : "SẴN SÀNG ĐỂ BẮT ĐẦU"}</span><h3>{lesson.title}</h3><p>{lesson.summary}</p><div className="lesson-meta"><span><Layers size={14} />{lesson.segments.length} phần</span><span><Headphones size={14} />Khoảng {lesson.durationMinutes} phút</span>{progress?.score !== undefined && <span><CheckCheck size={14} />Luyện tập: {progress.score}%</span>}</div></div><div className="roadmap-action"><span>{value}%</span><div className="progress-track"><i style={{ width: `${value}%` }} /></div><button className="button secondary small" onClick={() => void openLesson(lesson)}>{progress?.completed ? "Ôn lại bài" : progress ? "Học tiếp" : "Bắt đầu"}<ArrowRight size={15} /></button></div></article>; })}</div> : <div className="library-empty"><span className="empty-icon"><Waypoints size={32} /></span><h2>Hành trình bắt đầu từ một bài học</h2><p>Chọn học liệu trong thư viện để Mây chuẩn bị bài giảng cho bạn.</p><button className="button primary" onClick={() => navigate("library")}>Đến thư viện <ArrowRight size={16} /></button></div>}</>}

          {view === "settings" && <><div className="page-heading"><div><span className="eyebrow">ĐỂ MÂY HIỂU BẠN HƠN</span><h1>Góc học tập của riêng bạn</h1><p>Mỗi môn học có mục tiêu, trình độ và notebook riêng.</p></div></div><AiModelSettings busy={creating || chatBusy || voice.connecting} value={state.aiSettings} onSaved={saveAiSelection} onError={reportError} />{!state.activeCourseId ? <div className="library-empty"><span className="empty-icon"><GraduationCap size={30} /></span><h2>Bắt đầu với môn học đầu tiên</h2><p>Sau đó, bạn có thể thêm những môn khác trong học kỳ.</p><button className="button primary" onClick={() => setCourseOpen(true)}><Plus size={16} />Thêm môn học</button></div> : <form className="settings-form" onSubmit={(e) => void saveSettings(e)}><section className="settings-card"><div className="settings-card-heading"><span className="step-icon mint"><GraduationCap size={21} /></span><div><h2>Hồ sơ môn học</h2><p>Bài giảng được điều chỉnh theo thông tin này.</p></div></div><div className="form-grid"><label>Tên môn học<input required maxLength={120} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="Ví dụ: Thiết kế vi mạch số" /></label><label>Trình độ / học kỳ<input maxLength={120} value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })} placeholder="Ví dụ: Năm 2, học kỳ 1" /></label></div><label className="full-field">Bạn muốn đạt được điều gì?<textarea rows={3} maxLength={1000} value={draft.goal} onChange={(e) => setDraft({ ...draft, goal: e.target.value })} placeholder="Ví dụ: Hiểu kiến thức nền tảng và ôn thi học kỳ." /></label></section><section className="settings-card"><div className="settings-card-heading"><span className="step-icon lavender"><BookOpen size={21} /></span><div><h2>Góc NotebookLM</h2><p>Giữ notebook của môn này trong tầm tay.</p></div><span className="pill neutral">Liên kết ngoài</span></div><label className="full-field">Liên kết notebook<input id="notebook-url" type="text" inputMode="url" maxLength={600} value={draft.notebookUrl} onChange={(e) => setDraft({ ...draft, notebookUrl: e.target.value })} placeholder="https://notebooklm.google.com/notebook/…" /></label><div className="notebook-info"><CircleHelp size={17} /><p>Dán link và bật quyền đọc chỉ giúp bạn mở notebook trên Google. Web chưa đọc hay đồng bộ nội dung NotebookLM cá nhân từ liên kết đó. Để Mây giảng bài và trả lời bằng giọng nói tại đây, tải cùng PDF/PPTX vào thư viện, nhập khóa API, tạo bài học rồi bắt đầu trò chuyện giọng nói.</p></div><a className="text-button" href={notebookHref(draft.notebookUrl)} target="_blank" rel="noopener noreferrer">Mở NotebookLM <ExternalLink size={14} /></a></section><div className="settings-save"><span>Cài đặt được lưu riêng cho môn này.</span><button className="button primary" type="submit" disabled={settingsBusy}>{settingsBusy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{settingsBusy ? "Đang lưu…" : "Lưu cài đặt"}</button></div></form>}<section className="connection-card"><div className="settings-card-heading"><span className="step-icon peach"><AudioLines size={21} /></span><div><h2>Gia sư AI & giọng nói</h2><p>{state.aiReady ? "Đã lưu khóa API cho " + aiProviderName + "." : "Chưa bật dịch vụ AI"}</p></div><span className={`status-pill ${state.aiReady ? "ready" : ""}`}><i />{aiStatus}</span></div><p>{state.aiReady ? "Tạo bài giảng và hỏi đáp cần khóa API hợp lệ, quyền sử dụng model và kết nối Internet. " : "Cấu hình dịch vụ AI riêng để tạo bài giảng và trả lời câu hỏi. Web này không dùng đăng nhập ChatGPT. "}{state.voiceReady ? "Đã có khóa cho giọng nói trực tiếp. Để bắt đầu, cần khóa hợp lệ, quyền dùng model giọng nói và cho phép truy cập micro." : "Bạn vẫn có thể đọc học liệu và nghe nội dung bằng giọng đọc có sẵn của trình duyệt."}</p>{aiSetup}</section></>}

          {view === "classroom" && (activeLesson || sourceId) && <section className="workspace-section"><div className="lesson-heading"><div><button className="text-button back-link" onClick={closeWorkspace}><ArrowLeft size={14} />Về lớp học</button><h1>{activeLesson?.title || sourceDetail?.material.name || "Học liệu của bạn"}</h1><p>{activeLesson ? `Phần ${segmentIndex + 1}/${activeLesson.segments.length} · ${segment?.title || ""}` : "Đọc và nghe nội dung học liệu"}</p></div>{activeLesson && <button className="button secondary small" disabled={progressBusy} onClick={() => void saveProgress(false)}>{progressBusy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Lưu tiến độ</button>}</div>
            {activeLesson && <LessonOutline lesson={activeLesson} index={segmentIndex} onSelect={changeSegment} />}<div className="workspace-mobile-switch" role="group" aria-label="Chọn khung học"><button className={workspacePane === "source" ? "active" : ""} onClick={() => setWorkspacePane("source")}><FileText size={15} />Học liệu</button><button className={workspacePane === "tutor" ? "active" : ""} onClick={() => setWorkspacePane("tutor")}><Cloud size={16} />Gia sư & hỏi đáp</button></div>
            <div className={`teaching-layout study-layout pane-${workspacePane}`}><div className="source-panel"><div className="panel-heading"><div><FileText size={17} /><strong>Học liệu gốc</strong></div><div className="reader-toggle"><button className={readerMode === "text" ? "active" : ""} onClick={() => setReaderMode("text")}>Nội dung</button>{sourceDetail?.material.type === "pdf" && <button className={readerMode === "original" ? "active" : ""} onClick={() => setReaderMode("original")}>Bản gốc</button>}</div></div><div className="source-select"><select value={sourceId} aria-label="Chọn học liệu" onChange={(e) => { stopReading(); setFollowSource(false); void loadSource(e.target.value); }}>{materials.filter((m) => !activeLesson || activeLesson.materialIds.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><ChevronDown size={14} /></div><div className="source-content">{sourceLoading ? <div className="reader-empty"><LoaderCircle className="spin" size={24} /><p>Đang mở học liệu…</p></div> : sourceDetail ? readerMode === "original" && sourceDetail.material.type === "pdf" ? <PdfPagePreview url={sourceDetail.downloadUrl} pageIndex={unit?.index ?? 1} name={sourceDetail.material.name} /> : <article className="source-page"><div className="source-page-label">{unit?.label || "Nội dung"}<span>{sourceDetail.material.type.toUpperCase()}</span></div><div className="source-page-rule" /><p className={!sourceReadable ? "source-visual-note" : ""}>{sourceReadable ? unit?.text : unit?.images?.length ? "Trang này gồm hình. Xem hình bên dưới và hỏi Mây để được giải thích." : unit?.text || "Trang này chưa có nội dung văn bản."}</p><SourceImages images={unit?.images} label={unit?.label} notice={unit?.visualNotice} /><div className="source-footnote"><Cloud size={13} />Nội dung trích từ học liệu của bạn</div></article> : <div className="reader-empty"><FileText size={30} /><p>Chọn học liệu để xem nội dung.</p></div>}</div><div className="reader-footer"><button className="icon-button" aria-label="Trang trước" disabled={sourceIndex === 0 || !sourceDetail} onClick={() => { stopReading(); setFollowSource(false); setSourceIndex((i) => Math.max(0, i - 1)); }}><ChevronLeft size={17} /></button><span>{sourceDetail ? `${unit?.label} · ${sourceIndex + 1}/${sourceDetail.units.length}` : "—"}</span><button className="icon-button" aria-label="Trang tiếp" disabled={!sourceDetail || sourceIndex >= sourceDetail.units.length - 1} onClick={() => { stopReading(); setFollowSource(false); setSourceIndex((i) => i + 1); }}><ChevronRight size={17} /></button>{sourceDetail && <a className="icon-button source-download" href={sourceDetail.downloadUrl} download={sourceDetail.material.name} aria-label="Tải học liệu gốc"><ArrowDownToLine size={16} /></a>}</div></div>
              <div className="tutor-panel"><div className="panel-heading"><div><span className="tutor-small-mark"><Cloud size={17} /></span><strong>Cùng học với Mây</strong></div><span className="tutor-state"><i />{voice.connected ? "Đã kết nối giọng nói" : state.aiReady ? aiStatus : "Chưa bật AI"}</span></div>{activeLesson ? <>
                <ListeningFocus lesson={activeLesson} index={segmentIndex} points={keyPoints} focus={studyFocus} sourceName={focusSourceName} sourceLabel={focusSource?.label} following={followSource} voiceConnected={voice.connected} speaking={voice.speaking} reading={reading} paused={readPaused} boundaryKnown={boundaryKnown} transcript={liveTranscript} onFollow={restoreFollowing} onPoint={askPoint} onAsk={askTutor} />
                <div className="lesson-tabbar" role="tablist" aria-label="Nội dung học"><button id="study-tab-lesson" role="tab" aria-selected={lessonTab === "lesson"} aria-controls="study-panel-lesson" className={lessonTab === "lesson" ? "active" : ""} onClick={() => setLessonTab("lesson")}><BookOpen size={15} />Bài giảng</button><button id="study-tab-chat" role="tab" aria-selected={lessonTab === "chat"} aria-controls="study-panel-chat" className={lessonTab === "chat" ? "active" : ""} onClick={showChat}><MessageCircle size={15} />Hỏi đáp{newChatMessages && lessonTab !== "chat" && <span className="chat-unread-dot" aria-label="Có tin nhắn mới" />}</button><button id="study-tab-quiz" role="tab" aria-selected={lessonTab === "quiz"} aria-controls="study-panel-quiz" className={lessonTab === "quiz" ? "active" : ""} onClick={() => setLessonTab("quiz")}><CheckCheck size={15} />Luyện tập <span>{activeLesson.quiz.length}</span></button></div>
                {lessonTab === "lesson" ? <div id="study-panel-lesson" role="tabpanel" aria-labelledby="study-tab-lesson" className="tutor-scroll lesson-scroll" ref={lessonScrollRef}><div className="lesson-content"><span className="eyebrow">PHẦN {segmentIndex + 1} · CÙNG TÌM HIỂU</span><h2>{segment?.title}</h2><div className="lesson-paragraphs">{paragraphs.map((paragraph, i) => <p key={i} className={reading && readingParagraph === i ? "being-read" : ""}>{reading && readingParagraph === i && <span className="reading-marker"><Volume2 size={13} />Đang đọc đoạn này</span>}{paragraph.text}</p>)}</div><LessonDiagram illustration={segment?.illustration} />{segment && <LinkedSourceImages references={segment.sourceRefs} />}{!!segment?.sourceRefs.length && refs(segment.sourceRefs)}<div className="segment-navigation"><button className="text-button" disabled={segmentIndex === 0} onClick={() => changeSegment(segmentIndex - 1)}><ArrowLeft size={14} />Phần trước</button>{segmentIndex < activeLesson.segments.length - 1 ? <button className="text-button" onClick={() => changeSegment(segmentIndex + 1)}>Tôi hiểu rồi, học tiếp <ArrowRight size={14} /></button> : <button className="text-button" onClick={() => setLessonTab("quiz")}>Thử luyện tập <ArrowRight size={14} /></button>}</div><button className="lesson-ask-link" onClick={() => { showChat(); window.setTimeout(() => chatInputRef.current?.focus(), 50); }}><MessageCircle size={16} />Có chỗ chưa hiểu? Mở khung hỏi đáp<ArrowRight size={15} /></button></div></div> : lessonTab === "chat" ? <div id="study-panel-chat" role="tabpanel" aria-labelledby="study-tab-chat" className="chat-view"><div className="chat-scroll" ref={chatScrollRef} onScroll={event => { chatNearBottom.current = nearChatBottom(event.currentTarget); if (chatNearBottom.current) setNewChatMessages(false); }}>
                  {!messages.length && <div className="chat-intro"><span className="tutor-avatar"><Cloud size={20} /></span><div><strong>Hỏi ngay ở phần đang học</strong><p>Gõ câu hỏi bên dưới hoặc nói qua micro. Bài giảng luôn ở tab bên cạnh để bạn đối chiếu.</p></div></div>}<div className="chat-messages" aria-live="polite" aria-relevant="additions">{messages.map(entry => <div className={`chat-entry ${entry.role}`} key={entry.id}>{entry.role === "assistant" && <span className="tutor-avatar"><Cloud size={16} /></span>}<div><span className="message-author">{entry.role === "assistant" ? "Mây" : "Bạn"}</span><p>{entry.content}</p><LessonDiagram illustration={entry.illustration} />{!!entry.sourceRefs?.length && refs(entry.sourceRefs)}</div></div>)}{chatBusy && <div className="chat-entry assistant" role="status" aria-label="Mây đang trả lời"><span className="tutor-avatar"><Cloud size={16} /></span><span className="typing-dots"><i /><i /><i /></span></div>}</div>
                </div>{newChatMessages && <button className="new-chat-button" onClick={latestChat}><ArrowDown size={14} />Tin nhắn mới</button>}<div className="chat-compose"><div className="quick-prompts">{["Giải thích đơn giản hơn", "Cho tôi một ví dụ", "Giải thích bằng sơ đồ"].map(prompt => <button type="button" key={prompt} disabled={(prompt === "Giải thích bằng sơ đồ" ? !state.aiReady : !state.aiReady && !voice.connected) || chatBusy} onClick={() => prompt === "Giải thích bằng sơ đồ" ? void sendChat(prompt) : askTutor(prompt)}>{prompt}</button>)}</div><label htmlFor="tutor-question">Câu hỏi của bạn <span>Về phần {segmentIndex + 1}: {segment?.title}</span></label><form onSubmit={event => { event.preventDefault(); submitQuestion(); }}><textarea ref={chatInputRef} id="tutor-question" rows={2} aria-label="Câu hỏi cho gia sư" value={message} onChange={event => setMessage(event.target.value)} disabled={!state.aiReady && !voice.connected} placeholder={state.aiReady || voice.connected ? "Tôi chưa hiểu… Hãy giải thích và chỉ phần cần nhìn." : "Nhập khóa API trong Cài đặt để hỏi gia sư"} onKeyDown={event => { if (submitOnEnter(event)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><button type="submit" className="send-button" disabled={!message.trim() || chatBusy || voice.connecting || (!state.aiReady && !voice.connected)}><Send size={16} /><span>Gửi</span></button></form><span className="chat-caption">Enter để gửi · Shift + Enter để xuống dòng · Đối chiếu điểm quan trọng với học liệu.</span></div></div> : <div id="study-panel-quiz" role="tabpanel" aria-labelledby="study-tab-quiz" className="tutor-scroll"><div className="quiz-panel"><span className="eyebrow">THỬ SỨC MỘT CHÚT</span><h2>Kiểm tra điều bạn đã hiểu</h2><p className="muted-text">Chọn câu trả lời. Mây sẽ giải thích sau khi bạn hoàn thành.</p>{activeLesson.quiz.length ? <>{activeLesson.quiz.map((q, i) => <fieldset className="quiz-question" key={i}><legend>{i + 1}. {q.question}</legend>{q.options.map((option, j) => <label key={j} className={`quiz-option ${quizAnswers[i] === j ? "selected" : ""} ${quizSubmitted && j === q.correctIndex ? "correct" : ""} ${quizSubmitted && quizAnswers[i] === j && j !== q.correctIndex ? "incorrect" : ""}`}><input type="radio" name={`quiz-${i}`} disabled={quizSubmitted || progressBusy} checked={quizAnswers[i] === j} onChange={() => setQuizAnswers((answers) => ({ ...answers, [i]: j }))} /><span className="option-letter">{String.fromCharCode(65 + j)}</span><span>{option}</span>{quizSubmitted && j === q.correctIndex && <Check size={16} />}</label>)}{quizSubmitted && <p className="quiz-explanation">{q.explanation}</p>}</fieldset>)}{quizSubmitted ? <div className="quiz-result"><CheckCheck size={27} /><h3>Bạn trả lời đúng {quizScore}%</h3><p>Đọc phần giải thích và hỏi Mây nếu có điều còn băn khoăn.</p><button className="button secondary" onClick={() => { setQuizSubmitted(false); setQuizAnswers({}); }}>Luyện tập lại</button></div> : <button className="button primary" disabled={Object.keys(quizAnswers).length < activeLesson.quiz.length || progressBusy} onClick={() => { void saveProgress(true, quizScore).then(saved => { if (saved) setQuizSubmitted(true); }); }}><CheckCheck size={17} />Kiểm tra & lưu kết quả</button>}</> : <div className="quiz-result"><p>Bài học này chưa có câu hỏi luyện tập.</p><button className="button primary" disabled={progressBusy} onClick={() => void saveProgress(true)}>Đánh dấu đã hoàn thành</button></div>}</div></div>}
              </> : <div className="tutor-without-lesson"><span className="empty-icon"><Headphones size={29} /></span><h2>Từ học liệu đến bài giảng</h2><p>Đọc tài liệu ở bên trái, hoặc tạo bài học để Mây giải thích từng phần và trả lời câu hỏi.</p><button className="button primary" onClick={() => { setSelectedIds([sourceId]); setView("library"); }}><Sparkles size={17} />Tạo bài học từ học liệu này</button><span className="field-note">Bạn có thể nghe nội dung bằng giọng đọc bên dưới.</span></div>}</div></div>
            <div className="voice-bar"><div className="voice-bar-label"><span className={`voice-bar-icon ${voice.speaking || reading ? "playing" : ""}`}><AudioLines size={23} /></span><div><strong>{voice.connected ? voice.speaking ? "Mây đang giảng bài" : "Mây đang lắng nghe" : reading ? readPaused ? "Giọng đọc đang tạm dừng" : "Đang đọc nội dung" : "Học bằng giọng nói"}</strong><span>{voice.connected ? "Bạn có thể ngắt lời để hỏi bất cứ lúc nào" : "Giọng đọc trình duyệt hoặc hội thoại AI có micro"}</span></div></div><div className="voice-controls">{voice.connected ? <><button className="button secondary small" onClick={voice.toggleMute}>{voice.muted ? <MicOff size={17} /> : <Mic size={17} />}{voice.muted ? "Bật micro" : "Tắt micro"}</button><button className="button secondary small" onClick={() => void voice.teach()}><Play size={15} />Giảng phần này</button><button className="button stop-voice small" onClick={voice.stop}><Square size={13} />Kết thúc</button></> : <><div className="read-controls"><button className="button secondary small" onClick={readAloud} disabled={!segment?.explanation && !sourceReadable}>{reading && !readPaused ? <Pause size={15} /> : <Volume2 size={17} />}{reading ? readPaused ? "Tiếp tục" : "Tạm dừng" : activeLesson ? "Nghe bài giảng" : "Nghe học liệu"}</button>{reading && <button className="icon-button" onClick={stopReading} aria-label="Dừng đọc"><Square size={14} /></button>}<select aria-label="Tốc độ giọng đọc" value={readSpeed} disabled={reading} onChange={(e) => setReadSpeed(Number(e.target.value))}><option value="0.8">0.8×</option><option value="1">1×</option><option value="1.2">1.2×</option></select></div><button className="button primary small" disabled={!activeLesson || !state.voiceReady || voice.connecting} onClick={() => { stopReading(); void voice.start(); }}>{voice.connecting ? <LoaderCircle className="spin" size={16} /> : <Mic size={16} />}{voice.connecting ? "Đang kết nối…" : "Trò chuyện bằng giọng nói"}</button></>}</div></div>{!activeLesson && unit && !sourceReadable && <p className="voice-availability">Trang này chứa hình thay cho văn bản. Tạo bài học AI để nghe lời giải thích hình; giọng đọc trình duyệt chỉ đọc được chữ.</p>}{(!state.aiReady || !state.voiceReady) && <p className="voice-availability">{!state.aiReady ? "Chưa bật dịch vụ AI. Giọng đọc trình duyệt vẫn dùng được với nội dung học liệu." : "Chưa bật trò chuyện giọng nói trực tiếp. Bạn có thể nghe bài giảng và hỏi bằng văn bản."}</p>}
          </section>}
        </>}
        {!loading && !activeLesson && !sourceId && <footer className="page-footer"><span><Cloud size={14} />Mây — học để hiểu, từng chút một.</span><span>Dữ liệu riêng trong trình duyệt</span></footer>}
      </main>
    </div>
    <input ref={inputRef} type="file" multiple accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="visually-hidden" onChange={(e) => { if (e.target.files) void uploadFiles(e.target.files); }} />
    {pendingMaterial && <div className="modal-backdrop" onClick={() => { if (!deleting) setPendingMaterial(null); }}><section id="delete-material-dialog" className="delete-modal" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="delete-material-title" aria-describedby="delete-material-description" aria-busy={deleting} onClick={(e) => e.stopPropagation()}><button className="icon-button modal-close" disabled={deleting} aria-label="Đóng cửa sổ xác nhận xóa học liệu" onClick={() => setPendingMaterial(null)}><X size={20} /></button><span className="empty-icon"><Trash2 size={27} /></span><h2 id="delete-material-title">Xóa học liệu này?</h2><p className="delete-material-name">{pendingMaterial.name}</p><p id="delete-material-description">Bài học dùng học liệu này, hội thoại và tiến độ liên quan cũng bị xóa. Tải bản gốc trước nếu cần.</p><div className="delete-modal-actions"><button ref={deleteCancelRef} className="button secondary" disabled={deleting} onClick={() => setPendingMaterial(null)}>Hủy</button><button className="button delete-confirm" disabled={deleting} onClick={() => void deleteMaterial(pendingMaterial)}>{deleting ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{deleting ? "Đang xóa…" : "Xóa học liệu"}</button></div></section></div>}
    {uploadOpen && <div className="modal-backdrop" onClick={() => { if (!uploading) setUploadOpen(false); }}><section className="upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={(e) => e.stopPropagation()}><button className="icon-button modal-close" disabled={uploading} aria-label="Đóng cửa sổ tải học liệu" onClick={() => setUploadOpen(false)}><X size={20} /></button><span className="empty-icon"><Upload size={28} /></span><h2 id="upload-title">Mang học liệu của bạn đến</h2><p>Mây sẽ đọc nội dung để chuẩn bị bài học phù hợp.</p><button className={`upload-dropzone ${dragging ? "dragging" : ""}`} disabled={uploading} onClick={() => inputRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); void uploadFiles(e.dataTransfer.files); }}>{uploading ? <LoaderCircle className="spin" size={31} /> : <span className="upload-plus"><Plus size={25} /></span>}<strong>{uploading ? uploadStep : "Kéo thả học liệu vào đây"}</strong><span>{uploading ? "Giữ cửa sổ này mở trong khi tải học liệu." : "hoặc nhấn để chọn file từ máy tính"}</span><div className="file-types"><span>PDF</span><span>PPTX</span><span>Tối đa 20 MB/file</span></div></button><div className="upload-note"><FileText size={16} /><p>PDF/PPTX giữ hình ảnh để AI cùng đọc và giải thích. Với tài liệu scan, AI đọc hình khi tạo bài giảng; giọng đọc trình duyệt cần văn bản trích xuất.</p></div><span className="modal-privacy">Học liệu được lưu trong trình duyệt này. Khi tạo bài giảng hoặc hỏi AI, nội dung liên quan được gửi đến dịch vụ AI.</span></section></div>}
    {courseOpen && <div className="modal-backdrop" onClick={() => { if (!courseBusy) setCourseOpen(false); }}><section className="course-modal" role="dialog" aria-modal="true" aria-labelledby="course-title" onClick={(e) => e.stopPropagation()}><button className="icon-button modal-close" disabled={courseBusy} aria-label="Đóng cửa sổ tạo môn học" onClick={() => setCourseOpen(false)}><X size={20} /></button><span className="empty-icon"><GraduationCap size={29} /></span><h2 id="course-title">Một góc riêng cho môn học mới</h2><p>Học liệu và tiến độ của từng môn được lưu riêng.</p><form onSubmit={(e) => void createCourse(e)}><label>Tên môn học<input autoFocus required maxLength={120} value={newCourse.subject} onChange={(e) => setNewCourse({ ...newCourse, subject: e.target.value })} placeholder="Ví dụ: Vật lý bán dẫn" /></label><label>Trình độ / học kỳ<input maxLength={120} value={newCourse.level} onChange={(e) => setNewCourse({ ...newCourse, level: e.target.value })} placeholder="Ví dụ: Đại học, học kỳ 1" /></label><label>Mục tiêu học tập<textarea rows={2} maxLength={1000} value={newCourse.goal} onChange={(e) => setNewCourse({ ...newCourse, goal: e.target.value })} placeholder="Bạn muốn hiểu hoặc luyện tập điều gì?" /></label><button type="submit" className="button primary" disabled={courseBusy}>{courseBusy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}{courseBusy ? "Đang tạo…" : "Tạo môn học"}</button></form></section></div>}
    {error && (uploadOpen || courseOpen || !!pendingMaterial) && <div className="modal-error" role="alert"><CircleHelp size={18} /><span>{error}</span><button className="icon-button" aria-label="Đóng thông báo lỗi" onClick={() => setError("")}><X size={16} /></button></div>}
  </div>;
}
