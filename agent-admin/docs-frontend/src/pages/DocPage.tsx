import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { docsApi, type DocDetail } from '../services/api';

/**
 * 文档详情页 /d/:idOrSlug
 *
 * 安全：content_html 来自 admin 富文本编辑器，可能包含任意 HTML。
 * 必须用 DOMPurify 清理后再 dangerouslySetInnerHTML，否则 XSS。
 *
 * 渲染：
 * - 标题 / 副标题 / 分类 / 更新时间 / 浏览数（meta 区）
 * - 正文：通过 .doc-content 类应用排版样式（h1/h2/p/blockquote/code/img）
 * - 找不到（404）→ 友好提示 + 返回首页
 */
export default function DocPage() {
  const { idOrSlug = '' } = useParams<{ idOrSlug: string }>();

  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setErr(null);
    docsApi.show(idOrSlug)
      .then((res) => setDoc(res.data))
      .catch((e) => {
        if (e?.response?.status === 404) setErr('not_found');
        else setErr(e?.response?.data?.message || '加载文档失败');
      })
      .finally(() => setLoading(false));
  }, [idOrSlug]);

  if (loading) return <div className="loading-inline">加载中...</div>;

  if (err === 'not_found' || !doc) {
    return (
      <div className="empty-state">
        <h2>文档不存在</h2>
        <p style={{ color: '#666', marginTop: 8 }}>该文档可能已被删除或不可见</p>
        <Link to="/" className="back-link">返回首页</Link>
      </div>
    );
  }

  if (err) {
    return <div className="error-inline">{err}</div>;
  }

  // DOMPurify 配置：默认黑名单已经覆盖 script/iframe/onevent；放行 target/rel 让外链能开新页
  const cleanHtml = DOMPurify.sanitize(doc.content_html || '', {
    ADD_ATTR: ['target', 'rel'],
  });

  return (
    <article className="doc-detail">
      <header className="doc-detail-header">
        <h1>{doc.title}</h1>
        {doc.subtitle && <p className="doc-detail-subtitle">{doc.subtitle}</p>}
        <div className="doc-detail-meta">
          {doc.category && (
            <Link to={`/category/${doc.category.slug || doc.category.id}`} className="doc-card-tag">
              {doc.category.name}
            </Link>
          )}
          <span>更新于 {new Date(doc.updated_at).toLocaleDateString('zh-CN')}</span>
          <span>浏览 {doc.view_count}</span>
        </div>
      </header>
      <div
        className="doc-content"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
      />
    </article>
  );
}
