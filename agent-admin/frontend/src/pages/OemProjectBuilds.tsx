import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Alert, Button, Card, Descriptions, Drawer, Form, Input, message,
  Modal, Popconfirm, Progress, Select, Space, Table, Tag, Typography, Upload,
  Spin, Tooltip,
} from 'antd';
import {
  AppstoreOutlined, ArrowLeftOutlined, ClearOutlined, DeleteOutlined, DownloadOutlined,
  EyeOutlined, FolderOpenOutlined, RedoOutlined, ReloadOutlined, RocketOutlined,
  StopOutlined, UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { cloudBuildApi, oemProjectApi } from '../services/api';
import {
  CLOUD_BUILD_ICON_RULE_TEXT,
  getCloudBuildIconUploadErrorMessage,
  validateCloudBuildIcon,
} from '../utils/cloudBuildIcon';

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
  build_count?: number;
  latest_build_created_at?: string | null;
  last_build_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface OemBuild {
  id: number;
  build_id: string;
  project_key: string;
  platform: 'win' | 'mac';
  app_name: string;
  app_version: string;
  app_id: string;
  update_path: string;
  status: string;
  filename?: string | null;
  artifact_size?: number | null;
  downloaded_bytes?: number | null;
  sha256?: string | null;
  stored_path?: string | null;
  agent_build_url?: string | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  delivered_at?: string | null;
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

export default function OemProjectBuildsPage() {
  const navigate = useNavigate();
  const { projectKey = '' } = useParams();
  const location = useLocation();
  const highlightBuildId = (location.state as any)?.highlight_build_id;

  const [project, setProject] = useState<OemProject | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [builds, setBuilds] = useState<{ items: OemBuild[]; total: number }>({ items: [], total: 0 });
  const [buildParams, setBuildParams] = useState<Record<string, any>>({ page: 1, page_size: 20 });
  const [buildsLoading, setBuildsLoading] = useState(false);

  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const [buildForm] = Form.useForm();
  const [buildSubmitting, setBuildSubmitting] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const [detail, setDetail] = useState<OemBuild | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [authLoading, setAuthLoading] = useState(true);
  const [auth, setAuth] = useState<AuthCheckResult | null>(null);
  const [installersOpen, setInstallersOpen] = useState(false);
  const [installers, setInstallers] = useState<InstallerVersion[]>([]);
  const [installersLoading, setInstallersLoading] = useState(false);
  const [installersBase, setInstallersBase] = useState('');
  const [installersTotal, setInstallersTotal] = useState(0);
  const [cleanupLoading, setCleanupLoading] = useState(false);

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

  const loadProject = async () => {
    if (!projectKey) return;
    setProjectLoading(true);
    try {
      const res = await oemProjectApi.get(projectKey);
      setProject(res.data.project || null);
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载 OEM 项目失败');
    }
    setProjectLoading(false);
  };

  const loadBuilds = async (params = buildParams) => {
    if (!projectKey) return;
    setBuildsLoading(true);
    try {
      const res = await oemProjectApi.builds(projectKey, params);
      setBuilds({ items: res.data.items || [], total: res.data.total || 0 });
      if (res.data.project) setProject(res.data.project);
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载 OEM 构建历史失败');
    }
    setBuildsLoading(false);
  };

  useEffect(() => { loadAuth(); }, []);
  useEffect(() => { loadProject(); }, [projectKey]);
  useEffect(() => { loadBuilds(); }, [projectKey, buildParams.page, buildParams.page_size, buildParams.status, buildParams.platform]);

  useEffect(() => {
    const active = builds.items.some(b => ['queued', 'building', 'success', 'downloading'].includes(b.status));
    if (!active) return;
    const timer = setInterval(() => loadBuilds(), 8000);
    return () => clearInterval(timer);
  }, [builds.items.map(b => b.status).join(',')]);

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

  const authorized = auth?.authorized === true;
  const packagingLicensed = auth?.can_use_github_packaging === true;
  const macLicensed = auth?.can_use_mac_packaging === true;
  const maintenance = authorized && auth?.maintenance === true;
  const maintenanceText = (auth?.maintenance_message && auth.maintenance_message.trim()) || DEFAULT_MAINTENANCE_TEXT;
  const adminVersionTooLow = authorized && auth?.admin_version_too_low === true;
  const minAdminVersion = (auth?.min_admin_version || '').trim();
  const currentAdminVersion = (auth?.current_admin_version || '').trim();
  const buildSubmitDisabled = !authorized || !packagingLicensed || maintenance || adminVersionTooLow || project?.status !== 'active';
  const buildDisabledText = project?.status !== 'active'
    ? '项目未启用，无法提交'
    : !authorized
      ? '本站未获授权，无法提交'
      : !packagingLicensed
        ? '未获打包授权，无法提交'
      : maintenance
        ? '平台维护中，暂停提交'
        : adminVersionTooLow
          ? `云控端版本过低，请先升级到 ${minAdminVersion || '最新版'}`
          : null;

  const openBuildModal = () => {
    if (!project) return;
    if (buildSubmitDisabled) loadAuth();
    buildForm.resetFields();
    buildForm.setFieldsValue({
      platform: 'win',
      app_name: project.app_name,
      icon_url: project.icon_url,
    });
    setBuildModalOpen(true);
  };

  const submitBuild = async () => {
    if (!project) return;
    if (buildSubmitDisabled) {
      loadAuth();
      message.error(buildDisabledText || '当前无法提交 OEM 打包');
      return;
    }
    const values = await buildForm.validateFields();
    setBuildSubmitting(true);
    try {
      const res = await oemProjectApi.requestBuild(project.project_key, values);
      message.success(`已加入 OEM 打包队列：${res.data.build_id}`);
      setBuildModalOpen(false);
      const nextParams = { ...buildParams, page: 1 };
      setBuildParams(nextParams);
      loadBuilds(nextParams);
      loadProject();
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
        message.error(detail?.error || '提交打包失败');
      }
    }
    setBuildSubmitting(false);
  };

  const refreshBuild = async (row: OemBuild) => {
    try {
      const res = await oemProjectApi.refreshBuild(row.project_key, row.build_id);
      if (res.data.build) setDetail(res.data.build);
      loadBuilds();
      message.success('已刷新');
    } catch (err: any) {
      message.error(err.response?.data?.error || '刷新失败');
    }
  };

  const retryBuild = async (row: OemBuild) => {
    try {
      const res = await oemProjectApi.retryBuild(row.project_key, row.build_id);
      if (res.data.build) setDetail(res.data.build);
      loadBuilds();
      message.success('已重试拉取');
    } catch (err: any) {
      message.error(err.response?.data?.error || '重试失败');
    }
  };

  const cancelBuild = async (row: OemBuild, force = false) => {
    try {
      await oemProjectApi.cancelBuild(row.project_key, row.build_id, force);
      message.success('已取消');
      loadBuilds();
    } catch (err: any) {
      message.error(err.response?.data?.error || '取消失败');
    }
  };

  const cleanupInvalid = async () => {
    if (!project) return;
    setCleanupLoading(true);
    try {
      const res = await oemProjectApi.cleanupInvalid(project.project_key);
      const { records_deleted = 0, files_deleted = 0 } = res.data || {};
      message.success(`已清空 ${records_deleted} 条无效记录${files_deleted ? `，删除 ${files_deleted} 个文件` : ''}`);
      loadBuilds();
      loadProject();
      if (installersOpen) loadInstallers();
    } catch (err: any) {
      message.error(err.response?.data?.error || '清空失败');
    }
    setCleanupLoading(false);
  };

  const loadInstallers = async () => {
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

  const openInstallers = () => {
    setInstallersOpen(true);
    loadInstallers();
  };

  const removeInstaller = async (filename: string) => {
    if (!project) return;
    try {
      await oemProjectApi.deleteInstaller(project.project_key, filename);
      message.success(`已删除 ${filename}`);
      loadInstallers();
      loadBuilds();
      loadProject();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const buildColumns = [
    { title: 'Build ID', dataIndex: 'build_id', width: 220, render: (v: string, row: OemBuild) => <Text code copyable={{ text: v }} style={{ fontSize: 12, background: highlightBuildId === row.build_id ? '#fff7e6' : undefined }}>{v}</Text> },
    { title: '平台', dataIndex: 'platform', width: 90, render: platformTag },
    { title: '版本', dataIndex: 'app_version', width: 110 },
    { title: '状态', dataIndex: 'status', width: 100, render: statusTag },
    { title: '文件', dataIndex: 'filename', width: 280, ellipsis: true, render: (v: string) => v || '-' },
    { title: '大小', dataIndex: 'artifact_size', width: 110, render: fmtSize },
    { title: '创建时间', dataIndex: 'created_at', width: 150, render: fmtTime },
    { title: '操作', width: 280, fixed: 'right' as const, render: (_: any, row: OemBuild) => (
      <Space size={[8, 8]} wrap>
        <Button size="small" icon={<EyeOutlined />} onClick={() => { setDetail(row); setDetailOpen(true); }}>详情</Button>
        {!['delivered', 'failed', 'cancelled', 'expired', 'purged'].includes(row.status) && (
          <Button size="small" icon={<ReloadOutlined />} onClick={() => refreshBuild(row)}>刷新</Button>
        )}
        {['queued', 'building'].includes(row.status) && (
          <Popconfirm title="确认取消该 OEM 构建？" onConfirm={() => cancelBuild(row)}>
            <Button size="small" danger icon={<StopOutlined />}>取消</Button>
          </Popconfirm>
        )}
        {['failed', 'cancelled', 'expired'].includes(row.status) && (
          <Button size="small" icon={<RedoOutlined />} onClick={() => retryBuild(row)}>
            {!row.stored_path && !row.agent_build_url ? '重新排队' : '重试'}
          </Button>
        )}
      </Space>
    ) },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/oem-projects')}>返回项目</Button>
          <Title level={3} style={{ margin: 0 }}>{project ? `构建历史：${project.name}` : 'OEM 构建历史'}</Title>
          {project && statusTag(project.status)}
        </Space>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => { loadProject(); loadBuilds(); }}>刷新</Button>
          <Button icon={<AppstoreOutlined />} onClick={openInstallers} disabled={!project}>安装包</Button>
          <Popconfirm title="清空该项目无效记录？" description="将删除已取消、失败状态的历史记录，并尽可能清理关联安装包文件。" onConfirm={cleanupInvalid}>
            <Button icon={<ClearOutlined />} loading={cleanupLoading} disabled={!project}>清理无效</Button>
          </Popconfirm>
          <Button type="primary" icon={<RocketOutlined />} onClick={openBuildModal} disabled={buildSubmitDisabled}>{buildDisabledText || '发起打包'}</Button>
        </Space>
      </div>

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
      ) : maintenance ? (
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
      ) : adminVersionTooLow ? (
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
      ) : null}

      <Card size="small" loading={projectLoading} style={{ marginBottom: 16 }}>
        {project ? (
          <Descriptions column={2} size="small">
            <Descriptions.Item label="内部标识"><Text code>{project.project_key}</Text></Descriptions.Item>
            <Descriptions.Item label="应用名称">{project.app_name}</Descriptions.Item>
            <Descriptions.Item label="App ID"><Text code>{project.app_id}</Text></Descriptions.Item>
            <Descriptions.Item label="更新目录"><Text code>{project.update_path}</Text></Descriptions.Item>
          </Descriptions>
        ) : <Text type="secondary">项目不存在或正在加载</Text>}
      </Card>

      <Space style={{ marginBottom: 12 }} wrap>
        <Select allowClear placeholder="状态" style={{ width: 120 }} options={Object.keys(STATUS_LABEL).filter(k => !['active', 'disabled', 'archived'].includes(k)).map(k => ({ value: k, label: STATUS_LABEL[k].label }))} onChange={(status) => setBuildParams({ ...buildParams, status, page: 1 })} />
        <Select allowClear placeholder="平台" style={{ width: 120 }} options={[{ value: 'win', label: 'Windows' }, { value: 'mac', label: 'macOS' }]} onChange={(platform) => setBuildParams({ ...buildParams, platform, page: 1 })} />
      </Space>
      <Table
        rowKey="build_id"
        columns={buildColumns as any}
        dataSource={builds.items}
        loading={buildsLoading}
        size="small"
        scroll={{ x: 1340 }}
        pagination={{
          current: buildParams.page,
          pageSize: buildParams.page_size,
          total: builds.total,
          showSizeChanger: true,
          onChange: (page, page_size) => setBuildParams({ ...buildParams, page, page_size }),
        }}
      />

      <Modal
        title={project ? `发起 OEM 打包：${project.name}` : '发起 OEM 打包'}
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
            extra={`上传要求：${CLOUD_BUILD_ICON_RULE_TEXT}。也可手动填写已上传图标的完整 URL。`}
          >
            <Input addonAfter={<Upload showUploadList={false} accept="image/png" beforeUpload={(file) => uploadIcon(file, buildForm)}><Button size="small" icon={<UploadOutlined />} loading={iconUploading}>上传</Button></Upload>} />
          </Form.Item>
          {project && (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="App ID"><Text code>{project.app_id}</Text></Descriptions.Item>
              <Descriptions.Item label="更新目录"><Text code>{project.update_path}</Text></Descriptions.Item>
              <Descriptions.Item label="版本来源">跟随授权管理端当前模板版本</Descriptions.Item>
            </Descriptions>
          )}
        </Form>
      </Modal>

      <Modal
        open={installersOpen}
        onCancel={() => setInstallersOpen(false)}
        footer={null}
        title={project ? `安装包文件管理：${project.name}` : '安装包文件管理'}
        width={920}
        mask={false}
        destroyOnClose
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            <FolderOpenOutlined style={{ marginRight: 4 }} />{installersBase || '-'}
          </Text>
          <Text type="secondary">总占用：<Tag>{fmtSize(installersTotal)}</Tag></Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={loadInstallers} loading={installersLoading}>刷新</Button>
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
              render: (v: string, row: InstallerVersion) => (
                <Space direction="vertical" size={2}>
                  <a href={`/${row.stored_path}`} download={row.filename} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    <DownloadOutlined style={{ marginRight: 4 }} />{v}
                  </a>
                  {row.blockmap_filename && <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>+ {row.blockmap_filename}</Text>}
                </Space>
              ),
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

      <Drawer title="OEM 构建详情" open={detailOpen} onClose={() => setDetailOpen(false)} width={720} mask={false}>
        {detail && (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            {detail.status === 'downloading' && detail.artifact_size && detail.artifact_size > 0 && (
              <Progress percent={Math.min(100, Math.round((detail.downloaded_bytes || 0) / detail.artifact_size * 100))} status="active" format={(p) => `${p}% (${fmtSize(detail.downloaded_bytes)} / ${fmtSize(detail.artifact_size)})`} />
            )}
            {detail.error_message && <Alert type="error" showIcon message="错误信息" description={detail.error_message} />}
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Build ID"><Text code copyable={{ text: detail.build_id }}>{detail.build_id}</Text></Descriptions.Item>
              <Descriptions.Item label="内部标识"><Text code>{detail.project_key}</Text></Descriptions.Item>
              <Descriptions.Item label="平台">{platformTag(detail.platform)}</Descriptions.Item>
              <Descriptions.Item label="版本">{detail.app_version}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(detail.status)}</Descriptions.Item>
              <Descriptions.Item label="App ID"><Text code>{detail.app_id}</Text></Descriptions.Item>
              <Descriptions.Item label="更新目录"><Text code>{detail.update_path}</Text></Descriptions.Item>
              <Descriptions.Item label="文件名">{detail.filename || '-'}</Descriptions.Item>
              <Descriptions.Item label="大小">{fmtSize(detail.artifact_size)}</Descriptions.Item>
              <Descriptions.Item label="本地路径">{detail.stored_path ? <Text code>{detail.stored_path}</Text> : '-'}</Descriptions.Item>
              <Descriptions.Item label="SHA-256">{detail.sha256 ? <Text code copyable={{ text: detail.sha256 }}>{detail.sha256}</Text> : '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{fmtTime(detail.created_at)}</Descriptions.Item>
              <Descriptions.Item label="完成时间">{fmtTime(detail.finished_at)}</Descriptions.Item>
              <Descriptions.Item label="落盘时间">{fmtTime(detail.delivered_at)}</Descriptions.Item>
            </Descriptions>
            <Space>
              {!['delivered', 'failed', 'cancelled', 'expired', 'purged'].includes(detail.status) && <Button icon={<ReloadOutlined />} onClick={() => refreshBuild(detail)}>刷新拉取</Button>}
              {['failed', 'cancelled', 'expired'].includes(detail.status) && (
                <Button icon={<RedoOutlined />} onClick={() => retryBuild(detail)}>
                  {!detail.stored_path && !detail.agent_build_url ? '重新排队打包' : '重试拉取'}
                </Button>
              )}
            </Space>
          </Space>
        )}
      </Drawer>
    </div>
  );
}
