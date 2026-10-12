import { useEffect, useId, useState } from "react";
import { Check, Cpu, LoaderCircle, Settings2 } from "lucide-react";
import type { AiSettingsState } from "@/lib/types";
import { apiFetch } from "@/lib/client-api";
import { AiProfileSelection } from "./ai-profile-selection";

type Props = {
  value: AiSettingsState;
  onSaved: (value: AiSettingsState) => void;
  onError: (message: string) => void;
  onSettings: () => void;
  busy?: boolean;
};

export function TutorModelPicker({ value, onSaved, onError, onSettings, busy = false }: Props) {
  const [draft, setDraft] = useState(value.selection);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const id = useId();
  useEffect(() => { setDraft(value.selection); }, [value.selection]);
  const changed = JSON.stringify(draft) !== JSON.stringify(value.selection);
  const selected = value.profiles.find(profile => profile.id === draft.textProfileId);
  const voiceSelected = value.profiles.find(profile => profile.id === draft.voiceProfileId);

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving || busy || !changed) return;
    setSaving(true); setSaved(false);
    try {
      const response = await apiFetch("/api/ai-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selection: draft }) });
      const data = await response.json() as AiSettingsState & { error?: string };
      if (!response.ok || !data.selection) throw new Error(data.error || "Chưa lưu được cấu hình gia sư.");
      onSaved(data); setDraft(data.selection); setSaved(true);
    } catch (error) { onError(error instanceof Error ? error.message : "Chưa lưu được cấu hình gia sư."); }
    finally { setSaving(false); }
  }

  return <form className="tutor-model-picker" onSubmit={event => void save(event)} aria-labelledby={`${id}-heading`}>
    <div className="tutor-model-heading"><div><Cpu size={19} /><strong id={`${id}-heading`}>Chọn AI hướng dẫn bạn học</strong></div>
      <button type="button" className="text-button" onClick={onSettings}><Settings2 size={14} />Quản lý khóa API và model</button>
    </div>
    <fieldset className="tutor-model-fields tutor-profile-fields" disabled={saving || busy}>
      <AiProfileSelection id={id} profiles={value.profiles} value={draft} onChange={selection => { setDraft(selection); setSaved(false); }} />
    </fieldset>
    <div className="tutor-model-footer"><span role="status">{busy ? "Gia sư đang xử lý yêu cầu. Bạn có thể đổi cấu hình khi hoàn tất."
      : value.profiles.length === 0 ? "Thêm các khóa API trong cài đặt để bắt đầu học với AI."
      : changed ? "Bấm Áp dụng để dùng các cấu hình mới."
      : saved ? "Đã áp dụng cấu hình cho gia sư."
      : !selected ? "Chọn cấu hình giảng bài để bắt đầu."
      : !selected.keyConfigured ? "Cấu hình giảng bài chưa có khóa API. Nhập khóa trong cài đặt."
      : voiceSelected && !voiceSelected.keyConfigured ? "Cấu hình giọng nói chưa có khóa API. Nhập khóa trong cài đặt."
      : "Dùng khóa và model đã chọn. Bạn có thể chọn riêng cấu hình giảng bài và giọng nói."}</span>
      <button type="submit" className="button secondary small" disabled={!changed || saving || busy}>{saving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}{saving ? "Đang lưu…" : "Áp dụng lựa chọn"}</button>
    </div>
  </form>;
}
