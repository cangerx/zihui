import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, App as AntdApp } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/AppLayout'
import { LoginPage } from '@/pages/Login'
import { SelfServeBuyPage } from '@/pages/SelfServeBuy'
import { BuyPackagingPage } from '@/pages/BuyPackaging'
import { PackagingOrdersPage } from '@/pages/PackagingOrders'
import { PackagingLicenseSettingsPage } from '@/pages/PackagingLicenseSettings'
import { OpenSourceDeliveryPage } from '@/pages/OpenSourceDelivery'
import { DashboardPage } from '@/pages/Dashboard'
import { ClientsPage } from '@/pages/Clients'
import { AuthRequestsPage } from '@/pages/AuthRequests'
import { SettingsPage } from '@/pages/Settings'
import { SelfServeOrdersPage } from '@/pages/SelfServeOrders'
import { OpenSourceOrdersPage } from '@/pages/OpenSourceOrders'
import { WeChatPaySettingsPage } from '@/pages/WeChatPaySettings'
import UpdatesPage from '@/pages/Updates'
import { TemplatesPage } from '@/pages/Templates'
import { SiteUpdatesPage } from '@/pages/SiteUpdates'
import { SharedInspirationsPage } from '@/pages/SharedInspirations'
import { SharedInspirationReportsPage } from '@/pages/SharedInspirationReports'
import { SharedInspirationCategoriesPage } from '@/pages/SharedInspirationCategories'
import { SharedInspirationSettingsPage } from '@/pages/SharedInspirationSettings'
import { SharedCreativeTemplatesPage } from '@/pages/SharedCreativeTemplates'
import { SharedCreativeTemplateReportsPage } from '@/pages/SharedCreativeTemplateReports'
import { SharedCreativeTemplateCategoriesPage } from '@/pages/SharedCreativeTemplateCategories'
import { SharedCreativeTemplateSettingsPage } from '@/pages/SharedCreativeTemplateSettings'
import { SharedAgentsPage } from '@/pages/SharedAgents'
import { SharedAgentReportsPage } from '@/pages/SharedAgentReports'
import { SharedAgentCategoriesPage } from '@/pages/SharedAgentCategories'
import { SharedAgentSettingsPage } from '@/pages/SharedAgentSettings'
import { SkillRegistryPage } from '@/pages/SkillRegistry'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: 0,
    },
  },
})

const theme = {
  token: {
    colorPrimary: '#2f6fed',
    colorInfo: '#2f6fed',
    colorText: '#1a2030',
    colorTextSecondary: '#5b6575',
    colorBgLayout: '#f3f6fb',
    colorBgContainer: '#ffffff',
    colorBorder: '#d7e2f0',
    colorBorderSecondary: '#e8eef6',
    borderRadius: 8,
    borderRadiusLG: 10,
    controlHeight: 36,
    fontSize: 13,
  },
  components: {
    Layout: {
      headerHeight: 58,
    },
    Menu: {
      itemHeight: 40,
      itemBorderRadius: 8,
      itemSelectedBg: '#e8f1fe',
      itemSelectedColor: '#1d56c9',
      itemHoverBg: '#f2f6ff',
      itemHoverColor: '#2f6fed',
      subMenuItemBg: 'transparent',
    },
    Table: {
      headerBg: '#eef3fb',
      headerColor: '#4a5568',
    },
    Card: {
      paddingLG: 20,
    },
    Button: {
      primaryShadow: '0 2px 6px rgba(47, 111, 237, 0.22)',
    },
  },
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntdApp>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter basename="/admin">
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              {/* 自助付费开通商城授权（公开页，免登录，独立布局） */}
              <Route path="/buy" element={<SelfServeBuyPage />} />
              <Route path="/buy-packaging" element={<BuyPackagingPage />} />
              {/* 开源交付（公开页，免登录，独立布局） */}
              <Route path="/opensource" element={<OpenSourceDeliveryPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <AppLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="clients" element={<ClientsPage />} />
                <Route path="requests" element={<Navigate to="/" replace />} />
                <Route path="requests/:buildId" element={<Navigate to="/" replace />} />
                <Route path="auth-requests" element={<AuthRequestsPage />} />
                <Route path="templates" element={<TemplatesPage />} />
                <Route path="site-updates" element={<SiteUpdatesPage />} />
                <Route path="queue" element={<Navigate to="/" replace />} />
                <Route path="updates" element={<UpdatesPage />} />
                {/* 自助付费开通商城授权 */}
                <Route path="self-serve-orders" element={<SelfServeOrdersPage />} />
                <Route path="packaging-orders" element={<PackagingOrdersPage />} />
                <Route path="packaging-license-settings" element={<PackagingLicenseSettingsPage />} />
                {/* 开源交付订单 */}
                <Route path="open-source-orders" element={<OpenSourceOrdersPage />} />
                <Route path="wechat-pay-settings" element={<WeChatPaySettingsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                {/* 共享灵感库 v1 */}
                <Route path="shared-inspirations" element={<SharedInspirationsPage />} />
                <Route path="shared-inspiration-reports" element={<SharedInspirationReportsPage />} />
                <Route path="shared-inspiration-categories" element={<SharedInspirationCategoriesPage />} />
                <Route path="shared-inspiration-settings" element={<SharedInspirationSettingsPage />} />
                <Route path="shared-creative-templates" element={<SharedCreativeTemplatesPage />} />
                <Route path="shared-creative-template-reports" element={<SharedCreativeTemplateReportsPage />} />
                <Route path="shared-creative-template-categories" element={<SharedCreativeTemplateCategoriesPage />} />
                <Route path="shared-creative-template-settings" element={<SharedCreativeTemplateSettingsPage />} />
                {/* 共享智能体库 v1 */}
                <Route path="shared-agents" element={<SharedAgentsPage />} />
                <Route path="shared-agent-reports" element={<SharedAgentReportsPage />} />
                <Route path="shared-agent-categories" element={<SharedAgentCategoriesPage />} />
                <Route path="shared-agent-settings" element={<SharedAgentSettingsPage />} />
                <Route path="skill-registry" element={<SkillRegistryPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AntdApp>
    </ConfigProvider>
  )
}
