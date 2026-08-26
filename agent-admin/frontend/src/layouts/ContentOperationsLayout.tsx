import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button, Tabs, message } from 'antd';
import { sharedHubApi } from '../services/api';

type ContentSection = {
  title: string;
  description: string;
  routes: {
    manage: string;
    market: string;
    review: string;
  };
};

const CONTENT_SECTIONS: ContentSection[] = [
  {
    title: '数字员工',
    description: '管理本站数字员工，并连接跨站共享市场与审核流程。',
    routes: {
      manage: '/agents',
      market: '/agent-hub/browse',
      review: '/agent-hub/pending',
    },
  },
  {
    title: '灵感内容',
    description: '维护本站灵感内容，并浏览、拉取和审核跨站共享内容。',
    routes: {
      manage: '/inspirations',
      market: '/inspiration-hub/browse',
      review: '/inspiration-hub/pending',
    },
  },
  {
    title: '工作流模板',
    description: '管理图片工作流模板，并连接模板共享市场与审核流程。',
    routes: {
      manage: '/creative-templates',
      market: '/creative-template-hub/browse',
      review: '/creative-template-hub/pending',
    },
  },
];

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export default function ContentOperationsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const [importedAt, setImportedAt] = useState<string | null>(null);
  const section = CONTENT_SECTIONS.find(({ routes }) =>
    Object.values(routes).some((route) => matchesRoute(location.pathname, route)),
  );

  useEffect(() => {
    sharedHubApi.status().then((res) => {
      setImportedAt(res.data?.imported_at || null);
    }).catch(() => {});
  }, []);

  const syncOnce = async () => {
    if (importedAt) {
      message.info('本地客户端只做第一次同步，已经灌过。');
      return;
    }
    setSyncing(true);
    try {
      const res = await sharedHubApi.syncOnce();
      setImportedAt(res.data?.imported_at || new Date().toISOString());
      const imported = res.data?.import?.imported ?? 0;
      const pushed = res.data?.hub?.pushed ?? 0;
      message.success(`已写入本站 ${imported} 条，推到授权端 ${pushed} 条`);
    } catch (err: any) {
      if (err.response?.data?.error === 'already_imported') {
        setImportedAt(err.response.data.imported_at || 'done');
        message.info('本地客户端只做第一次同步，已经灌过。');
        return;
      }
      message.error('同步失败，请确认授权端已登记本站且 Hub 可用');
    } finally {
      setSyncing(false);
    }
  };

  if (!section) {
    return <Outlet />;
  }

  const activeKey = (Object.entries(section.routes).find(([, route]) =>
    matchesRoute(location.pathname, route),
  )?.[0] ?? 'manage') as keyof ContentSection['routes'];

  return (
    <section className="content-operations">
      <div className="content-operations__header">
        <div className="content-operations__heading">
          <h1 className="content-operations__title">{section.title}</h1>
          <p className="content-operations__description">{section.description}</p>
          <Button style={{ marginTop: 10 }} loading={syncing} disabled={!!importedAt} onClick={syncOnce}>
            {importedAt ? '本地灵感已灌过' : '一次性同步本地灵感广场'}
          </Button>
        </div>
        <Tabs
          className="content-operations__tabs"
          activeKey={activeKey}
          onChange={(key) => navigate(section.routes[key as keyof ContentSection['routes']])}
          items={[
            { key: 'manage', label: '内容管理' },
            { key: 'market', label: '共享市场' },
            { key: 'review', label: '共享审核' },
          ]}
        />
      </div>
      <div className="content-operations__body">
        <Outlet />
      </div>
    </section>
  );
}
