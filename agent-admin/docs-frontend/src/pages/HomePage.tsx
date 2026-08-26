import { useEffect, useState } from 'react';
import { docsApi, type DocListItem } from '../services/api';
import DocCard from '../components/DocCard';

/**
 * 首页：展示「最新 / 全部」文档列表，按 sort_order DESC + id DESC 排序（后端默认）。
 * 不分类筛选，单纯按整站维度展示；分类页 /category/:slug 才会带过滤。
 */
export default function HomePage() {
  const [items, setItems] = useState<DocListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    docsApi.list({ page, per_page: perPage })
      .then((res) => {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
      })
      .catch((e) => setErr(e?.response?.data?.message || '加载文档失败'))
      .finally(() => setLoading(false));
  }, [page, perPage]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div>
      <h1 className="page-title">全部文档</h1>
      <p className="page-summary">共 {total} 篇</p>

      {loading && <div className="loading-inline">加载中...</div>}
      {err && <div className="error-inline">{err}</div>}
      {!loading && !err && items.length === 0 && (
        <div className="empty-state"><p>暂无文档</p></div>
      )}

      <div className="doc-list">
        {items.map((d) => <DocCard key={d.id} doc={d} />)}
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>上一页</button>
          <span>{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>下一页</button>
        </div>
      )}
    </div>
  );
}
