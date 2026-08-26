import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useConfig } from '../contexts/ConfigContext';
import { docsApi, type DocCategory } from '../services/api';
import ChatWidget from '../components/ChatWidget';

/**
 * 全站布局：左侧分类 + 右侧主内容 + 顶部 header（含搜索）+ 右下角问答悬浮窗。
 *
 * 设计取舍：
 * - 桌面：grid layout sidebar=240/auto，sidebar sticky
 * - 移动（<768px）：sidebar 折叠为顶部抽屉式（暂用简单的 details/summary，避免引 react-spring 等动画库）
 * - 分类列表全站只拉一次（这里挂载时拉），子页面如需 category 详细信息再单独拉
 * - ChatWidget 仅在 rag_enabled 时挂载；隐藏后完全 unmount，避免后台占资源
 */
export default function AppShell() {
  const config = useConfig();
  const location = useLocation();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    docsApi.listCategories()
      .then((res) => setCategories(res.data?.data || []))
      .catch((err) => console.warn('[docs] load categories failed', err));
  }, []);

  // 路由切换时同步 search 框（从 /search 离开时清空）
  useEffect(() => {
    if (location.pathname === '/search') {
      const q = new URLSearchParams(location.search).get('q') || '';
      setSearchValue(q);
    } else if (searchValue) {
      // 仅当离开 /search 时清空，不影响其他页打字
      setSearchValue('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchValue.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-logo">
          {config.site_title || '文档中心'}
        </Link>
        <form className="app-search" onSubmit={handleSearchSubmit}>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="搜索文档..."
            aria-label="搜索文档"
          />
          <button type="submit" aria-label="搜索">搜索</button>
        </form>
      </header>

      <div className="app-body">
        <aside className="app-sidebar">
          <details className="sidebar-section" open>
            <summary>文档分类</summary>
            <nav>
              <NavLink to="/" end className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}>
                <span>全部文档</span>
              </NavLink>
              {categories.map((cat) => (
                <NavLink
                  key={cat.id}
                  to={`/category/${cat.slug || cat.id}`}
                  className={({ isActive }) => isActive ? 'sidebar-link active' : 'sidebar-link'}
                >
                  <span>{cat.name}</span>
                  <span className="sidebar-count">{cat.docs_count}</span>
                </NavLink>
              ))}
              {categories.length === 0 && (
                <div className="sidebar-empty">暂无分类</div>
              )}
            </nav>
          </details>
        </aside>

        <main className="app-main">
          <Outlet />
        </main>
      </div>

      {config.rag_enabled && <ChatWidget />}
    </div>
  );
}
