import { useEffect, useState } from 'react';
import {
  Table,
  Button,
  Space,
  Tag,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  message,
  Popconfirm,
  Typography,
} from 'antd';
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { ttsProviderApi } from '../services/api';

const { TextArea } = Input;

const PRESET_OPTIONS = [
  { value: 'doubao', label: '豆包(预设)' },
  { value: 'openai_compatible', label: 'OpenAI 兼容' },
  { value: 'generic', label: '通用模板' },
];
const FORMAT_OPTIONS = [
  { value: 'mp3', label: 'mp3' },
  { value: 'wav', label: 'wav' },
  { value: 'pcm', label: 'pcm' },
];
const RESPONSE_TYPE_OPTIONS = [
  { value: 'binary', label: 'binary(直接音频字节)' },
  { value: 'json-base64', label: 'json-base64(JSON 内 base64)' },
  { value: 'json-url', label: 'json-url(JSON 内下载地址)' },
];

interface TtsProvider {
  id: number;
  name: string;
  preset_type: string;
  endpoint: string;
  api_key_masked: string;
  format: string;
  voice_default: string;
  speed_default: number;
  status: string;
  response_type: string;
  audio_path: string;
  body_template: string;
  headers: Record<string, unknown> | null;
  auth: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
}

// JSON 字段在表单内以字符串编辑, 提交前解析
function parseJsonField(s: unknown): Record<string, unknown> | undefined {
  if (typeof s !== 'string' || s.trim() === '') return undefined;
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? v : undefined;
  } catch {
    throw new Error('JSON 格式错误');
  }
}
function stringifyJsonField(v: unknown): string {
  if (!v || typeof v !== 'object') return '';
  return JSON.stringify(v, null, 2);
}

