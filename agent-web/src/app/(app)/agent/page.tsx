"use client";

import { useEffect, useState } from "react";
import { agentAPI } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useRouter } from "next/navigation";

export default function AgentDashboard() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    agentAPI
      .stats()
      .then((res) => setStats(res.data))
      .catch((err) => {
        if (err.response?.status === 403) {
          setError("not_agent");
        } else {
          setError("failed");
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    );
  }

  if (error === "not_agent") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <h2 className="text-xl font-semibold">您还不是代理商</h2>
        <p className="text-gray-500">申请成为代理商，拥有专属品牌分站</p>
        <button
          className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
          onClick={() => router.push("/agent/apply")}
        >
          立即申请
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-400">加载失败</div>
      </div>
    );
  }

  const agent = stats?.agent;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold">代理商面板</h1>

      {/* Stats cards */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="分站用户" value={stats?.user_count ?? 0} />
        <StatCard label="总收入" value={`¥${(stats?.total_revenue ?? 0).toFixed(2)}`} />
        <StatCard label="累计佣金" value={`¥${(stats?.total_commission ?? 0).toFixed(2)}`} />
        <StatCard label="待结算" value={`¥${(stats?.pending_commission ?? 0).toFixed(2)}`} />
      </div>

      {/* Agent info */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-4 text-lg font-semibold">基本信息</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <InfoRow label="编码" value={agent?.code} />
          <InfoRow label="站点名称" value={agent?.site_name || "-"} />
          <InfoRow label="子域名" value={agent?.subdomain} />
          <InfoRow label="自定义域名" value={agent?.custom_domain || "未绑定"} />
          <InfoRow label="定价模式" value={agent?.pricing_mode === "custom" ? "自定义定价" : "佣金分成"} />
          <InfoRow label="佣金比例" value={`${((agent?.commission_rate ?? 0) * 100).toFixed(0)}%`} />
          <InfoRow label="状态" value={agent?.status} />
        </div>
      </div>

      {/* Quick links */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <QuickLink href="/agent/brand" label="品牌设置" />
        <QuickLink href="/agent/domain" label="域名管理" />
        <QuickLink href="/agent/packages" label="套餐定价" />
        <QuickLink href="/agent/users" label="用户管理" />
        <QuickLink href="/agent/withdraw" label="佣金提现" />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-gray-500">{label}:</span>
      <span className="text-sm font-medium">{value || "-"}</span>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      className="flex items-center justify-center rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:border-blue-500 hover:text-blue-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
    >
      {label}
    </a>
  );
}
