import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { docsApi, type DocListItem } from '../services/api';
import DocCard from '../components/DocCard';

/**
 * 搜索页 /search?q=xxx：
 * - 后端用 LIKE 全文搜索 title / subtitle / content_plain，返回带摘要的列表
 * - URL 参数变化时重置 page=1
 * - 没有"高级筛选"，简洁直观
 */
export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';

  const [items, setItems] = useState<DocListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // q 变化时重置 page
  useEffect(() => { setPage(1); }, [q]);

  useEffect(() => {
    if (!q) {
      setItems([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    setErr(null);
    docsApi.list({ keyword: q, page, per_page: perPage })
      .then((res) => {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
      })
      .catch((e) => setErr(e?.response?.data?.message || '搜索失败'))
      .finally(() => setLoading(false));
  }, [q, page, perPage]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div>
      <h1 className="page-title">搜索结果</h1>
      <p className="page-summary">
        {q
          ? <>关键词「<b>{q}</b>」共 {total} 条结果</>
          : '请在顶部搜索框输入关键词'}
      </p>

      {loading && <div className="loading-inline">搜索中...</div>}
      {err && <div className="error-inline">{err}</div>}
      {!loading && !err && q && items.length === 0 && (
        <div className="empty-state"><p>未找到匹配的文档，换个关键词试试</p></div>
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
