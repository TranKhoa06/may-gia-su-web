import type { AiProfile, AiSettingsState } from "@/lib/types";

type Props = {
  id: string;
  profiles: AiProfile[];
  value: AiSettingsState["selection"];
  onChange: (value: AiSettingsState["selection"]) => void;
};

function profileOption(profile: AiProfile, voice: boolean) {
  return `${profile.label} · ${profile.provider === "gemini" ? "Gemini" : "OpenAI"} · ${voice ? profile.voiceModel : profile.textModel}${profile.keyConfigured ? "" : " · chưa lưu khóa"}`;
}

export function AiProfileSelection({ id, profiles, value, onChange }: Props) {
  const voiceProfiles = profiles.filter(profile => profile.voiceModel !== null);
  const selectedText = profiles.find(profile => profile.id === value.textProfileId);
  const selectedVoice = voiceProfiles.find(profile => profile.id === value.voiceProfileId);
  return <div className="form-grid ai-profile-selection">
    <label htmlFor={`${id}-text`}>Giảng bài và hỏi đáp<select id={`${id}-text`} value={selectedText?.id || ""} onChange={event => onChange({ ...value, textProfileId: event.target.value || null })}>
      <option value="">{profiles.length ? "Chọn cấu hình để giảng bài" : "Chưa có cấu hình AI"}</option>
      {profiles.map(profile => <option key={profile.id} value={profile.id}>{profileOption(profile, false)}</option>)}
    </select></label>
    <label htmlFor={`${id}-voice`}>Trò chuyện giọng nói<select id={`${id}-voice`} value={selectedVoice?.id || ""} onChange={event => onChange({ ...value, voiceProfileId: event.target.value || null })}>
      <option value="">Chỉ dùng chức năng đọc bài của trình duyệt</option>
      {voiceProfiles.map(profile => <option key={profile.id} value={profile.id}>{profileOption(profile, true)}</option>)}
    </select></label>
  </div>;
}
