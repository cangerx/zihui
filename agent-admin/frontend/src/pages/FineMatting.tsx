import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Badge, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Image, Input,
  InputNumber, message, Modal, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Tooltip, Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  CheckCircleTwoTone, CloseCircleTwoTone, ExperimentOutlined, LineChartOutlined,
  PlayCircleOutlined, ReloadOutlined, ScissorOutlined, UnorderedListOutlined,
  UploadOutlined, ClockCircleTwoTone, SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { fineMattingApi } from '../services/api';
import BatchDeleteButton from '../components/BatchDeleteButton';
import { useCurrencyLabels } from '../contexts/CurrencyContext';

interface FineMattingTask {
  id: string;
  user_id: number;
  user?: { id: number; username: string; nickname?: string | null };
  source: 'upload' | 'url';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  request_meta?: Record<string, any> | null;
  result?: {
    image_url?: string;
    request_id?: string;
    provider_task_id?: string;
    elapsed_ms?: number;
  } | null;
  error?: string | null;
  width: number;
  height: number;
  tier: number;
  cost: number;
  provider_task_id?: string | null;
  request_id: string;
  created_at: string;
  updated_at: string;
}

interface FineMattingStats {
  today:    { total: number; success: number };
  month:    { total: number; success: number; credits: number };
  by_status: Record<string, number>;
  by_tier: Array<{ tier: number; count: number; credits: number }>;
  top_users: Array<{
    user_id: number;
    success_count: number;
    credits: string | number;
    user?: { id: number; username: string; nickname?: string | null } | null;
  }>;
  concurrency: { global_used: number; global_limit: number; user_used: number; user_limit: number };
  config: {
    enabled: boolean;
    api_key_configured: boolean;
    tier1_credit: number;
    tier2_credit: number;
    tier3_credit: number;
    tier_threshold_1: number;
    tier_threshold_2: number;
    global_concurrency: number;
    per_user_concurrency: number;
    poll_timeout_seconds: number;
    max_file_size_mb: number;
  };
}

interface FineMattingSettings {
  fine_matting_enabled: boolean;
  has_fine_matting_api_key: boolean;
  fine_matting_tier1_credit: number;
  fine_matting_tier2_credit: number;
  fine_matting_tier3_credit: number;
  fine_matting_tier_threshold_1: number;
  fine_matting_tier_threshold_2: number;
}

const STATUS_META: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  pending:    { color: 'default',    label: '待处理', icon: <ClockCircleTwoTone twoToneColor="#999" /> },
  processing: { color: 'processing', label: '处理中', icon: <ClockCircleTwoTone twoToneColor="#1677ff" /> },
  completed:  { color: 'success',    label: '完成',   icon: <CheckCircleTwoTone twoToneColor="#52c41a" /> },
  failed:     { color: 'error',      label: '失败',   icon: <CloseCircleTwoTone twoToneColor="#ff4d4f" /> },
};

const TIER_META: Record<number, { label: string; color: string }> = {
  1: { label: '4K 以下', color: 'green' },
  2: { label: '4K–8K',  color: 'blue' },
  3: { label: '8K 以上', color: 'volcano' },
};

function tierTag(tier: number) {
  const m = TIER_META[tier];
  return m ? <Tag color={m.color}>{m.label}</Tag> : <Tag>-</Tag>;
}

