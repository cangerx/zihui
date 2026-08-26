"use client";

import { useEffect, useState } from "react";
import { agentAPI } from "@/lib/api";

export default function AgentPackagesPage() {
  const [packages, setPackages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetchPackages();
  }, []);

  function fetchPackages() {
    setLoading(true);
    agentAPI
      .packages()
      .then((res) => setPackages(res.data?.data || []))
      .finally(() => setLoading(false));
  }

  async function handleSave(packageId: number) {
    const price = parseFloat(editPrice);
    if (isNaN(price) || price <= 0) {
      setMsg("请输入有效价格");
      return;
    }
    try {
      await agentAPI.updatePackage({ package_id: packageId, price });
      setMsg("保存成功");
      setEditId(null);
      fetchPackages();
    } catch {
      setMsg("保存失败");
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="mb-6 text-2xl font-bold">套餐定价</h1>
      <p className="mb-4 text-sm text-gray-500">自定义您分站的套餐价格（仅在定价模式为"自定义"时生效）</p>

      {loading ? (
        <div className="text-gray-400">加载中...</div>
      ) : packages.length === 0 ? (
        <div className="text-gray-400">暂无套餐数据</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-4 py-3 text-left font-medium">套餐名称</th>
                <th className="px-4 py-3 text-left font-medium">原价</th>
                <th className="px-4 py-3 text-left font-medium">自定义价格</th>
                <th className="px-4 py-3 text-left font-medium">积分</th>
                <th className="px-4 py-3 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {packages.map((pkg) => (
                <tr key={pkg.id || pkg.package_id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 font-medium">{pkg.package_name}</td>
                  <td className="px-4 py-3 text-gray-500">¥{pkg.original_price}</td>
                  <td className="px-4 py-3">
                    {editId === pkg.package_id ? (
                      <input
                        type="number"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                        className="w-24 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                        autoFocus
                      />
                    ) : (
                      <span className="font-semibold text-blue-600">¥{pkg.price}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{pkg.credits}</td>
                  <td className="px-4 py-3">
                    {editId === pkg.package_id ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSave(pkg.package_id)}
                          className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-700"
                        >
                          保存
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="rounded bg-gray-200 px-3 py-1 text-xs dark:bg-gray-700"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditId(pkg.package_id); setEditPrice(String(pkg.price)); }}
                        className="rounded bg-gray-100 px-3 py-1 text-xs hover:bg-gray-200 dark:bg-gray-700"
                      >
                        修改价格
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {msg && <div className="mt-4 text-sm text-green-600">{msg}</div>}
    </div>
  );
}
