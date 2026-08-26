import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { docsApi, type DocListItem, type DocCategory } from '../services/api';
import DocCard from '../components/DocCard';

/**
 * 分类页 /category/:slug：URL 段既可能是 slug 也可能是 id（兼容无 slug 分类）。
 *
 * 显示策略：
 * - 顶部展示分类标题
 * - 文档列表按 sort_order DESC 排序（后端默认）
 * - 分页 / 总数信息
 */
export default function CategoryPage() {
  const { slug = '' } = useParams<{ slug: string }>();

  const [items, setItems] = useState<DocListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(20);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [category, setCategory] = useState<DocCategory | null>(null);

  // 分类 slug / id → 名称（从全量分类列表里查一次）
  useEffect(() => {
    docsApi.listCategories()
      .then((res) => {
        const list = res.data?.data || [];
        const hit = list.find((c) => c.slug === slug || String(c.id) === slug);
        setCategory(hit || null);
      })
      .catch((e) => console.warn('[docs] load categories failed', e));
  }, [slug]);

  // 文档列表
  useEffect(() => {
    setLoading(true);
    setErr(null);
    setPage(1);
  }, [slug]);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    const params: Record<string, any> = { page, per_page: perPage };
    if (/^\d+$/.test(slug)) params.category_id = Number(slug);
    else params.category_slug = slug;
    docsApi.list(params)
      .then((res) => {
        setItems(res.data.items || []);
        setTotal(res.data.total || 0);
      })
      .catch((e) => setErr(e?.response?.data?.message || '加载文档失败'))
      .finally(() => setLoading(false));
  }, [slug, page, perPage]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div>
      <h1 className="page-title">{category?.name || '分类'}</h1>
      <p className="page-summary">共 {total} 篇</p>

      {loading && <div className="loading-inline">加载中...</div>}
      {err && <div className="error-inline">{err}</div>}
      {!loading && !err && items.length === 0 && (
        <div className="empty-state"><p>该分类下暂无文档</p></div>
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
