import { useEffect, useState } from 'react';
import {
  Card, Form, Switch, Input, InputNumber, Select, Button, Space, message,
  Tag, Tooltip, Statistic, Alert,
} from 'antd';
import {
  ReloadOutlined, ExperimentOutlined, SaveOutlined, InfoCircleOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import { knowledgeBaseApi } from '../services/api';

/**
 * 知识库设置页：embedding 模型 / 切片参数 / 检索参数 / hybrid 开关 + 统计 + Qdrant 健康。
 *
 * 与文档设置的差异：
 * - 向量存 Qdrant（顶部展示连通健康），无 chat 模型（知识库只做检索，不在云端做问答）
 * - 切换 embedding 模型后，需到「知识库列表」对各库点「重建索引」（维度变化需重新写 Qdrant）
 */

type ModelOption = { id: number; name: string; model_id: string; provider_name: string };

type ConfigPayload = {
  kb_embedding_model_id: number | null;
  kb_chunk_size: number;
  kb_chunk_overlap: number;
  kb_retrieve_top_k: number;
  kb_min_similarity: number;
  kb_hybrid_enabled: boolean;
  kb_qdrant_url: string;
  kb_qdrant_collection: string;
  has_kb_qdrant_api_key: boolean;
  available_embedding_models: ModelOption[];
  stats: { kb_count: number; doc_count: number; chunk_count: number; indexed_count: number };
  qdrant: { ok: boolean; reason?: string; status?: number };
};

export default function KnowledgeBaseSettings() {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [form] = Form.useForm();

  useEffect(() => { void loadConfig(); }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const res = await knowledgeBaseApi.getConfig();
      setConfig(res.data);
      form.setFieldsValue({
        kb_embedding_model_id: res.data.kb_embedding_model_id ? Number(res.data.kb_embedding_model_id) : null,
        kb_chunk_size: res.data.kb_chunk_size ?? 800,
        kb_chunk_overlap: res.data.kb_chunk_overlap ?? 100,
        kb_retrieve_top_k: res.data.kb_retrieve_top_k ?? 6,
        kb_min_similarity: res.data.kb_min_similarity ?? 0.3,
        kb_hybrid_enabled: !!res.data.kb_hybrid_enabled,
        kb_qdrant_url: res.data.kb_qdrant_url || '',
        kb_qdrant_collection: res.data.kb_qdrant_collection || '',
        kb_qdrant_api_key: '',
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
      await knowledgeBaseApi.updateConfig(values);
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

  const handleTestModel = async () => {
    const modelId = form.getFieldValue('kb_embedding_model_id');
    if (!modelId) {
      message.warning('请先选择向量模型');
      return;
    }
    setTesting(true);
    try {
      const res = await knowledgeBaseApi.testModel({ cloud_model_id: modelId });
      const d = res.data;
      if (d.ok) {
        message.success(`连通正常：${d.latency}ms / 维度 ${d.dimension}`);
      } else {
        message.error(`连通失败：${d.error || ''} ${d.detail || ''}`);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '测试失败');
    } finally {
      setTesting(false);
    }
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
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          <Statistic title="知识库数" value={stats.kb_count} prefix={<DatabaseOutlined />} />
          <Statistic title="文档数" value={stats.doc_count} />
          <Statistic title="切片数" value={stats.chunk_count} />
          <Statistic
            title="已索引向量"
            value={stats.indexed_count}
            suffix={stats.chunk_count ? <span style={{ fontSize: 14, color: '#999' }}>/ {indexedRatio}%</span> : null}
            valueStyle={{ color: indexedRatio === 100 ? '#52c41a' : '#fa8c16' }}
          />
          <div>
            <div style={{ color: 'rgba(0,0,0,.45)', fontSize: 14, marginBottom: 4 }}>Qdrant 向量库</div>
            <Tag color={config.qdrant?.ok ? 'success' : 'error'}>
              {config.qdrant?.ok ? '已连通' : `不可用${config.qdrant?.reason ? '：' + config.qdrant.reason : ''}`}
            </Tag>
          </div>
        </div>
      </Card>

      {!config.qdrant?.ok && (
        <Alert
          type="error" showIcon style={{ marginBottom: 16 }}
          message="Qdrant 向量库未连通"
          description="请先部署 Qdrant 并在下方填写服务地址（默认 http://127.0.0.1:6333）。未连通时文档无法向量化、检索不可用。"
        />
      )}

      <Form form={form} layout="vertical" disabled={saving}>
        <Card title="Qdrant 向量库连接" style={{ marginBottom: 16 }} extra={
          <Tooltip title="知识库 chunk 向量存于 Qdrant；连接信息在此配置，无需改服务器 .env">
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        }>
          <Form.Item
            name="kb_qdrant_url" label="服务地址（URL）"
            tooltip="Qdrant HTTP 地址，如 http://127.0.0.1:6333；留空表示未配置（向量化 / 检索不可用）"
            rules={[{ max: 300 }]}
          >
            <Input placeholder="http://127.0.0.1:6333" style={{ maxWidth: 480 }} allowClear />
          </Form.Item>
          <Form.Item
            name="kb_qdrant_api_key" label="API Key（可选）"
            tooltip="Qdrant 开启鉴权时填写；留空表示不改动已保存的值（不会清空）"
            extra={config.has_kb_qdrant_api_key ? '已配置（如需更换请重新输入；留空保持不变）' : '未配置'}
            rules={[{ max: 500 }]}
          >
            <Input.Password placeholder={config.has_kb_qdrant_api_key ? '••••••（留空保持不变）' : '未开启鉴权可留空'} style={{ maxWidth: 480 }} autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="kb_qdrant_collection" label="Collection 名"
            tooltip="向量集合名，留空默认 kb_chunks。多库共用一个 collection，按 kb_id 过滤隔离"
            rules={[{ max: 100 }, { pattern: /^[A-Za-z0-9_-]*$/, message: '仅允许字母 / 数字 / 下划线 / 连字符' }]}
          >
            <Input placeholder="kb_chunks" style={{ maxWidth: 480 }} allowClear />
          </Form.Item>
          <Alert
            type={config.qdrant?.ok ? 'success' : 'warning'}
            showIcon
            message={config.qdrant?.ok ? 'Qdrant 已连通' : `Qdrant 未连通${config.qdrant?.reason ? '：' + config.qdrant.reason : ''}`}
            description={config.qdrant?.ok ? undefined : '保存连接信息后此处会刷新连通状态；未连通时无法向量化与检索。'}
          />
        </Card>

        <Card title="向量模型（embedding）" style={{ marginBottom: 16 }} extra={
          <Tooltip title="切换 embedding 模型后，各知识库需重新「重建索引」（不同模型维度可能不同）">
            <InfoCircleOutlined style={{ color: '#999' }} />
          </Tooltip>
        }>
          <Form.Item label="全局向量模型" required tooltip="知识库可在编辑时按库覆盖；此处为默认值">
            <Space.Compact style={{ width: '100%', maxWidth: 600 }}>
              <Form.Item name="kb_embedding_model_id" noStyle rules={[{ required: true, message: '请选择向量模型' }]}>
                <Select
                  placeholder="选择 embedding 类型的 cloud_models"
                  options={config.available_embedding_models.map((m) => ({
                    value: m.id,
                    label: `${m.name}（${m.provider_name} / ${m.model_id}）`,
                  }))}
                />
              </Form.Item>
              <Button icon={<ExperimentOutlined />} loading={testing} onClick={handleTestModel}>
                测试连通
              </Button>
            </Space.Compact>
          </Form.Item>
          {config.available_embedding_models.length === 0 && (
            <Alert
              type="warning" showIcon
              message="尚无可用的 embedding 类型 cloud_models"
              description="请先到「AI 资源 → 模型管理」添加 type=embedding、status=active 的模型"
              style={{ marginTop: 8 }}
            />
          )}
        </Card>

        <Card title="检索 / 切片参数" style={{ marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <Form.Item
              name="kb_chunk_size" label="切片大小（token）"
              tooltip="单个 chunk 的目标 token 数。500-1500 比较合理"
              rules={[{ required: true }]}
            >
              <InputNumber min={200} max={2000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="kb_chunk_overlap" label="切片重叠（token）"
              tooltip="相邻 chunk 重叠 token 数，建议 chunk_size 的 10-20%"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={500} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="kb_retrieve_top_k" label="检索 Top K"
              tooltip="每次检索召回最相似的 K 个 chunk"
              rules={[{ required: true }]}
            >
              <InputNumber min={1} max={20} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="kb_min_similarity" label="最低相似度"
              tooltip="cosine 相似度低于此值的 chunk 不返回。0.30 较宽松，0.50 较严"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item
            name="kb_hybrid_enabled" label="启用 Hybrid 检索" valuePropName="checked"
            tooltip="开启后向量召回 + MySQL 全文关键词召回做 RRF 融合，提升中文短词命中率"
          >
            <Switch checkedChildren="向量+关键词" unCheckedChildren="仅向量" />
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
          </Space>
        </Card>
      </Form>
    </div>
  );
}
