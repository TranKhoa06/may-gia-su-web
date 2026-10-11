"use client";

import { useEffect, useId, useState } from "react";
import { AudioLines, Check, CircleHelp, Cpu, LoaderCircle } from "lucide-react";
import type { AiProvider, AiSettingsState } from "@/lib/types";
import { apiFetch } from "@/lib/client-api";

type Props = {
  value: AiSettingsState;
  onSaved: (state: AiSettingsState) => void;
  onError: (message: string) => void;
  busy?: boolean;
};
type Model = { id: string; label: string };
const CUSTOM_MODEL = "__custom_model__";

export function ModelChoice({ id, label, models, value, onChange }: {
  id: string; label: string; models: Model[]; value: string; onChange: (value: string) => void;
}) {
  const [custom, setCustom] = useState(!models.some(model => model.id === value));
  useEffect(() => { if (!models.some(model => model.id === value)) setCustom(true); }, [models, value]);
  return <div className="ai-model-choice">
    <label htmlFor={id}>{label}</label>
    <select id={id} value={custom ? CUSTOM_MODEL : value} onChange={event => {
      if (event.target.value === CUSTOM_MODEL) setCustom(true);
      else { setCustom(false); onChange(event.target.value); }
    }}>
      {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
      <option value={CUSTOM_MODEL}>Nhập tên model khác…</option>
    </select>
    {custom && <label className="ai-custom-model" htmlFor={`${id}-custom`}>
      Tên model chính xác
      <input id={`${id}-custom`} value={value} onChange={event => onChange(event.target.value)} required maxLength={160}
        pattern="[A-Za-z0-9._\-]+" autoComplete="off" spellCheck={false}
        placeholder="Nhập ID model từ dịch vụ API"
        aria-describedby={`${id}-hint`} />
      <span id={`${id}-hint`} className="field-note">Dùng ID model hỗ trợ tính năng này và có quyền truy cập trong tài khoản API của bạn.</span>
    </label>}
  </div>;
}

export function AiModelSettings({ value, onSaved, onError, busy = false }: Props) {
  const [draft, setDraft] = useState(value.preferences);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState("");
  const [keys, setKeys] = useState<Record<AiProvider, string>>({ gemini: "", openai: "" });
  const [removeKeys, setRemoveKeys] = useState<Record<AiProvider, boolean>>({ gemini: false, openai: false });
  const id = useId();
  useEffect(() => { setDraft(value.preferences); }, [value.preferences]);

  // Auto prefers an available Gemini key, matching the browser API's selection rule.
  const selectedId = draft.provider === "auto"
    ? value.providers.find(provider => provider.id === "gemini")?.keyConfigured ? "gemini" : "openai"
    : draft.provider;
  const selected = value.providers.find(provider => provider.id === selectedId)
    || value.providers.find(provider => provider.id === value.selectedProvider);
  const textField = selected?.id === "gemini" ? "geminiTextModel" : "openaiTextModel";
  const voiceField = selected?.id === "gemini" ? "geminiVoiceModel" : "openaiVoiceModel";
  const changed = JSON.stringify(draft) !== JSON.stringify(value.preferences)
    || keys.gemini.trim() !== "" || keys.openai.trim() !== "" || removeKeys.gemini || removeKeys.openai;

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (saving || testing || busy) return;
    setSaving(true); setNotice("");
    try {
      const credentials: Partial<Record<AiProvider, string>> = {};
      for (const provider of ["gemini", "openai"] as const) {
        if (removeKeys[provider]) credentials[provider] = "";
        else if (keys[provider].trim()) credentials[provider] = keys[provider].trim();
      }
      const response = await apiFetch("/api/ai-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: draft, credentials }),
      });
      const data = await response.json().catch(() => null) as (AiSettingsState & { error?: string }) | null;
      if (!response.ok || !data?.preferences) throw new Error(data?.error || "Chưa lưu được lựa chọn AI. Hãy thử lại.");
      setDraft(data.preferences); onSaved(data);
      setKeys({ gemini: "", openai: "" }); setRemoveKeys({ gemini: false, openai: false });
      setNotice("Đã lưu cài đặt AI trong trình duyệt này. Bạn có thể tạo bài học ngay khi khóa hợp lệ và còn hạn mức.");
    } catch (error) { onError(error instanceof Error ? error.message : "Chưa lưu được lựa chọn AI."); }
    finally { setSaving(false); }
  }

  async function testConnection() {
    if (testing || saving || busy) return;
    setTesting(true); setNotice("");
    try {
      const response = await apiFetch("/api/ai/test", { method: "POST" });
      const result = await response.json() as { message?: string; error?: string; provider?: string; textModel?: string };
      if (!response.ok) throw new Error(result.error || "Chưa kết nối được dịch vụ AI.");
      setNotice(result.message || `Đã kiểm tra kết nối AI với model ${result.textModel || "đã chọn"}.`);
    } catch (error) { onError(error instanceof Error ? error.message : "Chưa kiểm tra được kết nối AI."); }
    finally { setTesting(false); }
  }

  return <form className="settings-form ai-model-settings" onSubmit={event => void save(event)}>
    <section className="settings-card ai-model-card" aria-labelledby={`${id}-heading`}>
      <div className="settings-card-heading">
        <span className="step-icon mint"><Cpu size={21} /></span>
        <div><h2 id={`${id}-heading`}>Chọn dịch vụ và model AI</h2><p>Lựa chọn dùng chung cho các môn học trong trình duyệt này.</p></div>
      </div>
      {busy && <p className="field-note ai-test-hint" role="status">Gia sư đang xử lý yêu cầu. Bạn có thể đổi khóa hoặc model khi hoàn tất.</p>}
      <fieldset disabled={saving || testing || busy} className="ai-model-fields">
        <label htmlFor={`${id}-provider`}>Dịch vụ AI
          <select id={`${id}-provider`} value={draft.provider} onChange={event => {
            setDraft(current => ({ ...current, provider: event.target.value as AiSettingsState["preferences"]["provider"] }));
            setNotice("");
          }}>
            <option value="auto">Tự động chọn dịch vụ có khóa</option>
            {value.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
        </label>
        <div className="ai-key-section">
          <h3>Khóa API của bạn</h3>
          <p>Nhập khóa cho dịch vụ bạn muốn dùng. Chỉ cần nhập lại khi thay khóa hoặc dùng trình duyệt khác.</p>
          <div className="form-grid ai-key-fields">{value.providers.map(provider => <div className="ai-key-field" key={provider.id}>
            <label htmlFor={`${id}-key-${provider.id}`}>Khóa {provider.label}
              <input id={`${id}-key-${provider.id}`} name={`${provider.id}-api-key`} type="password"
                value={keys[provider.id]} disabled={removeKeys[provider.id]} autoComplete="off" spellCheck={false}
                autoCapitalize="none" maxLength={512} aria-describedby={`${id}-key-note`}
                placeholder={provider.keyConfigured ? "Đã lưu khóa — nhập để thay" : "Dán khóa API của bạn"}
                onChange={event => { setKeys(current => ({ ...current, [provider.id]: event.target.value })); setNotice(""); }} />
            </label>
            {provider.keyConfigured && <label className="ai-key-remove">
              <input type="checkbox" checked={removeKeys[provider.id]} onChange={event => {
                setRemoveKeys(current => ({ ...current, [provider.id]: event.target.checked })); setNotice("");
              }} />Xóa khóa đã lưu khi bấm Lưu
            </label>}
          </div>)}</div>
          <p className="field-note" id={`${id}-key-note`}>Khóa chỉ lưu trong trình duyệt này và gửi tới dịch vụ AI khi bạn sử dụng. Không đăng lên GitHub.</p>
        </div>
        {selected && <>
          <div className="ai-selected-provider"><span>Dịch vụ sẽ dùng: <strong>{selected.label}</strong></span>
            <span className={`status-pill ${selected.keyConfigured ? "ready" : ""}`}><i />{selected.keyConfigured ? "Đã cấu hình khóa" : "Chưa có khóa API"}</span>
          </div>
          <div className="form-grid">
            <ModelChoice key={`${selected.id}-text`} id={`${id}-text`} label="Model tạo bài giảng và hỏi đáp"
              value={draft[textField]} models={selected.textModels}
              onChange={model => { setDraft(current => ({ ...current, [textField]: model })); setNotice(""); }} />
            <ModelChoice key={`${selected.id}-voice`} id={`${id}-voice`} label="Model trò chuyện giọng nói"
              value={draft[voiceField]} models={selected.voiceModels}
              onChange={model => { setDraft(current => ({ ...current, [voiceField]: model })); setNotice(""); }} />
          </div>
          <div className="notebook-info ai-model-key-note"><CircleHelp size={17} /><p>{selected.keyConfigured
            ? "Khóa đã được cấu hình. Model chỉ hoạt động khi khóa hợp lệ, có quyền dùng model và còn hạn mức."
            : <>Chưa có khóa cho {selected.label}. Nhập khóa vào ô tương ứng ở trên rồi bấm Lưu. Bạn vẫn có thể lưu lựa chọn model trước.</>}
            <br />OpenAI API và Gemini API có hạn mức hoặc chi phí riêng; không cần ChatGPT Plus để mở web này.</p>
          </div>
        </>}
      </fieldset>
      <div className="settings-save ai-model-save"><span><AudioLines size={15} />Thay đổi áp dụng cho bài giảng, câu trả lời và phiên giọng nói mới.</span>
        <div className="ai-settings-actions"><button className="button secondary" type="button" disabled={saving || testing || changed || busy} onClick={() => void testConnection()}>{testing ? <LoaderCircle className="spin" size={16} /> : <Cpu size={16} />}{testing ? "Đang kiểm tra…" : "Kiểm tra kết nối AI"}</button>
        <button className="button primary" type="submit" disabled={saving || testing || !changed || busy}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? "Đang lưu…" : "Lưu lựa chọn AI"}
        </button></div>
      </div>
      {changed && <p className="field-note ai-test-hint">Lưu khóa và lựa chọn trước khi kiểm tra kết nối. Kiểm tra dùng một yêu cầu API nhỏ; giọng nói được kiểm tra khi bạn bắt đầu phiên học.</p>}
      {notice && <p className="ai-model-saved" role="status"><Check size={15} />{notice}</p>}
    </section>
  </form>;
}
