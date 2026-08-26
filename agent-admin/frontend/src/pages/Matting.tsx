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
import { mattingApi } from '../services/api';
import BatchDeleteButton from '../components/BatchDeleteButton';
import { useCurrencyLabels } from '../contexts/CurrencyContext';

interface MattingTask {
  id: string;
  user_id: number;
  user?: { id: number; username: string; nickname?: string | null };
  source: 'upload' | 'url';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  request_meta?: Record<string, any> | null;
  result?: {
    image_url?: string;
    request_id?: string;
    elapsed_ms?: number;
  } | null;
  error?: string | null;
  cost: number;
  request_id: string;
  created_at: string;
  updated_at: string;
}

interface MattingStats {
  today:    { total: number; success: number };
  month:    { total: number; success: number; credits: number };
  by_status: Record<string, number>;
  top_users: Array<{
    user_id: number;
    success_count: number;
    credits: string | number;
    user?: { id: number; username: string; nickname?: string | null } | null;
  }>;
  config: {
    enabled: boolean;
    access_key_configured: boolean;
    access_key_id_masked: string;
    endpoint: string;
    region_id: string;
    credit_per_call: number;
    global_qps: number;
    per_user_concurrency: number;
    poll_timeout_seconds: number;
    max_file_size_mb: number;
  };
}

interface MattingSettings {
  matting_enabled: boolean;
  matting_access_key_id: string;
  matting_access_key_id_masked: string;
  has_matting_access_key_secret: boolean;
  matting_endpoint: string;
  matting_region_id: string;
  matting_credit_per_call: number;
  endpoint_options: Array<{ value: string; label: string; region_id: string }>;
}

const STATUS_META: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  pending:    { color: 'default',    label: '待处理', icon: <ClockCircleTwoTone twoToneColor="#999" /> },
  processing: { color: 'processing', label: '处理中', icon: <ClockCircleTwoTone twoToneColor="#1677ff" /> },
  completed:  { color: 'success',    label: '完成',   icon: <CheckCircleTwoTone twoToneColor="#52c41a" /> },
  failed:     { color: 'error',      label: '失败',   icon: <CloseCircleTwoTone twoToneColor="#ff4d4f" /> },
};

