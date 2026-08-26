"use client";

import { useEffect, useState } from "react";
import { agentAPI } from "@/lib/api";

export default function AgentWithdrawPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ amount: "", method: "alipay", account: "", account_name: "" });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  function fetchData() {
    setLoading(true);
    agentAPI
      .withdrawals()
      .then((res) => setData(res.data))
      .finally(() => setLoading(false));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) {
      setMsg("请输入有效金额");
      return;
    }
    if (!form.account || !form.account_name) {
      setMsg("请填写完整信息");
      return;
    }
    setSubmitting(true);
    setMsg("");
    try {
      await agentAPI.requestWithdrawal({
        amount,
        method: form.method,
        account: form.account,
        account_name: form.account_name,
      });
      setMsg("✅ 提现申请已提交");
      setShowForm(false);
      setForm({ amount: "", method: "alipay", account: "", account_name: "" });
      fetchData();
    } catch (err: any) {
      setMsg(err.response?.data?.error || "提交失败");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="p-6 text-gray-400">加载中...</div>;

  const withdrawals = data?.data || [];
  const available = data?.available ?? 0;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">佣金提现</h1>

      {/* Balance card */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="text-sm text-gray-500">可提现余额</div>
          <div className="mt-1 text-2xl font-bold text-green-600">¥{available.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="text-sm text-gray-500">累计已结算</div>
          <div className="mt-1 text-2xl font-bold">¥{(data?.settled ?? 0).toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <div className="text-sm text-gray-500">累计已提现</div>
          <div className="mt-1 text-2xl font-bold text-gray-500">¥{(data?.withdrawn ?? 0).toFixed(2)}</div>
        </div>
      </div>

      {/* Action */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          disabled={available <= 0}
          className="mb-6 rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          申请提现
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="mb-6 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
          <h3 className="mb-4 font-semibold">提现申请</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-gray-500">提现金额</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder={`最多 ${available.toFixed(2)}`}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">提现方式</label>
              <select
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              >
                <option value="alipay">支付宝</option>
                <option value="wechat">微信</option>
                <option value="bank">银行卡</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">收款账号</label>
              <input
                type="text"
                value={form.account}
                onChange={(e) => setForm({ ...form, account: e.target.value })}
                placeholder="支付宝/微信/银行卡号"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-500">真实姓名</label>
              <input
                type="text"
                value={form.account_name}
                onChange={(e) => setForm({ ...form, account_name: e.target.value })}
                placeholder="收款人真实姓名"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "提交中..." : "确认提现"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm dark:bg-gray-700"
            >
              取消
            </button>
          </div>
        </form>
      )}

      {msg && <div className="mb-4 text-sm text-blue-600">{msg}</div>}

      {/* History */}
      <h2 className="mb-3 text-lg font-semibold">提现记录</h2>
      {withdrawals.length === 0 ? (
        <div className="text-gray-400">暂无提现记录</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium">时间</th>
                <th className="px-4 py-3 text-left font-medium">金额</th>
                <th className="px-4 py-3 text-left font-medium">方式</th>
                <th className="px-4 py-3 text-left font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {withdrawals.map((w: any) => (
                <tr key={w.id}>
                  <td className="px-4 py-3">{new Date(w.created_at).toLocaleString("zh-CN")}</td>
                  <td className="px-4 py-3 font-semibold">¥{w.amount.toFixed(2)}</td>
                  <td className="px-4 py-3">{w.method === "alipay" ? "支付宝" : w.method === "wechat" ? "微信" : "银行卡"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={w.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    pending: { color: "bg-yellow-100 text-yellow-700", label: "待审核" },
    approved: { color: "bg-blue-100 text-blue-700", label: "已审核" },
    paid: { color: "bg-green-100 text-green-700", label: "已打款" },
    rejected: { color: "bg-red-100 text-red-700", label: "已拒绝" },
  };
  const info = map[status] || { color: "bg-gray-100 text-gray-700", label: status };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${info.color}`}>{info.label}</span>;
}
