import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Drawer, Descriptions, message, Select,
  Typography, Tooltip, Popconfirm, Progress, Alert, Modal, Form, Input,
} from 'antd';
import {
  ReloadOutlined, EyeOutlined, StopOutlined, RocketOutlined, RedoOutlined,
  DownloadOutlined, ClearOutlined, AppstoreOutlined, ThunderboltOutlined,
  DeleteOutlined, FolderOpenOutlined, IdcardOutlined, EditOutlined,
  FileOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { cloudBuildApi } from '../../services/api';
import MacInstallGuideModal, {
  absoluteDownloadUrl, friendlyDownloadName,
} from '../../components/MacInstallGuide';
import type { MacGuideInfo } from '../../components/MacInstallGuide';

const STATUS_LABEL: Record<string, { color: string; label: string }> = {
  queued:      { color: 'default', label: '排队中' },
  building:    { color: 'processing', label: '打包中' },
  success:     { color: 'cyan', label: '已就绪' },
  downloading: { color: 'gold', label: '拉取中' },
  delivered:   { color: 'green', label: '已落盘' },
  failed:      { color: 'red', label: '失败' },
  cancelled:   { color: 'default', label: '已取消' },
  expired:     { color: 'default', label: '已过期' },
};

const TERMINAL_STATUSES = ['delivered', 'failed', 'cancelled', 'expired', 'purged'] as const;

function isTerminalCloudBuildStatus(status?: string | null): boolean {
  return !!status && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

function canAutoRefreshCloudBuild(
  local?: { status: string; stored_path?: string | null } | null,
  remote?: { status?: string } | null,
): boolean {
  if (!local || local.stored_path) return false;
  if (isTerminalCloudBuildStatus(local.status)) return false;
  if (isTerminalCloudBuildStatus(remote?.status)) return false;
  return true;
}

function needsRebuildQueue(row: { status: string; stored_path?: string | null; agent_build_url?: string | null }): boolean {
  return ['failed', 'expired', 'cancelled'].includes(row.status) && !row.stored_path && !row.agent_build_url;
}

function rebuildQueueHint(error?: string | null): string {
  if (error === 'stuck_no_run_id') {
    return 'GitHub 已触发但没有把 run_id 写回云控。常见原因是构建仓 npm ci 失败，或失败回调被服务器缓存权限打成 500。点右上角「重新排队打包」会重新发起；打开详情不会自动重入队。';
  }
  if (error === 'github_run_failure' || error === 'github_job_failed') {
    return 'GitHub Actions 已经跑完但失败。先看构建仓 Actions 日志（常见是 package-lock 与 package.json 不同步）。点右上角「重新排队打包」会重新发起；打开详情不会自动重入队。';
  }
  return '点击右上角「重新排队打包」会向 GitHub 重新发起构建，打开详情不会自动重入队';
}

interface SupplementaryFile {
  filename: string;
  role: string;
  size?: number;
  sha256?: string;
  download_url?: string;
  stored_path?: string;
}

interface CloudBuild {
  id: number;
  build_id: string;
  platform: 'win' | 'mac';
  app_name: string;
  app_version: string;
  status: string;
  filename?: string | null;
  artifact_size?: number | null;
  downloaded_bytes?: number | null;
  sha256?: string | null;
  stored_path?: string | null;
  agent_build_url?: string | null;
  supplementary_files?: string | SupplementaryFile[] | null;
  error_message?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  delivered_at?: string | null;
}

interface InstallerVersion {
  filename: string;
  platform: 'win' | 'mac';
  primary_size: number;
  blockmap_filename: string | null;
  blockmap_size: number;
  size: number;
  mtime: string | null;
  linked_build: { build_id: string; app_name: string; app_version: string } | null;
}

interface TmpArtifact {
  filename: string;
  size: number;
  mtime: string | null;
  age_sec: number;
  is_orphan: boolean;
}

interface TmpArtifactsResp {
  base: string;
  items: TmpArtifact[];
  total_size: number;
  orphan_count: number;
  orphan_size: number;
  orphan_after_hours: number;
}

interface MyInfo {
  domain: string;
  owner_name: string;
  owner_phone: string | null;
  needs_completion: boolean;
}

const PLATFORM_TAG: Record<string, { color: string; label: string }> = {
  win: { color: 'blue', label: 'Windows' },
  mac: { color: 'purple', label: 'macOS' },
};

export default function CloudBuildHistoryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const highlightBuildId = (location.state as any)?.highlight_build_id;

  const [data, setData] = useState<{ items: CloudBuild[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, page_size: 20 });
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<CloudBuild | null>(null);
  const [detailRemote, setDetailRemote] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [installersOpen, setInstallersOpen] = useState(false);
  const [installers, setInstallers] = useState<InstallerVersion[]>([]);
  const [installersLoading, setInstallersLoading] = useState(false);
  const [installersBase, setInstallersBase] = useState('');
  const [installersTotal, setInstallersTotal] = useState(0);
  // 临时产物（storage/app/cloud-builds/tmp）管理弹窗状态
  const [tmpOpen, setTmpOpen] = useState(false);
  const [tmpData, setTmpData] = useState<TmpArtifactsResp | null>(null);
  const [tmpLoading, setTmpLoading] = useState(false);
  const [tmpCleanupLoading, setTmpCleanupLoading] = useState(false);
  // 我的信息（授权信息）弹窗状态
  const [myInfoOpen, setMyInfoOpen] = useState(false);
  const [myInfo, setMyInfo] = useState<MyInfo | null>(null);
  const [myInfoLoading, setMyInfoLoading] = useState(false);
  const [myInfoEditing, setMyInfoEditing] = useState(false);
  const [myInfoSaving, setMyInfoSaving] = useState(false);
  const [myInfoForm] = Form.useForm();
  // mac 安装指引弹窗：非 null 即打开，内容按具体下载文件生成
  const [macGuide, setMacGuide] = useState<MacGuideInfo | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await cloudBuildApi.list(params);
      setData(res.data);
    } catch { message.error('加载失败'); }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params]);

  // 自动刷新 in-progress 状态
  useEffect(() => {
    const inProgress = data.items.some((b) => ['queued', 'building', 'success', 'downloading'].includes(b.status));
    if (!inProgress) return;
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
    /* eslint-disable-next-line */
  }, [data.items.map((b) => b.status).join(',')]);

  const openDetail = async (row: CloudBuild) => {
    setDetailOpen(true);
    setDetail(row);
    setDetailRemote(null);
    setDetailLoading(true);
    try {
      const res = await cloudBuildApi.get(row.build_id);
      setDetail(res.data.local);
      setDetailRemote(res.data.remote);
      // on-load trigger: 如果还没落盘，立即触发一次按需拉取（不等用户点刷新）
      const local = res.data.local;
      const remote = res.data.remote;
      if (canAutoRefreshCloudBuild(local, remote)) {
        // 异步触发，不阻塞 drawer 渲染
        cloudBuildApi.refresh(row.build_id)
          .then((r) => {
            if (r?.data?.build) {
              setDetail(r.data.build);
              load();
            }
          })
          .catch(() => { /* best-effort */ });
      }
    } catch { /* 保留列表数据 */ }
    setDetailLoading(false);
  };

  // 详情 drawer 打开期间，状态非终态时每 5s 调一次 refresh，拿到 delivered 自动停
  useEffect(() => {
    if (!detailOpen || !detail) return;
    if (!detail.build_id) return;
    if (!canAutoRefreshCloudBuild(detail, detailRemote)) return;

    const timer = setInterval(async () => {
      try {
        const r = await cloudBuildApi.refresh(detail.build_id);
        if (r?.data?.build) {
          setDetail(r.data.build);
          // 顺带刷新列表（因为状态变了）
          load();
        }
      } catch { /* best-effort */ }
    }, 5000);

    return () => clearInterval(timer);
    /* eslint-disable-next-line */
  }, [detailOpen, detail?.build_id, detail?.status, detailRemote?.status]);

  const cancel = async (row: CloudBuild, force = false) => {
    try {
      await cloudBuildApi.cancel(row.build_id, force);
      message.success(force ? '已强制本地取消' : '已请求取消');
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || (force ? '强制取消失败' : '取消失败'));
    }
  };

  const cleanupInvalid = async () => {
    setCleanupLoading(true);
    try {
      const res = await cloudBuildApi.cleanupInvalid();
      const { records_deleted = 0, files_deleted = 0 } = res.data || {};
      message.success(
        `已清空 ${records_deleted} 条无效记录` +
          (files_deleted ? `，删除 ${files_deleted} 个孤儿文件` : ''),
      );
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '清空失败');
    }
    setCleanupLoading(false);
  };

  const loadInstallers = async () => {
    setInstallersLoading(true);
    try {
      const res = await cloudBuildApi.listInstallers();
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
    try {
      await cloudBuildApi.deleteInstaller(filename);
      message.success(`已删除 ${filename}`);
      loadInstallers();
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  // 临时产物管理：扫描 storage/app/cloud-builds/tmp、逐条删、一键清理超过阈值的残留文件
  const loadTmpArtifacts = async () => {
    setTmpLoading(true);
    try {
      const res = await cloudBuildApi.listTmpArtifacts();
      setTmpData(res.data);
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载临时产物列表失败');
    }
    setTmpLoading(false);
  };

  const openTmpArtifacts = () => {
    setTmpOpen(true);
    loadTmpArtifacts();
  };

  const removeTmpArtifact = async (filename: string) => {
    try {
      const res = await cloudBuildApi.cleanupTmpArtifacts({ filenames: [filename] });
      const { deleted_count = 0, freed_bytes = 0, failed = [] } = res.data || {};
      if (deleted_count > 0) {
        message.success(`已删除 ${filename}（释放 ${fmtSize(freed_bytes)}）`);
      } else if (failed.length > 0) {
        message.error(`删除失败：${failed[0].error}`);
      }
      loadTmpArtifacts();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  const cleanupTmpOrphans = async () => {
    setTmpCleanupLoading(true);
    try {
      // 不传 min_age_hours 走后端默认 24h，与列表 is_orphan 标记阈值保持一致
      const res = await cloudBuildApi.cleanupTmpArtifacts();
      const { deleted_count = 0, freed_bytes = 0, failed = [] } = res.data || {};
      const parts: string[] = [`已清理 ${deleted_count} 个残留文件`];
      if (freed_bytes > 0) parts.push(`释放 ${fmtSize(freed_bytes)}`);
      if (failed.length > 0) parts.push(`${failed.length} 个失败`);
      message[failed.length > 0 ? 'warning' : 'success'](parts.join('，'));
      loadTmpArtifacts();
    } catch (err: any) {
      message.error(err.response?.data?.error || '清理失败');
    }
    setTmpCleanupLoading(false);
  };

  // 授权信息：进页时静默读一次，并为「新打包」拦截、按钮红点提供数据
  const loadMyInfo = async (): Promise<MyInfo | null> => {
    setMyInfoLoading(true);
    try {
      const res = await cloudBuildApi.getMyInfo();
      setMyInfo(res.data);
      return res.data as MyInfo;
    } catch (err: any) {
      // 未授权 / agent-build 不可达等异常不弹 message，避免进页噪音；弹窗里以 Alert 展示
      console.warn('[my-info] load failed:', err?.response?.data || err?.message);
      setMyInfo(null);
      return null;
    } finally {
      setMyInfoLoading(false);
    }
  };

  useEffect(() => { loadMyInfo(); /* eslint-disable-next-line */ }, []);

  const openMyInfo = () => {
    setMyInfoOpen(true);
    setMyInfoEditing(false);
    loadMyInfo();
  };

  const startEditMyInfo = () => {
    if (!myInfo) return;
    // 域名永不进 Form，只有姓名 + 电话；占位 '1' 清空，让用户从头填
    myInfoForm.setFieldsValue({
      owner_name: myInfo.owner_name === '1' ? '' : myInfo.owner_name,
      owner_phone: myInfo.owner_phone || '',
    });
    setMyInfoEditing(true);
  };

  const cancelEditMyInfo = () => {
    setMyInfoEditing(false);
    myInfoForm.resetFields();
  };

  const saveMyInfo = async () => {
    let values: { owner_name: string; owner_phone?: string };
    try {
      values = await myInfoForm.validateFields();
    } catch {
      return; // Form 验证错误，Form 自己会展示
    }
    setMyInfoSaving(true);
    try {
      // 只传 owner_name + owner_phone。domain 不在 form 里，全链路没有任何地方能被前端伪造
      const res = await cloudBuildApi.updateMyInfo({
        owner_name: values.owner_name,
        owner_phone: String(values.owner_phone || '').trim(),
      });
      setMyInfo(res.data);
      setMyInfoEditing(false);
      message.success('授权信息已更新');
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    } finally {
      setMyInfoSaving(false);
    }
  };

  // 「新打包」点击拦截： needs_completion=true 时弹框提示，点确定 → 打开我的信息弹窗直接进编辑模式
  const handleNewBuildClick = async () => {
    // 优先用进页时已 load 的 myInfo；若没有（初次进页 load 还没回）同步再 load 一次避免误判
    const info = myInfo ?? await loadMyInfo();
    if (info?.needs_completion) {
      Modal.confirm({
        title: '请先完善授权信息',
        content: '当前域名在授权表里的姓名仍是占位值（或为空）。请先完善姓名和电话，再提交新打包。',
        okText: '去完善',
        cancelText: '取消',
        onOk: () => {
          setMyInfoOpen(true);
          setMyInfoEditing(true);
          myInfoForm.setFieldsValue({
            owner_name: info.owner_name === '1' ? '' : info.owner_name,
            owner_phone: info.owner_phone || '',
          });
        },
      });
      return;
    }
    navigate('/cloud-build/request');
  };

  const retry = async (buildId: string) => {
    try {
      const r = await cloudBuildApi.retry(buildId);
      if (r?.data?.build) {
        setDetail(r.data.build);
      }
      message.success('已触发重试');
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '重试失败');
    }
  };

  const fmtSize = (n?: number | null) => {
    if (!n) return '-';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 ** 3) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 ** 3).toFixed(2) + ' GB';
  };

  // 把秒数格式化为人类友好的「几天 / 几小时 / 几分钟 / 几秒」（用于临时产物存在时长显示）
  const fmtDuration = (sec: number) => {
    if (!sec || sec < 0) return '-';
    if (sec < 60) return `${sec} 秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)} 分钟`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} 小时`;
    return `${Math.floor(sec / 86400)} 天`;
  };

  // 解析 supplementary_files（后端返回 JSON 字符串或已 decode 的数组都兼容）
  const parseSupFiles = (raw: CloudBuild['supplementary_files']): SupplementaryFile[] => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  };

  // 从 filename 推断 mac 架构标签（仅 mac 用，win 总是 x64）
  const detectArch = (filename?: string | null): string | null => {
    if (!filename) return null;
    const lower = filename.toLowerCase();
    if (lower.includes('arm64')) return 'arm64';
    if (lower.includes('x64')) return 'x64';
    return null;
  };

  // 列出该 build 所有 role=primary 的可下载文件（主件 + 副件里 role=primary 的项）
  // mac 同时打 x64+arm64 两个 zip 时，第二个会作为 role=primary 的副件存在
  // 旧记录的 supplementary_files JSON 里没有 stored_path 字段，按落盘约定回退到 updates/{filename}
  const getPrimaryDownloads = (row: CloudBuild): Array<{ filename: string; stored_path: string; arch: string | null }> => {
    const out: Array<{ filename: string; stored_path: string; arch: string | null }> = [];
    if (row.stored_path && row.filename) {
      out.push({ filename: row.filename, stored_path: row.stored_path, arch: detectArch(row.filename) });
    }
    for (const sf of parseSupFiles(row.supplementary_files)) {
      if (sf.role !== 'primary') continue;
      const stored = sf.stored_path || `updates/${sf.filename}`;
      // 去重，避免后端某次又把主件也写进了 supplementary
      if (out.some((d) => d.stored_path === stored)) continue;
      out.push({ filename: sf.filename, stored_path: stored, arch: detectArch(sf.filename) });
    }
    return out;
  };

  // 单个下载项：链接（下载另存为显示名，落盘 slug 名不动）+ mac 行附「安装指引」入口
  const renderDownloadEntry = (row: CloudBuild, d: { filename: string; stored_path: string; arch: string | null }) => {
    const isMac = row.platform === 'mac' || /\.(zip|dmg)$/i.test(d.filename);
    return (
      <div key={d.stored_path}>
        <Tooltip title={`点击下载：${d.stored_path}`}>
          <a
            href={`/${d.stored_path}`}
            download={friendlyDownloadName({
              platform: row.platform, appName: row.app_name, version: row.app_version,
              filename: d.filename, arch: d.arch,
            })}
            style={{ fontSize: 11, fontFamily: 'monospace' }}
          >
            <DownloadOutlined style={{ marginRight: 4 }} />
            {d.arch && <Tag style={{ marginRight: 4, fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>{d.arch}</Tag>}
            {d.stored_path}
          </a>
        </Tooltip>
        {isMac && (
          <Typography.Link
            style={{ marginLeft: 8, fontSize: 11, whiteSpace: 'nowrap' }}
            onClick={() => setMacGuide({
              appName: row.app_name, zipName: d.filename, url: absoluteDownloadUrl(d.stored_path),
            })}
          >
            mac 安装指引
          </Typography.Link>
        )}
      </div>
    );
  };

  const columns = [
    {
      title: 'build_id', dataIndex: 'build_id', width: 110,
      render: (v: string, row: CloudBuild) => (
        <Tooltip title={v}>
          <Tag style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.slice(0, 8)}</Tag>
          {highlightBuildId === row.build_id ? (
            <Typography.Text type="secondary" style={{ marginLeft: 6, fontSize: 11 }}>新</Typography.Text>
          ) : null}
        </Tooltip>
      ),
    },
    { title: 'app_name', dataIndex: 'app_name', width: 120, ellipsis: true },
    { title: '平台', dataIndex: 'platform', width: 70, render: (v: string) => <Tag>{v.toUpperCase()}</Tag> },
    { title: '版本', dataIndex: 'app_version', width: 80 },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        const s = STATUS_LABEL[v] || { color: 'default', label: v };
        return (
          <Tag color={s.color} variant={v === 'delivered' ? 'outlined' : undefined}>
            {s.label}
          </Tag>
        );
      },
    },
    { title: '文件', dataIndex: 'filename', width: 180, ellipsis: true, render: (v: string) => v || '-' },
    { title: '大小', dataIndex: 'artifact_size', width: 80, render: fmtSize },
    {
      title: '本地路径', dataIndex: 'stored_path', width: 240, ellipsis: { showTitle: false },
      render: (_: string | null, row: CloudBuild) => {
        const downloads = getPrimaryDownloads(row);
        if (downloads.length === 0) return '-';
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {downloads.map((d) => renderDownloadEntry(row, d))}
          </Space>
        );
      },
    },
    { title: '创建时间', dataIndex: 'created_at', width: 150 },
    {
      title: '操作', width: 200, fixed: 'right' as const,
      render: (_: any, row: CloudBuild) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(row)}>详情</Button>
          {['queued', 'building'].includes(row.status) && (
            <>
              <Popconfirm
                title="确认取消该打包？"
                description="通知打包平台终止任务"
                onConfirm={() => cancel(row, false)}
                okText="取消任务"
                cancelText="保留"
              >
                <Button size="small" danger icon={<StopOutlined />}>取消</Button>
              </Popconfirm>
              <Popconfirm
                title="强制本地取消？"
                description="不通知打包平台，直接把本地状态置为「已取消」。仅在远端不可达或任务卡死时使用，远端可能仍在执行。"
                onConfirm={() => cancel(row, true)}
                okText="强制取消"
                okButtonProps={{ danger: true }}
                cancelText="返回"
              >
                <Tooltip title="强制本地取消（不通知打包平台）">
                  <Button size="small" danger icon={<ThunderboltOutlined />} />
                </Tooltip>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>云打包记录</Typography.Title>
        <Button type="primary" icon={<RocketOutlined />} onClick={handleNewBuildClick}>
          新打包
        </Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        <Popconfirm
          title="清空无效记录"
          description="将永久删除所有「已取消」「失败」状态的历史记录，关联的孤儿安装包文件也会一并清理。"
          onConfirm={cleanupInvalid}
          okText="清空"
          okButtonProps={{ danger: true }}
          cancelText="取消"
        >
          <Button icon={<ClearOutlined />} loading={cleanupLoading}>清空无效记录</Button>
        </Popconfirm>
        <Button icon={<AppstoreOutlined />} onClick={openInstallers}>安装包</Button>
        <Button icon={<FileOutlined />} onClick={openTmpArtifacts}>临时产物</Button>
        <Tooltip title={myInfo?.needs_completion ? '当前授权信息姓名为占位值，请点击完善' : ''}>
          <Button
            icon={<IdcardOutlined />}
            onClick={openMyInfo}
            danger={myInfo?.needs_completion}
          >我的信息</Button>
        </Tooltip>
        <Select
          placeholder="状态筛选" allowClear style={{ width: 120 }}
          options={Object.keys(STATUS_LABEL).map((k) => ({ value: k, label: STATUS_LABEL[k].label }))}
          onChange={(v) => setParams({ ...params, status: v, page: 1 })}
        />
        <Select
          placeholder="平台筛选" allowClear style={{ width: 110 }}
          options={[{ value: 'win', label: 'Windows' }, { value: 'mac', label: 'macOS' }]}
          onChange={(v) => setParams({ ...params, platform: v, page: 1 })}
        />
      </Space>

      <Table<CloudBuild>
        rowKey="id"
        size="middle"
        columns={columns as any}
        dataSource={data.items}
        loading={loading}
        scroll={{ x: 1200 }}
        pagination={{
          current: params.page, pageSize: params.page_size, total: data.total,
          showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'],
          onChange: (page, page_size) => setParams({ ...params, page, page_size }),
        }}
      />

      <Drawer
        title={`打包详情：${detail?.build_id?.slice(0, 8)}...`}
        width={680}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        loading={detailLoading}
        mask={false}
        extra={detail && ['failed', 'expired', 'cancelled'].includes(detail.status) ? (
          <Button type="primary" size="small" icon={<RedoOutlined />} onClick={() => retry(detail.build_id)}>
            {needsRebuildQueue(detail) ? '重新排队打包' : '重试拉取'}
          </Button>
        ) : null}
      >
        {detail && (
          <>
            {/* 下载中：进度条 */}
            {detail.status === 'downloading' && detail.artifact_size && detail.artifact_size > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Progress
                  percent={Math.min(100, Math.round((detail.downloaded_bytes ?? 0) / detail.artifact_size * 100))}
                  status="active"
                  format={(p) => `${p}% (${fmtSize(detail.downloaded_bytes)} / ${fmtSize(detail.artifact_size)})`}
                />
              </div>
            )}
            {/* 失败：错误提示 + 重试入口（drawer extra 也有按钮） */}
            {['failed', 'expired'].includes(detail.status) && detail.error_message && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 16 }}
                message={`${needsRebuildQueue(detail) ? '打包失败' : '拉取失败'}：${detail.error_message}`}
                description={needsRebuildQueue(detail)
                  ? rebuildQueueHint(detail.error_message)
                  : '点击右上角「重试拉取」可重新下载，常见原因是跨服务器网络不稳定或下载超时'}
              />
            )}
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="build_id">
                <Typography.Text copyable={{ text: detail.build_id }}>{detail.build_id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="app_name">{detail.app_name}</Descriptions.Item>
              <Descriptions.Item label="平台">{detail.platform.toUpperCase()}</Descriptions.Item>
              <Descriptions.Item label="版本">{detail.app_version}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag
                  color={STATUS_LABEL[detail.status]?.color}
                  variant={detail.status === 'delivered' ? 'outlined' : undefined}
                >
                  {STATUS_LABEL[detail.status]?.label || detail.status}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="文件名">{detail.filename || '-'}</Descriptions.Item>
              <Descriptions.Item label="大小">{fmtSize(detail.artifact_size)}</Descriptions.Item>
              <Descriptions.Item label="sha256">
                {detail.sha256 ? (
                  <Typography.Text style={{ fontFamily: 'monospace', fontSize: 11 }} copyable={{ text: detail.sha256 }}>
                    {detail.sha256.slice(0, 32)}...
                  </Typography.Text>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="本地路径">
                {(() => {
                  const downloads = getPrimaryDownloads(detail);
                  if (downloads.length === 0) return '-';
                  return (
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      {downloads.map((d) => renderDownloadEntry(detail, d))}
                    </Space>
                  );
                })()}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{detail.created_at}</Descriptions.Item>
              <Descriptions.Item label="开始打包">{detail.started_at || '-'}</Descriptions.Item>
              <Descriptions.Item label="完成时间">{detail.finished_at || '-'}</Descriptions.Item>
              <Descriptions.Item label="落盘时间">{detail.delivered_at || '-'}</Descriptions.Item>
              {detail.error_message && (
                <Descriptions.Item label="错误">
                  <Typography.Text type="danger">{detail.error_message}</Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {detailRemote && (
              <details style={{ marginTop: 16 }}>
                <summary style={{ cursor: 'pointer', color: '#888' }}>agent-build 远端原始响应（调试）</summary>
                <pre style={{ background: '#fafafa', padding: 12, fontSize: 11, marginTop: 8, maxHeight: 300, overflow: 'auto' }}>
                  {JSON.stringify(detailRemote, null, 2)}
                </pre>
              </details>
            )}
          </>
        )}
      </Drawer>

      <Modal
        open={installersOpen}
        onCancel={() => setInstallersOpen(false)}
        footer={null}
        title="安装包文件管理"
        width={920}
        mask={false}
        destroyOnClose
      >
        <Space style={{ marginBottom: 12 }} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            <FolderOpenOutlined style={{ marginRight: 4 }} />{installersBase || '-'}
          </Typography.Text>
          <Typography.Text type="secondary">
            总占用：<Tag>{fmtSize(installersTotal)}</Tag>
          </Typography.Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={loadInstallers} loading={installersLoading}>
            刷新
          </Button>
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
                  <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Typography.Text>
                  {row.blockmap_filename && (
                    <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 11 }}>
                      + {row.blockmap_filename}
                    </Typography.Text>
                  )}
                </Space>
              ),
            },
            {
              title: '平台',
              dataIndex: 'platform',
              width: 100,
              render: (v: string) => {
                const t = PLATFORM_TAG[v] || { color: 'default', label: v };
                return <Tag color={t.color}>{t.label}</Tag>;
              },
            },
            {
              title: '总大小',
              dataIndex: 'size',
              width: 110,
              render: (_: number, row: InstallerVersion) => (
                <Tooltip
                  title={
                    row.blockmap_filename
                      ? `主包 ${fmtSize(row.primary_size)} + blockmap ${fmtSize(row.blockmap_size)}`
                      : `主包 ${fmtSize(row.primary_size)}`
                  }
                >
                  <span>{fmtSize(row.size)}</span>
                </Tooltip>
              ),
            },
            { title: '修改时间', dataIndex: 'mtime', width: 160, render: (v: string | null) => v || '-' },
            {
              title: '关联打包',
              dataIndex: 'linked_build',
              width: 200,
              render: (v: InstallerVersion['linked_build']) => v ? (
                <Tooltip title={`build_id: ${v.build_id}`}>
                  <Tag style={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {v.app_name} {v.app_version}
                  </Tag>
                </Tooltip>
              ) : (
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>无关联</Typography.Text>
              ),
            },
            {
              title: '操作',
              width: 90,
              fixed: 'right' as const,
              render: (_: any, row: InstallerVersion) => (
                <Popconfirm
                  title={`删除该版本的安装包？`}
                  description={
                    row.blockmap_filename
                      ? `将一并删除：${row.filename}（${fmtSize(row.primary_size)}） + ${row.blockmap_filename}（${fmtSize(row.blockmap_size)}），无法恢复。`
                      : `将删除：${row.filename}（${fmtSize(row.primary_size)}），无法恢复。`
                  }
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
          locale={{ emptyText: '安装包目录为空（更新元信息 latest.yml 不在此列出）' }}
        />
      </Modal>

      {/* 临时产物（storage/app/cloud-builds/tmp）管理弹窗 */}
      <Modal
        open={tmpOpen}
        onCancel={() => setTmpOpen(false)}
        footer={null}
        title="临时产物清理"
        width={920}
        mask={false}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="云打包产物的下载临时区"
          description={
            <div style={{ fontSize: 12, lineHeight: 1.7 }}>
              下载远端打包产物时会先落到这里，校验通过后搬到 <code>public/updates/</code> 并清掉自身。
              正常状态应当为空；如有 .bin 残留，多半是 PHP 进程在搬运前被强杀（reboot / OOM / kill -9）。
              下方<b>「{tmpData?.orphan_after_hours ?? 24} 小时以内」</b>的文件可能是正在下载，<b>不要轻易删除</b>；
              超过的会被标记为「残留」，可一键清理。
            </div>
          }
        />
        <Space style={{ marginBottom: 12 }} wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
            <FolderOpenOutlined style={{ marginRight: 4 }} />{tmpData?.base || '-'}
          </Typography.Text>
          <Typography.Text type="secondary">
            总占用：<Tag>{fmtSize(tmpData?.total_size || 0)}</Tag>
          </Typography.Text>
          <Typography.Text type="secondary">
            残留：
            <Tag color={tmpData && tmpData.orphan_count > 0 ? 'orange' : 'default'}>
              {tmpData?.orphan_count || 0} 个 / {fmtSize(tmpData?.orphan_size || 0)}
            </Tag>
          </Typography.Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={loadTmpArtifacts} loading={tmpLoading}>
            刷新
          </Button>
          <Popconfirm
            title={`一键清理 ${tmpData?.orphan_after_hours ?? 24} 小时以前的残留文件`}
            description={
              tmpData && tmpData.orphan_count > 0
                ? `将删除 ${tmpData.orphan_count} 个残留 .bin 文件，共 ${fmtSize(tmpData.orphan_size)}，无法恢复。`
                : '当前没有残留文件可清理。'
            }
            onConfirm={cleanupTmpOrphans}
            okText="清理"
            okButtonProps={{ danger: true, disabled: !tmpData || tmpData.orphan_count === 0 }}
            cancelText="取消"
            disabled={!tmpData || tmpData.orphan_count === 0}
          >
            <Button
              size="small"
              type="primary"
              danger
              icon={<ClearOutlined />}
              loading={tmpCleanupLoading}
              disabled={!tmpData || tmpData.orphan_count === 0}
            >
              一键清理残留
            </Button>
          </Popconfirm>
        </Space>
        <Table<TmpArtifact>
          rowKey="filename"
          size="small"
          loading={tmpLoading}
          dataSource={tmpData?.items || []}
          pagination={false}
          scroll={{ y: 480 }}
          columns={[
            {
              title: '文件名',
              dataIndex: 'filename',
              ellipsis: true,
              render: (v: string) => (
                <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Typography.Text>
              ),
            },
            {
              title: '大小',
              dataIndex: 'size',
              width: 110,
              render: (v: number) => fmtSize(v),
            },
            {
              title: '修改时间',
              dataIndex: 'mtime',
              width: 160,
              render: (v: string | null) => v || '-',
            },
            {
              title: '存在时长',
              dataIndex: 'age_sec',
              width: 110,
              render: (v: number) => fmtDuration(v),
            },
            {
              title: '状态',
              dataIndex: 'is_orphan',
              width: 100,
              render: (v: boolean) => v
                ? <Tag color="orange">残留</Tag>
                : <Tag color="blue">下载中?</Tag>,
            },
            {
              title: '操作',
              width: 90,
              fixed: 'right' as const,
              render: (_: any, row: TmpArtifact) => (
                <Popconfirm
                  title="删除该临时文件？"
                  description={
                    row.is_orphan
                      ? `将删除：${row.filename}（${fmtSize(row.size)}）`
                      : `该文件可能正在下载中（存在 ${fmtDuration(row.age_sec)}），删除后正在进行的下载会失败。确定要删除？`
                  }
                  onConfirm={() => removeTmpArtifact(row.filename)}
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              ),
            },
          ]}
          locale={{ emptyText: '临时产物目录为空（正常状态）' }}
        />
      </Modal>

      {/* 我的信息（授权信息）弹窗：domain 永远只读，防止前端改域名 */}
      <Modal
        open={myInfoOpen}
        onCancel={() => {
          if (myInfoSaving) return;
          setMyInfoOpen(false);
          setMyInfoEditing(false);
          myInfoForm.resetFields();
        }}
        title={<><IdcardOutlined style={{ marginRight: 8 }} />我的授权信息</>}
        width={560}
        footer={null}
        destroyOnClose
        mask={false}
        maskClosable={!myInfoSaving}
      >
        {myInfoLoading && !myInfo ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: '#999' }}>加载中...</div>
        ) : !myInfo ? (
          <Alert
            type="error"
            showIcon
            message="加载授权信息失败"
            description="可能是 agent-build 未配置、当前域名未授权或服务不可达。详情见浏览器控制台。"
          />
        ) : (
          <>
            {myInfo.needs_completion && !myInfoEditing && (
              <Alert
                type="warning"
                showIcon
                message="请完善授权信息"
                description="当前姓名仍是占位值（或为空）。请点「编辑」填写真实姓名和电话。"
                style={{ marginBottom: 16 }}
              />
            )}
            {!myInfoEditing ? (
              <>
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="授权域名">
                    <Typography.Text copyable style={{ fontFamily: 'monospace' }}>{myInfo.domain}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>（不可修改）</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="姓名">
                    {myInfo.owner_name
                      ? <span>{myInfo.owner_name}</span>
                      : <Typography.Text type="secondary">（未填）</Typography.Text>}
                  </Descriptions.Item>
                  <Descriptions.Item label="电话">
                    {myInfo.owner_phone
                      ? <span>{myInfo.owner_phone}</span>
                      : <Typography.Text type="secondary">（未填）</Typography.Text>}
                  </Descriptions.Item>
                </Descriptions>
                <div style={{ marginTop: 16, textAlign: 'right' }}>
                  <Button type="primary" icon={<EditOutlined />} onClick={startEditMyInfo}>编辑</Button>
                </div>
              </>
            ) : (
              <>
                {/* 域名只读展示，不放进 Form，无论如何也不会被传入 body */}
                <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="授权域名">
                    <Typography.Text style={{ fontFamily: 'monospace' }}>{myInfo.domain}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>（不可修改）</Typography.Text>
                  </Descriptions.Item>
                </Descriptions>
                <Form form={myInfoForm} layout="vertical" preserve={false}>
                  <Form.Item
                    name="owner_name"
                    label="姓名"
                    rules={[
                      { required: true, message: '请输入真实姓名' },
                      { min: 2, message: '至少 2 个字符' },
                      { max: 100, message: '最多 100 个字符' },
                      {
                        validator: (_r, v) => (String(v ?? '').trim() === '1')
                          ? Promise.reject(new Error('请填写真实姓名，不能使用占位值'))
                          : Promise.resolve(),
                      },
                    ]}
                  >
                    <Input placeholder="请输入真实姓名" maxLength={100} />
                  </Form.Item>
                  <Form.Item
                    name="owner_phone"
                    label="电话"
                    rules={[
                      { required: true, message: '请输入手机号' },
                      {
                        validator: (_r, v) => {
                          const s = String(v ?? '').trim();
                          if (!s) return Promise.reject(new Error('请输入手机号'));
                          if (!/^1[3-9]\d{9}$/.test(s)) {
                            return Promise.reject(new Error('请输入有效的 11 位中国大陆手机号'));
                          }
                          return Promise.resolve();
                        },
                      },
                    ]}
                  >
                    <Input placeholder="请输入 11 位手机号，例如 13800138000" maxLength={11} />
                  </Form.Item>
                </Form>
                <div style={{ textAlign: 'right' }}>
                  <Space>
                    <Button onClick={cancelEditMyInfo} disabled={myInfoSaving}>取消</Button>
                    <Button type="primary" onClick={saveMyInfo} loading={myInfoSaving}>保存</Button>
                  </Space>
                </div>
              </>
            )}
          </>
        )}
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
