"use client";

import { useEffect, useState } from "react";
import { agentAPI } from "@/lib/api";

export default function AgentBrandPage() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    agentAPI
      .getProfile()
      .then((res) => setProfile(res.data?.data || res.data))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setMsg("");
    try {
      await agentAPI.updateProfile({
        site_name: profile.site_name || "",
        site_logo: profile.site_logo || "",
        site_logo_dark: profile.site_logo_dark || "",
        site_favicon: profile.site_favicon || "",
        primary_color: profile.primary_color || "",
        site_copyright: profile.site_copyright || "",
        site_icp: profile.site_icp || "",
      });
      setMsg("保存成功");
    } catch {
      setMsg("保存失败");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6 text-gray-400">加载中...</div>;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">品牌设置</h1>
      <div className="space-y-4">
        <Field label="站点名称" value={profile?.site_name} onChange={(v) => setProfile({ ...profile, site_name: v })} />
        <Field label="Logo URL" value={profile?.site_logo} onChange={(v) => setProfile({ ...profile, site_logo: v })} placeholder="https://..." />
        <Field label="深色 Logo URL" value={profile?.site_logo_dark} onChange={(v) => setProfile({ ...profile, site_logo_dark: v })} />
        <Field label="Favicon URL" value={profile?.site_favicon} onChange={(v) => setProfile({ ...profile, site_favicon: v })} />
        <Field label="主题色" value={profile?.primary_color} onChange={(v) => setProfile({ ...profile, primary_color: v })} placeholder="#6366f1" />
        <Field label="版权信息" value={profile?.site_copyright} onChange={(v) => setProfile({ ...profile, site_copyright: v })} />
        <Field label="ICP备案号" value={profile?.site_icp} onChange={(v) => setProfile({ ...profile, site_icp: v })} />

        {msg && <div className={`text-sm ${msg === "保存成功" ? "text-green-500" : "text-red-500"}`}>{msg}</div>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
      />
    </div>
  );
}
