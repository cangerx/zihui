import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { docsApi, type DocsConfig } from './services/api';
import { ConfigContext } from './contexts/ConfigContext';
import AppShell from './layout/AppShell';
import HomePage from './pages/HomePage';
import CategoryPage from './pages/CategoryPage';
import SearchPage from './pages/SearchPage';
import DocPage from './pages/DocPage';
import DisabledPage from './pages/DisabledPage';
import LoadingScreen from './components/LoadingScreen';

/**
 * 全局尾斜杠纠正器。
 *
 * 背景：React Router v6 的 useHref 在 basename 不为 "/" 且 to="/" 时，会刻意把
 * href 优化成 basename（不带尾斜杠）—— 见源码：
 *   joinedPathname = pathname === "/" ? basename : joinPaths([basename, pathname])
 * 因此在 docs-frontend 里点击 logo / 「全部文档」 / 404 兜底跳根，URL 都会变成
 * `/docs`（无尾斜杠）。在尾斜杠敏感的 nginx 配置下刷新会触发 301 加斜杠 redirect，
 * 而某些反代场景里 redirect 的 Location 会拼出 `域名:端口/docs/` 这种异常 URL。
 *
 * 修复：监听 useLocation，每次 pathname 变到 basename 根（视觉上 "/"）就主动用
 * history.replaceState 把浏览器地址栏改回 `basename + '/'`，不进 history 栈，
 * 不影响 React Router 状态。一处修复覆盖所有 `<Link to="/">` / `<Navigate to="/">`。
 */
function TrailingSlashEnforcer({ basename }: { basename: string }) {
  const location = useLocation();
  useEffect(() => {
    if (basename === '/' || basename === '') return;
    if (window.location.pathname === basename) {
      window.history.replaceState(
        null,
        '',
        basename + '/' + window.location.search + window.location.hash,
      );
    }
  }, [location.pathname, basename]);
  return null;
}

/**
 * docs-frontend 入口。
 *
 * 启动流程：
 * 1. 拉 /api/public/docs/config 决定门控
 *    - enabled=false → 整站显示 DisabledPage（独立路由树）
 *    - enabled=true 但 guest_access=false 且未登录 → 弹"需要登录"提示（暂直接显示 DisabledPage）
 *    - 正常 → 渲染 AppShell + 子路由
 * 2. 拿到 config 后注入 ConfigContext，子组件按 rag_enabled / chat_allow_guest 决定 UI
 *
 * basename 用 vite 的 BASE_URL（生产构建为 /docs/，dev 为 /）
 */
export default function App() {
  const [config, setConfig] = useState<DocsConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    docsApi.getConfig()
      .then((res) => setConfig(res.data))
      .catch((err) => {
        console.error('[docs] load config failed', err);
        setLoadError(err?.response?.data?.message || err?.message || '无法连接到服务器');
      });
  }, []);

  if (loadError) {
    return <DisabledPage variant="error" message={loadError} />;
  }
  if (!config) {
    return <LoadingScreen />;
  }

  // 站点关闭：游客和已登录都看不到
  if (!config.enabled) {
    return <DisabledPage variant="disabled" />;
  }

  // base 路径在生产构建注入；basename 与 vite.config base 保持一致
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

  return (
    <ConfigContext.Provider value={config}>
      <BrowserRouter basename={basename}>
        <TrailingSlashEnforcer basename={basename} />
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="category/:slug" element={<CategoryPage />} />
            <Route path="search" element={<SearchPage />} />
            <Route path="d/:idOrSlug" element={<DocPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigContext.Provider>
  );
}
