"use client";

import { useEffect, useState } from "react";
import { agentAPI } from "@/lib/api";

export default function AgentDomainPage() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState("");
  const [msg, setMsg] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    agentAPI
      .getProfile()
      .then((res) => {
        const data = res.data?.data || res.data;
        setProfile(data);
        setDomain(data?.custom_domain || "");
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleBind() {
    if (!domain) return;
    setMsg("");
    try {
      const res = await agentAPI.updateDomain(domain);
      setMsg(res.data?.message || "域名已保存，请添加 DNS 验证记录");
      setProfile({ ...profile, custom_domain: domain, domain_verified: false, domain_verify_txt: res.data?.verify_txt });
    } catch (err: any) {
      setMsg(err.response?.data?.error || "绑定失败");
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setMsg("");
    try {
      const res = await agentAPI.verifyDomain();
      if (res.data?.verified) {
        setMsg("✅ 域名验证成功！");
        setProfile({ ...profile, domain_verified: true });
      } else {
        setMsg("❌ 验证失败: " + (res.data?.error || "DNS记录未检测到"));
      }
    } catch {
      setMsg("验证请求失败");
    } finally {
      setVerifying(false);
    }
  }

  if (loading) return <div className="p-6 text-gray-400">加载中...</div>;

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-6 text-2xl font-bold">域名管理</h1>

      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="text-sm text-gray-500">自动分配子域名</div>
        <div className="mt-1 text-lg font-semibold">{profile?.subdomain || "-"}</div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">自定义域名</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value.toLowerCase())}
              placeholder="agent.example.com"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
            />
            <button
              onClick={handleBind}
              className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              绑定
            </button>
          </div>
        </div>

        {profile?.custom_domain && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
            <div className="mb-2 text-sm font-medium">
              DNS 验证状态: {profile.domain_verified ? "✅ 已验证" : "⏳ 待验证"}
            </div>
            {!profile.domain_verified && (
              <>
                <p className="mb-2 text-xs text-gray-600 dark:text-gray-400">
                  请添加以下 TXT 记录到您的 DNS：
                </p>
                <div className="mb-3 rounded bg-gray-100 p-2 text-xs font-mono dark:bg-gray-800">
                  <div>主机记录: _zihui-verify.{profile.custom_domain}</div>
                  <div>记录值: {profile.domain_verify_txt}</div>
                </div>
                <button
                  onClick={handleVerify}
                  disabled={verifying}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {verifying ? "验证中..." : "验证域名"}
                </button>
              </>
            )}
          </div>
        )}

        {msg && <div className="text-sm text-blue-600">{msg}</div>}
      </div>
    </div>
  );
}
