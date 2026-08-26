import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, Table, Button, Space, Modal, Form, Input, Select, Switch, InputNumber,
  message, Tag, Popconfirm, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, FileTextOutlined,
  ThunderboltOutlined, ReloadOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import { knowledgeBaseApi } from '../services/api';

/**
 * 知识库列表页：库 CRUD + 入口到「文档管理」+ 整库重建索引。
 *
 * 知识库是顶层单元，与数字员工预设 N:N 绑定（agents_count 列展示绑定数）。
 * embedding 模型可按库覆盖（留空用「知识库设置」的全局模型）。
 */

type ModelOption = { id: number; name: string; model_id: string; provider_name: string };

type KbItem = {
  id: number;
  name: string;
  description: string;
  embedding_model_id: number | null;
  status: string;
  is_visible: boolean;
  doc_count: number;
  chunk_count: number;
  agents_count?: number;
  sort_order: number;
  created_at: string;
};

export default function KnowledgeBases() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<KbItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KbItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => { void load(); }, [page]);
  useEffect(() => {
    knowledgeBaseApi.getConfig()
      .then((res) => setModelOptions(res.data.available_embedding_models || []))
      .catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await knowledgeBaseApi.list({ page, per_page: 20, keyword: keyword || undefined });
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active', is_visible: true, sort_order: 0, embedding_model_id: null });
    setModalOpen(true);
  };

  const openEdit = (row: KbItem) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      description: row.description,
      embedding_model_id: row.embedding_model_id ? Number(row.embedding_model_id) : null,
      status: row.status || 'active',
      is_visible: !!row.is_visible,
      sort_order: row.sort_order ?? 0,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      if (editing) {
        await knowledgeBaseApi.update(editing.id, values);
        message.success('已更新');
      } else {
        await knowledgeBaseApi.create(values);
        message.success('已创建');
      }
      setModalOpen(false);
      await load();
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

  const handleDelete = async (row: KbItem) => {
    try {
      await knowledgeBaseApi.delete(row.id);
      message.success('已删除');
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const handleReindex = async (row: KbItem) => {
    try {
      const res = await knowledgeBaseApi.reindexKb(row.id);
      message.success(`已提交重建：${res.data.dispatched} 个文档排队向量化`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '重建失败');
    }
  };

  const columns = [
    {
      title: '知识库', dataIndex: 'name', key: 'name',
      render: (name: string, row: KbItem) => (
        <Space direction="vertical" size={0}>
          <Space>
            <DatabaseOutlined style={{ color: '#1677ff' }} />
            <b>{name}</b>
            {row.status !== 'active' && <Tag color="default">已禁用</Tag>}
          </Space>
          {row.description && <span style={{ color: '#999', fontSize: 12 }}>{row.description}</span>}
        </Space>
      ),
    },
    { title: '文档', dataIndex: 'doc_count', key: 'doc_count', width: 80 },
    { title: '切片', dataIndex: 'chunk_count', key: 'chunk_count', width: 80 },
    {
      title: '绑定数字员工', dataIndex: 'agents_count', key: 'agents_count', width: 110,
      render: (n: number) => <Tag color={n ? 'geekblue' : 'default'}>{n || 0}</Tag>,
    },
    {
      title: '操作', key: 'action', width: 320,
      render: (_: any, row: KbItem) => (
        <Space>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => navigate(`/knowledge-bases/${row.id}/documents`)}>
            文档
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Tooltip title="把该库所有文档重新切片 + 向量化（异步）">
            <Button size="small" icon={<ThunderboltOutlined />} onClick={() => handleReindex(row)}>重建</Button>
          </Tooltip>
          <Popconfirm
            title="删除知识库？"
            description="将级联删除其文档、切片、向量，并解除与数字员工的绑定，且不可恢复。"
            okType="danger"
            onConfirm={() => handleDelete(row)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="知识库列表"
        extra={
          <Space>
            <Input.Search
              placeholder="搜索名称 / 描述"
              allowClear
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={() => { setPage(1); void load(); }}
              style={{ width: 220 }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建知识库</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          loading={loading}
          columns={columns as any}
          dataSource={items}
          pagination={{
            current: page,
            pageSize: 20,
            total,
            onChange: (p) => setPage(p),
            showTotal: (t) => `共 ${t} 个`,
          }}
        />
      </Card>

      <Modal
        title={editing ? '编辑知识库' : '新建知识库'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        mask={false}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }, { max: 100 }]}>
            <Input placeholder="例如：产品帮助库" />
          </Form.Item>
          <Form.Item name="description" label="描述" rules={[{ max: 500 }]}>
            <Input.TextArea rows={2} placeholder="可选，简述该知识库用途" />
          </Form.Item>
          <Form.Item
            name="embedding_model_id" label="向量模型（可选）"
            tooltip="留空使用「知识库设置」的全局 embedding 模型；按库覆盖时切换后需重建该库索引"
          >
            <Select
              allowClear
              placeholder="默认使用全局模型"
              options={modelOptions.map((m) => ({ value: m.id, label: `${m.name}（${m.provider_name} / ${m.model_id}）` }))}
            />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Form.Item name="status" label="状态">
              <Select options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '禁用' }]} />
            </Form.Item>
            <Form.Item name="is_visible" label="可见" valuePropName="checked">
              <Switch checkedChildren="是" unCheckedChildren="否" />
            </Form.Item>
            <Form.Item name="sort_order" label="排序">
              <InputNumber min={-9999} max={9999} style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
