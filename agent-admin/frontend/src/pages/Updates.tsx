import { useEffect, useRef, useState } from 'react';
import {
  Card, Button, Tag, Typography, Space, Alert, Steps, Progress, Modal,
  Checkbox, Table, Tabs, message, Tooltip, Descriptions, Empty, Pagination,
} from 'antd';
import {
  ReloadOutlined, CloudDownloadOutlined, CheckCircleOutlined,
  CloseCircleOutlined, LoadingOutlined, ClockCircleOutlined,
  WarningOutlined, CopyOutlined, DatabaseOutlined, ToolOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { updateApi } from '../services/api';

/** 「更新记录」Tab 每页展示的版本数量（按 Card 折叠后的高度估算，10 条在主流分辨率下不用主动滚动即可看完） */
const RELEASES_PAGE_SIZE = 10;

interface WritableInfo {
  ok: boolean;
  base_path: string;
  php_user: string;
  message: string;
  fix_script: string;
  bad_paths: string[];
}

interface CheckResp {
  current: string;
  current_released_at?: string;
  latest: string;
  released_at?: string;
  upgradable: boolean;
  is_latest?: boolean;
  too_old?: boolean;
  min_upgradable_from?: string;
  breaking?: boolean;
  zip_url: string;
  sha256: string;
  size: number;
  changelog: string[];
  previous_versions?: { version: string; url: string }[];
  running_log_id?: number | null;
  writable?: WritableInfo;
}

interface UpdateLog {
  id: number;
  from_version: string;
  to_version: string;
  status: 'running' | 'success' | 'failed';
  phase: string;
  progress_percent: number;
  zip_url: string;
  zip_sha256: string;
  zip_size: number;
  backup_path: string;
  operator_id: number;
  operator_name: string;
  started_at: string | null;
  finished_at: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
  log: string | null;
}

interface DbCheckData {
  ok: boolean;
  migrations_total: number;
  migrations_ran: number;
  pending_migrations: string[];
  expected_tables: string[];
  missing_tables: string[];
  extra_tables: string[];
  checked_at: string;
}

interface DbRepairResult {
  success: boolean;
  error: string;
  output: string;
  before: DbCheckData;
  after: DbCheckData;
}

interface ReleaseItem {
  version: string;
  released_at: string;
  breaking: boolean;
  changelog: string[];
  size: number;
  sha256: string;
  zip_url: string;
}

interface ReleasesResp {
  source: string;
  updated_at: string;
  current: string;
  releases: ReleaseItem[];
  error: string;
}

const PHASE_META: Record<string, { title: string; order: number }> = {
  init:            { title: '初始化',    order: 0 },
  downloading:     { title: '下载更新包', order: 1 },
  verifying:       { title: '校验完整性', order: 2 },
  backing_up:      { title: '备份代码与数据库', order: 3 },
  extracting:      { title: '解压更新包', order: 4 },
  migrating:       { title: '执行数据库迁移', order: 5 },
  clearing_cache:  { title: '清理缓存',   order: 6 },
  completed:       { title: '完成',       order: 7 },
};
const PHASE_ORDER = ['downloading', 'verifying', 'backing_up', 'extracting', 'migrating', 'clearing_cache', 'completed'];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function statusTag(status: string) {
  switch (status) {
    case 'running':
      return <Tag icon={<LoadingOutlined />} color="processing">进行中</Tag>;
    case 'success':
      return <Tag icon={<CheckCircleOutlined />} color="success">已完成</Tag>;
    case 'failed':
      return <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>;
    default:
      return <Tag>{status}</Tag>;
  }
}

type TabKey = 'check' | 'history' | 'data' | 'releases';

export default function UpdatesPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('check');

  // Check 状态
  const [checkLoading, setCheckLoading] = useState(false);
  const [checkData, setCheckData] = useState<CheckResp | null>(null);
  const [checkError, setCheckError] = useState<string>('');

  // 升级状态
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmRead, setConfirmRead] = useState(false);
  const [applying, setApplying] = useState(false);
  const [activeLog, setActiveLog] = useState<UpdateLog | null>(null);
  const pollTimer = useRef<number | null>(null);
  const logBoxRef = useRef<HTMLPreElement | null>(null);

  // 历史
  const [history, setHistory] = useState<UpdateLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [detailLog, setDetailLog] = useState<UpdateLog | null>(null);

  // 数据表检查 / 修复
  const [dbLoading, setDbLoading] = useState(false);
  const [dbCheck, setDbCheck] = useState<DbCheckData | null>(null);
  const [dbCheckError, setDbCheckError] = useState<string>('');
  const [dbRepairing, setDbRepairing] = useState(false);
  const [dbRepairResult, setDbRepairResult] = useState<DbRepairResult | null>(null);
  const [dbRepairConfirmVisible, setDbRepairConfirmVisible] = useState(false);

  // 更新记录
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [releasesData, setReleasesData] = useState<ReleasesResp | null>(null);
  const [releasesPage, setReleasesPage] = useState(1);

  useEffect(() => {
    handleCheck(false);
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current);
    };
  }, []);

  // 自动滚动日志到底
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [activeLog?.log]);

  // 切到历史 / 数据表 / 更新记录 Tab 时首次拉数据
  useEffect(() => {
    if (activeTab === 'history') loadHistory();
    if (activeTab === 'data' && dbCheck === null) loadDbCheck(false);
    if (activeTab === 'releases' && releasesData === null) loadReleases(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  async function handleCheck(showMsg = true) {
    setCheckLoading(true);
    setCheckError('');
    try {
      const { data } = await updateApi.check();
      setCheckData(data);
      // 如果服务端报告有正在运行的升级，恢复轮询
      if (data.running_log_id && !activeLog) {
        startPolling(data.running_log_id);
      }
      if (showMsg) message.success('已获取最新版本信息');
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '检查失败';
      setCheckError(msg);
      if (showMsg) message.error(msg);
    } finally {
      setCheckLoading(false);
    }
  }

  function startPolling(logId: number) {
    if (pollTimer.current) window.clearInterval(pollTimer.current);
    setApplying(true);
    pollTimer.current = window.setInterval(async () => {
      try {
        const { data } = await updateApi.progress(logId);
        if (data?.log) {
          setActiveLog(data.log);
          if (data.log.status !== 'running') {
            if (pollTimer.current) {
              window.clearInterval(pollTimer.current);
              pollTimer.current = null;
            }
            setApplying(false);
            if (data.log.status === 'success') {
              message.success(`升级成功：${data.log.from_version} → ${data.log.to_version}`);
              // 刷新一次 check 拿新版本号
              setTimeout(() => handleCheck(false), 1500);
            } else {
              message.error('升级失败：' + (data.log.error_message || '未知错误'));
            }
          }
        }
      } catch (e: any) {
        // 轮询失败先不停，继续重试。除非是 401，会被全局拦截
      }
    }, 1500);
  }

  async function handleApply() {
    setConfirmVisible(false);
    setApplying(true);
    setActiveLog(null);
    try {
      const { data } = await updateApi.apply();
      message.success(data.message || '升级任务已启动');
      startPolling(data.log_id);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '启动升级失败';
      message.error(msg);
      setApplying(false);
    }
  }

  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const { data } = await updateApi.history({ per_page: 50 });
      setHistory(data?.data || []);
      setHistoryTotal(data?.total || 0);
    } catch {
      message.error('加载历史失败');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadDbCheck(showMsg = true) {
    setDbLoading(true);
    setDbCheckError('');
    try {
      const { data } = await updateApi.dbCheck();
      setDbCheck(data);
      if (showMsg) {
        if (data?.ok) message.success('数据表完整');
        else message.warning('检测到数据表缺失或未执行的迁移');
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '检查失败';
      setDbCheckError(msg);
      if (showMsg) message.error(msg);
    } finally {
      setDbLoading(false);
    }
  }

  async function handleDbRepair() {
    setDbRepairConfirmVisible(false);
    setDbRepairing(true);
    setDbRepairResult(null);
    try {
      const { data } = await updateApi.dbRepair();
      setDbRepairResult(data);
      if (data?.success) {
        message.success('修复完成');
      } else {
        message.error('修复未完全成功：' + (data?.error || ''));
      }
      if (data?.after) setDbCheck(data.after);
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '修复失败';
      message.error(msg);
      setDbRepairResult({
        success: false,
        error: msg,
        output: '',
        before: dbCheck as DbCheckData,
        after: dbCheck as DbCheckData,
      });
    } finally {
      setDbRepairing(false);
    }
  }

  async function loadReleases(showMsg = true) {
    setReleasesLoading(true);
    try {
      const { data } = await updateApi.releases();
      setReleasesData(data);
      setReleasesPage(1);
      if (showMsg) {
        if (data?.error) message.warning(data.error);
        else message.success(`已加载 ${data?.releases?.length || 0} 条版本记录`);
      }
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '加载失败';
      message.error(msg);
    } finally {
      setReleasesLoading(false);
    }
  }

  // ============ 渲染：当前 / 检查结果 ============
  function renderCheckTab() {
    const writable = checkData?.writable;
    const notWritable = writable && writable.ok === false;
    return (
      <>
        {notWritable && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message="项目目录不可写，升级将无法执行"
            description={
              <div>
                <Descriptions column={1} size="small" style={{ marginBottom: 12 }} labelStyle={{ width: 110 }}>
                  <Descriptions.Item label="PHP 运行用户">
                    <Typography.Text code>{writable!.php_user || '未知'}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="项目路径">
                    <Typography.Text code style={{ fontSize: 12 }}>{writable!.base_path}</Typography.Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="不可写子目录">
                    {writable!.bad_paths.map((p) => (
                      <Tag key={p} color="red" style={{ marginRight: 4 }}>{p}</Tag>
                    ))}
                  </Descriptions.Item>
                </Descriptions>

                {writable!.fix_script && (
                  <>
                    <Typography.Paragraph style={{ marginBottom: 4 }}>
                      <strong>请通过 SSH 执行以下命令修复：</strong>
                    </Typography.Paragraph>
                    <pre
                      style={{
                        background: '#0f1419',
                        color: '#d4d4d4',
                        padding: 12,
                        borderRadius: 4,
                        fontSize: 12,
                        margin: '0 0 8px 0',
                        fontFamily: 'Menlo, Consolas, monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                    >
                      {writable!.fix_script}
                    </pre>
                    <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                      说明：改为 <Typography.Text code style={{ fontSize: 12 }}>750</Typography.Text> 而非 <Typography.Text code style={{ fontSize: 12 }}>775</Typography.Text>，避免 others 用户读取源码；
                      <Typography.Text code style={{ fontSize: 12 }}>.env</Typography.Text> 单独 <Typography.Text code style={{ fontSize: 12 }}>640</Typography.Text> 只有 root 可写，避免密钥泄漏。
                    </Typography.Paragraph>
                  </>
                )}

                <Space>
                  <Button
                    type="primary"
                    icon={<ReloadOutlined />}
                    onClick={() => handleCheck(true)}
                    loading={checkLoading}
                  >
                    再次检查权限
                  </Button>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(writable!.fix_script);
                        message.success('修复命令已复制到剪贴板');
                      } catch {
                        message.error('复制失败，请手动选中复制');
                      }
                    }}
                  >
                    复制命令
                  </Button>
                </Space>
              </div>
            }
          />
        )}

        <Card size="small" style={{ marginBottom: 16 }}>
          <Descriptions column={2} size="small" labelStyle={{ width: 100 }}>
            <Descriptions.Item label="当前版本">
              <Typography.Text strong style={{ fontFamily: 'monospace' }}>
                {checkData?.current || '-'}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="发布日期">
              {checkData?.current_released_at || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="远端版本">
              {checkData ? (
                <Space>
                  <Typography.Text strong style={{ fontFamily: 'monospace' }}>
                    {checkData.latest}
                  </Typography.Text>
                  {checkData.upgradable && <Tag color="processing">可升级</Tag>}
                  {checkData.is_latest && <Tag color="success">已是最新</Tag>}
                  {checkData.too_old && <Tag color="error">版本过低</Tag>}
                  {checkData.breaking && <Tag color="error">破坏性更新</Tag>}
                </Space>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="远端发布">
              {checkData?.released_at ? dayjs(checkData.released_at).format('YYYY-MM-DD HH:mm') : '-'}
            </Descriptions.Item>
          </Descriptions>
          <div style={{ marginTop: 12 }}>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => handleCheck(true)}
              loading={checkLoading}
            >
              重新检查
            </Button>
          </div>
        </Card>

        {checkError && (
          <Alert
            type="error"
            message="检查更新失败"
            description={checkError}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        {checkData?.too_old && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="版本过低，无法直接升级"
            description={`当前版本 ${checkData.current} 低于最低可升级版本 ${checkData.min_upgradable_from}，需要先升级到中间版本`}
          />
        )}

        {checkData && checkData.upgradable && !applying && (
          <Card size="small" title={
            <Space>
              <CloudDownloadOutlined />
              <span>有新版本可用</span>
              <Tag color="processing" style={{ fontFamily: 'monospace' }}>
                {checkData.current} → {checkData.latest}
              </Tag>
              {checkData.breaking && (
                <Tag icon={<WarningOutlined />} color="error">破坏性更新</Tag>
              )}
            </Space>
          }>
            <Descriptions column={3} size="small" style={{ marginBottom: 12 }} labelStyle={{ width: 80 }}>
              <Descriptions.Item label="包大小">
                {formatBytes(checkData.size)}
              </Descriptions.Item>
              <Descriptions.Item label="SHA256" span={2}>
                <Typography.Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {checkData.sha256 || '-'}
                </Typography.Text>
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5} style={{ marginTop: 0 }}>更新内容</Typography.Title>
            {checkData.changelog && checkData.changelog.length > 0 ? (
              <ul style={{ paddingLeft: 20, marginBottom: 16 }}>
                {checkData.changelog.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            ) : (
              <Typography.Paragraph type="secondary">暂无更新说明</Typography.Paragraph>
            )}

            <Alert
              type={checkData.breaking ? 'error' : 'warning'}
              showIcon
              style={{ marginBottom: 16 }}
              message="升级注意事项"
              description={
                <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
                  <li>系统将自动备份代码 + 数据库到 storage/app/backups/，备份完成前无法回滚</li>
                  <li>升级期间管理后台短暂不可用，请避开业务高峰</li>
                  <li>升级失败时可联系开发人员通过备份手动恢复</li>
                  {checkData.breaking && (
                    <li style={{ color: '#cf1322' }}>
                      <strong>本次为破坏性更新</strong>，建议先在测试环境验证再升级生产
                    </li>
                  )}
                </ul>
              }
            />

            <Button
              type="primary"
              size="large"
              icon={<CloudDownloadOutlined />}
              onClick={() => { setConfirmRead(false); setConfirmVisible(true); }}
              disabled={notWritable}
              title={notWritable ? '项目目录不可写，请先按上方提示修复权限' : undefined}
            >
              立即升级
            </Button>
          </Card>
        )}

        {checkData?.is_latest && !applying && (
          <Alert
            type="success"
            showIcon
            message="当前已是最新版本"
            description={`版本 ${checkData.current}，无需升级`}
          />
        )}

        {/* 升级进行中 / 已完成 */}
        {(applying || activeLog) && (
          <Card
            size="small"
            title={
              <Space>
                <span>升级状态</span>
                {activeLog && statusTag(activeLog.status)}
                {activeLog && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {activeLog.from_version} → {activeLog.to_version}
                  </Typography.Text>
                )}
              </Space>
            }
            style={{ marginTop: 16 }}
          >
            {activeLog && (
              <>
                <Progress
                  percent={activeLog.progress_percent || 0}
                  status={
                    activeLog.status === 'failed' ? 'exception' :
                    activeLog.status === 'success' ? 'success' :
                    'active'
                  }
                  strokeLinecap="butt"
                />
                <Steps
                  size="small"
                  style={{ marginTop: 16, marginBottom: 16 }}
                  current={PHASE_ORDER.indexOf(activeLog.phase)}
                  status={
                    activeLog.status === 'failed' ? 'error' :
                    activeLog.status === 'success' ? 'finish' : 'process'
                  }
                  items={PHASE_ORDER.map((p) => ({
                    title: PHASE_META[p]?.title || p,
                  }))}
                />

                {activeLog.status === 'failed' && activeLog.error_message && (
                  <Alert
                    type="error"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="升级失败"
                    description={activeLog.error_message}
                  />
                )}

                {activeLog.backup_path && (
                  <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                    备份路径：<Typography.Text code style={{ fontSize: 12 }}>{activeLog.backup_path}</Typography.Text>
                  </Typography.Paragraph>
                )}

                <Typography.Title level={5} style={{ marginTop: 8, marginBottom: 8 }}>实时日志</Typography.Title>
                <pre
                  ref={logBoxRef}
                  style={{
                    background: '#0f1419',
                    color: '#d4d4d4',
                    padding: 12,
                    borderRadius: 4,
                    fontSize: 12,
                    height: 280,
                    overflow: 'auto',
                    margin: 0,
                    fontFamily: 'Menlo, Consolas, monospace',
                  }}
                >
                  {activeLog.log || '（暂无日志）'}
                </pre>

                {activeLog.status !== 'running' && (
                  <div style={{ marginTop: 12 }}>
                    <Button onClick={() => { setActiveLog(null); setApplying(false); }}>
                      关闭
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        )}
      </>
    );
  }

  // ============ 渲染：升级历史 ============
  function renderHistoryTab() {
    return (
      <Card
        size="small"
        title={`升级历史（共 ${historyTotal} 条）`}
        extra={<Button icon={<ReloadOutlined />} onClick={loadHistory} loading={historyLoading}>刷新</Button>}
      >
        <Table
          size="small"
          rowKey="id"
          loading={historyLoading}
          dataSource={history}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description="暂无升级记录" /> }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 60 },
            {
              title: '版本变化',
              dataIndex: 'from_version',
              render: (_: any, r: UpdateLog) => (
                <Typography.Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {r.from_version} → {r.to_version}
                </Typography.Text>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (v: string) => statusTag(v),
            },
            {
              title: '阶段',
              dataIndex: 'phase',
              width: 130,
              render: (v: string) => PHASE_META[v]?.title || v,
            },
            {
              title: '进度',
              dataIndex: 'progress_percent',
              width: 90,
              render: (v: number) => `${v || 0}%`,
            },
            {
              title: '操作员',
              dataIndex: 'operator_name',
              width: 120,
              ellipsis: true,
            },
            {
              title: '开始时间',
              dataIndex: 'started_at',
              width: 150,
              render: (v: string) => v || '-',
            },
            {
              title: '耗时',
              dataIndex: 'duration_seconds',
              width: 80,
              render: (v: number | null) => (v ? `${v}s` : '-'),
            },
            {
              title: '操作',
              width: 80,
              render: (_: any, r: UpdateLog) => (
                <Button size="small" type="link" onClick={async () => {
                  const { data } = await updateApi.progress(r.id);
                  setDetailLog(data?.log || null);
                }}>详情</Button>
              ),
            },
          ]}
        />
      </Card>
    );
  }

  // ============ 渲染：数据表检查 / 修复 ============
  function renderDataTab() {
    const bad = dbCheck && !dbCheck.ok;
    return (
      <>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="数据表完整性检查"
          description={
            <div>
              对比 <Typography.Text code>database/migrations/</Typography.Text> 目录文件与 <Typography.Text code>migrations</Typography.Text> 表，同时校验所有应存在的表。若升级期间 migrate 被中断或有历史遗漏，可点击「一键修复」执行 <Typography.Text code>php artisan migrate --force</Typography.Text> 补齐。
            </div>
          }
        />

        <Card
          size="small"
          title={
            <Space>
              <DatabaseOutlined />
              <span>状态概览</span>
              {dbCheck && (dbCheck.ok
                ? <Tag icon={<CheckCircleOutlined />} color="success">完整</Tag>
                : <Tag icon={<WarningOutlined />} color="warning">需要修复</Tag>)}
            </Space>
          }
          extra={
            <Space>
              <Button
                icon={<ReloadOutlined />}
                onClick={() => loadDbCheck(true)}
                loading={dbLoading}
              >重新检查</Button>
              <Button
                type="primary"
                danger={!!bad}
                icon={<ToolOutlined />}
                disabled={dbLoading || dbRepairing}
                loading={dbRepairing}
                onClick={() => setDbRepairConfirmVisible(true)}
              >一键修复</Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {dbCheckError && (
            <Alert type="error" showIcon message="检查失败" description={dbCheckError} style={{ marginBottom: 12 }} />
          )}
          {dbCheck ? (
            <>
              <Descriptions column={4} size="small" labelStyle={{ width: 100 }}>
                <Descriptions.Item label="Migration 总数">
                  <Typography.Text strong>{dbCheck.migrations_total}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="已执行">
                  <Typography.Text strong style={{ color: '#389e0d' }}>{dbCheck.migrations_ran}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="待执行">
                  <Typography.Text strong style={{ color: dbCheck.pending_migrations.length > 0 ? '#cf1322' : undefined }}>
                    {dbCheck.pending_migrations.length}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="缺失表">
                  <Typography.Text strong style={{ color: dbCheck.missing_tables.length > 0 ? '#cf1322' : undefined }}>
                    {dbCheck.missing_tables.length}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="应存在表数">
                  {dbCheck.expected_tables.length}
                </Descriptions.Item>
                <Descriptions.Item label="额外表数">
                  {dbCheck.extra_tables.length}
                </Descriptions.Item>
                <Descriptions.Item label="检查时间" span={2}>
                  {dbCheck.checked_at}
                </Descriptions.Item>
              </Descriptions>

              {dbCheck.pending_migrations.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 12 }}
                  message={`待执行 ${dbCheck.pending_migrations.length} 条 migration`}
                  description={
                    <div style={{ maxHeight: 200, overflow: 'auto' }}>
                      {dbCheck.pending_migrations.map((m) => (
                        <div key={m} style={{ fontFamily: 'monospace', fontSize: 12, padding: '2px 0' }}>
                          {m}
                        </div>
                      ))}
                    </div>
                  }
                />
              )}

              {dbCheck.missing_tables.length > 0 && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 12 }}
                  message={`缺失 ${dbCheck.missing_tables.length} 张表`}
                  description={
                    <Space wrap>
                      {dbCheck.missing_tables.map((t) => (
                        <Tag key={t} color="red">{t}</Tag>
                      ))}
                    </Space>
                  }
                />
              )}

              {dbCheck.ok && (
                <Alert
                  type="success"
                  showIcon
                  style={{ marginTop: 12 }}
                  message="所有 migration 均已执行，所有应存在的表均已创建"
                />
              )}

              {dbCheck.extra_tables.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    实际存在但不在 migration 清单中的表（手动建表或第三方包）：
                  </Typography.Text>
                  <div style={{ marginTop: 4 }}>
                    {dbCheck.extra_tables.slice(0, 30).map((t) => (
                      <Tag key={t} style={{ marginBottom: 4 }}>{t}</Tag>
                    ))}
                    {dbCheck.extra_tables.length > 30 && (
                      <Tag>...还有 {dbCheck.extra_tables.length - 30} 张</Tag>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <Empty description={dbLoading ? '检查中...' : '点击「重新检查」开始'} />
          )}
        </Card>

        {dbRepairResult && (
          <Card
            size="small"
            title={
              <Space>
                <span>修复结果</span>
                {dbRepairResult.success
                  ? <Tag icon={<CheckCircleOutlined />} color="success">成功</Tag>
                  : <Tag icon={<CloseCircleOutlined />} color="error">失败</Tag>}
              </Space>
            }
            extra={<Button onClick={() => setDbRepairResult(null)}>关闭</Button>}
          >
            {!dbRepairResult.success && dbRepairResult.error && (
              <Alert
                type="error"
                showIcon
                message="修复异常"
                description={dbRepairResult.error}
                style={{ marginBottom: 12 }}
              />
            )}
            <Descriptions column={3} size="small" labelStyle={{ width: 110 }} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="修复前 待执行">
                {dbRepairResult.before?.pending_migrations?.length || 0}
              </Descriptions.Item>
              <Descriptions.Item label="修复后 待执行">
                <Typography.Text strong style={{ color: (dbRepairResult.after?.pending_migrations?.length || 0) === 0 ? '#389e0d' : '#cf1322' }}>
                  {dbRepairResult.after?.pending_migrations?.length || 0}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="修复后 缺失表">
                <Typography.Text strong style={{ color: (dbRepairResult.after?.missing_tables?.length || 0) === 0 ? '#389e0d' : '#cf1322' }}>
                  {dbRepairResult.after?.missing_tables?.length || 0}
                </Typography.Text>
              </Descriptions.Item>
            </Descriptions>
            <Typography.Title level={5} style={{ marginTop: 8, marginBottom: 8 }}>Artisan 输出</Typography.Title>
            <pre
              style={{
                background: '#0f1419',
                color: '#d4d4d4',
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                maxHeight: 320,
                overflow: 'auto',
                margin: 0,
                fontFamily: 'Menlo, Consolas, monospace',
                whiteSpace: 'pre-wrap',
              }}
            >
              {dbRepairResult.output || '（无输出）'}
            </pre>
          </Card>
        )}
      </>
    );
  }

  // ============ 渲染：历代更新记录 ============
  function renderReleasesTab() {
    const data = releasesData;
    const total = data?.releases?.length ?? 0;
    const pageStart = (releasesPage - 1) * RELEASES_PAGE_SIZE;
    const pagedReleases = data?.releases?.slice(pageStart, pageStart + RELEASES_PAGE_SIZE) ?? [];
    return (
      <Card
        size="small"
        title={
          <Space>
            <FileTextOutlined />
            <span>历代更新记录</span>
            {data && <Tag>{data.releases.length} 条</Tag>}
          </Space>
        }
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => loadReleases(true)}
            loading={releasesLoading}
          >刷新</Button>
        }
      >
        {data?.error && (
          <Alert
            type="warning"
            showIcon
            message="加载远端更新记录失败"
            description={data.error}
            style={{ marginBottom: 12 }}
          />
        )}

        {data && data.updated_at && (
          <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
            远端更新记录最后更新时间：{data.updated_at}
          </Typography.Paragraph>
        )}

        {!data && (
          <Empty description={releasesLoading ? '加载中...' : '暂无数据'} />
        )}

        {data && data.releases.length === 0 && !data.error && (
          <Empty description="暂无历史版本记录" />
        )}

        {data && data.releases.length > 0 && (
          <div>
            {pagedReleases.map((r) => {
              const isCurrent = r.version === data.current;
              return (
                <Card
                  key={r.version}
                  size="small"
                  type="inner"
                  style={{ marginBottom: 12 }}
                  title={
                    <Space>
                      <Typography.Text strong style={{ fontFamily: 'monospace', fontSize: 15 }}>
                        v{r.version}
                      </Typography.Text>
                      {isCurrent && <Tag color="blue">当前版本</Tag>}
                      {r.breaking && (
                        <Tag icon={<WarningOutlined />} color="error">破坏性更新</Tag>
                      )}
                      {r.released_at && (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {dayjs(r.released_at).isValid()
                            ? dayjs(r.released_at).format('YYYY-MM-DD HH:mm')
                            : r.released_at}
                        </Typography.Text>
                      )}
                    </Space>
                  }
                  extra={
                    r.size > 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {formatBytes(r.size)}
                      </Typography.Text>
                    )
                  }
                >
                  {r.changelog && r.changelog.length > 0 ? (
                    <ul style={{ paddingLeft: 20, marginBottom: r.sha256 ? 12 : 0 }}>
                      {r.changelog.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <Typography.Paragraph type="secondary" style={{ marginBottom: r.sha256 ? 12 : 0 }}>
                      无更新说明
                    </Typography.Paragraph>
                  )}
                  {r.sha256 && (
                    <Typography.Paragraph type="secondary" style={{ fontSize: 11, marginBottom: 0 }}>
                      SHA256: <Typography.Text code style={{ fontSize: 11 }}>{r.sha256}</Typography.Text>
                    </Typography.Paragraph>
                  )}
                </Card>
              );
            })}
            {total > RELEASES_PAGE_SIZE && (
              <div style={{ textAlign: 'center', marginTop: 12 }}>
                <Pagination
                  size="small"
                  current={releasesPage}
                  pageSize={RELEASES_PAGE_SIZE}
                  total={total}
                  showSizeChanger={false}
                  onChange={(p) => setReleasesPage(p)}
                />
              </div>
            )}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div>
      <Typography.Title level={4} style={{ marginBottom: 4 }}>在线更新</Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0, marginBottom: 16, fontSize: 12 }}>
        从更新服务器拉取最新版本，自动备份后执行迁移与缓存清理
      </Typography.Paragraph>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as TabKey)}
        items={[
          { key: 'check', label: '检查更新', children: renderCheckTab() },
          { key: 'history', label: '升级历史', children: renderHistoryTab() },
          { key: 'data', label: '数据表', children: renderDataTab() },
          { key: 'releases', label: '更新记录', children: renderReleasesTab() },
        ]}
      />

      {/* 数据表修复二次确认 */}
      <Modal
        title={
          <Space>
            <ToolOutlined style={{ color: '#faad14' }} />
            <span>确认修复数据表</span>
          </Space>
        }
        open={dbRepairConfirmVisible}
        onOk={handleDbRepair}
        onCancel={() => setDbRepairConfirmVisible(false)}
        okText="执行修复"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        maskClosable={false}
        mask={false}
      >
        <Typography.Paragraph>
          将执行 <Typography.Text code>php artisan migrate --force</Typography.Text>：
        </Typography.Paragraph>
        <ul style={{ paddingLeft: 20 }}>
          <li>运行所有待执行的 migration</li>
          <li>补齐应存在但缺失的数据表</li>
          <li>已存在的表不会被改动（不会清空数据）</li>
        </ul>
        {dbCheck && dbCheck.pending_migrations.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 8 }}
            message={`本次将执行 ${dbCheck.pending_migrations.length} 条 migration`}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          建议先在升级历史确认没有正在运行的升级任务再执行。
        </Typography.Paragraph>
      </Modal>

      {/* 升级二次确认 */}
      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: '#faad14' }} />
            <span>确认升级</span>
          </Space>
        }
        open={confirmVisible}
        onOk={handleApply}
        onCancel={() => setConfirmVisible(false)}
        okText="确认升级"
        cancelText="取消"
        okButtonProps={{ disabled: !confirmRead, danger: true }}
        maskClosable={false}
        mask={false}
      >
        <Typography.Paragraph>
          即将从 <Typography.Text strong style={{ fontFamily: 'monospace' }}>{checkData?.current}</Typography.Text> 升级到 <Typography.Text strong style={{ fontFamily: 'monospace' }}>{checkData?.latest}</Typography.Text>
        </Typography.Paragraph>
        <Typography.Paragraph>
          升级过程将依次执行：
        </Typography.Paragraph>
        <ol style={{ paddingLeft: 20 }}>
          <li>从远端下载更新包（{formatBytes(checkData?.size || 0)}）</li>
          <li>SHA256 完整性校验</li>
          <li>自动备份当前代码与数据库</li>
          <li>解压更新包到站点根目录</li>
          <li>执行 <Typography.Text code>php artisan migrate --force</Typography.Text></li>
          <li>清理 Laravel 缓存</li>
        </ol>
        <Tooltip title="必须勾选才能继续">
          <Checkbox
            checked={confirmRead}
            onChange={(e) => setConfirmRead(e.target.checked)}
            style={{ marginTop: 8 }}
          >
            我已阅读以上说明并理解升级期间管理后台短暂不可用
          </Checkbox>
        </Tooltip>
      </Modal>

      {/* 历史详情 */}
      <Modal
        title={detailLog ? `升级记录 #${detailLog.id} (${detailLog.from_version} → ${detailLog.to_version})` : ''}
        open={!!detailLog}
        onCancel={() => setDetailLog(null)}
        footer={null}
        width={760}
        mask={false}
      >
        {detailLog && (
          <>
            <Descriptions column={2} size="small" labelStyle={{ width: 90 }}>
              <Descriptions.Item label="状态">{statusTag(detailLog.status)}</Descriptions.Item>
              <Descriptions.Item label="阶段">{PHASE_META[detailLog.phase]?.title || detailLog.phase}</Descriptions.Item>
              <Descriptions.Item label="进度">{detailLog.progress_percent || 0}%</Descriptions.Item>
              <Descriptions.Item label="耗时">
                {detailLog.duration_seconds ? `${detailLog.duration_seconds}s` : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="操作员">{detailLog.operator_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="包大小">{formatBytes(detailLog.zip_size)}</Descriptions.Item>
              <Descriptions.Item label="开始" span={2}>
                <Space size="small">
                  <ClockCircleOutlined />
                  {detailLog.started_at || '-'}
                  {detailLog.finished_at && <span>~ {detailLog.finished_at}</span>}
                </Space>
              </Descriptions.Item>
              {detailLog.backup_path && (
                <Descriptions.Item label="备份路径" span={2}>
                  <Typography.Text code style={{ fontSize: 12 }}>{detailLog.backup_path}</Typography.Text>
                </Descriptions.Item>
              )}
              {detailLog.error_message && (
                <Descriptions.Item label="错误" span={2}>
                  <Typography.Text type="danger">{detailLog.error_message}</Typography.Text>
                </Descriptions.Item>
              )}
            </Descriptions>
            <Typography.Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>执行日志</Typography.Title>
            <pre
              style={{
                background: '#0f1419',
                color: '#d4d4d4',
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                height: 320,
                overflow: 'auto',
                margin: 0,
                fontFamily: 'Menlo, Consolas, monospace',
              }}
            >
              {detailLog.log || '（无日志）'}
            </pre>
          </>
        )}
      </Modal>
    </div>
  );
}
