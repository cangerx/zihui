import { useEffect, useState } from 'react';
import {
  Card, Form, Switch, Input, InputNumber, Select, Button, Space, message, Modal,
  Tag, Tooltip, Statistic, Divider, Alert,
} from 'antd';
import {
  ReloadOutlined, ThunderboltOutlined, ExperimentOutlined, SaveOutlined,
  InfoCircleOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { docApi } from '../services/api';

/**
 * 文档管理设置页：开关 / 站点信息 / RAG 模型 / 切片参数 / 系统提示词 / 全量重建。
 *
 * 设计取舍：
 * - 4 个表单卡片分组：基础开关、站点信息、RAG 模型、检索参数
 * - 模型下拉直接用 config 接口返回的 available_chat_models / available_embedding_models
 *   省一次单独的 modelApi.list 调用
 * - 「测试模型」按钮放在模型下拉旁边，立即调用 testModel 接口
 * - 「全量重建」放在最底部 + 二次确认（耗时几分钟，操作不可中断）
 * - vec_mode 用 Tag 显示在统计区，让 admin 知道是 vec0 还是 fallback
 */

type ConfigPayload = {
  docs_enabled: boolean;
  docs_guest_access: boolean;
  docs_site_title: string;
  docs_rag_enabled: boolean;
  docs_chat_allow_guest: boolean;
  docs_chat_model_id: number | null;
  docs_embedding_model_id: number | null;
  docs_chunk_size: number;
  docs_chunk_overlap: number;
  docs_retrieve_top_k: number;
  docs_min_similarity: number;
  docs_system_prompt: string;
  available_chat_models: Array<{ id: number; name: string; model_id: string; provider_name: string }>;
  available_embedding_models: Array<{ id: number; name: string; model_id: string; provider_name: string }>;
  stats: {
    doc_count: number;
    visible_count: number;
    category_count: number;
    chunk_count: number;
    indexed_count: number;
  };
  vec_mode: string;
};

export default function DocSettings() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [form] = Form.useForm<Omit<ConfigPayload, 'available_chat_models' | 'available_embedding_models' | 'stats' | 'vec_mode'>>();

  const [testingChat, setTestingChat] = useState(false);
  const [testingEmbed, setTestingEmbed] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => { void loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await docApi.getConfig();
      setConfig(res.data);
      form.setFieldsValue({
        docs_enabled: !!res.data.docs_enabled,
        docs_guest_access: !!res.data.docs_guest_access,
        docs_site_title: res.data.docs_site_title || '',
        docs_rag_enabled: !!res.data.docs_rag_enabled,
        docs_chat_allow_guest: !!res.data.docs_chat_allow_guest,
        docs_chat_model_id: res.data.docs_chat_model_id ? Number(res.data.docs_chat_model_id) : null,
        docs_embedding_model_id: res.data.docs_embedding_model_id ? Number(res.data.docs_embedding_model_id) : null,
        docs_chunk_size: res.data.docs_chunk_size ?? 800,
        docs_chunk_overlap: res.data.docs_chunk_overlap ?? 100,
        docs_retrieve_top_k: res.data.docs_retrieve_top_k ?? 6,
        docs_min_similarity: res.data.docs_min_similarity ?? 0.30,
        docs_system_prompt: res.data.docs_system_prompt || '',
      });
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载设置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      await docApi.updateConfig(values);
      message.success('设置已保存');
      await loadConfig();
    } catch (e: any) {
      const details = e?.response?.data?.details;
      if (details) {
        const firstError = Object.values(details)[0] as string[];
        message.error(firstError?.[0] || '保存失败');
      } else {
        message.error(e?.response?.data?.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  /** 测试模型：当前选中的 chat / embedding 模型 */
  const handleTestModel = async (type: 'chat' | 'embedding') => {
    const fieldName = type === 'chat' ? 'docs_chat_model_id' : 'docs_embedding_model_id';
    const modelId = form.getFieldValue(fieldName);
    if (!modelId) {
      message.warning(`请先选择 ${type === 'chat' ? '对话' : '向量'} 模型`);
      return;
    }
    const setLoading = type === 'chat' ? setTestingChat : setTestingEmbed;
    setLoading(true);
    try {
      const res = await docApi.testModel({ type, cloud_model_id: modelId });
      const d = res.data;
      if (d.ok) {
        if (type === 'embedding') {
          message.success(`连通正常：${d.latency}ms / 维度 ${d.dimension}`);
        } else {
          message.success(`连通正常：${d.latency}ms / 回复 "${d.reply}"`);
        }
      } else {
        message.error(`连通失败：${d.error || ''} ${d.detail || ''}`);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '测试失败');
    } finally {
      setLoading(false);
    }
  };

  /** 全量重建索引 */
  const handleReindexAll = () => {
    Modal.confirm({
      title: '全量重建索引？',
      icon: <ThunderboltOutlined style={{ color: '#faad14' }} />,
      content: (
        <div>
          <p>此操作会：</p>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            <li>清空当前所有 chunk 和向量索引</li>
            <li>逐个文档重新切片 + 调用 embedding 模型</li>
            <li>耗时与文档数 / 切片数线性相关，可能几十秒到几分钟</li>
          </ul>
          <p style={{ marginTop: 8, color: '#fa8c16' }}>切换 embedding 模型后必须执行此操作。</p>
        </div>
      ),
      okText: '确定重建',
      okType: 'danger',
      onOk: async () => {
        setReindexing(true);
        try {
          const res = await docApi.reindexAll();
          const d = res.data;
          let msg = `重建完成：${d.docs} 文档 / ${d.chunks} 切片 / ${d.indexed} 已索引`;
          if (d.failed?.length) {
            msg += `；${d.failed.length} 篇失败`;
            console.warn('[Docs] reindex failures:', d.failed);
          }
          message.success({ content: msg, duration: 6 });
          await loadConfig();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '重建失败');
        } finally {
          setReindexing(false);
        }
      },
    });
  };

  if (!config) {
    return <Card loading={loading} />;
  }

  const stats = config.stats;
  const indexedRatio = stats.chunk_count > 0
    ? Math.round((stats.indexed_count / stats.chunk_count) * 100)
    : 0;

  return (
    <div>
      {/* 顶部统计卡 */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16 }}>
          <Statistic title="文档总数" value={stats.doc_count} prefix={<FileTextOutlined />} />
          <Statistic title="已显示" value={stats.visible_count} valueStyle={{ color: '#52c41a' }} />
          <Statistic title="分类数" value={stats.category_count} />
          <Statistic title="切片数" value={stats.chunk_count} />
          <Statistic
            title="已索引"
            value={stats.indexed_count}
            suffix={stats.chunk_count ? <span style={{ fontSize: 14, color: '#999' }}>/ {indexedRatio}%</span> : null}
            valueStyle={{ color: indexedRatio === 100 ? '#52c41a' : '#fa8c16' }}
          />
          <div>
            <div style={{ color: 'rgba(0,0,0,.45)', fontSize: 14, marginBottom: 4 }}>向量后端</div>
            <Tag color={config.vec_mode === 'vec0' ? 'blue' : 'default'}>
              {config.vec_mode === 'vec0' ? 'sqlite-vec (KNN)' : 'PHP cosine 兜底'}
            </Tag>
          </div>
        </div>
      </Card>

      <Form form={form} layout="vertical" disabled={saving}>
        {/* 基础开关 */}
        <Card title="基础开关" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <Form.Item
              name="docs_enabled" label="启用文档站点" valuePropName="checked"
              tooltip="关闭后 docs-frontend 整个站点不可访问，所有 /public/docs/* 端点返回 403"
            >
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
            <Form.Item
              name="docs_guest_access" label="允许游客浏览" valuePropName="checked"
              tooltip="关闭后游客需登录才能浏览文档；客户端用户不受影响"
            >
              <Switch checkedChildren="允许" unCheckedChildren="必须登录" />
            </Form.Item>
            <Form.Item
              name="docs_rag_enabled" label="启用 RAG 问答" valuePropName="checked"
              tooltip="关闭后右下角问答悬浮窗会隐藏；/docs/chat 端点返回 disabled"
            >
              <Switch checkedChildren="启用" unCheckedChildren="禁用" />
            </Form.Item>
            <Form.Item
              name="docs_chat_allow_guest" label="允许游客提问" valuePropName="checked"
              tooltip="关闭后游客的问答会被引导跳登录，已登录用户不受影响"
            >
              <Switch checkedChildren="允许" unCheckedChildren="仅登录用户" />
            </Form.Item>
          </div>
        </Card>

        {/* 站点信息 */}
        <Card title="站点信息" style={{ marginBottom: 16 }}>
          <Form.Item
            name="docs_site_title" label="站点名"
            tooltip="文档前台 header / 浏览器标题、问答 system prompt 中的 {site_title} 占位符均会替换"
            rules={[{ max: 100 }]}
          >
            <Input placeholder="例如：MyApp 帮助中心" style={{ maxWidth: 480 }} />
          </Form.Item>
        </Card>

        {/* RAG 模型 */}
        <Card title="RAG 模型" style={{ marginBottom: 16 }} extra={
          <Tooltip title="切换 embedding 模型后必须重建索引（不同模型维度可能不同）">
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        }>
          <Form.Item label="对话模型（chat）" required tooltip="用于生成 RAG 回答，建议选 GPT-4o / Qwen-Plus 等指令调教好的模型">
            <Space.Compact style={{ width: '100%', maxWidth: 600 }}>
              <Form.Item name="docs_chat_model_id" noStyle rules={[{ required: true, message: '请选择对话模型' }]}>
                <Select
                  placeholder="选择 chat 类型的 cloud_models"
                  options={config.available_chat_models.map((m) => ({
                    value: m.id,
                    label: `${m.name}（${m.provider_name} / ${m.model_id}）`,
                  }))}
                />
              </Form.Item>
              <Button
                icon={<ExperimentOutlined />}
                loading={testingChat}
                onClick={() => handleTestModel('chat')}
              >
                测试连通
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item label="向量模型（embedding）" required tooltip="用于生成文档 / 查询 embedding。建议选 text-embedding-3-small 等高性价比模型">
            <Space.Compact style={{ width: '100%', maxWidth: 600 }}>
              <Form.Item name="docs_embedding_model_id" noStyle rules={[{ required: true, message: '请选择向量模型' }]}>
                <Select
                  placeholder="选择 embedding 类型的 cloud_models"
                  options={config.available_embedding_models.map((m) => ({
                    value: m.id,
                    label: `${m.name}（${m.provider_name} / ${m.model_id}）`,
                  }))}
                />
              </Form.Item>
              <Button
                icon={<ExperimentOutlined />}
                loading={testingEmbed}
                onClick={() => handleTestModel('embedding')}
              >
                测试连通
              </Button>
            </Space.Compact>
          </Form.Item>
          {config.available_chat_models.length === 0 && (
            <Alert
              type="warning" showIcon
              message="尚无可用的 chat 类型 cloud_models"
              description="请先到「AI 资源 → 模型管理」添加 type=chat、status=active 的模型"
              style={{ marginTop: 8 }}
            />
          )}
          {config.available_embedding_models.length === 0 && (
            <Alert
              type="warning" showIcon
              message="尚无可用的 embedding 类型 cloud_models"
              description="请先到「AI 资源 → 模型管理」添加 type=embedding、status=active 的模型"
              style={{ marginTop: 8 }}
            />
          )}
        </Card>

        {/* 检索 / 切片参数 */}
        <Card title="检索 / 切片参数" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Form.Item
              name="docs_chunk_size" label="切片大小（token）"
              tooltip="单个 chunk 的目标 token 数。500-1500 比较合理；切大了上下文损失，切小了召回率低"
              rules={[{ required: true }]}
            >
              <InputNumber min={200} max={2000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="docs_chunk_overlap" label="切片重叠（token）"
              tooltip="相邻 chunk 之间重叠的 token 数。重叠保留语义连续，建议 chunk_size 的 10-20%"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={500} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="docs_retrieve_top_k" label="检索 Top K"
              tooltip="每次问答检索回最相似的 K 个 chunk 拼接到 prompt"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={20} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="docs_min_similarity" label="最低相似度"
              tooltip="cosine 相似度低于此值的 chunk 不参与回答。0.30 比较宽松，0.50 较严"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item
            name="docs_system_prompt" label="系统提示词"
            tooltip="占位符：{site_title} 替换为站点名；{context} 替换为命中的 chunks；{query} 替换为用户问题"
            rules={[{ required: true, max: 4000 }]}
          >
            <Input.TextArea
              rows={6}
              placeholder="你是 {site_title} 的客服助手..."
              style={{ fontFamily: '"SF Mono","Menlo",monospace', fontSize: 13 }}
            />
          </Form.Item>
        </Card>

        <Card>
          <Space>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              保存设置
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void loadConfig()} disabled={saving}>
              刷新
            </Button>
            <Divider type="vertical" />
            <Tooltip title="切换 embedding 模型 / 修改切片参数后建议执行">
              <Button danger icon={<ThunderboltOutlined />} loading={reindexing} onClick={handleReindexAll}>
                全量重建索引
              </Button>
            </Tooltip>
          </Space>
        </Card>
      </Form>
    </div>
  );
}