export default function FineMattingPage() {
  const { labels } = useCurrencyLabels();
  const creditLabel = labels.credit;
  const [tab, setTab] = useState<'stats' | 'tasks' | 'test' | 'settings'>('stats');

  // ===== Stats =====
  const [stats, setStats] = useState<FineMattingStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const res = await fineMattingApi.stats();
      setStats(res.data);
    } catch (e: any) {
      message.error('加载统计失败：' + (e?.response?.data?.error || e?.message));
    } finally { setStatsLoading(false); }
  };

  // ===== Tasks =====
  const [tasks, setTasks] = useState<any>({ data: [], total: 0 });
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskParams, setTaskParams] = useState<Record<string, any>>({ page: 1, per_page: 20 });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailTask, setDetailTask] = useState<FineMattingTask | null>(null);

  const loadTasks = async () => {
    setTasksLoading(true);
    try {
      const res = await fineMattingApi.list(taskParams);
      setTasks(res.data);
    } catch (e: any) {
      message.error('加载任务失败：' + (e?.response?.data?.error || e?.message));
    } finally { setTasksLoading(false); }
  };

  useEffect(() => { if (tab === 'stats') loadStats(); }, [tab]);
  useEffect(() => { if (tab === 'tasks') loadTasks(); /* eslint-disable-next-line */ }, [tab, taskParams]);
  useEffect(() => { if (tab === 'settings') loadSettings(); /* eslint-disable-next-line */ }, [tab]);

  // ===== Settings =====
  const [settings, setSettings] = useState<FineMattingSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsForm] = Form.useForm();
  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await fineMattingApi.getSettings();
      setSettings(res.data);
      settingsForm.setFieldsValue({
        fine_matting_enabled:          res.data.fine_matting_enabled,
        fine_matting_api_key:          '',  // 始终为空；留空保存表示不修改
        fine_matting_tier1_credit:     res.data.fine_matting_tier1_credit || undefined,
        fine_matting_tier2_credit:     res.data.fine_matting_tier2_credit || undefined,
        fine_matting_tier3_credit:     res.data.fine_matting_tier3_credit || undefined,
        fine_matting_tier_threshold_1: res.data.fine_matting_tier_threshold_1,
        fine_matting_tier_threshold_2: res.data.fine_matting_tier_threshold_2,
      });
    } catch (e: any) {
      message.error('加载设置失败：' + (e?.response?.data?.error || e?.message));
    } finally { setSettingsLoading(false); }
  };
  const saveSettings = async (values: any) => {
    setSettingsSaving(true);
    try {
      const res = await fineMattingApi.updateSettings(values);
      setSettings(res.data);
      settingsForm.setFieldValue('fine_matting_api_key', '');
      message.success('设置已保存');
      loadStats();
    } catch (e: any) {
      message.error('保存失败：' + (e?.response?.data?.error || e?.message));
    } finally { setSettingsSaving(false); }
  };

  // ===== Test =====
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testFileList, setTestFileList] = useState<UploadFile[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; image_url?: string; provider_task_id?: string; elapsed_ms?: number; width?: number; height?: number; tier?: number; cost?: number; error?: string } | null
  >(null);
  const runTest = async () => {
    if (!testFile) { message.warning('请先选择一张图'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fineMattingApi.test(testFile);
      const data = res.data;
      if (data.ok) {
        setTestResult({
          ok: true,
          image_url:        data.result?.image_url,
          provider_task_id: data.result?.provider_task_id,
          elapsed_ms:       data.result?.elapsed_ms,
          width:  data.width,
          height: data.height,
          tier:   data.tier,
          cost:   data.cost,
        });
        message.success('测试成功');
      } else {
        setTestResult({ ok: false, error: data.error || '未知错误' });
      }
    } catch (e: any) {
      setTestResult({ ok: false, error: e?.response?.data?.error || e?.message || '请求失败' });
    } finally { setTesting(false); }
  };

  // ===== Render Stats =====
  const renderStats = () => {
    if (!stats) {
      return statsLoading ? <Card loading /> : <Empty description="暂无数据" />;
    }
    const cfg = stats.config;
    const keyOk = cfg.api_key_configured;
    const priceOk = (cfg.tier1_credit > 0 || cfg.tier2_credit > 0 || cfg.tier3_credit > 0);

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {!keyOk && (
          <Alert
            type="warning"
            showIcon
            message="精细抠图服务尚未配置抠抠图 API Key"
            description="请到「自定义设置」tab 填写 API Key，保存后即可启用。"
            action={<Button size="small" type="primary" onClick={() => setTab('settings')}>去填写</Button>}
          />
        )}
        {keyOk && !priceOk && (
          <Alert
            type="warning"
            showIcon
            message="三档售价尚未配置"
            description="当前三档单价均为 0，将按 0 扣费。请到「自定义设置」tab 按成本设置高于成本的售价。"
            action={<Button size="small" type="primary" onClick={() => setTab('settings')}>去配置</Button>}
          />
        )}
        {keyOk && priceOk && !cfg.enabled && (
          <Alert
            type="warning"
            showIcon
            message="精细抠图服务已配置但未启用"
            description="只需在「自定义设置」tab 打开「服务总开关」即可接用户调用。"
            action={<Button size="small" type="primary" onClick={() => setTab('settings')}>去启用</Button>}
          />
        )}

        <Row gutter={16}>
          <Col xs={24} sm={12} md={6}>
            <Card><Statistic title="今日任务" value={stats.today.total} suffix={`/ 成功 ${stats.today.success}`} /></Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card><Statistic title="本月任务" value={stats.month.total} suffix={`/ 成功 ${stats.month.success}`} /></Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card><Statistic title={`本月消耗${creditLabel}`} precision={2} value={Number(stats.month.credits || 0)} /></Card>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Card>
              <Statistic
                title="实时全站并发"
                value={stats.concurrency?.global_used ?? 0}
                suffix={`/ ${stats.concurrency?.global_limit ?? cfg.global_concurrency}`}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Card title="状态分布" size="small">
              <Space wrap>
                {Object.entries(STATUS_META).map(([k, m]) => (
                  <Badge key={k} status={m.color as any} text={`${m.label}: ${stats.by_status[k] ?? 0}`} />
                ))}
              </Space>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title="本月三档分布" size="small">
              <Space direction="vertical" style={{ width: '100%' }}>
                {[1, 2, 3].map((t) => {
                  const row = stats.by_tier?.find((x) => x.tier === t);
                  return (
                    <div key={t} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{tierTag(t)}</span>
                      <span>{row?.count ?? 0} 张 / {Number(row?.credits ?? 0).toFixed(2)} {creditLabel}</span>
                    </div>
                  );
                })}
              </Space>
            </Card>
          </Col>
        </Row>

        <Card title="服务配置" size="small"
          extra={<Button size="small" type="link" onClick={() => setTab('settings')}>编辑</Button>}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="服务状态">
              {cfg.enabled ? <Tag color="success">已启用</Tag> : <Tag color="default">未启用</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="API Key">
              {keyOk ? <Tag color="success">已配置</Tag> : <Tag color="error">未填写</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="档1（4K 以下）">{cfg.tier1_credit} {creditLabel} / 张</Descriptions.Item>
            <Descriptions.Item label={`长边阈值`}>{cfg.tier_threshold_1} / {cfg.tier_threshold_2} px</Descriptions.Item>
            <Descriptions.Item label="档2（4K–8K）">{cfg.tier2_credit} {creditLabel} / 张</Descriptions.Item>
            <Descriptions.Item label="全站并发">{cfg.global_concurrency}（单用户 {cfg.per_user_concurrency}）</Descriptions.Item>
            <Descriptions.Item label="档3（8K 以上）">{cfg.tier3_credit} {creditLabel} / 张</Descriptions.Item>
            <Descriptions.Item label="单图上限">{cfg.max_file_size_mb} MB / 最长 {cfg.poll_timeout_seconds}s</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="本月 Top 10 用户" size="small">
          <Table
            size="small"
            rowKey={(r: any) => String(r.user_id)}
            pagination={false}
            dataSource={stats.top_users}
            columns={[
              { title: '用户', render: (_, r: any) => r.user?.nickname || r.user?.username || `#${r.user_id}` },
              { title: '成功任务', dataIndex: 'success_count', width: 120 },
              { title: `消耗${creditLabel}`, dataIndex: 'credits', width: 140, render: (v: any) => Number(v).toFixed(4) },
            ]}
            locale={{ emptyText: '本月暂无任务' }}
          />
        </Card>
      </Space>
    );
  };

  // ===== Render Tasks =====
  const taskColumns: ColumnsType<FineMattingTask> = [
    { title: 'ID', dataIndex: 'id', width: 120, render: (v: string) => (
      <Tooltip title={v}><code style={{ fontSize: 12 }}>{v.slice(0, 8)}…</code></Tooltip>
    )},
    { title: '用户', width: 140, render: (_, r) => r.user?.nickname || r.user?.username || `#${r.user_id}` },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => {
      const m = STATUS_META[v] || STATUS_META.pending;
      return <Tag color={m.color}>{m.icon} {m.label}</Tag>;
    }},
    { title: '尺寸', width: 120, render: (_, r) => (r.width && r.height) ? `${r.width}×${r.height}` : '-' },
    { title: '档位', dataIndex: 'tier', width: 100, render: (v: number) => tierTag(v) },
    { title: `消耗${creditLabel}`, dataIndex: 'cost', width: 100, render: (v: number) => Number(v).toFixed(4) },
    { title: '耗时', width: 100, render: (_, r) => r.result?.elapsed_ms ? `${r.result.elapsed_ms} ms` : '-' },
    { title: '错误', dataIndex: 'error', ellipsis: true,
      render: (v: string | null) => v ? <Tooltip title={v}><span style={{ color: '#ff4d4f' }}>{v}</span></Tooltip> : '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 170,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss') },
    { title: '操作', width: 140, fixed: 'right', render: (_, r) => (
      <Space size="small">
        <Button size="small" type="link" onClick={() => setDetailTask(r)}>详情</Button>
        <Button size="small" type="link" danger onClick={() => doDelete(r.id)}>删除</Button>
      </Space>
    )},
  ];

  const doDelete = async (taskId: string) => {
    Modal.confirm({
      title: '确认删除该任务？',
      content: <code>{taskId}</code>,
      onOk: async () => {
        await fineMattingApi.delete(taskId);
        message.success('已删除');
        loadTasks();
      },
    });
  };

  const renderTasks = () => (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small">
        <Form layout="inline"
          onFinish={(v: any) => setTaskParams({ ...taskParams, ...v, page: 1 })}>
          <Form.Item name="keyword">
            <Input.Search placeholder="任务 ID / Request ID / 抠抠图 task / 错误信息" allowClear style={{ width: 300 }} />
          </Form.Item>
          <Form.Item name="user_id">
            <Input placeholder="用户 ID" type="number" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 120 }}
              options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label }))} />
          </Form.Item>
          <Form.Item name="tier">
            <Select placeholder="档位" allowClear style={{ width: 120 }}
              options={[1, 2, 3].map((t) => ({ value: t, label: TIER_META[t].label }))} />
          </Form.Item>
          <Form.Item name="date_range">
            <DatePicker.RangePicker
              onChange={(_, ds) => setTaskParams((p) => ({
                ...p,
                from_date: ds?.[0] || undefined,
                to_date:   ds?.[1] || undefined,
              }))}
            />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit" type="primary">筛选</Button>
          </Form.Item>
          <Form.Item>
            <Button icon={<ReloadOutlined />} onClick={loadTasks}>刷新</Button>
          </Form.Item>
        </Form>
      </Card>

      <BatchDeleteButton
        selectedKeys={selectedIds as any}
        onClear={() => setSelectedIds([])}
        batchDelete={async (ids: any) => {
          const res = await fineMattingApi.batchDelete(ids as string[]);
          return {
            data: {
              deleted: res.data?.deleted ?? ids.length,
              errors:  [],
              total:   ids.length,
            },
          };
        }}
        onDone={loadTasks}
        itemName="精细抠图任务"
      />

      <Table<FineMattingTask>
        rowKey="id"
        size="small"
        loading={tasksLoading}
        dataSource={tasks.data || []}
        columns={taskColumns}
        scroll={{ x: 1300 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as string[]),
        }}
        pagination={{
          current:  taskParams.page,
          pageSize: taskParams.per_page,
          total:    tasks.total,
          showSizeChanger: true,
          onChange: (p, ps) => setTaskParams({ ...taskParams, page: p, per_page: ps }),
        }}
      />
    </Space>
  );

  // ===== Render Test =====
  const renderTest = () => (
    <Space direction="vertical" size={16} style={{ width: '100%', maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        message="管理员测试调用"
        description="直接上传一张图，后台用「自定义设置」里的 API Key 调抠抠图通用抠图异步接口，结果会显示透明 PNG 临时 URL，并给出该图落入的尺寸档位与对应售价。10/min 限流。"
      />

      <Card>
        <Upload.Dragger
          accept=".png,.jpg,.jpeg,.webp"
          fileList={testFileList}
          beforeUpload={(file) => {
            setTestFile(file as File);
            setTestFileList([{
              uid:   String((file as any).uid || Date.now()),
              name:  file.name,
              status: 'done',
              size:   file.size,
              type:   file.type,
            } as UploadFile]);
            return false;
          }}
          onRemove={() => { setTestFile(null); setTestFileList([]); return true; }}
          maxCount={1}
        >
          <p style={{ fontSize: 28, color: '#bfbfbf' }}><UploadOutlined /></p>
          <p>点击或拖拽图片到此处</p>
          <p style={{ color: '#999', fontSize: 12 }}>支持 PNG / JPG / JPEG / WEBP，单图 ≤ 40MB</p>
        </Upload.Dragger>

        <div style={{ marginTop: 16 }}>
          <Button type="primary" loading={testing} disabled={!testFile}
            icon={<PlayCircleOutlined />} onClick={runTest}>
            开始测试
          </Button>
        </div>
      </Card>

      {testResult && (
        <Card title={testResult.ok ? '测试成功' : '测试失败'}
          extra={testResult.ok
            ? <Tag color="success">{testResult.elapsed_ms} ms</Tag>
            : <Tag color="error">FAIL</Tag>}>
          {testResult.ok ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="抠抠图 task_id">{testResult.provider_task_id}</Descriptions.Item>
                <Descriptions.Item label="原图尺寸">
                  {testResult.width}×{testResult.height}（长边 {Math.max(testResult.width || 0, testResult.height || 0)} px）
                </Descriptions.Item>
                <Descriptions.Item label="计费档位">
                  {tierTag(testResult.tier || 0)} 售价 {Number(testResult.cost ?? 0).toFixed(4)} {creditLabel} / 张
                </Descriptions.Item>
                <Descriptions.Item label="端到端耗时">{testResult.elapsed_ms} ms</Descriptions.Item>
                <Descriptions.Item label="结果 URL">
                  <a href={testResult.image_url} target="_blank" rel="noreferrer">{testResult.image_url}</a>
                </Descriptions.Item>
              </Descriptions>
              {testResult.image_url && (
                <div style={{ background: 'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px',
                  padding: 16, borderRadius: 6 }}>
                  <Image src={testResult.image_url} alt="抠图结果" />
                </div>
              )}
            </Space>
          ) : (
            <Alert type="error" message={testResult.error} showIcon />
          )}
        </Card>
      )}
    </Space>
  );

  // ===== Render Settings =====
  const renderSettings = () => (
    <Card loading={settingsLoading && !settings} style={{ maxWidth: 720 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="配置后请到「调用测试」tab 上传一张图验证，看到透明 PNG 结果即说明端到端走通。"
        description="需要事先在抠抠图（koukoutu.com）注册账号、获取 API Key 并充值其平台积分。仅云端中转，API Key 不下发桌面端。"
      />
      <Form
        layout="vertical"
        form={settingsForm}
        onFinish={saveSettings}
      >
        <Form.Item
          name="fine_matting_enabled"
          label="服务总开关"
          valuePropName="checked"
          extra="关闭后用户端「精细抠图」调用返回 503；调用测试仍可走（调试用）"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="fine_matting_api_key"
          label="抠抠图 API Key（X-API-Key）"
          extra={settings?.has_fine_matting_api_key
            ? '已保存。留空表示不修改；填写新值会覆盖。'
            : '首次填写。保存后不会明文返回。'}
        >
          <Input.Password placeholder="****" autoComplete="new-password" />
        </Form.Item>

        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="成本参考（抠抠图平台官方定价：充值 60 元 = 3333 抠抠图积分，约 0.018 元 / 抠抠图积分）"
          description={
            <div>
              <div>4K 以下：约 0.036 元 / 张（2 抠抠图积分）</div>
              <div>4K–8K：约 0.09 元 / 张（5 抠抠图积分）</div>
              <div>8K 以上：约 0.162 元 / 张（9 抠抠图积分）</div>
              <div style={{ marginTop: 8, color: '#8c8c8c' }}>
                说明：上方「抠抠图积分」是抠抠图平台的积分，代表平台采购成本，与本系统向终端用户收取的「{creditLabel}」是两套体系。请据此为下方三档设置高于成本的本系统{creditLabel}售价。
              </div>
            </div>
          }
        />

        <Form.Item label={`三档售价（本系统${creditLabel}，按上传图长边尺寸计费）`} required>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="fine_matting_tier1_credit" noStyle>
                <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={4}
                  placeholder="4K 以下" addonBefore="4K以下" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="fine_matting_tier2_credit" noStyle>
                <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={4}
                  placeholder="4K–8K" addonBefore="4K-8K" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="fine_matting_tier3_credit" noStyle>
                <InputNumber style={{ width: '100%' }} min={0} step={0.1} precision={4}
                  placeholder="8K 以上" addonBefore="8K以上" />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
            留空视为 0（该档免费）。每档为单张扣费的本系统{creditLabel}数。
          </div>
        </Form.Item>

        <Form.Item label="三档尺寸阈值（原图长边像素）">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="fine_matting_tier_threshold_1" noStyle
                rules={[{ required: true, type: 'number', min: 1, message: '请填写档1阈值' }]}>
                <InputNumber style={{ width: '100%' }} min={1} step={1} addonBefore="4K 界限" addonAfter="px" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fine_matting_tier_threshold_2" noStyle
                rules={[{ required: true, type: 'number', min: 1, message: '请填写档2阈值' }]}>
                <InputNumber style={{ width: '100%' }} min={1} step={1} addonBefore="8K 界限" addonAfter="px" />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
            长边 &lt; 4K界限 → 档1；4K界限 ≤ 长边 &lt; 8K界限 → 档2；≥ 8K界限 → 档3。默认 4096 / 7680。
          </div>
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={settingsSaving}>保存设置</Button>
            <Button onClick={loadSettings} icon={<ReloadOutlined />} disabled={settingsLoading}>重新加载</Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );

  // ===== Render Detail =====
  const renderDetail = useMemo(() => {
    if (!detailTask) return null;
    const m = STATUS_META[detailTask.status] || STATUS_META.pending;
    return (
      <Modal
        open={!!detailTask}
        title={<><ScissorOutlined /> 任务详情 <code style={{ fontSize: 12, marginLeft: 8 }}>{detailTask.id}</code></>}
        width={720}
        footer={null}
        onCancel={() => setDetailTask(null)}
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="状态">
            <Tag color={m.color}>{m.icon} {m.label}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="用户">
            {detailTask.user?.nickname || detailTask.user?.username || `#${detailTask.user_id}`}
          </Descriptions.Item>
          <Descriptions.Item label="Request ID">{detailTask.request_id}</Descriptions.Item>
          <Descriptions.Item label="原图尺寸">
            {(detailTask.width && detailTask.height) ? `${detailTask.width}×${detailTask.height}` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="计费档位">{tierTag(detailTask.tier)}</Descriptions.Item>
          <Descriptions.Item label={`消耗${creditLabel}`}>{Number(detailTask.cost).toFixed(4)}</Descriptions.Item>
          <Descriptions.Item label="创建">{dayjs(detailTask.created_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          <Descriptions.Item label="更新">{dayjs(detailTask.updated_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>
          {detailTask.request_meta && (
            <Descriptions.Item label="请求元数据">
              <pre style={{ margin: 0, fontSize: 12 }}>{JSON.stringify(detailTask.request_meta, null, 2)}</pre>
            </Descriptions.Item>
          )}
          {detailTask.error && (
            <Descriptions.Item label="错误">
              <Alert type="error" message={detailTask.error} showIcon />
            </Descriptions.Item>
          )}
          {detailTask.result && (
            <Descriptions.Item label="结果">
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {detailTask.result.provider_task_id && (
                  <div>抠抠图 task_id: <code>{detailTask.result.provider_task_id}</code></div>
                )}
                {detailTask.result.elapsed_ms && (
                  <div>耗时: {detailTask.result.elapsed_ms} ms</div>
                )}
                {detailTask.result.image_url && (
                  <>
                    <a href={detailTask.result.image_url} target="_blank" rel="noreferrer">
                      {detailTask.result.image_url}
                    </a>
                    <div style={{ background: 'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px',
                      padding: 16, borderRadius: 6 }}>
                      <Image src={detailTask.result.image_url} alt="抠图结果" />
                    </div>
                  </>
                )}
              </Space>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Modal>
    );
  }, [detailTask, creditLabel]);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>
        <ScissorOutlined /> 精细抠图（抠抠图 koukoutu，按尺寸三档计费）
      </h2>

      <Tabs activeKey={tab} onChange={(k) => setTab(k as any)}
        items={[
          { key: 'stats',    label: <><LineChartOutlined /> 概览</>,        children: renderStats() },
          { key: 'tasks',    label: <><UnorderedListOutlined /> 任务列表</>, children: renderTasks() },
          { key: 'test',     label: <><ExperimentOutlined /> 调用测试</>,    children: renderTest() },
          { key: 'settings', label: <><SettingOutlined /> 自定义设置</>,     children: renderSettings() },
        ]}
      />

      {renderDetail}
    </div>
  );
}
