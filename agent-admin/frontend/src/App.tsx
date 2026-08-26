import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import { isLoggedIn } from './services/auth';
import { CurrencyProvider } from './contexts/CurrencyContext';
import AdminLayout from './layouts/AdminLayout';
import ContentOperationsLayout from './layouts/ContentOperationsLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Groups from './pages/Groups';
import Providers from './pages/Providers';
import Health from './pages/Health';
import Models from './pages/Models';
import Assignments from './pages/Assignments';
import Permissions from './pages/Permissions';
import Billing from './pages/Billing';
import Balances from './pages/Balances';
import Usage from './pages/Usage';
import ChangePassword from './pages/ChangePassword';
import SettingsPage from './pages/Settings';
import DesktopBasicSettingsPage from './pages/DesktopBasicSettings';
import RedeemCodesPage from './pages/RedeemCodes';
import RedeemRecordsPage from './pages/RedeemRecords';
import PlansPage from './pages/Plans';
import UserPlansPage from './pages/UserPlans';
import UserPlanQuotasPage from './pages/UserPlanQuotas';
import OrdersPage from './pages/Orders';
import CommissionOrdersPage from './pages/CommissionOrders';
import UpdatesPage from './pages/Updates';
import CloudBuildRequestPage from './pages/CloudBuild/RequestPage';
import CloudBuildGithubSettingsPage from './pages/CloudBuild/GithubSettings';
import CloudBuildHistoryPage from './pages/CloudBuild/HistoryPage';
import OemProjectsPage from './pages/OemProjects';
import OemProjectBuildsPage from './pages/OemProjectBuilds';
import HomepageSettingsPage from './pages/HomepageSettings';
import InspirationsPage from './pages/Inspirations';
import CreativeTemplatesPage from './pages/CreativeTemplates';
import StylePresetsPage from './pages/StylePresets';
import AgentsPage from './pages/Agents';
import InspirationHubBrowsePage from './pages/InspirationHubBrowse';
import InspirationHubPendingPage from './pages/InspirationHubPending';
import CreativeTemplateHubBrowsePage from './pages/CreativeTemplateHubBrowse';
import CreativeTemplateHubPendingPage from './pages/CreativeTemplateHubPending';
import AgentHubBrowsePage from './pages/AgentHubBrowse';
import AgentHubPendingPage from './pages/AgentHubPending';
import AnnouncementsPage from './pages/Announcements';
import DocsPage from './pages/Docs';
import DocCategoriesPage from './pages/DocCategories';
import DocSettingsPage from './pages/DocSettings';
import DocRetrievePreviewPage from './pages/DocRetrievePreview';
import DocChatLogsPage from './pages/DocChatLogs';
import KnowledgeBasesPage from './pages/KnowledgeBases';
import KnowledgeBaseDocumentsPage from './pages/KnowledgeBaseDocuments';
import KnowledgeBaseSettingsPage from './pages/KnowledgeBaseSettings';
import KnowledgeBaseRetrievePreviewPage from './pages/KnowledgeBaseRetrievePreview';
import MattingPage from './pages/Matting';
import FineMattingPage from './pages/FineMatting';
import ShopProductImagePage from './pages/ShopProductImage';
import VideoManagementPage from './pages/VideoManagement';
import TemporaryAssetsPage from './pages/TemporaryAssets';
import SyncStoragePage from './pages/SyncStorage';
import RechargeConfigPage from './pages/RechargeConfig';
import DesktopMenuConfigPage from './pages/DesktopMenuConfig';
// import DeckAssetsPage from './pages/DeckAssets'; // AI PPT 暂时下线
import TtsProvidersPage from './pages/TtsProviders';
import SkillsPage from './pages/Skills';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  return isLoggedIn() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ConfigProvider
      theme={{
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
          fontSize: 14,
        },
        components: {
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
            headerBg: '#ffffff',
          },
          Button: {
            primaryShadow: '0 2px 6px rgba(47, 111, 237, 0.22)',
          },
        },
      }}
    >
      <CurrencyProvider>
        <HashRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><AdminLayout /></ProtectedRoute>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="users" element={<Users />} />
              <Route path="groups" element={<Groups />} />
              <Route path="providers" element={<Providers />} />
              <Route path="health" element={<Health />} />
              <Route path="models" element={<Models />} />
              <Route path="assignments" element={<Assignments />} />
              <Route path="permissions" element={<Permissions />} />
              <Route path="billing" element={<Billing />} />
              <Route path="balances" element={<Balances />} />
              <Route path="usage" element={<Usage />} />
              <Route path="redeem-codes" element={<RedeemCodesPage />} />
              <Route path="redeem-records" element={<RedeemRecordsPage />} />
              <Route path="plans" element={<PlansPage />} />
              <Route path="user-plans" element={<UserPlansPage />} />
              <Route path="user-plan-quotas" element={<UserPlanQuotasPage />} />
              <Route path="orders" element={<OrdersPage />} />
              <Route path="commission-orders" element={<CommissionOrdersPage />} />
              <Route path="updates" element={<UpdatesPage />} />
              <Route path="cloud-build" element={<CloudBuildHistoryPage />} />
              <Route path="cloud-build/request" element={<CloudBuildRequestPage />} />
              <Route path="cloud-build/history" element={<CloudBuildHistoryPage />} />
              <Route path="oem-projects" element={<OemProjectsPage />} />
              <Route path="oem-projects/:projectKey/builds" element={<OemProjectBuildsPage />} />
              <Route path="desktop-basic-settings" element={<DesktopBasicSettingsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="cloud-build/github" element={<CloudBuildGithubSettingsPage />} />
              <Route path="homepage-settings" element={<HomepageSettingsPage />} />
              <Route path="style-presets" element={<StylePresetsPage />} />
              <Route element={<ContentOperationsLayout />}>
                <Route path="agents" element={<AgentsPage />} />
                <Route path="agent-hub/browse" element={<AgentHubBrowsePage />} />
                <Route path="agent-hub/pending" element={<AgentHubPendingPage />} />
                <Route path="inspirations" element={<InspirationsPage />} />
                <Route path="inspiration-hub/browse" element={<InspirationHubBrowsePage />} />
                <Route path="inspiration-hub/pending" element={<InspirationHubPendingPage />} />
                <Route path="creative-templates" element={<CreativeTemplatesPage />} />
                <Route path="creative-template-hub/browse" element={<CreativeTemplateHubBrowsePage />} />
                <Route path="creative-template-hub/pending" element={<CreativeTemplateHubPendingPage />} />
              </Route>
              <Route path="announcements" element={<AnnouncementsPage />} />
              <Route path="docs" element={<DocsPage />} />
              <Route path="docs/categories" element={<DocCategoriesPage />} />
              <Route path="docs/settings" element={<DocSettingsPage />} />
              <Route path="docs/retrieve" element={<DocRetrievePreviewPage />} />
              <Route path="docs/chat-logs" element={<DocChatLogsPage />} />
              <Route path="knowledge-bases" element={<KnowledgeBasesPage />} />
              <Route path="knowledge-bases/settings" element={<KnowledgeBaseSettingsPage />} />
              <Route path="knowledge-bases/retrieve" element={<KnowledgeBaseRetrievePreviewPage />} />
              <Route path="knowledge-bases/:kbId/documents" element={<KnowledgeBaseDocumentsPage />} />
              <Route path="matting" element={<MattingPage />} />
              <Route path="fine-matting" element={<FineMattingPage />} />
              <Route path="shop-product-image" element={<ShopProductImagePage />} />
              <Route path="videos" element={<VideoManagementPage />} />
              <Route path="temporary-assets" element={<TemporaryAssetsPage />} />
              <Route path="sync-storage" element={<SyncStoragePage />} />
              <Route path="recharge" element={<RechargeConfigPage />} />
              <Route path="desktop-menu" element={<DesktopMenuConfigPage />} />
              {/* AI PPT 暂时下线: <Route path="deck-assets" element={<DeckAssetsPage />} /> */}
              <Route path="tts-providers" element={<TtsProvidersPage />} />
              <Route path="skills" element={<SkillsPage />} />
              <Route path="change-password" element={<ChangePassword />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </HashRouter>
      </CurrencyProvider>
    </ConfigProvider>
  );
}
