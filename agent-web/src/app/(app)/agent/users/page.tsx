"use client";

import { useEffect, useState } from "react";
import { agentAPI } from "@/lib/api";

export default function AgentUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    agentAPI
      .users()
      .then((res) => setUsers(res.data?.data || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold">分站用户</h1>

      {loading ? (
        <div className="text-gray-400">加载中...</div>
      ) : users.length === 0 ? (
        <div className="text-gray-400">暂无用户</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium">ID</th>
                <th className="px-4 py-3 text-left font-medium">昵称</th>
                <th className="px-4 py-3 text-left font-medium">邮箱</th>
                <th className="px-4 py-3 text-left font-medium">VIP</th>
                <th className="px-4 py-3 text-left font-medium">注册时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3">{u.id}</td>
                  <td className="px-4 py-3">{u.nickname || "-"}</td>
                  <td className="px-4 py-3">{u.email || "-"}</td>
                  <td className="px-4 py-3">{u.vip_level > 0 ? `VIP${u.vip_level}` : "-"}</td>
                  <td className="px-4 py-3">{new Date(u.created_at).toLocaleDateString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
