"use client";

import { useState } from "react";
import { agentAPI } from "@/lib/api";
import { useRouter } from "next/navigation";

export default function AgentApplyPage() {
  const router = useRouter();
  const [form, setForm] = useState({ site_name: "", code: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.site_name) {
      setError("请填写所有字段");
      return;
    }
    if (!/^[a-z0-9-]{3,30}$/.test(form.code)) {
      setError("编码只能包含小写字母、数字和横线，3-30个字符");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await agentAPI.apply(form);
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || "申请失败");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="text-4xl">🎉</div>
        <h2 className="text-xl font-semibold">申请已提交</h2>
        <p className="text-gray-500">审核通过后将自动开通您的专属分站</p>
        <button
          className="mt-4 rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
          onClick={() => router.push("/agent")}
        >
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="mb-6 text-2xl font-bold">申请成为代理商</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">站点名称</label>
          <input
            type="text"
            value={form.site_name}
            onChange={(e) => setForm({ ...form, site_name: e.target.value })}
            placeholder="您的品牌名称"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">分站编码</label>
          <input
            type="text"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase() })}
            placeholder="如: myshop"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800"
          />
          <p className="mt-1 text-xs text-gray-400">
            只能包含小写字母、数字和横线，将作为您的子域名
          </p>
        </div>
        {error && <div className="text-sm text-red-500">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "提交中..." : "提交申请"}
        </button>
      </form>
    </div>
  );
}