export default function MattingPage() {
  const { labels } = useCurrencyLabels();
  const creditLabel = labels.credit;
  const [tab, setTab] = useState<'stats' | 'tasks' | 'test' | 'settings'>('stats');

  // ===== Stats =====
  const [stats, setStats] = useState<MattingStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const res = await mattingApi.stats();
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
  const [detailTask, setDetailTask] = useState<MattingTask | null>(null);

  const loadTasks = async () => {
    setTasksLoading(true);
    try {
      const res = await mattingApi.list(taskParams);
      setTasks(res.data);
    } catch (e: any) {
      message.error('加载任务失败：' + (e?.response?.data?.error || e?.message));
    } finally { setTasksLoading(false); }
  };

  useEffect(() => { if (tab === 'stats') loadStats(); }, [tab]);
  useEffect(() => { if (tab === 'tasks') loadTasks(); /* eslint-disable-next-line */ }, [tab, taskParams]);
  useEffect(() => { if (tab === 'settings') loadSettings(); /* eslint-disable-next-line */ }, [tab]);

  // ===== Settings =====
  const [settings, setSettings] = useState<MattingSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsForm] = Form.useForm();
  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await mattingApi.getSettings();
      setSettings(res.data);
      // 同步到 Form（AK Secret 仅读取「是否已填」标志，本身不返明文）
      settingsForm.setFieldsValue({
        matting_enabled:         res.data.matting_enabled,
        matting_access_key_id:   res.data.matting_access_key_id,
        matting_access_key_secret: '',  // 始终为空；留空保存表示不修改
        matting_endpoint:        res.data.matting_endpoint,
        matting_region_id:       res.data.matting_region_id,
        matting_credit_per_call: res.data.matting_credit_per_call,
      });
    } catch (e: any) {
      message.error('加载设置失败：' + (e?.response?.data?.error || e?.message));
    } finally { setSettingsLoading(false); }
  };
  const saveSettings = async (values: any) => {
    setSettingsSaving(true);
    try {
      const res = await mattingApi.updateSettings(values);
      setSettings(res.data);
      // 保存后把密码框清空（下次提交默认保持不变）
      settingsForm.setFieldValue('matting_access_key_secret', '');
      message.success('设置已保存');
      // 同步森问概览页最新状态
      loadStats();
    } catch (e: any) {
      message.error('保存失败：' + (e?.response?.data?.error || e?.message));
    } finally { setSettingsSaving(false); }
  };

  // ===== Test =====
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testFileList, setTestFileList] = useState<UploadFile[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; image_url?: string; request_id?: string; elapsed_ms?: number; error?: string } | null>(null);
  const runTest = async () => {
    if (!testFile) { message.warning('请先选择一张图'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await mattingApi.test(testFile);
      const data = res.data;
      if (data.ok) {
        setTestResult({
          ok: true,
          image_url:   data.result?.image_url,
          request_id:  data.result?.request_id,
          elapsed_ms:  data.result?.elapsed_ms,
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
    const akOk = cfg.access_key_configured;

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {!akOk && (
          <Alert
            type="warning"
            showIcon
            message="抠图服务尚未配置阿里云 AccessKey"
            description="请到「自定义设置」tab 填写 Access Key ID + Secret，保存后即可启用。"
            action={
              <Button size="small" type="primary" onClick={() => setTab('settings')}>去填写</Button>
            }
          />
        )}
        {akOk && !cfg.enabled && (
          <Alert
            type="warning"
            showIcon
            message="抠图服务已配置但未启用"
            description="AccessKey 已填，只需在「自定义设置」tab 打开「服务总开关」即可接用户抠图调用。"
            action={
              <Button size="small" type="primary" onClick={() => setTab('settings')}>去启用</Button>
            }
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
                title="当前计费"
                value={cfg.credit_per_call ?? 0}
                precision={4}
                suffix={`${creditLabel} / 张`}
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
            <Card title="服务配置" size="small"
              extra={<Button size="small" type="link" onClick={() => setTab('settings')}>编辑</Button>}>
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="服务状态">
                  {cfg.enabled
                    ? <Tag color="success">已启用</Tag>
                    : <Tag color="default">未启用</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="AccessKey">
                  {akOk
                    ? <Tag color="success">{cfg.access_key_id_masked}</Tag>
                    : <Tag color="error">未填写</Tag>}
                </Descriptions.Item>
                <Descriptions.Item label="Endpoint">{cfg.endpoint}</Descriptions.Item>
                <Descriptions.Item label="Region">{cfg.region_id}</Descriptions.Item>
                <Descriptions.Item label="限流">
                  全站 {cfg.global_qps} QPS / 单用户 {cfg.per_user_concurrency} 并发
                </Descriptions.Item>
                <Descriptions.Item label="单图上限">
                  {cfg.max_file_size_mb} MB / 最长等待 {cfg.poll_timeout_seconds}s
                </Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
        </Row>

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
  const taskColumns: ColumnsType<MattingTask> = [
    { title: 'ID', dataIndex: 'id', width: 120, render: (v: string) => (
      <Tooltip title={v}><code style={{ fontSize: 12 }}>{v.slice(0, 8)}…</code></Tooltip>
    )},
    { title: '用户', width: 140, render: (_, r) => r.user?.nickname || r.user?.username || `#${r.user_id}` },
    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => {
      const m = STATUS_META[v] || STATUS_META.pending;
      return <Tag color={m.color}>{m.icon} {m.label}</Tag>;
    }},
    { title: '来源', dataIndex: 'source', width: 80, render: (v: string) => (
      <Tag color={v === 'upload' ? 'blue' : 'purple'}>{v === 'upload' ? '上传' : 'URL'}</Tag>
    )},
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
        await mattingApi.delete(taskId);
        message.success('已删除');
        loadTasks();
      },
    });
  };

  const renderTasks = () => (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {/* 过滤栏 */}
      <Card size="small">
        <Form layout="inline"
          onFinish={(v: any) => setTaskParams({ ...taskParams, ...v, page: 1 })}>
          <Form.Item name="keyword">
            <Input.Search placeholder="任务 ID / Request ID / 错误信息" allowClear style={{ width: 280 }} />
          </Form.Item>
          <Form.Item name="user_id">
            <Input placeholder="用户 ID" type="number" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" allowClear style={{ width: 120 }}
              options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: m.label }))} />
          </Form.Item>
          <Form.Item name="source">
            <Select placeholder="来源" allowClear style={{ width: 100 }}
              options={[{ value: 'upload', label: '上传' }, { value: 'url', label: 'URL' }]} />
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
        // BatchDeleteButton 期望 { data: { deleted, errors[], total } }；MattingController 返回 { ok, deleted } 简化版，
        // 这里包一层 adapter 兜成统一结构（matting 后端无逐 id 错误，errors 恒为空数组）。
        batchDelete={async (ids: any) => {
          const res = await mattingApi.batchDelete(ids as string[]);
          return {
            data: {
              deleted: res.data?.deleted ?? ids.length,
              errors:  [],
              total:   ids.length,
            },
          };
        }}
        onDone={loadTasks}
        itemName="抠图任务"
      />

      <Table<MattingTask>
        rowKey="id"
        size="small"
        loading={tasksLoading}
        dataSource={tasks.data || []}
        columns={taskColumns}
        scroll={{ x: 1200 }}
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
        description="直接上传一张图，后台用「自定义设置」里的 AccessKey 调通用高清抠图接口，结果会显示透明 PNG 临时 URL。10/min 限流。"
      />

      <Card>
        <Upload.Dragger
          accept=".png,.jpg,.jpeg,.bmp"
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
            return false; // 阻止自动上传
          }}
          onRemove={() => { setTestFile(null); setTestFileList([]); return true; }}
          maxCount={1}
        >
          <p style={{ fontSize: 28, color: '#bfbfbf' }}><UploadOutlined /></p>
          <p>点击或拖拽图片到此处</p>
          <p style={{ color: '#999', fontSize: 12 }}>支持 PNG / JPG / JPEG / BMP，单图 ≤ 40MB</p>
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
                <Descriptions.Item label="阿里 Request ID">{testResult.request_id}</Descriptions.Item>
                <Descriptions.Item label="端到端耗时">{testResult.elapsed_ms} ms</Descriptions.Item>
                <Descriptions.Item label="结果 URL">
                  <a href={testResult.image_url} target="_blank" rel="noreferrer">
                    {testResult.image_url}
                  </a>
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
        description={
          <span>
            需要事先在阿里云控制台开通「分割抠图」服务 + 创建 RAM 子账号并授予「AliyunVIAPIFullAccess」权限。
          </span>
        }
      />
      <Form
        layout="vertical"
        form={settingsForm}
        onFinish={saveSettings}
      >
        <Form.Item
          name="matting_enabled"
          label="服务总开关"
          valuePropName="checked"
          extra="关闭后用户端「AI 抠图」调用返回 503；调用测试仍可走（调试用）"
        >
          <Switch />
        </Form.Item>

        <Form.Item
          name="matting_access_key_id"
          label="Access Key ID"
          rules={[{ required: true, message: '请填写 Access Key ID' }]}
          extra={settings?.matting_access_key_id_masked
            ? `当前掩码显示：${settings.matting_access_key_id_masked}`
            : '如 LTAI5tXXXXXXXXXXX，需 RAM 子账号并拥有 AliyunVIAPIFullAccess'}
        >
          <Input placeholder="LTAI5tXXXXXXXXXXX" autoComplete="off" />
        </Form.Item>

        <Form.Item
          name="matting_access_key_secret"
          label="Access Key Secret"
          extra={settings?.has_matting_access_key_secret
            ? '已保存。留空表示不修改；填写新值会覆盖。'
            : '首次填写。保存后不会明文返回。'}
        >
          <Input.Password placeholder="****" autoComplete="new-password" />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="matting_endpoint"
              label="接口地址 (Endpoint)"
              rules={[{ required: true }]}
              extra="选择与你阿里云账号同地域，提高响应速度"
            >
              <Select
                options={settings?.endpoint_options || []}
                onChange={(val) => {
                  // 联动 region_id
                  const opt = settings?.endpoint_options?.find((o) => o.value === val);
                  if (opt) settingsForm.setFieldValue('matting_region_id', opt.region_id);
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="matting_region_id"
              label="Region ID"
              rules={[{ required: true }]}
              extra="与 Endpoint 同地域，一般随 Endpoint 自动填充"
            >
              <Input placeholder="cn-shanghai" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="matting_credit_per_call"
          label={`单次抠图扣费（${creditLabel}）`}
          rules={[{ required: true, type: 'number', min: 0 }]}
          extra={`会扣用户「${creditLabel}」钱包；填 0 表示免费（仅限流控制）`}
        >
          <InputNumber
            style={{ width: 200 }}
            min={0}
            step={0.05}
            precision={4}
            addonAfter={`${creditLabel} / 张`}
          />
        </Form.Item>

        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={settingsSaving}>
              保存设置
            </Button>
            <Button onClick={loadSettings} icon={<ReloadOutlined />} disabled={settingsLoading}>
              重新加载
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );

  // ===== Render Detail Drawer =====
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
          <Descriptions.Item label="来源">
            <Tag color={detailTask.source === 'upload' ? 'blue' : 'purple'}>
              {detailTask.source === 'upload' ? '上传' : 'URL'}
            </Tag>
          </Descriptions.Item>
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
                {detailTask.result.request_id && (
                  <div>阿里 Request ID: <code>{detailTask.result.request_id}</code></div>
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
        <ScissorOutlined /> AI 抠图（阿里 viapi SegmentHDCommonImage）
      </h2>

      <Tabs activeKey={tab} onChange={(k) => setTab(k as any)}
        items={[
          { key: 'stats',    label: <><LineChartOutlined /> 概览</>,     children: renderStats() },
          { key: 'tasks',    label: <><UnorderedListOutlined /> 任务列表</>, children: renderTasks() },
          { key: 'test',     label: <><ExperimentOutlined /> 调用测试</>,  children: renderTest() },
          { key: 'settings', label: <><SettingOutlined /> 自定义设置</>, children: renderSettings() },
        ]}
      />

      {renderDetail}
    </div>
  );
}
