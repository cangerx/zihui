import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, Select, message, Popconfirm, Tooltip, Badge, Typography, Collapse, Switch, Divider } from 'antd';
import { PlusOutlined, ApiOutlined, ThunderboltOutlined, MinusCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { providerApi } from '../services/api';
import BatchDeleteButton from '../components/BatchDeleteButton';
import ProviderCredentialsDrawer from '../components/ProviderCredentialsDrawer';

type TestKind = 'basic' | 'deep';

const TEST_STATUS_MAP: Record<string, { badge: 'success' | 'warning' | 'error' | 'default'; label: string }> = {
  ok:      { badge: 'success', label: '通过' },
  warning: { badge: 'warning', label: '警告' },
  error:   { badge: 'error',   label: '失败' },
};

/**
 * provider.type 选项：必须与后端 CloudProviderController::SUPPORTED_TYPES 同步。
 *   - openai / openai_compatible : OpenAI 协议族，都走 OpenAICompatibleAdapter；
 *                                  Azure OpenAI 依靠高级设置 auth_style=azure_api_key + extra_query 承载，不占独立 type。
 *   - duomi                       : 多米 API（duomiapi.com），仅图片生成（gpt-image-2 异步路径）。
 */
const PROVIDER_TYPE_OPTIONS = [
  { value: 'openai_compatible', label: 'OpenAI 兼容（默认，最大兼容）' },
  { value: 'openai',            label: 'OpenAI 官方（享受新特性）' },
  { value: 'duomi',             label: '多米 API（仅图片生成 gpt-image-2）' },
] as const;

/**
 * 某些服务商类型有固定接入地址，选中后若 api_base 为空则自动填充。已填写过不覆盖。
 */
const PROVIDER_DEFAULT_API_BASE: Record<string, string> = {
  duomi: 'https://duomiapi.com/v1',
};

const AUTH_STYLE_OPTIONS = [
  { value: 'bearer',         label: 'Bearer Token（默认）' },
  { value: 'azure_api_key',  label: 'Azure 风格（api-key Header）' },
  { value: 'query',          label: '查询参数（?api-key=...）' },
];

/**
 * 后端 provider.config 是 JSON object，前端表单为了用 Form.List 编辑
 * extra_headers / extra_query，把它们展平成 [{key, value}] 列表。
 * 提交前再压回 object。本函数：DB → Form。
 */
function configToFormValue(config: any) {
  const c = config || {};
  return {
    auth_style: c.auth_style || 'bearer',
    verify_ssl: c.verify_ssl !== false,
    proxy: c.proxy || '',
    extra_headers_list: Object.entries(c.extra_headers || {}).map(([key, value]) => ({ key, value: String(value ?? '') })),
    extra_query_list:   Object.entries(c.extra_query   || {}).map(([key, value]) => ({ key, value: String(value ?? '') })),
  };
}

/** Form → DB：list 压回 object，丢弃空 key 行。返回 null 表示完全没填。 */
function formValueToConfig(formConfig: any): any {
  if (!formConfig) return null;
  const out: Record<string, any> = {};

  // 鉴权方式：默认 bearer 不写入（保持 config 体小）
  if (formConfig.auth_style && formConfig.auth_style !== 'bearer') {
    out.auth_style = formConfig.auth_style;
  }
  // SSL 默认 true；只在显式关闭时写入
  if (formConfig.verify_ssl === false) out.verify_ssl = false;
  if (formConfig.proxy) out.proxy = String(formConfig.proxy);

  const headers: Record<string, string> = {};
  for (const it of formConfig.extra_headers_list || []) {
    const k = (it?.key ?? '').trim();
    if (k) headers[k] = String(it.value ?? '');
  }
  if (Object.keys(headers).length) out.extra_headers = headers;

  const query: Record<string, string> = {};
  for (const it of formConfig.extra_query_list || []) {
    const k = (it?.key ?? '').trim();
    if (k) query[k] = String(it.value ?? '');
  }
  if (Object.keys(query).length) out.extra_query = query;

  return Object.keys(out).length ? out : null;
}

/** capabilities：默认全开（与后端 default_capabilities 一致），保证老 provider 升级零行为变化。 */
function capabilitiesToFormValue(caps: any) {
  const c = caps || {};
  return {
    stream:           c.stream           !== false,
    usage_in_stream:  c.usage_in_stream  !== false,
    tools:            c.tools            !== false,
    vision:           c.vision           !== false,
    json_mode:        c.json_mode        !== false,
    reasoning_params: c.reasoning_params === true,  // 默认 false
  };
}

const CAPABILITY_DEFAULTS = capabilitiesToFormValue(null);

const FORM_DEFAULTS = {
  type: 'openai_compatible',
  status: 'active',
  config: configToFormValue(null),
  capabilities: CAPABILITY_DEFAULTS,
};

/**
 * 与桌面端 src/shared/api-base-normalize.ts、后端 app/Support/ApiBase.php 规则保持一致。
 * 任一端修改规则，三处必须同步。
 */
function normalizeApiBase(url: string | null | undefined): string {
  const stripped = String(url ?? '').trim().replace(/\/+$/, '');
  if (!stripped) return '';
  if (/\/v\d+[a-z]*(\/|$)/i.test(stripped)) return stripped;
  return stripped + '/v1';
}

/**
 * 实时预览：用户在 api_base 输入框打字时，下方显示 normalize 后的最终生效地址。
 * 用 Form.useWatch 订阅 api_base 字段值，避免每次渲染从 form.getFieldValue 拉取。
 */
function ApiBasePreview({ form }: { form: any }) {
  const value = Form.useWatch('api_base', form) ?? '';
  const trimmed = String(value).trim();
  if (!trimmed) {
    return <span style={{ fontSize: 12, color: '#999' }}>未填会自动补 /v1（典型 OpenAI 兼容服务）；已含 /v1 /v4 /v1beta 则原样保留</span>;
  }
  const normalized = normalizeApiBase(trimmed);
  const changed = normalized !== trimmed;
  return (
    <span style={{ fontSize: 12, color: '#666' }}>
      实际生效地址：<code style={{ color: '#333' }}>{normalized}</code>
      {changed && <span style={{ marginLeft: 8, color: '#1677ff' }}>（已自动补 /v1）</span>}
    </span>
  );
}

export default function Providers() {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 50 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);

  // 深测自动选 model 失败时的手动输入 Modal。
  // 场景：GET /models 被中转 API 白名单拦截（403）或响应不规范，
  // 后端无法推断出一个可用 model id，交由用户手动填入后重试。
  const [manualModel, setManualModel] = useState<{ providerId: number; providerName: string; tip: string } | null>(null);
  const [manualModelInput, setManualModelInput] = useState('');

  // 凭证池抽屉：点列表「凭证池」按钮时打开，独立于编辑 Modal。
  const [credDrawer, setCredDrawer] = useState<{ providerId: number; providerName: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try { const res = await providerApi.list(params); setData(res.data); } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);

  const handleSave = async () => {
    const values = await form.validateFields();
    // form.config 是扁平结构（含 extra_headers_list / extra_query_list），转回后端期望的 object
    const payload: any = {
      name:         values.name,
      type:         values.type,
      api_base:     values.api_base,
      status:       values.status,
      remark:       values.remark,
      capabilities: values.capabilities,
    };
    payload.config = formValueToConfig(values.config);
    // api_key：编辑模式留空表示「保持不变」，新建必填
    if (values.api_key) payload.api_key = values.api_key;

    try {
      if (editing) { await providerApi.update(editing.id, payload); message.success('已更新'); }
      else { await providerApi.create(payload); message.success('已创建'); }
      setModalOpen(false); form.resetFields(); setEditing(null); load();
    } catch (err: any) { message.error(err.response?.data?.error || '操作失败'); }
  };

  /**
   * 通用测试入口：basic 走 GET /models 探测，deep 实际发一条 max_tokens=1 的 chat 调用。
   *
   * 三档语义渲染：
   *   - ok      → message.success（短消息）
   *   - warning → Modal.warning（长内容防截断）
   *   - error   → message.error 或 Modal.error（按 detail 长度切换）
   *
   * 完成后必 load() 刷新列表，让「上次体检」列同步反映本次结果。
   * 429（throttle 命中）单独走友好提示，不弹 Modal。
   */
  const handleProbe = async (id: number, kind: TestKind, modelId?: string) => {
    const label = kind === 'deep' ? '深度测试' : '测试连接';
    const tip   = kind === 'deep' ? '正在发起 chat 测试调用（消耗 1 token）…' : '正在测试连接…';
    const hide  = message.loading(tip, 0);
    try {
      const res = kind === 'deep' ? await providerApi.deepTest(id, modelId) : await providerApi.test(id);
      hide();
      const { status, message: msg, endpoint, http_status } = res.data || {};
      if (status === 'warning') {
        Modal.warning({
          title: `${label}：可达但有警告`,
          content: (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
              {msg}
              {endpoint && `\n\n请求地址：${endpoint}`}
              {http_status && `\nHTTP 状态：${http_status}`}
            </div>
          ),
          width: 560,
        });
        return;
      }
      message.success(msg || `${label}成功`, 5);
    } catch (err: any) {
      hide();
      // throttle 命中：友好提示
      if (err.response?.status === 429) {
        message.warning(`${label}过于频繁，请稍后再试（每分钟最多 20 次）`, 5);
        return;
      }
      // 注意：用 errData 而不是 data，避免遮蔽外层组件 state.data（下面 providerName 要从 providers 列表里查）
      const errData = err.response?.data || {};
      const detailMsg = errData.message || '';
      // 深测且未传 modelId 且后端提示需手动选 model → 弹 Modal 让用户填入后重试
      if (kind === 'deep' && !modelId && /无法自动选择 model|手动指定具体 model/.test(detailMsg)) {
        const providerName = (data.data || []).find((p: any) => p?.id === id)?.name || '当前服务商';
        setManualModelInput('');
        setManualModel({
          providerId: id,
          providerName,
          tip: detailMsg,
        });
        // 避免后面的 detail 弹窗还在重复提示
        return;
      }
      let detail = detailMsg || `${label}失败`;
      if (errData.endpoint) detail += `\n请求地址：${errData.endpoint}`;
      if (detail.length > 80 || errData.endpoint) {
        Modal.error({
          title: `${label}失败`,
          content: (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
              {detail}
            </div>
          ),
          width: 560,
        });
      } else {
        message.error(detail, 6);
      }
    } finally {
      // 不阻塞 UI 反馈：放最后异步刷新「上次体检」列
      load();
    }
  };

  /** 深测手动 model Modal 提交：用输入的 model_id 重试一次 deepTest */
  const submitManualModel = async () => {
    const m = manualModelInput.trim();
    if (!m) {
      message.error('请输入 model id');
      return;
    }
    if (m.length > 200) {
      message.error('model id 过长（最大 200 字符）');
      return;
    }
    const target = manualModel;
    if (!target) return;
    setManualModel(null);
    setManualModelInput('');
    await handleProbe(target.providerId, 'deep', m);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name' },
    { title: '类型', dataIndex: 'type', width: 130 },
    { title: 'API 地址', dataIndex: 'api_base', ellipsis: true },
    { title: '模型数', dataIndex: 'models_count', width: 80, render: (v: number) => <Tag>{v}</Tag> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '正常' : '禁用'}</Tag>,
    },
    {
      // 上次体检：列表直接读 last_test_* 字段，不必每次现测；hover 看完整提示
      title: '上次体检',
      dataIndex: 'last_test_at',
      width: 180,
      // 未测试排最后，已测试按时间倒序。sorter 返回负数代表 a < b。
      sorter: (a: any, b: any) => {
        const ta = a.last_test_at ? dayjs(a.last_test_at).valueOf() : -1;
        const tb = b.last_test_at ? dayjs(b.last_test_at).valueOf() : -1;
        return ta - tb;
      },
      render: (_: any, r: any) => {
        if (!r.last_test_at) {
          return <Typography.Text type="secondary" style={{ fontSize: 12 }}>未测试</Typography.Text>;
        }
        const s = TEST_STATUS_MAP[r.last_test_status] || { badge: 'default' as const, label: r.last_test_status };
        const kindLabel = r.last_test_kind === 'deep' ? '深测' : '基础';
        const time = dayjs(r.last_test_at);
        return (
          <Tooltip
            title={
              <div style={{ fontSize: 12, maxWidth: 360 }}>
                <div style={{ marginBottom: 4 }}>{time.format('YYYY-MM-DD HH:mm:ss')} · {kindLabel}测试</div>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{r.last_test_message || '-'}</div>
              </div>
            }
          >
            <Space size={6}>
              <Badge status={s.badge} text={<span style={{ fontSize: 12 }}>{s.label}</span>} />
              <Tag style={{ fontSize: 11, marginRight: 0, padding: '0 4px', lineHeight: '16px' }}>{kindLabel}</Tag>
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>{time.format('MM-DD HH:mm')}</Typography.Text>
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: '操作', width: 400, render: (_: any, r: any) => (
        <Space size="small">
          <Tooltip title="基础测试：GET /models 探测网络与鉴权（不消耗 token）">
            <Button size="small" icon={<ApiOutlined />} onClick={() => handleProbe(r.id, 'basic')}>测试</Button>
          </Tooltip>
          <Tooltip title="深度测试：实际发一条 chat 调用（消耗 1 token，反映真实可用性）">
            <Button size="small" icon={<ThunderboltOutlined />} onClick={() => handleProbe(r.id, 'deep')}>深测</Button>
          </Tooltip>
          <Tooltip title="管理凭证池：一个服务商可挂多把 Key 自动轮询">
            <Button size="small" onClick={() => setCredDrawer({ providerId: r.id, providerName: r.name })}>凭证池</Button>
          </Tooltip>
          <Button size="small" onClick={() => {
            setEditing(r);
            providerApi.get(r.id).then(res => {
              const data = res.data || {};
              // 后端返回的 config / capabilities 是 object，转成 form 期望的扁平形式（含 _list）
              form.setFieldsValue({
                ...data,
                api_key:      '', // 编辑模式默认留空，避免回填明文 key
                config:       configToFormValue(data.config),
                capabilities: capabilitiesToFormValue(data.capabilities),
              });
            });
            setModalOpen(true);
          }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={async () => { await providerApi.delete(r.id); load(); }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div />
        <Space>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={providerApi.batchDelete}
            onDone={load}
            itemName="服务商"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>
            添加服务商
          </Button>
        </Space>
      </div>

      <Table columns={columns} dataSource={data.data} rowKey="id" loading={loading}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as number[]),
        }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" />

      <Modal title={editing ? '编辑服务商' : '添加服务商'} open={modalOpen}
        onOk={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); }} destroyOnClose width={680}>
        <Form
          form={form}
          layout="vertical"
          initialValues={FORM_DEFAULTS}
          onValuesChange={(changed) => {
            // 选中固定接入地址的类型时，若 api_base 为空则自动填充；已填写过不覆盖。
            if (typeof changed.type === 'string') {
              const def = PROVIDER_DEFAULT_API_BASE[changed.type];
              if (def && !((form.getFieldValue('api_base') ?? '').trim())) {
                form.setFieldValue('api_base', def);
              }
            }
          }}
        >
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="type" label="类型" tooltip="决定走哪个协议适配器。OpenAI / OpenAI 兼容 共用一套适配器；多米 API 走专用 DuoMiAdapter（仅图片生成）">
            <Select options={PROVIDER_TYPE_OPTIONS as any} />
          </Form.Item>
          <Form.Item
            name="api_base"
            label="API 地址"
            rules={[{ required: true }]}
            extra={<ApiBasePreview form={form} />}
          >
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API 密钥"
            rules={editing ? [] : [{ required: true }]}
            extra="也可以稍后在「凭证池」里挂多把 Key 自动轮询。此处填的会作为单 Key 模式或凭证池为空时的兜底。"
          >
            <Input.Password placeholder={editing ? '留空保持不变' : ''} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={[{ value: 'active', label: '正常' }, { value: 'disabled', label: '禁用' }]} />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>

          <Collapse ghost size="small" style={{ marginTop: 8 }}>
            <Collapse.Panel header="高级设置（自定义 headers / 鉴权方式 / SSL / 代理）" key="advanced">
              <Form.Item name={['config', 'auth_style']} label="鉴权方式" tooltip="Bearer 适用于绝大多数 OpenAI 兼容服务；Azure OpenAI 用 api-key Header；某些自建服务用查询参数（如 ?api-key=...）">
                <Select options={AUTH_STYLE_OPTIONS} />
              </Form.Item>
              <Form.Item name={['config', 'verify_ssl']} label="启用 SSL 证书验证" valuePropName="checked" tooltip="内网自签证书的服务关闭此项">
                <Switch />
              </Form.Item>
              <Form.Item name={['config', 'proxy']} label="代理地址" tooltip="格式：http://user:pass@host:port，留空走默认">
                <Input placeholder="http://127.0.0.1:7890" />
              </Form.Item>

              <Divider plain style={{ fontSize: 12, color: '#666' }}>自定义 Headers（每行 1 条）</Divider>
              <Form.List name={['config', 'extra_headers_list']}>
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name }) => (
                      <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                        <Form.Item name={[name, 'key']} rules={[{ required: true, message: 'Header 名不能为空' }]} style={{ marginBottom: 0 }}>
                          <Input placeholder="X-Workspace-Id" style={{ width: 200 }} />
                        </Form.Item>
                        <Form.Item name={[name, 'value']} rules={[{ required: true, message: 'Header 值不能为空' }]} style={{ marginBottom: 0 }}>
                          <Input placeholder="abc123" style={{ width: 360 }} />
                        </Form.Item>
                        <MinusCircleOutlined onClick={() => remove(name)} />
                      </Space>
                    ))}
                    <Button type="dashed" size="small" onClick={() => add({ key: '', value: '' })} icon={<PlusOutlined />}>添加 Header</Button>
                  </>
                )}
              </Form.List>

              <Divider plain style={{ fontSize: 12, color: '#666', marginTop: 16 }}>自定义查询参数</Divider>
              <Form.List name={['config', 'extra_query_list']}>
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name }) => (
                      <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 4 }}>
                        <Form.Item name={[name, 'key']} rules={[{ required: true, message: '参数名不能为空' }]} style={{ marginBottom: 0 }}>
                          <Input placeholder="api-version" style={{ width: 200 }} />
                        </Form.Item>
                        <Form.Item name={[name, 'value']} rules={[{ required: true, message: '参数值不能为空' }]} style={{ marginBottom: 0 }}>
                          <Input placeholder="2024-08-01-preview" style={{ width: 360 }} />
                        </Form.Item>
                        <MinusCircleOutlined onClick={() => remove(name)} />
                      </Space>
                    ))}
                    <Button type="dashed" size="small" onClick={() => add({ key: '', value: '' })} icon={<PlusOutlined />}>添加查询参数</Button>
                  </>
                )}
              </Form.List>
            </Collapse.Panel>

            <Collapse.Panel header="能力清单（决定调用时哪些字段会被发给上游）" key="capabilities">
              <div style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>默认全部开启 = 与原版行为一致。如果服务商不支持某能力，关掉对应开关，调用时会自动剥离相关字段，避免被上游 400。</div>
              <Space size="large" wrap>
                <Form.Item name={['capabilities', 'stream']} label="流式响应" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item name={['capabilities', 'usage_in_stream']} label="流式 usage 统计" valuePropName="checked" tooltip="关闭后流式调用不再附加 stream_options.include_usage（与精准计费换兼容性）"><Switch /></Form.Item>
                <Form.Item name={['capabilities', 'tools']} label="函数调用" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item name={['capabilities', 'vision']} label="视觉输入" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item name={['capabilities', 'json_mode']} label="结构化 JSON" valuePropName="checked"><Switch /></Form.Item>
                <Form.Item name={['capabilities', 'reasoning_params']} label="推理模型参数" valuePropName="checked" tooltip="开启后 max_tokens 自动改为 max_completion_tokens 并剥离 temperature。模型名 o1-/o3-/gpt-5- 会自动启用本规则"><Switch /></Form.Item>
              </Space>
            </Collapse.Panel>
          </Collapse>
        </Form>
      </Modal>

      {/* 凭证池抽屉：管理某个 provider 下的多把 API Key */}
      <ProviderCredentialsDrawer
        providerId={credDrawer?.providerId ?? null}
        providerName={credDrawer?.providerName ?? ''}
        open={!!credDrawer}
        onClose={() => setCredDrawer(null)}
      />

      {/* 深测手动 model Modal：仅在后端返回「无法自动选择 model」时弹出 */}
      <Modal
        title={`深度测试：手动指定 model${manualModel ? `（${manualModel.providerName}）` : ''}`}
        open={!!manualModel}
        onOk={submitManualModel}
        onCancel={() => { setManualModel(null); setManualModelInput(''); }}
        okText="用此 model 重试"
        cancelText="取消"
        width={520}
        destroyOnClose
      >
        {manualModel && (
          <div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {manualModel.tip}
            </div>
            <Input
              placeholder="例如 gpt-4o-mini / claude-3-5-haiku-latest"
              value={manualModelInput}
              maxLength={200}
              onChange={(e) => setManualModelInput(e.target.value)}
              onPressEnter={submitManualModel}
              autoFocus
            />
            <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
              该 model 会发一条 max_tokens=1 的 chat 调用，成本忽略不计。
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
