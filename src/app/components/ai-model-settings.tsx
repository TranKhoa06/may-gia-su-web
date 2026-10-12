"use client";

import { useEffect, useId, useState } from "react";
import { AudioLines, Check, CircleHelp, Cpu, KeyRound, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import type { AiProfile, AiProvider, AiSettingsState } from "@/lib/types";
import { apiFetch } from "@/lib/client-api";
import { AiProfileSelection } from "./ai-profile-selection";

type Props = {
  value: AiSettingsState;
  onSaved: (state: AiSettingsState) => void;
  onError: (message: string) => void;
  busy?: boolean;
};
type Model = { id: string; label: string };
const CUSTOM_MODEL = "__custom_model__";
const MAX_PROFILES = 20;
const providerName = (provider: AiProvider) => provider === "gemini" ? "Google Gemini" : "OpenAI";

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
  const [profiles, setProfiles] = useState<AiProfile[]>(value.profiles);
  const [selection, setSelection] = useState(value.selection);
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [addProvider, setAddProvider] = useState<AiProvider>("gemini");
  const [bulkProvider, setBulkProvider] = useState<AiProvider>("gemini");
  const [bulkKeys, setBulkKeys] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [testNotices, setTestNotices] = useState<Record<string, string>>({});
  const id = useId();
  useEffect(() => {
    setProfiles(value.profiles); setSelection(value.selection); setKeys({});
    setDeleteId(null); setTestNotices({});
  }, [value.profiles, value.selection]);
  const changed = JSON.stringify(profiles) !== JSON.stringify(value.profiles)
    || JSON.stringify(selection) !== JSON.stringify(value.selection)
    || Object.values(keys).some(key => key.trim() !== "");
  const disabled = saving || testingId !== null || busy;

  function newProfile(provider: AiProvider, existing: AiProfile[]): AiProfile {
    const service = value.providers.find(item => item.id === provider);
    let number = 1;
    const prefix = provider === "gemini" ? "Gemini" : "OpenAI";
    while (existing.some(profile => profile.label === `${prefix} ${number}`)) number++;
    return {
      id: crypto.randomUUID(), label: `${prefix} ${number}`, provider, keyConfigured: false,
      textModel: service?.textModels[0]?.id || (provider === "gemini" ? value.preferences.geminiTextModel : value.preferences.openaiTextModel),
      voiceModel: service?.voiceModels[0]?.id || null,
    };
  }

  function updateProfile(profileId: string, changes: Partial<AiProfile>) {
    setProfiles(current => current.map(profile => profile.id === profileId ? { ...profile, ...changes } : profile));
    if (changes.voiceModel === null) setSelection(current => ({ ...current, voiceProfileId: current.voiceProfileId === profileId ? null : current.voiceProfileId }));
    setNotice(""); setTestNotices(current => ({ ...current, [profileId]: "" }));
  }

  function appendProfiles(added: AiProfile[], pasted: Record<string, string> = {}) {
    setProfiles(current => [...current, ...added]); setKeys(current => ({ ...current, ...pasted }));
    setSelection(current => ({
      textProfileId: current.textProfileId || (profiles.length === 0 ? added[0]?.id || null : null),
      voiceProfileId: current.voiceProfileId || (profiles.length === 0 ? added.find(profile => profile.voiceModel)?.id || null : null),
    }));
    setNotice("");
  }

  function addProfile() {
    if (disabled || profiles.length >= MAX_PROFILES) return;
    appendProfiles([newProfile(addProvider, profiles)]);
  }

  function importKeys() {
    if (disabled) return;
    const lines = [...new Set(bulkKeys.split(/\r?\n/).map(key => key.trim()).filter(Boolean))];
    if (!lines.length) { onError("Dán ít nhất một khóa API, mỗi khóa trên một dòng."); return; }
    if (lines.some(key => key.length > 4000 || /\s/.test(key))) { onError("Mỗi dòng chỉ chứa một khóa API, không có dấu cách hoặc nhãn kèm theo."); return; }
    if (profiles.length + lines.length > MAX_PROFILES) {
      onError(`Bạn có thể lưu tối đa ${MAX_PROFILES} cấu hình. Hiện còn ${MAX_PROFILES - profiles.length} chỗ trống.`); return;
    }
    const added: AiProfile[] = [];
    const pasted: Record<string, string> = {};
    for (const key of lines) {
      const profile = newProfile(bulkProvider, [...profiles, ...added]);
      added.push(profile); pasted[profile.id] = key;
    }
    appendProfiles(added, pasted); setBulkKeys(""); setBulkOpen(false);
    setNotice(`Đã thêm ${added.length} cấu hình ${providerName(bulkProvider)}. Chọn model cho từng cấu hình rồi bấm Lưu.`);
  }

  function deleteProfile(profileId: string) {
    if (disabled) return;
    setProfiles(current => current.filter(profile => profile.id !== profileId));
    setKeys(current => { const next = { ...current }; delete next[profileId]; return next; });
    setSelection(current => ({
      textProfileId: current.textProfileId === profileId ? null : current.textProfileId,
      voiceProfileId: current.voiceProfileId === profileId ? null : current.voiceProfileId,
    }));
    setDeleteId(null); setNotice("Đã bỏ cấu hình khỏi danh sách. Bấm Lưu để xóa cấu hình và khóa đã lưu.");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (disabled || !changed) return;
    if (bulkKeys.trim()) { onError("Bạn còn khóa trong ô dán nhiều khóa. Bấm Thêm các khóa trước khi lưu hoặc xóa nội dung ô đó."); return; }
    setSaving(true); setNotice("");
    try {
      const response = await apiFetch("/api/ai-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profiles: profiles.map(({ id: profileId, label, provider, textModel, voiceModel }) => ({
            id: profileId, label: label.trim(), provider, textModel, voiceModel,
            ...(keys[profileId]?.trim() ? { apiKey: keys[profileId].trim() } : {}),
          })), selection,
        }),
      });
      const data = await response.json().catch(() => null) as (AiSettingsState & { error?: string }) | null;
      if (!response.ok || !data?.profiles || !data.selection) throw new Error(data?.error || "Chưa lưu được các cấu hình AI. Hãy thử lại.");
      setProfiles(data.profiles); setSelection(data.selection); setKeys({}); setTestNotices({}); onSaved(data);
      setNotice("Đã lưu các khóa và model trong trình duyệt này. Bạn có thể đổi cấu hình đang dùng ở ngay trong lớp học.");
    } catch (error) { onError(error instanceof Error ? error.message : "Chưa lưu được cấu hình AI."); }
    finally { setSaving(false); }
  }

  async function testConnection(profile: AiProfile) {
    if (disabled || changed || !profile.keyConfigured) return;
    setTestingId(profile.id); setTestNotices(current => ({ ...current, [profile.id]: "" }));
    try {
      const response = await apiFetch("/api/ai/test", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: profile.id }),
      });
      const result = await response.json() as { message?: string; error?: string; textModel?: string };
      if (!response.ok) throw new Error(result.error || "Chưa kết nối được dịch vụ AI.");
      setTestNotices(current => ({ ...current, [profile.id]: result.message || `Đã kết nối với model ${result.textModel || profile.textModel}.` }));
    } catch (error) { onError(error instanceof Error ? error.message : "Chưa kiểm tra được kết nối AI."); }
    finally { setTestingId(null); }
  }

  return <form className="settings-form ai-model-settings" onSubmit={event => void save(event)}>
    <section className="settings-card ai-model-card" aria-labelledby={`${id}-heading`}>
      <div className="settings-card-heading">
        <span className="step-icon mint"><Cpu size={21} /></span>
        <div><h2 id={`${id}-heading`}>Các khóa API và model của bạn</h2><p>Lưu nhiều cấu hình, mỗi cấu hình gồm một khóa và các model muốn dùng.</p></div>
      </div>
      {busy && <p className="field-note ai-test-hint" role="status">Gia sư đang xử lý yêu cầu. Bạn có thể đổi khóa hoặc model khi hoàn tất.</p>}
      <fieldset disabled={disabled} className="ai-model-fields ai-profile-fields">
        <div className="ai-profile-selection-card">
          <h3>Cấu hình đang dùng để học</h3>
          <AiProfileSelection id={`${id}-active`} profiles={profiles} value={selection} onChange={next => { setSelection(next); setNotice(""); }} />
          <p className="field-note">Bạn có thể dùng một khóa/model để tạo bài giảng và một khóa/model khác để trò chuyện giọng nói.</p>
        </div>
        <div className="ai-profile-list-heading"><div><h3>Danh sách cấu hình AI</h3><p>{profiles.length}/{MAX_PROFILES} cấu hình · Có thể thêm nhiều khóa của cùng một dịch vụ.</p></div>
          <button className="text-button" type="button" onClick={() => { setBulkOpen(current => !current); setNotice(""); }}><KeyRound size={15} />{bulkOpen ? "Đóng ô dán nhiều khóa" : "Dán nhiều khóa cùng lúc"}</button>
        </div>
        {bulkOpen && <div className="ai-bulk-import">
          <label htmlFor={`${id}-bulk-provider`}>Dịch vụ của các khóa này<select id={`${id}-bulk-provider`} value={bulkProvider} onChange={event => setBulkProvider(event.target.value as AiProvider)}>
            {value.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select></label>
          <label htmlFor={`${id}-bulk-keys`}>Dán các khóa API, mỗi khóa một dòng<textarea id={`${id}-bulk-keys`} className="ai-bulk-secrets" value={bulkKeys} onChange={event => setBulkKeys(event.target.value)} rows={4}
            maxLength={MAX_PROFILES * 4001} autoComplete="off" spellCheck={false} autoCapitalize="none" placeholder="Mỗi dòng là một khóa API" aria-describedby={`${id}-bulk-hint`} /></label>
          <div className="ai-bulk-footer"><p className="field-note" id={`${id}-bulk-hint`}>Mỗi khóa sẽ thành một cấu hình riêng. Các ký tự được che; không dán tên model hoặc nhãn trên cùng dòng.</p>
            <button className="button secondary small" type="button" disabled={!bulkKeys.trim()} onClick={importKeys}><Plus size={15} />Thêm các khóa</button>
          </div>
        </div>}
        <div className="ai-profiles-list">{profiles.map((profile, index) => {
          const service = value.providers.find(provider => provider.id === profile.provider);
          const profileId = `${id}-profile-${profile.id}`;
          return <section className="ai-profile-card" key={profile.id} aria-labelledby={`${profileId}-heading`}>
            <div className="ai-profile-heading"><div><span className="ai-profile-number">{index + 1}</span><h4 id={`${profileId}-heading`}>{providerName(profile.provider)}</h4>
              <span className={`status-pill ${profile.keyConfigured ? "ready" : ""}`}><i />{keys[profile.id]?.trim() ? "Khóa mới chưa lưu" : profile.keyConfigured ? "Đã lưu khóa" : "Chưa nhập khóa"}</span></div>
              <button className="text-button ai-profile-delete" type="button" onClick={() => setDeleteId(profile.id)} aria-label={`Xóa cấu hình ${profile.label}`}><Trash2 size={15} />Xóa</button>
            </div>
            <div className="form-grid ai-profile-key-row">
              <label htmlFor={`${profileId}-name`}>Tên dễ nhớ<input id={`${profileId}-name`} value={profile.label} onChange={event => updateProfile(profile.id, { label: event.target.value })} required maxLength={80} placeholder="Ví dụ: Gemini học hằng ngày" /></label>
              <label htmlFor={`${profileId}-key`}>Khóa API {providerName(profile.provider)}<input id={`${profileId}-key`} name={`api-key-${profile.id}`} type="password"
                value={keys[profile.id] || ""} autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={4000} required={!profile.keyConfigured}
                placeholder={profile.keyConfigured ? "Đã lưu khóa — nhập để thay" : "Dán khóa API cho cấu hình này"}
                onChange={event => { setKeys(current => ({ ...current, [profile.id]: event.target.value })); setNotice(""); }} /></label>
            </div>
            <div className="form-grid ai-profile-model-row">
              <ModelChoice id={`${profileId}-text`} label="Model tạo bài giảng và hỏi đáp" value={profile.textModel} models={service?.textModels || []}
                onChange={textModel => updateProfile(profile.id, { textModel })} />
              <div className="ai-profile-voice"><label className="ai-voice-enabled"><input type="checkbox" checked={profile.voiceModel !== null} onChange={event => updateProfile(profile.id, { voiceModel: event.target.checked ? service?.voiceModels[0]?.id || "" : null })} />Thêm model trò chuyện giọng nói</label>
                {profile.voiceModel !== null && <ModelChoice id={`${profileId}-voice`} label="Model trò chuyện giọng nói" value={profile.voiceModel} models={service?.voiceModels || []}
                  onChange={voiceModel => updateProfile(profile.id, { voiceModel })} />}
                {profile.voiceModel === null && <p className="field-note">Cấu hình này chỉ dùng để tạo bài giảng và hỏi đáp.</p>}
              </div>
            </div>
            {deleteId === profile.id && <div className="ai-profile-delete-confirm" role="group" aria-label={`Xác nhận xóa ${profile.label}`}><p>Xóa “{profile.label}” và khóa của cấu hình này khi bấm Lưu?</p>
              <div><button type="button" className="button secondary small" onClick={() => setDeleteId(null)}><X size={14} />Giữ lại</button>
                <button type="button" className="button secondary small ai-danger-button" onClick={() => deleteProfile(profile.id)}><Trash2 size={14} />Xác nhận xóa</button></div>
            </div>}
            <div className="ai-profile-test"><span className="field-note">{changed ? "Lưu các thay đổi trước khi kiểm tra." : "Kiểm tra dùng một yêu cầu API nhỏ với khóa và model của cấu hình này."}</span>
              <button className="button secondary small" type="button" disabled={disabled || changed || !profile.keyConfigured} onClick={() => void testConnection(profile)}>
                {testingId === profile.id ? <LoaderCircle className="spin" size={15} /> : <Cpu size={15} />}{testingId === profile.id ? "Đang kiểm tra…" : "Kiểm tra cấu hình"}
              </button>
            </div>
            {testNotices[profile.id] && <p className="ai-model-saved" role="status"><Check size={15} />{testNotices[profile.id]}</p>}
          </section>;
        })}</div>
        {profiles.length === 0 && <div className="ai-profiles-empty"><KeyRound size={24} /><h3>Thêm khóa API đầu tiên</h3><p>Chọn dịch vụ ở dưới rồi thêm cấu hình, hoặc dán nhiều khóa cùng lúc.</p></div>}
        <div className="ai-profile-add"><label htmlFor={`${id}-add-provider`}>Dịch vụ cho cấu hình mới<select id={`${id}-add-provider`} value={addProvider} onChange={event => setAddProvider(event.target.value as AiProvider)}>
          {value.providers.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
        </select></label><button className="button secondary" type="button" disabled={profiles.length >= MAX_PROFILES} onClick={addProfile}><Plus size={16} />Thêm cấu hình AI</button></div>
        <div className="notebook-info ai-model-key-note"><CircleHelp size={17} /><p>Khóa chỉ lưu trong trình duyệt này và gửi tới dịch vụ AI khi bạn sử dụng. Ô khóa đã lưu luôn để trống; chỉ nhập lại khi muốn thay khóa. Không đăng khóa lên GitHub.
          <br />Khóa cần có quyền dùng model và còn hạn mức. Gemini API và OpenAI API có hạn mức hoặc chi phí riêng.</p></div>
      </fieldset>
      <div className="settings-save ai-model-save"><span><AudioLines size={15} />Lựa chọn áp dụng cho bài giảng, câu trả lời và phiên giọng nói mới.</span>
        <button className="button primary" type="submit" disabled={disabled || !changed}>
          {saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? "Đang lưu…" : "Lưu các cấu hình AI"}
        </button>
      </div>
      {notice && <p className="ai-model-saved" role="status"><Check size={15} />{notice}</p>}
    </section>
  </form>;
}
