import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert, Button, Card, Descriptions, Form, Image, Input, InputNumber, message,
  Modal, Popconfirm, Select, Space, Table, Tag, Typography, Upload,
  Spin, Switch, Tooltip,
} from 'antd';
import {
  AppstoreOutlined, ClearOutlined, DeleteOutlined, DownloadOutlined, EditOutlined,
  FolderOpenOutlined, HistoryOutlined, PlusOutlined,
  ReloadOutlined, RocketOutlined, UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { cloudBuildApi, oemProjectApi, userApi } from '../services/api';
import {
  CLOUD_BUILD_ICON_RULE_TEXT,
  getCloudBuildIconUploadErrorMessage,
  validateCloudBuildIcon,
} from '../utils/cloudBuildIcon';
import MacInstallGuideModal, {
  absoluteDownloadUrl, friendlyDownloadName,
} from '../components/MacInstallGuide';
import type { MacGuideInfo } from '../components/MacInstallGuide';

const { Text, Title } = Typography;

const DEFAULT_MAINTENANCE_TEXT = '云打包更新维护中，暂停打包，请稍后刷新查看。';

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  active: { color: 'green', label: '启用' },
  disabled: { color: 'orange', label: '停用' },
  archived: { color: 'default', label: '归档' },
  queued: { color: 'default', label: '排队中' },
  building: { color: 'processing', label: '打包中' },
  success: { color: 'cyan', label: '已就绪' },
  downloading: { color: 'gold', label: '拉取中' },
  delivered: { color: 'green', label: '已落盘' },
  failed: { color: 'red', label: '失败' },
  cancelled: { color: 'default', label: '已取消' },
  expired: { color: 'default', label: '已过期' },
  purged: { color: 'default', label: '已清理' },
};

const PLATFORM_LABEL: Record<string, { color: string; label: string }> = {
  win: { color: 'blue', label: 'Windows' },
  mac: { color: 'purple', label: 'macOS' },
};

interface OemProject {
  id: number;
  project_key: string;
  name: string;
  app_name: string;
  icon_url?: string | null;
  app_id: string;
  update_path: string;
  status: string;
  commission_rate?: number | string;
  commission_enabled?: boolean | number;
  customer_service_title?: string | null;
  customer_service_image_url?: string | null;
  member_count?: number;
  build_count?: number;
  latest_build_created_at?: string | null;
  last_build_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface InstallerVersion {
  filename: string;
  stored_path: string;
  platform: 'win' | 'mac';
  primary_size: number;
  blockmap_filename: string | null;
  blockmap_size: number;
  size: number;
  mtime: string | null;
  linked_build: { build_id: string; app_name: string; app_version: string } | null;
}

interface AuthCheckResult {
  authorized: boolean;
  reason?: string;
  message?: string;
  domain?: string;
  origin?: string;
  daily_limit?: number;
  daily_used?: number;
  maintenance?: boolean;
  maintenance_message?: string | null;
  min_admin_version?: string | null;
  current_admin_version?: string | null;
  admin_version_too_low?: boolean;
  can_use_github_packaging?: boolean;
  can_use_mac_packaging?: boolean;
}

function statusTag(status: string) {
  const t = STATUS_LABEL[status] || { color: 'default', label: status };
  return <Tag color={t.color}>{t.label}</Tag>;
}

function platformTag(platform: string) {
  const t = PLATFORM_LABEL[platform] || { color: 'default', label: platform };
  return <Tag color={t.color}>{t.label}</Tag>;
}

function fmtTime(v?: string | null) {
  return v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-';
}

function fmtSize(v?: number | null) {
  if (!v) return '-';
  if (v > 1024 * 1024) return `${(v / 1024 / 1024).toFixed(2)} MB`;
  if (v > 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

export default function OemProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<{ items: OemProject[]; total: number }>({ items: [], total: 0 });
  const [projectParams, setProjectParams] = useState<Record<string, any>>({ page: 1, page_size: 20 });
  const [loading, setLoading] = useState(false);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectModalMode, setProjectModalMode] = useState<'create' | 'edit'>('create');
  const [editingProject, setEditingProject] = useState<OemProject | null>(null);
  const [projectForm] = Form.useForm();
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);

