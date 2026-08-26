import { Link } from 'react-router-dom';
import type { DocListItem } from '../services/api';

type Props = { doc: DocListItem };

/**
 * 文档卡片：列表 / 搜索结果通用。
 * - 标题点击进详情；slug 优先（更友好的 URL），无 slug 用 id
 * - excerpt 后端已截断 + 关键词标记（前端不做二次处理）
 * - category 标签可点击切换分类（无 category 关联时省略）
 */
export default function DocCard({ doc }: Props) {
  const detailPath = `/d/${doc.slug || doc.id}`;
  return (
    <article className="doc-card">
      <h3 className="doc-card-title">
        <Link to={detailPath}>{doc.title}</Link>
      </h3>
      {doc.subtitle && <p className="doc-card-subtitle">{doc.subtitle}</p>}
      <p className="doc-card-excerpt">{doc.excerpt}</p>
      <div className="doc-card-meta">
        {doc.category && (
          <Link
            to={`/category/${doc.category.slug || doc.category.id}`}
            className="doc-card-tag"
            onClick={(e) => e.stopPropagation()}
          >
            {doc.category.name}
          </Link>
        )}
        <span className="doc-card-date">
          {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString('zh-CN') : ''}
        </span>
        <span className="doc-card-views">浏览 {doc.view_count ?? 0}</span>
      </div>
    </article>
  );
}