export default function TtsProviders() {
  const [data, setData] = useState<TtsProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TtsProvider | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [form] = Form.useForm();

  const load = async () => {
    setLoading(true);
    try {
      const r = await ttsProviderApi.list({ per_page: 100 });
      setData(r.data?.data ?? r.data ?? []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ preset_type: 'doubao', format: 'mp3', speed_default: 1, status: 'active' });
    setModalOpen(true);
  };
  const openEdit = (r: TtsProvider) => {
    setEditing(r);
    form.resetFields();
    form.setFieldsValue({
      ...r,
      api_key: '',
      headers: stringifyJsonField(r.headers),
      auth: stringifyJsonField(r.auth),
      config: stringifyJsonField(r.config),
    });
    setModalOpen(true);
  };

  const onSubmit = async () => {
    const v = await form.validateFields();
    let payload: Record<string, unknown>;
    try {
      payload = {
        ...v,
        headers: parseJsonField(v.headers),
        auth: parseJsonField(v.auth),
        config: parseJsonField(v.config),
      };
    } catch (e: any) {
      message.error(e?.message ?? 'JSON 字段格式错误');
      return;
    }
    try {
      if (editing) await ttsProviderApi.update(editing.id, payload);
      else await ttsProviderApi.create(payload);
      message.success('已保存');
      setModalOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.error ?? '保存失败');
    }
  };

  const onTest = async (r: TtsProvider) => {
    setTesting(r.id);
    try {
      const res = await ttsProviderApi.test(r.id, { test_text: '语音合成测试' });
      if (res.data?.ok) message.success(`试连成功, 返回 ${res.data.bytes} 字节 (${res.data.format})`);
      else message.error('试连失败: ' + (res.data?.message ?? '未知错误'));
    } catch (e: any) {
      message.error('试连失败: ' + (e?.response?.data?.message ?? e?.message ?? '请求错误'));
    } finally {
      setTesting(null);
    }
  };

  const onRemove = async (id: number) => {
    try {
      await ttsProviderApi.remove(id);
      message.success('已删除');
      load();
    } catch {
      message.error('删除失败');
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '类型',
      dataIndex: 'preset_type',
      render: (t: string) => {
        const opt = PRESET_OPTIONS.find((o) => o.value === t);
        return <Tag color="geekblue">{opt?.label ?? t}</Tag>;
      },
    },
    { title: '端点', dataIndex: 'endpoint', ellipsis: true },
    {
      title: 'Key',
      dataIndex: 'api_key_masked',
      render: (k: string) => (k ? <Typography.Text code>{k}</Typography.Text> : <Tag>未设置</Tag>),
    },
    { title: '默认音色', dataIndex: 'voice_default', render: (v: string) => v || '-' },
    { title: '格式', dataIndex: 'format' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: string) => <Tag color={s === 'active' ? 'success' : 'default'}>{s}</Tag>,
    },
    {
      title: '操作',
      render: (_: unknown, r: TtsProvider) => (
        <Space>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            loading={testing === r.id}
            onClick={() => onTest(r)}
          >
            试连
          </Button>
          <Button size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="删除该供应商?" onConfirm={() => onRemove(r.id)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          添加供应商
        </Button>
        <Button onClick={load}>刷新</Button>
        <Typography.Text type="secondary">
          api_key 仅存服务端, 列表只显示脱敏值, 永不下发桌面端。按字符计费。
        </Typography.Text>
      </Space>
      <Table rowKey="id" columns={columns} dataSource={data} loading={loading} size="small" />

      <Modal
        title={editing ? '编辑 TTS 供应商' : '添加 TTS 供应商'}
        open={modalOpen}
        onOk={onSubmit}
        onCancel={() => setModalOpen(false)}
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 豆包-标准女声" />
          </Form.Item>
          <Form.Item name="preset_type" label="预设类型" rules={[{ required: true }]}>
            <Select options={PRESET_OPTIONS} />
          </Form.Item>
          <Form.Item name="endpoint" label="端点 URL">
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item
            name="api_key"
            label={editing ? 'API Key (留空=保持不变)' : 'API Key'}
          >
            <Input.Password placeholder={editing ? '不修改请留空' : '服务端持有, 不下发桌面端'} />
          </Form.Item>
          <Space size="large" style={{ display: 'flex' }}>
            <Form.Item name="voice_default" label="默认音色" style={{ flex: 1 }}>
              <Input placeholder="如 zh_female_..." />
            </Form.Item>
            <Form.Item name="format" label="音频格式" style={{ width: 140 }}>
              <Select options={FORMAT_OPTIONS} />
            </Form.Item>
            <Form.Item name="speed_default" label="默认语速" style={{ width: 140 }}>
              <InputNumber min={0.5} max={2} step={0.1} style={{ width: '100%' }} />
            </Form.Item>
          </Space>

          {/* 通用模板专属字段 */}
          <Form.Item noStyle shouldUpdate={(p, c) => p.preset_type !== c.preset_type}>
            {({ getFieldValue }) =>
              getFieldValue('preset_type') === 'generic' ? (
                <>
                  <Form.Item name="response_type" label="响应类型">
                    <Select options={RESPONSE_TYPE_OPTIONS} allowClear />
                  </Form.Item>
                  <Form.Item name="audio_path" label="音频字段路径 (JSON 响应内, 如 data.audio)">
                    <Input placeholder="data.audio" />
                  </Form.Item>
                  <Form.Item
                    name="body_template"
                    label="请求体模板 (占位符 {{text}} {{voice}} {{speed}})"
                  >
                    <TextArea rows={4} placeholder='{"text":"{{text}}","voice":"{{voice}}"}' />
                  </Form.Item>
                  <Form.Item name="headers" label="自定义请求头 (JSON)">
                    <TextArea rows={3} placeholder='{"X-Api-Key":"..."}' />
                  </Form.Item>
                  <Form.Item name="auth" label="鉴权配置 (JSON)">
                    <TextArea rows={3} placeholder='{"type":"bearer"}' />
                  </Form.Item>
                </>
              ) : null
            }
          </Form.Item>

          {/* 豆包需要 appid/cluster 等放 config */}
          <Form.Item noStyle shouldUpdate={(p, c) => p.preset_type !== c.preset_type}>
            {({ getFieldValue }) =>
              getFieldValue('preset_type') === 'doubao' ? (
                <Form.Item name="config" label="扩展配置 (JSON: appid / cluster 等)">
                  <TextArea rows={3} placeholder='{"appid":"...","cluster":"volcano_tts"}' />
                </Form.Item>
              ) : null
            }
          </Form.Item>

          <Form.Item name="status" label="状态">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