  const [selectedProject, setSelectedProject] = useState<OemProject | null>(null);

  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const [buildForm] = Form.useForm();
  const [buildSubmitting, setBuildSubmitting] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [auth, setAuth] = useState<AuthCheckResult | null>(null);
  const [installerProject, setInstallerProject] = useState<OemProject | null>(null);
  const [installersOpen, setInstallersOpen] = useState(false);
  const [installers, setInstallers] = useState<InstallerVersion[]>([]);
  const [installersLoading, setInstallersLoading] = useState(false);
  const [installersBase, setInstallersBase] = useState('');
  const [installersTotal, setInstallersTotal] = useState(0);
  const [cleanupLoadingKey, setCleanupLoadingKey] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberProject, setMemberProject] = useState<OemProject | null>(null);
  const [membersForm] = Form.useForm();
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [customerServiceProject, setCustomerServiceProject] = useState<OemProject | null>(null);
  const [customerServiceModalOpen, setCustomerServiceModalOpen] = useState(false);
  const [customerServiceForm] = Form.useForm();
  const [customerServiceImageUrl, setCustomerServiceImageUrl] = useState<string | null>(null);
  const [customerServiceUploading, setCustomerServiceUploading] = useState(false);
  const [customerServiceSubmitting, setCustomerServiceSubmitting] = useState(false);
  // mac 安装指引弹窗：非 null 即打开，内容按具体下载文件生成
  const [macGuide, setMacGuide] = useState<MacGuideInfo | null>(null);

  const loadAuth = async () => {
    setAuthLoading(true);
    try {
      const res = await cloudBuildApi.authCheck();
      setAuth(res.data);
    } catch (err: any) {
      setAuth({
        authorized: false,
        reason: 'request_failed',
        message: err.response?.data?.message || err.message || '授权预检请求失败',
        origin: err.response?.data?.origin,
      });
    }
    setAuthLoading(false);
  };

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await oemProjectApi.list(projectParams);
      setProjects({ items: res.data.items || [], total: res.data.total || 0 });
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载 OEM 项目失败');
    }
    setLoading(false);
  };

  const loadUsers = async () => {
    try {
      const res = await userApi.list({ page: 1, per_page: 500, status: 'active' });
      setUsers(res.data.data || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadAuth();
    loadUsers();
  }, []);
  useEffect(() => { loadProjects(); }, [projectParams.page, projectParams.page_size, projectParams.status, projectParams.keyword]);

  const uploadIcon = async (file: File, targetForm: any) => {
    const result = await validateCloudBuildIcon(file);
    if (result !== true) {
      message.error(result);
      return Upload.LIST_IGNORE;
    }
    setIconUploading(true);
    try {
      const res = await cloudBuildApi.uploadIcon(file);
      targetForm.setFieldValue('icon_url', res.data.icon_url);
      message.success('图标上传成功');
    } catch (err: any) {
      message.error(getCloudBuildIconUploadErrorMessage(err));
    }
    setIconUploading(false);
    return Upload.LIST_IGNORE;
  };

  const uploadCustomerServiceImage = async (file: File) => {
    setCustomerServiceUploading(true);
    try {
      const res = await cloudBuildApi.uploadCustomerServiceImage(file);
      const imageUrl = res.data.image_url;
      customerServiceForm.setFieldValue('customer_service_image_url', imageUrl);
      setCustomerServiceImageUrl(imageUrl);
      message.success('客服图片上传成功');
    } catch (err: any) {
      message.error(err.response?.data?.error || '客服图片上传失败');
    }
    setCustomerServiceUploading(false);
    return Upload.LIST_IGNORE;
  };

  const authorized = auth?.authorized === true;
  const packagingLicensed = auth?.can_use_github_packaging === true;
  const macLicensed = auth?.can_use_mac_packaging === true;
  const maintenance = authorized && auth?.maintenance === true;
  const maintenanceText = (auth?.maintenance_message && auth.maintenance_message.trim()) || DEFAULT_MAINTENANCE_TEXT;
  const adminVersionTooLow = authorized && auth?.admin_version_too_low === true;
  const minAdminVersion = (auth?.min_admin_version || '').trim();
  const currentAdminVersion = (auth?.current_admin_version || '').trim();
  const buildSubmitDisabled = !authorized || !packagingLicensed || maintenance || adminVersionTooLow;
  const buildDisabledText = !authorized
    ? '本站未获授权，无法提交'
    : !packagingLicensed
      ? '未获打包授权，无法提交'
    : maintenance
      ? '平台维护中，暂停提交'
      : adminVersionTooLow
        ? `云控端版本过低，请先升级到 ${minAdminVersion || '最新版'}`
        : null;

  const openCreateProject = () => {
    setProjectModalMode('create');
    setEditingProject(null);
    projectForm.resetFields();
    projectForm.setFieldsValue({ status: 'active', commission_enabled: true, commission_rate: 0 });
    setProjectModalOpen(true);
  };

  const openEditProject = (project: OemProject) => {
    setProjectModalMode('edit');
    setEditingProject(project);
    projectForm.setFieldsValue({
      ...project,
      commission_enabled: !!project.commission_enabled,
      commission_rate: Number(project.commission_rate || 0),
    });
    setProjectModalOpen(true);
  };

  const submitProject = async () => {
    const values = await projectForm.validateFields();
    setProjectSubmitting(true);
    try {
      if (projectModalMode === 'create') {
        await oemProjectApi.create(values);
        message.success('OEM 项目已创建');
      } else if (editingProject) {
        await oemProjectApi.update(editingProject.project_key, values);
        message.success('OEM 项目已更新');
      }
      setProjectModalOpen(false);
      loadProjects();
    } catch (err: any) {
      message.error(err.response?.data?.message || err.response?.data?.error || '保存失败');
    }
    setProjectSubmitting(false);
  };

  const archiveProject = async (project: OemProject) => {
    try {
      await oemProjectApi.delete(project.project_key);
      message.success('项目已归档');
      loadProjects();
    } catch (err: any) {
      message.error(err.response?.data?.error || '归档失败');
    }
  };

  const openBuilds = (project: OemProject) => {
    navigate(`/oem-projects/${project.project_key}/builds`);
  };

  const openBuildModal = (project: OemProject) => {
    if (buildSubmitDisabled) {
      loadAuth();
    }
    setSelectedProject(project);
    buildForm.resetFields();
    buildForm.setFieldsValue({
      platform: 'win',
      app_name: project.app_name,
      icon_url: project.icon_url,
    });
    setBuildModalOpen(true);
  };

  const submitBuild = async () => {
    if (!selectedProject) return;
    if (buildSubmitDisabled) {
      loadAuth();
      message.error(buildDisabledText || '当前无法提交 OEM 打包');
      return;
    }
    const values = await buildForm.validateFields();
    setBuildSubmitting(true);
    try {
      const res = await oemProjectApi.requestBuild(selectedProject.project_key, values);
      message.success(`已加入 OEM 打包队列：${res.data.build_id}`);
      setBuildModalOpen(false);
      loadProjects();
      navigate(`/oem-projects/${selectedProject.project_key}/builds`, { state: { highlight_build_id: res.data.build_id } });
    } catch (err: any) {
      const detail = err.response?.data;
      if (detail?.error === 'agent_build_rejected') {
        const inner = detail.agent_build_response;
        const code = inner?.error_code;
        if (code === 'maintenance_mode') {
          message.error(inner?.error || '云打包平台维护中，暂停打包');
          loadAuth();
        } else if (code === 'admin_version_too_low') {
          message.error(inner?.error || '云控端版本过低，请先升级');
          loadAuth();
        } else {
          message.error(inner?.error || '打包平台拒绝');
        }
      } else if (detail?.error === 'packaging_not_licensed' || detail?.error === 'packaging_mac_not_licensed') {
        message.error('尚未获得打包授权，请联系授权平台开通');
        loadAuth();
      } else {
        message.error(detail?.message || detail?.error || '提交打包失败');
      }
    }
    setBuildSubmitting(false);
  };

  const cleanupInvalid = async (project: OemProject) => {
    setCleanupLoadingKey(project.project_key);
    try {
      const res = await oemProjectApi.cleanupInvalid(project.project_key);
      const { records_deleted = 0, files_deleted = 0 } = res.data || {};
      message.success(`已清空 ${records_deleted} 条无效记录${files_deleted ? `，删除 ${files_deleted} 个文件` : ''}`);
      loadProjects();
    } catch (err: any) {
      message.error(err.response?.data?.error || '清空失败');
    }
    setCleanupLoadingKey(null);
  };

  const loadInstallers = async (project = installerProject) => {
    if (!project) return;
    setInstallersLoading(true);
    try {
      const res = await oemProjectApi.listInstallers(project.project_key);
      setInstallers(res.data?.items || []);
      setInstallersTotal(res.data?.total_size || 0);
      setInstallersBase(res.data?.base || '');
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载安装包列表失败');
    }
    setInstallersLoading(false);
  };

  const openInstallers = (project: OemProject) => {
    setInstallerProject(project);
    setInstallersOpen(true);
    loadInstallers(project);
  };

  const removeInstaller = async (filename: string) => {
    if (!installerProject) return;
    try {
      await oemProjectApi.deleteInstaller(installerProject.project_key, filename);
      message.success(`已删除 ${filename}`);
      loadInstallers(installerProject);
      loadProjects();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const openMembers = async (project: OemProject) => {
    setMemberProject(project);
    setMemberModalOpen(true);
    membersForm.resetFields();
    try {
      const res = await oemProjectApi.members(project.project_key);
      membersForm.setFieldsValue({
        members: (res.data.members || []).map((m: any) => ({
          user_id: m.user_id,
          role: m.role || 'owner',
          status: m.status || 'active',
        })),
      });
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载成员失败');
    }
  };

  const openCustomerService = (project: OemProject) => {
    setCustomerServiceProject(project);
    customerServiceForm.setFieldsValue({
      customer_service_title: project.customer_service_title || '',
      customer_service_image_url: project.customer_service_image_url || '',
    });
    setCustomerServiceImageUrl(project.customer_service_image_url || null);
    setCustomerServiceModalOpen(true);
  };

  const submitCustomerService = async () => {
    if (!customerServiceProject) return;
    const values = await customerServiceForm.validateFields();
    setCustomerServiceSubmitting(true);
    try {
      await oemProjectApi.update(customerServiceProject.project_key, {
        customer_service_title: values.customer_service_title || '',
        customer_service_image_url: values.customer_service_image_url || '',
      });
      message.success('客服信息已保存');
      setCustomerServiceModalOpen(false);
      loadProjects();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
    setCustomerServiceSubmitting(false);
  };

  const submitMembers = async () => {
    if (!memberProject) return;
    const values = await membersForm.validateFields();
    setMemberSubmitting(true);
    try {
      await oemProjectApi.syncMembers(memberProject.project_key, values.members || []);
      message.success('成员已保存');
      setMemberModalOpen(false);
      loadProjects();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存成员失败');
    }
    setMemberSubmitting(false);
  };

  const projectColumns = [
    { title: '项目', dataIndex: 'name', render: (_: any, row: OemProject) => (
      <Space direction="vertical" size={0}>
        <Space>
          {row.icon_url && <Image src={row.icon_url} width={28} height={28} preview={false} style={{ objectFit: 'contain' }} />}
          <Text strong>{row.name}</Text>
          {statusTag(row.status)}
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>内部标识：{row.project_key}</Text>
      </Space>
    ) },
    { title: '应用名称', dataIndex: 'app_name', width: 160 },
    { title: 'App ID', dataIndex: 'app_id', ellipsis: true, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    { title: '更新目录', dataIndex: 'update_path', ellipsis: true, render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text> },
    {
      title: '佣金', width: 120,
      render: (_: any, row: OemProject) => row.commission_enabled
        ? <Tag color="green">{(Number(row.commission_rate || 0) * 100).toFixed(2)}%</Tag>
        : <Tag>未启用</Tag>,
    },
    { title: '成员', dataIndex: 'member_count', width: 80, render: (v: number) => v || 0 },
    { title: '构建数', dataIndex: 'build_count', width: 80, render: (v: number) => v || 0 },
    { title: '最近构建', dataIndex: 'last_build_at', width: 150, render: (v: string) => fmtTime(v) },
    { title: '操作', width: 360, render: (_: any, row: OemProject) => (
      <Space size={[8, 8]} wrap>
        <Button size="small" icon={<RocketOutlined />} onClick={() => openBuildModal(row)} disabled={row.status !== 'active' || buildSubmitDisabled}>打包</Button>
        <Button size="small" icon={<HistoryOutlined />} onClick={() => openBuilds(row)}>历史</Button>
        <Button size="small" icon={<AppstoreOutlined />} onClick={() => openInstallers(row)}>安装包</Button>
        <Button size="small" onClick={() => openMembers(row)}>成员</Button>
        <Button size="small" onClick={() => openCustomerService(row)}>客服信息</Button>
        <Button size="small" icon={<EditOutlined />} onClick={() => openEditProject(row)}>编辑</Button>
        <Popconfirm title="清空该项目无效记录？" description="将删除已取消、失败状态的历史记录，并尽可能清理关联安装包文件。" onConfirm={() => cleanupInvalid(row)}>
          <Button size="small" icon={<ClearOutlined />} loading={cleanupLoadingKey === row.project_key}>清理</Button>
        </Popconfirm>
        <Popconfirm title="确认归档该 OEM 项目？" onConfirm={() => archiveProject(row)}>
          <Button size="small" danger icon={<DeleteOutlined />}>归档</Button>
        </Popconfirm>
      </Space>
    ) },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>OEM 项目</Title>
        <Space>
          <Input.Search
            allowClear
            placeholder="搜索项目、应用名、App ID"
            style={{ width: 260 }}
            onSearch={(keyword) => setProjectParams({ ...projectParams, keyword, page: 1 })}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            options={['active', 'disabled', 'archived'].map(k => ({ value: k, label: STATUS_LABEL[k].label }))}
            onChange={(status) => setProjectParams({ ...projectParams, status, page: 1 })}
          />
          <Button icon={<ReloadOutlined />} onClick={loadProjects}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateProject}>新建 OEM 项目</Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="OEM 项目拥有独立 appId 和更新目录"
        description="每个项目会自动生成独立内部标识，更新文件会落盘到独立 OEM 目录，不会覆盖普通云打包的 /public/updates/。"
      />

      {authLoading ? (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space><Spin size="small" /> <Text type="secondary">正在校验本站打包授权…</Text></Space>
        </Card>
      ) : !authorized ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="本站尚未获得打包平台授权"
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div>{auth?.message || '未知原因，请联系打包平台管理员。'}</div>
              {auth?.origin && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  本站发起请求的域名是 <Tag color="red">{auth.origin}</Tag>，未在打包平台授权列表中。
                </Text>
              )}
              {auth?.reason && <Text type="secondary" style={{ fontSize: 12 }}>错误代码：<code>{auth.reason}</code></Text>}
              <Button size="small" icon={<ReloadOutlined />} onClick={loadAuth}>重新检测</Button>
            </Space>
          }
        />
      ) : (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <Tag color="green">已授权</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{auth?.domain}</Text>
              {typeof auth?.daily_limit === 'number' && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  · 今日配额 {auth?.daily_used ?? 0}/{auth?.daily_limit}
                </Text>
              )}
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={loadAuth} />
            </Space>
          }
        />
      )}

      {maintenance && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="云打包平台维护中"
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div>{maintenanceText}</div>
              <Button size="small" icon={<ReloadOutlined />} onClick={loadAuth}>重新检测</Button>
            </Space>
          }
        />
      )}

      {!maintenance && adminVersionTooLow && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="云控端版本过低，已被打包平台限制"
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div>
                打包平台要求的最低云控端版本为
                <Tag color="blue" style={{ marginLeft: 4, marginRight: 4 }}>{minAdminVersion || '?'}</Tag>
                ，当前云控端版本为
                <Tag color="red" style={{ marginLeft: 4 }}>{currentAdminVersion || '未知'}</Tag>
              </div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                请先在管理后台「在线更新」升级云控端到 {minAdminVersion || '最新版'} 或更高版本，再回来申请 OEM 打包。
              </Text>
              <Button size="small" icon={<ReloadOutlined />} onClick={loadAuth}>重新检测</Button>
            </Space>
          }
        />
      )}

      <Table
        rowKey="id"
        columns={projectColumns as any}
        dataSource={projects.items}
        loading={loading}
        pagination={{
          current: projectParams.page,
          pageSize: projectParams.page_size,
          total: projects.total,
          showSizeChanger: true,
          onChange: (page, page_size) => setProjectParams({ ...projectParams, page, page_size }),
        }}
      />

      <Modal
        title={projectModalMode === 'create' ? '新建 OEM 项目' : '编辑 OEM 项目'}
        open={projectModalOpen}
        onCancel={() => setProjectModalOpen(false)}
        onOk={submitProject}
        confirmLoading={projectSubmitting}
        width={680}
        destroyOnClose
        mask={false}
      >
        <Form form={projectForm} layout="vertical">
          {projectModalMode === 'edit' && (
            <Form.Item label="内部标识" name="project_key">
              <Input disabled />
            </Form.Item>
          )}
          <Form.Item
            label="项目名称"
            name="name"
            extra={projectModalMode === 'create' ? '新建后会默认作为客户端应用显示名，后续可在编辑中单独调整。' : undefined}
            rules={[{ required: true }, { max: projectModalMode === 'create' ? 50 : 100 }]}
          >
            <Input placeholder="例如 ACME 专版" />
          </Form.Item>
          {projectModalMode === 'edit' && (
            <Form.Item label="应用显示名" name="app_name" rules={[{ required: true }, { max: 50 }]}>
              <Input placeholder="例如 ACME 数字员工" />
            </Form.Item>
          )}
          <Form.Item
            label="应用图标 URL"
            name="icon_url"
            rules={[{ type: 'url', message: '请输入有效 URL' }]}
            extra={`上传要求：${CLOUD_BUILD_ICON_RULE_TEXT}。也可手动填写图标 URL，但同样必须是合规 PNG，否则保存或打包会被拒绝。`}
          >
            <Input addonAfter={<Upload showUploadList={false} accept="image/png" beforeUpload={(file) => uploadIcon(file, projectForm)}><Button size="small" icon={<UploadOutlined />} loading={iconUploading}>上传</Button></Upload>} />
          </Form.Item>
          {projectModalMode === 'edit' && (
            <Form.Item label="App ID" name="app_id" extra="系统自动生成，作为桌面端应用唯一标识。">
              <Input disabled />
            </Form.Item>
          )}
          <Form.Item label="状态" name="status" initialValue="active">
            <Select options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }, { value: 'archived', label: '归档' }]} />
          </Form.Item>
          <Space size={16} style={{ width: '100%' }} align="baseline">
            <Form.Item label="启用佣金" name="commission_enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              label="佣金比例"
              name="commission_rate"
              extra="取值 0~1，例如 0.2 表示 20%"
              rules={[{ type: 'number', min: 0, max: 1 }]}
            >
              <InputNumber min={0} max={1} step={0.01} precision={4} style={{ width: 180 }} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      <Modal
        title={memberProject ? `成员绑定：${memberProject.name}` : '成员绑定'}
        open={memberModalOpen}
        onCancel={() => setMemberModalOpen(false)}
        onOk={submitMembers}
        confirmLoading={memberSubmitting}
        width={760}
        destroyOnClose
        mask={false}
      >
        <Form form={membersForm} layout="vertical">
          <Form.List name="members">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ width: '100%' }}>
                    <Form.Item
                      {...field}
                      name={[field.name, 'user_id']}
                      rules={[{ required: true, message: '请选择用户' }]}
                    >
                      <Select
                        showSearch
                        placeholder="选择用户"
                        style={{ width: 280 }}
                        optionFilterProp="label"
                        options={users.map((u) => ({ value: u.id, label: `${u.nickname || u.username} #${u.id}` }))}
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'role']} initialValue="owner">
                      <Select
                        style={{ width: 120 }}
                        options={[{ value: 'owner', label: '负责人' }, { value: 'manager', label: '协管人' }]}
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'status']} initialValue="active">
                      <Select
                        style={{ width: 120 }}
                        options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }]}
                      />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>移除</Button>
                  </Space>
                ))}
                <Button onClick={() => add({ role: 'owner', status: 'active' })}>添加成员</Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title={customerServiceProject ? `客服信息：${customerServiceProject.name}` : '客服信息'}
        open={customerServiceModalOpen}
        onCancel={() => setCustomerServiceModalOpen(false)}
        onOk={submitCustomerService}
        confirmLoading={customerServiceSubmitting}
        width={520}
        destroyOnClose
        mask={false}
      >
        <Form form={customerServiceForm} layout="vertical">
          <Form.Item label="标题" name="customer_service_title" rules={[{ max: 50, message: '不超过 50 个字' }]}>
            <Input placeholder="例如：联系客服" allowClear />
          </Form.Item>
          <Form.Item label="图片 URL" name="customer_service_image_url" rules={[{ type: 'url', message: '请输入有效 URL' }]}>
            <Input
              allowClear
              onChange={(e) => setCustomerServiceImageUrl(e.target.value || null)}
              addonAfter={
                <Upload showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(file) => uploadCustomerServiceImage(file)}>
                  <Button size="small" loading={customerServiceUploading}>上传</Button>
                </Upload>
              }
            />
          </Form.Item>
          {customerServiceImageUrl && (
            <Image src={customerServiceImageUrl} alt="客服信息" width="100%" style={{ borderRadius: 8 }} />
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            标题和图片都填写后，对应 OEM 桌面端用户中心才会显示客服信息卡片；清空任一项则不显示。
          </Text>
        </Form>
      </Modal>

      <Modal
        title={selectedProject ? `发起 OEM 打包：${selectedProject.name}` : '发起 OEM 打包'}
        open={buildModalOpen}
        onCancel={() => setBuildModalOpen(false)}
        onOk={submitBuild}
        okButtonProps={{ disabled: buildSubmitDisabled }}
        okText={buildDisabledText || '提交打包'}
        confirmLoading={buildSubmitting}
        width={620}
        destroyOnClose
        mask={false}
      >
        <Form form={buildForm} layout="vertical">
          <Form.Item label="目标平台" name="platform" rules={[{ required: true }]}>
            <Select options={[{ value: 'win', label: 'Windows (.exe)' }, { value: 'mac', label: 'macOS (.zip)', disabled: !macLicensed }]} />
          </Form.Item>
          <Form.Item label="本次应用显示名" name="app_name" rules={[{ max: 50 }]}>
            <Input />
          </Form.Item>
          <Form.Item
            label="本次图标 URL"
            name="icon_url"
            rules={[{ type: 'url', message: '请输入有效 URL' }]}
            extra={`上传要求：${CLOUD_BUILD_ICON_RULE_TEXT}。也可手动填写图标 URL，但同样必须是合规 PNG，否则保存或打包会被拒绝。`}
          >
            <Input addonAfter={<Upload showUploadList={false} accept="image/png" beforeUpload={(file) => uploadIcon(file, buildForm)}><Button size="small" icon={<UploadOutlined />} loading={iconUploading}>上传</Button></Upload>} />
          </Form.Item>
          {selectedProject && (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="App ID"><Text code>{selectedProject.app_id}</Text></Descriptions.Item>
              <Descriptions.Item label="更新目录"><Text code>{selectedProject.update_path}</Text></Descriptions.Item>
              <Descriptions.Item label="版本来源">跟随授权管理端当前模板版本</Descriptions.Item>
            </Descriptions>
          )}
        </Form>
      </Modal>

      <Modal
        open={installersOpen}
        onCancel={() => setInstallersOpen(false)}
        footer={null}
        title={installerProject ? `安装包文件管理：${installerProject.name}` : '安装包文件管理'}
        width={920}
        mask={false}
        destroyOnClose
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            <FolderOpenOutlined style={{ marginRight: 4 }} />{installersBase || '-'}
          </Text>
          <Text type="secondary">总占用：<Tag>{fmtSize(installersTotal)}</Tag></Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => loadInstallers()} loading={installersLoading}>刷新</Button>
        </Space>
        <Table<InstallerVersion>
          rowKey="filename"
          size="small"
          loading={installersLoading}
          dataSource={installers}
          pagination={false}
          scroll={{ y: 480 }}
          columns={[
            {
              title: '安装包',
              dataIndex: 'filename',
              ellipsis: true,
              render: (v: string, row: InstallerVersion) => {
                // .app 显示名来自关联构建；无关联时无法确定 .app 名，不给安装指引入口
                const linked = row.linked_build;
                const arch = /arm64/i.test(row.filename) ? 'arm64' : (/x64/i.test(row.filename) ? 'x64' : null);
                return (
                  <Space direction="vertical" size={2}>
                    <span>
                      <a
                        href={`/${row.stored_path}`}
                        download={friendlyDownloadName({
                          platform: row.platform,
                          appName: linked?.app_name,
                          version: linked?.app_version,
                          filename: row.filename,
                          arch,
                        })}
                        style={{ fontFamily: 'monospace', fontSize: 12 }}
                      >
                        <DownloadOutlined style={{ marginRight: 4 }} />{v}
                      </a>
                      {row.platform === 'mac' && linked && (
                        <Typography.Link
                          style={{ marginLeft: 8, fontSize: 11, whiteSpace: 'nowrap' }}
                          onClick={() => setMacGuide({
                            appName: linked.app_name,
                            zipName: row.filename,
                            url: absoluteDownloadUrl(row.stored_path),
                          })}
                        >
                          mac 安装指引
                        </Typography.Link>
                      )}
                    </span>
                    {row.blockmap_filename && <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>+ {row.blockmap_filename}</Text>}
                  </Space>
                );
              },
            },
            { title: '平台', dataIndex: 'platform', width: 100, render: platformTag },
            {
              title: '总大小',
              dataIndex: 'size',
              width: 110,
              render: (_: number, row: InstallerVersion) => (
                <Tooltip title={row.blockmap_filename ? `主包 ${fmtSize(row.primary_size)} + blockmap ${fmtSize(row.blockmap_size)}` : `主包 ${fmtSize(row.primary_size)}`}>
                  <span>{fmtSize(row.size)}</span>
                </Tooltip>
              ),
            },
            { title: '修改时间', dataIndex: 'mtime', width: 160, render: (v: string | null) => v || '-' },
            {
              title: '关联构建',
              dataIndex: 'linked_build',
              width: 200,
              render: (v: InstallerVersion['linked_build']) => v ? (
                <Tooltip title={`build_id: ${v.build_id}`}>
                  <Tag style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.app_name} {v.app_version}</Tag>
                </Tooltip>
              ) : <Text type="secondary" style={{ fontSize: 11 }}>无关联</Text>,
            },
            {
              title: '操作',
              width: 90,
              fixed: 'right' as const,
              render: (_: any, row: InstallerVersion) => (
                <Popconfirm
                  title="删除该版本的安装包？"
                  description={row.blockmap_filename ? `将一并删除：${row.filename} + ${row.blockmap_filename}，无法恢复。` : `将删除：${row.filename}，无法恢复。`}
                  onConfirm={() => removeInstaller(row.filename)}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              ),
            },
          ]}
          locale={{ emptyText: '该 OEM 项目的安装包目录为空' }}
        />
      </Modal>

      {/* macOS 未签名包安装指引（方案A 一键命令 / 方案B xattr 补救） */}
      <MacInstallGuideModal
        open={macGuide !== null}
        onClose={() => setMacGuide(null)}
        info={macGuide}
      />

    </div>
  );
}
