import { useMemo, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Dropdown, message } from 'antd';
import {
  UserOutlined, TeamOutlined, CloudServerOutlined, AppstoreOutlined,
  LinkOutlined, SafetyOutlined, DollarOutlined, WalletOutlined,
  BarChartOutlined, MenuFoldOutlined, MenuUnfoldOutlined, LogoutOutlined,
  KeyOutlined, DashboardOutlined, ClearOutlined, SettingOutlined,
  GiftOutlined, FileDoneOutlined, CrownOutlined, ProfileOutlined,
  ShoppingOutlined, CloudDownloadOutlined, RocketOutlined, GlobalOutlined,
  BulbOutlined, HeartOutlined, NotificationOutlined,
  BookOutlined, FolderOutlined, SearchOutlined, MessageOutlined,
  ScissorOutlined, VideoCameraOutlined,
  PictureOutlined, RobotOutlined, DatabaseOutlined, FormatPainterOutlined, SoundOutlined,
} from '@ant-design/icons';
import { removeToken, getUser } from '../services/auth';
import { systemApi } from '../services/api';
import { useSiteInfo } from '../contexts/CurrencyContext';

const { Header, Sider, Content } = Layout;

type RouteMenuMeta = {
  groupKey: string;
  selectedMenuKey: string;
};

const ROUTE_MENU_META: Record<string, RouteMenuMeta> = {
  '/dashboard': { groupKey: 'group-workbench', selectedMenuKey: '/dashboard' },
  '/users': { groupKey: 'group-users', selectedMenuKey: '/users' },
  '/groups': { groupKey: 'group-users', selectedMenuKey: '/groups' },
  '/permissions': { groupKey: 'group-users', selectedMenuKey: '/permissions' },
  '/plans': { groupKey: 'group-users', selectedMenuKey: '/plans' },
  '/user-plans': { groupKey: 'group-users', selectedMenuKey: '/user-plans' },
  '/user-plan-quotas': { groupKey: 'group-users', selectedMenuKey: '/user-plan-quotas' },
  '/providers': { groupKey: 'group-ai', selectedMenuKey: '/providers' },
  '/health': { groupKey: 'group-ai', selectedMenuKey: '/health' },
  '/models': { groupKey: 'group-ai', selectedMenuKey: '/models' },
  '/assignments': { groupKey: 'group-ai', selectedMenuKey: '/assignments' },
  '/matting': { groupKey: 'group-ai', selectedMenuKey: '/matting' },
  '/fine-matting': { groupKey: 'group-ai', selectedMenuKey: '/fine-matting' },
  '/videos': { groupKey: 'group-ai', selectedMenuKey: '/videos' },
  '/temporary-assets': { groupKey: 'group-ai', selectedMenuKey: '/temporary-assets' },
  '/billing': { groupKey: 'group-billing', selectedMenuKey: '/billing' },
  '/balances': { groupKey: 'group-billing', selectedMenuKey: '/balances' },
  '/recharge': { groupKey: 'group-system', selectedMenuKey: '/recharge' },
  '/usage': { groupKey: 'group-billing', selectedMenuKey: '/usage' },
  '/orders': { groupKey: 'group-billing', selectedMenuKey: '/orders' },
  '/commission-orders': { groupKey: 'group-billing', selectedMenuKey: '/commission-orders' },
  '/redeem-codes': { groupKey: 'group-billing', selectedMenuKey: '/redeem-codes' },
  '/redeem-records': { groupKey: 'group-billing', selectedMenuKey: '/redeem-records' },
  '/desktop-basic-settings': { groupKey: 'group-desktop', selectedMenuKey: '/desktop-basic-settings' },
  '/cloud-build': { groupKey: 'group-desktop', selectedMenuKey: '/cloud-build' },
  '/oem-projects': { groupKey: 'group-desktop', selectedMenuKey: '/oem-projects' },
  '/desktop-menu': { groupKey: 'group-desktop', selectedMenuKey: '/desktop-menu' },
  '/shop-product-image': { groupKey: 'group-desktop', selectedMenuKey: '/shop-product-image' },
  '/deck-assets': { groupKey: 'group-desktop', selectedMenuKey: '/deck-assets' },
  '/tts-providers': { groupKey: 'group-desktop', selectedMenuKey: '/tts-providers' },
  '/agents': { groupKey: '', selectedMenuKey: '/agents' },
  '/agent-hub/browse': { groupKey: '', selectedMenuKey: '/agents' },
  '/agent-hub/pending': { groupKey: '', selectedMenuKey: '/agents' },
  '/inspirations': { groupKey: 'group-content', selectedMenuKey: '/inspirations' },
  '/inspiration-hub/browse': { groupKey: 'group-content', selectedMenuKey: '/inspirations' },
  '/inspiration-hub/pending': { groupKey: 'group-content', selectedMenuKey: '/inspirations' },
  '/creative-templates': { groupKey: 'group-content', selectedMenuKey: '/creative-templates' },
  '/creative-template-hub/browse': { groupKey: 'group-content', selectedMenuKey: '/creative-templates' },
  '/creative-template-hub/pending': { groupKey: 'group-content', selectedMenuKey: '/creative-templates' },
  '/style-presets': { groupKey: 'group-content', selectedMenuKey: '/style-presets' },
  '/skills': { groupKey: '', selectedMenuKey: '/skills' },
  '/docs': { groupKey: 'group-docs', selectedMenuKey: '/docs' },
  '/docs/categories': { groupKey: 'group-docs', selectedMenuKey: '/docs/categories' },
  '/docs/settings': { groupKey: 'group-docs', selectedMenuKey: '/docs/settings' },
  '/docs/retrieve': { groupKey: 'group-docs', selectedMenuKey: '/docs/retrieve' },
  '/docs/chat-logs': { groupKey: 'group-docs', selectedMenuKey: '/docs/chat-logs' },
  '/announcements': { groupKey: 'group-system', selectedMenuKey: '/announcements' },
  '/updates': { groupKey: 'group-system', selectedMenuKey: '/updates' },
  '/homepage-settings': { groupKey: 'group-system', selectedMenuKey: '/homepage-settings' },
  '/settings': { groupKey: 'group-system', selectedMenuKey: '/settings' },
  '/cloud-build/github': { groupKey: 'group-system', selectedMenuKey: '/cloud-build/github' },
  '/sync-storage': { groupKey: 'group-system', selectedMenuKey: '/sync-storage' },
  '/knowledge-bases': { groupKey: 'group-system', selectedMenuKey: '/knowledge-bases' },
  '/knowledge-bases/settings': { groupKey: 'group-system', selectedMenuKey: '/knowledge-bases/settings' },
  '/knowledge-bases/retrieve': { groupKey: 'group-system', selectedMenuKey: '/knowledge-bases/retrieve' },
};

