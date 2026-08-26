import { useEffect, useState } from 'react'
import { Layout, Menu, Dropdown, Button, theme } from 'antd'
import type { MenuProps } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  DashboardOutlined,
  ClusterOutlined,
  FileSearchOutlined,
  BulbOutlined,
  AppstoreOutlined,
  RobotOutlined,
  DollarOutlined,
  SafetyCertificateOutlined,
  CloudDownloadOutlined,
  SettingOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { authStore } from '@/store/auth'
import { authApi } from '@/api/auth'

const { Header, Sider, Content } = Layout

const HUB_PATHS = [
  '/shared-inspirations',
  '/shared-inspiration-reports',
  '/shared-inspiration-categories',
  '/shared-inspiration-settings',
  '/shared-creative-templates',
  '/shared-creative-template-reports',
  '/shared-creative-template-categories',
  '/shared-creative-template-settings',
]

const AGENT_PATHS = [
  '/shared-agents',
  '/shared-agent-reports',
  '/shared-agent-categories',
  '/shared-agent-settings',
]

const PAYMENT_PATHS = ['/self-serve-orders', '/packaging-orders', '/open-source-orders']
const SYSTEM_PATHS = ['/settings', '/wechat-pay-settings', '/packaging-license-settings', '/updates', '/templates', '/site-updates']
const SHARED_GROUP_KEYS = ['hub', 'templateHub'] as const
const GROUP_KEYS = ['shared', ...SHARED_GROUP_KEYS, 'agentHub', 'payment', 'system'] as const

function leafGroupForPath(pathname: string): string | null {
  const top = '/' + pathname.split('/')[1]
  if (top.startsWith('/shared-creative-')) return 'templateHub'
  if (top.startsWith('/shared-agent')) return 'agentHub'
  if (HUB_PATHS.includes(top)) return 'hub'
  if (PAYMENT_PATHS.includes(top)) return 'payment'
  if (SYSTEM_PATHS.includes(top)) return 'system'
  return null
}

function openGroupsForPath(pathname: string): string[] {
  const leaf = leafGroupForPath(pathname)
  if (!leaf) return []
  if ((SHARED_GROUP_KEYS as readonly string[]).includes(leaf)) return ['shared', leaf]
  return [leaf]
}

const navItems: MenuProps['items'] = [
  { key: '/', icon: <DashboardOutlined />, label: '概览' },
  { key: '/clients', icon: <ClusterOutlined />, label: '云控站点' },
  { key: '/auth-requests', icon: <FileSearchOutlined />, label: '授权日志' },
  { key: '/skill-registry', icon: <SafetyCertificateOutlined />, label: 'Skills 目录' },
  {
    key: 'agentHub',
    icon: <RobotOutlined />,
    label: '数字员工',
    children: [
      { key: '/shared-agents', label: '内容' },
      { key: '/shared-agent-reports', label: '举报' },
      { key: '/shared-agent-categories', label: '分类' },
      { key: '/shared-agent-settings', label: '规则' },
    ],
  },
  {
    key: 'shared',
    icon: <AppstoreOutlined />,
    label: '共享内容',
    children: [
      {
        key: 'hub',
        icon: <BulbOutlined />,
        label: '灵感',
        children: [
          { key: '/shared-inspirations', label: '内容' },
          { key: '/shared-inspiration-reports', label: '举报' },
          { key: '/shared-inspiration-categories', label: '分类' },
          { key: '/shared-inspiration-settings', label: '规则' },
        ],
      },
      {
        key: 'templateHub',
        icon: <AppstoreOutlined />,
        label: '创意模板',
        children: [
          { key: '/shared-creative-templates', label: '内容' },
          { key: '/shared-creative-template-reports', label: '举报' },
          { key: '/shared-creative-template-categories', label: '分类' },
          { key: '/shared-creative-template-settings', label: '规则' },
        ],
      },
    ],
  },
  {
    key: 'payment',
    icon: <DollarOutlined />,
    label: '收款',
    children: [
      { key: '/self-serve-orders', label: '商城授权订单' },
      { key: '/packaging-orders', label: '打包授权订单' },
      { key: '/open-source-orders', label: '开源交付订单' },
    ],
  },
  {
    key: 'system',
    icon: <SettingOutlined />,
    label: '系统',
    children: [
      { key: '/settings', label: '站点' },
      { key: '/templates', label: '桌面模板版本' },
      { key: '/site-updates', label: '云控发版' },
      { key: '/packaging-license-settings', label: '打包授权定价' },
      { key: '/wechat-pay-settings', label: '收款方式' },
      { key: '/updates', icon: <CloudDownloadOutlined />, label: '在线更新' },
    ],
  },
]

export function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [user, setUser] = useState(authStore.getUser())
  const { token } = theme.useToken()

  useEffect(() => {
    return authStore.subscribe(() => {
      setUser(authStore.getUser())
    })
  }, [])

  const selectedKey = (() => {
    const p = location.pathname
    if (p === '/' || p.startsWith('/dashboard')) return '/'
    const top = '/' + p.split('/')[1]
    if (HUB_PATHS.includes(top) || AGENT_PATHS.includes(top) || PAYMENT_PATHS.includes(top) || SYSTEM_PATHS.includes(top)) return top
    return navItems?.some((it) => it && 'key' in it && it.key === top) ? top : '/'
  })()

  const [openKeys, setOpenKeys] = useState<string[]>(() => openGroupsForPath(location.pathname))
  useEffect(() => {
    const groups = openGroupsForPath(location.pathname)
    if (groups.length === 0) return
    setOpenKeys((prev) => {
      const next = new Set(prev)
      groups.forEach((g) => next.add(g))
      return [...next]
    })
  }, [location.pathname])

  const handleLogout = async () => {
    try {
      await authApi.logout()
    } catch {
      // ignore
    } finally {
      authStore.clear()
      navigate('/login', { replace: true })
    }
  }

  const userMenu: MenuProps = {
    items: [
      { key: 'username', label: user?.username, disabled: true },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: handleLogout },
    ],
  }

  return (
    <Layout className="admin-shell">
      <Sider
        className="admin-shell__sider"
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={220}
        theme="light"
      >
        <div className={`admin-shell__brand${collapsed ? ' admin-shell__brand--collapsed' : ''}`}>
          <span className="admin-shell__brand-mark">授</span>
          {!collapsed && <span>授权管理</span>}
        </div>
        <div className="admin-shell__menu-wrap">
          <Menu
            className="admin-shell__menu"
            mode="inline"
            selectedKeys={[selectedKey]}
            openKeys={openKeys}
            onOpenChange={(keys) => setOpenKeys(keys as string[])}
            items={navItems}
            onClick={(e) => {
              if ((GROUP_KEYS as readonly string[]).includes(e.key)) return
              navigate(e.key)
            }}
          />
        </div>
      </Sider>
      <Layout className="admin-shell__main">
        <Header className="admin-shell__header">
          <div>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <span className="admin-shell__header-title">授权管理后台</span>
            <span className="admin-shell__header-sub">给云控站发放许可与共享内容，不调度打包</span>
          </div>
          <Dropdown menu={userMenu} placement="bottomRight" trigger={['click']}>
            <Button type="text" icon={<UserOutlined />} style={{ color: token.colorText }}>
              {user?.name || user?.username}
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
  )
}
