import { useEffect, useId, useState } from "react";
import { Check, Cpu, LoaderCircle, Settings2 } from "lucide-react";
import type { AiPreferences, AiSettingsState } from "@/lib/types";
import { apiFetch } from "@/lib/client-api";
import { ModelChoice } from "./ai-model-settings";

type Props = {
  value: AiSettingsState;
  onSaved: (value: AiSettingsState) => void;
  onError: (message: string) => void;
  onSettings: () => void;
  busy?: boolean;
};

export function TutorModelPicker({ value, onSaved, onError, onSettings, busy = false }: Props) {
  const [draft, setDraft] = useState(value.preferences);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const id = useId();
  useEffect(() => { setDraft(value.preferences); }, [value.preferences]);
  const selectedId = draft.provider === "auto"
    ? value.providers.find(provider => provider.id === "gemini")?.keyConfigured ? "gemini" : "openai"
    : draft.provider;
  const selected = value.providers.find(provider => provider.id === selectedId);
  const textField = selectedId === "gemini" ? "geminiTextModel" : "openaiTextModel";
  const voiceField = selectedId === "gemini" ? "geminiVoiceModel" : "openaiVoiceModel";
  const changed = JSON.stringify(draft) !== JSON.stringify(value.preferences);
  const update = (changes: Partial<AiPreferences>) => { setDraft(current => ({ ...current, ...changes })); setSaved(false); };

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving || busy || !changed) return;
    setSaving(true); setSaved(false);
    try {
      const response = await apiFetch("/api/ai-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ preferences: draft }) });
      const data = await response.json() as AiSettingsState & { error?: string };
      if (!response.ok || !data.preferences) throw new Error(data.error || "Chưa lưu được model gia sư.");
      onSaved(data); setDraft(data.preferences); setSaved(true);
    } catch (error) { onError(error instanceof Error ? error.message : "Chưa lưu được model gia sư."); }
    finally { setSaving(false); }
  }

  return <form className="tutor-model-picker" onSubmit={event => void save(event)} aria-labelledby={`${id}-heading`}>
    <div className="tutor-model-heading"><div><Cpu size={19} /><strong id={`${id}-heading`}>Chọn AI hướng dẫn bạn học</strong></div>
      <button type="button" className="text-button" onClick={onSettings}><Settings2 size={14} />Khóa API & cài đặt</button>
    </div>
    <fieldset className="tutor-model-fields" disabled={saving || busy}>
      <label htmlFor={`${id}-provider`}>Dịch vụ AI<select id={`${id}-provider`} value={draft.provider} onChange={event => update({ provider: event.target.value as AiPreferences["provider"] })}>
        <option value="auto">Tự động chọn dịch vụ có khóa</option>{value.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
      </select></label>
      {selected && <><ModelChoice id={`${id}-text`} key={`${selected.id}-text`} label="Model giảng bài & hỏi đáp" models={selected.textModels} value={draft[textField]} onChange={model => update({ [textField]: model })} />
        <ModelChoice id={`${id}-voice`} key={`${selected.id}-voice`} label="Model trò chuyện giọng nói" models={selected.voiceModels} value={draft[voiceField]} onChange={model => update({ [voiceField]: model })} /></>}
    </fieldset>
    <div className="tutor-model-footer"><span role="status">{busy ? "Gia sư đang xử lý yêu cầu. Bạn có thể đổi model khi hoàn tất." : changed ? "Bấm Áp dụng để dùng lựa chọn mới." : saved ? "Đã áp dụng model cho gia sư." : selected?.keyConfigured ? "Đã lưu khóa. Khóa hợp lệ và hạn mức được kiểm tra khi dùng AI." : "Chưa có khóa cho dịch vụ này. Nhập khóa trong cài đặt để bắt đầu."}</span>
      <button type="submit" className="button secondary small" disabled={!changed || saving || busy}>{saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{saving ? "Đang lưu…" : "Áp dụng model"}</button>
    </div>
  </form>;
}