const ROUTE_PATHS = Object.keys(ROUTE_MENU_META).sort((a, b) => b.length - a.length);

function matchRouteMenuMeta(pathname: string): RouteMenuMeta | undefined {
  const hit = ROUTE_PATHS.find((path) => pathname === path || pathname.startsWith(`${path}/`));
  return hit ? ROUTE_MENU_META[hit] : undefined;
}

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();
  const site = useSiteInfo();
  // 折叠态用首字母 / 中文取头 2 字，避免长标题溢出
  const collapsedLabel = (() => {
    const t = (site.title || 'Agent Admin').trim();
    if (Array.from(t).every((char) => char.charCodeAt(0) <= 0x7f)) {
      return t.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'AA';
    }
    return t.slice(0, 2);
  })();

  // 按管理员要完成的任务分组；文档中心保持独立，路由不变，避免旧书签失效。
  const menuItems = useMemo(() => [
    {
      key: 'group-workbench', icon: <DashboardOutlined />, label: '工作台',
      children: [{ key: '/dashboard', icon: <DashboardOutlined />, label: '运营概览' }],
    },
    {
      key: 'group-users', icon: <UserOutlined />, label: '用户与权限',
      children: [
        { key: '/users', icon: <UserOutlined />, label: '用户管理' },
        { key: '/groups', icon: <TeamOutlined />, label: '用户分组' },
        { key: '/permissions', icon: <SafetyOutlined />, label: '高级权限规则' },
        { key: '/plans', icon: <CrownOutlined />, label: '套餐管理' },
        { key: '/user-plans', icon: <ProfileOutlined />, label: '用户套餐' },
        { key: '/user-plan-quotas', icon: <WalletOutlined />, label: '套餐额度明细' },
      ],
    },
    {
      key: 'group-ai', icon: <AppstoreOutlined />, label: '模型与线路',
      children: [
        { key: '/providers', icon: <CloudServerOutlined />, label: '对话与生图线路' },
        { key: '/models', icon: <AppstoreOutlined />, label: '对话与生图模型' },
        { key: '/assignments', icon: <LinkOutlined />, label: '模型可用范围' },
        { key: '/videos', icon: <VideoCameraOutlined />, label: '视频模型与线路' },
        { key: '/health', icon: <HeartOutlined />, label: '健康看板' },
        { key: '/matting', icon: <ScissorOutlined />, label: '快速抠图' },
        { key: '/fine-matting', icon: <ScissorOutlined />, label: '精细抠图' },
        { key: '/temporary-assets', icon: <PictureOutlined />, label: '临时素材' },
      ],
    },
    {
      key: 'group-billing', icon: <DollarOutlined />, label: '计费与订单',
      children: [
        { key: '/billing', icon: <DollarOutlined />, label: '计费规则' },
        { key: '/balances', icon: <WalletOutlined />, label: '费用管理' },
        { key: '/usage', icon: <BarChartOutlined />, label: '用量统计' },
        { key: '/orders', icon: <ShoppingOutlined />, label: '订单管理' },
        { key: '/commission-orders', icon: <DollarOutlined />, label: '佣金订单' },
        { key: '/redeem-codes', icon: <GiftOutlined />, label: '兑换码' },
        { key: '/redeem-records', icon: <FileDoneOutlined />, label: '兑换记录' },
      ],
    },
    {
      key: 'group-desktop', icon: <RocketOutlined />, label: '客户端运营',
      children: [
        { key: '/desktop-basic-settings', icon: <SettingOutlined />, label: '品牌与默认设置' },
        { key: '/desktop-menu', icon: <AppstoreOutlined />, label: '客户端菜单' },
        { key: '/tts-providers', icon: <SoundOutlined />, label: '解说 TTS' },
        { key: '/cloud-build', icon: <RocketOutlined />, label: '客户端打包' },
        { key: '/oem-projects', icon: <AppstoreOutlined />, label: 'OEM 项目' },
        { key: '/shop-product-image', icon: <ShoppingOutlined />, label: '店铺商品图' },
      ],
    },
    { key: '/skills', icon: <AppstoreOutlined />, label: 'Skills 管理' },
    { key: '/agents', icon: <RobotOutlined />, label: '数字员工' },
    {
      key: 'group-content', icon: <BulbOutlined />, label: '内容运营',
      children: [
        { key: '/inspirations', icon: <BulbOutlined />, label: '灵感内容' },
        { key: '/creative-templates', icon: <PictureOutlined />, label: '工作流模板' },
        { key: '/style-presets', icon: <FormatPainterOutlined />, label: '图片风格' },
      ],
    },
    {
      key: 'group-docs', icon: <BookOutlined />, label: '文档中心',
      children: [
        { key: '/docs', icon: <BookOutlined />, label: '文档中心' },
        { key: '/docs/categories', icon: <FolderOutlined />, label: '文档分类' },
        { key: '/docs/settings', icon: <SettingOutlined />, label: '文档站设置' },
        { key: '/docs/retrieve', icon: <SearchOutlined />, label: '文档检索调试' },
        { key: '/docs/chat-logs', icon: <MessageOutlined />, label: '文档问答记录' },
      ],
    },
    {
      key: 'group-system', icon: <SettingOutlined />, label: '系统设置',
      children: [
        { key: '/settings', icon: <SettingOutlined />, label: '系统配置' },
        { key: '/cloud-build/github', icon: <SettingOutlined />, label: '云打包 GitHub' },
        { key: '/recharge', icon: <WalletOutlined />, label: '直充配置' },
        { key: '/announcements', icon: <NotificationOutlined />, label: '公告管理' },
        { key: '/updates', icon: <CloudDownloadOutlined />, label: '在线更新' },
        { key: '/homepage-settings', icon: <GlobalOutlined />, label: '官网设置' },
        { key: '/sync-storage', icon: <CloudServerOutlined />, label: '云同步存储' },
        { key: '/knowledge-bases', icon: <DatabaseOutlined />, label: '云端知识库（高级）' },
        { key: '/knowledge-bases/settings', icon: <SettingOutlined />, label: '云端知识库设置' },
        { key: '/knowledge-bases/retrieve', icon: <SearchOutlined />, label: '云端检索调试' },
      ],
    },
  ], []);

  const routeMenuMeta = matchRouteMenuMeta(location.pathname);
  const activeGroupKey = routeMenuMeta?.groupKey;
  const [manualOpenKeys, setManualOpenKeys] = useState<string[]>(() => {
    return activeGroupKey ? [activeGroupKey] : [];
  });
  const [closedActiveAt, setClosedActiveAt] = useState<{ pathname: string; groupKey: string } | null>(null);
  const activeGroupSuppressed = closedActiveAt?.pathname === location.pathname
    && closedActiveAt.groupKey === activeGroupKey;
  const openKeys = useMemo(() => {
    if (!activeGroupKey || activeGroupSuppressed) return manualOpenKeys;
    return Array.from(new Set([...manualOpenKeys, activeGroupKey]));
  }, [activeGroupKey, activeGroupSuppressed, manualOpenKeys]);
  const selectedKey = routeMenuMeta?.selectedMenuKey ?? location.pathname;

  const handleOpenChange = (keys: string[]) => {
    if (activeGroupKey && openKeys.includes(activeGroupKey) && !keys.includes(activeGroupKey)) {
      setClosedActiveAt({ pathname: location.pathname, groupKey: activeGroupKey });
    } else if (activeGroupKey && keys.includes(activeGroupKey)) {
      setClosedActiveAt(null);
    }
    setManualOpenKeys(keys);
  };

  const handleLogout = () => {
    removeToken();
    navigate('/login');
  };

  const handleClearCache = async () => {
    try {
      await systemApi.clearCache();
      message.success('缓存已清理');
    } catch { message.error('清理失败'); }
  };

  const userMenuItems = [
    { key: 'password', icon: <KeyOutlined />, label: '修改密码', onClick: () => navigate('/change-password') },
    { key: 'cache', icon: <ClearOutlined />, label: '清理缓存', onClick: handleClearCache },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
  ];

  return (
    <Layout className="admin-shell">
      <Sider
        className="admin-shell__sider"
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={232}
        theme="light"
      >
        <div className={`admin-shell__brand${collapsed ? ' admin-shell__brand--collapsed' : ''}`} title={site.title}>
          <span className="admin-shell__brand-mark">{collapsedLabel}</span>
          {!collapsed && <span className="admin-shell__brand-title">{site.title || 'Agent Admin'}</span>}
        </div>
        <div className="admin-shell__menu-wrap">
          <Menu
            className="admin-shell__menu"
            mode="inline"
            selectedKeys={[selectedKey]}
            openKeys={openKeys}
            onOpenChange={(keys) => handleOpenChange(keys as string[])}
            items={menuItems}
            onClick={({ key }) => { if (key.startsWith('/')) navigate(key); }}
          />
        </div>
      </Sider>
      <Layout className="admin-shell__main">
        <Header className="admin-shell__header">
          <Button className="admin-shell__header-action" type="text" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)} />
          <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
            <Button className="admin-shell__header-action" type="text" icon={<UserOutlined />}>
              {user?.nickname || user?.username || 'Admin'}
            </Button>
          </Dropdown>
        </Header>
        <div className="admin-shell__viewport">
          <Content className="admin-shell__content">
            <Outlet />
          </Content>
        </div>
      </Layout>
    </Layout>
  );
}
