import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Table, Button, Space, Modal, Form, Input, message, Tag,
  Popconfirm, Upload, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ThunderboltOutlined,
  ReloadOutlined, ArrowLeftOutlined, ImportOutlined,
} from '@ant-design/icons';
import { knowledgeBaseApi } from '../services/api';
import DocRichEditor from '../components/DocRichEditor';

/**
 * 知识库文档管理页：富文本在线编辑 + 文件上传解析（PDF/Word/MD/TXT/Excel）+ 异步向量化状态。
 *
 * 文档向量化是异步的（index_status: pending→processing→ready/failed），
 * 存在 pending/processing 文档时自动轮询刷新。
 */

type DocItem = {
  id: number;
  kb_id: number;
  title: string;
  source_type: string;
  original_filename: string;
  index_status: string;
  index_error: string;
  chunk_count: number;
  updated_at: string;
};

const STATUS_TAG: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待索引' },
  processing: { color: 'processing', text: '索引中' },
  ready: { color: 'success', text: '已就绪' },
  failed: { color: 'error', text: '失败' },
};

export default function KnowledgeBaseDocuments() {
  const { kbId } = useParams<{ kbId: string }>();
  const id = Number(kbId);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DocItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DocItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [contentHtml, setContentHtml] = useState('');
  const [form] = Form.useForm();
  const pollTimer = useRef<number | null>(null);

  useEffect(() => { void load(); }, [page]);
  useEffect(() => () => { if (pollTimer.current) window.clearTimeout(pollTimer.current); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await knowledgeBaseApi.listDocuments(id, { page, per_page: 20 });
      const list: DocItem[] = res.data.items || [];
      setItems(list);
      setTotal(res.data.total || 0);
      // 有进行中的文档则轮询
      if (pollTimer.current) window.clearTimeout(pollTimer.current);
      if (list.some((d) => d.index_status === 'pending' || d.index_status === 'processing')) {
        pollTimer.current = window.setTimeout(() => void load(), 4000);
      }
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setContentHtml('');
    setModalOpen(true);
  };

  const openEdit = async (row: DocItem) => {
    setEditing(row);
    try {
      const res = await knowledgeBaseApi.getDocument(id, row.id);
      form.setFieldsValue({ title: res.data.title });
      setContentHtml(res.data.content_html || '');
      setModalOpen(true);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载文档失败');
    }
  };

  const handleSubmit = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    if (!contentHtml.trim()) {
      message.warning('请输入文档内容');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await knowledgeBaseApi.updateDocument(id, editing.id, { title: values.title, content_html: contentHtml });
        message.success('已更新，正在重新索引');
      } else {
        await knowledgeBaseApi.createDocument(id, { title: values.title, content_html: contentHtml });
        message.success('已创建，正在索引');
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleBatchImport = async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    try {
      const res = await knowledgeBaseApi.import(id, files);
      const d = res.data;
      let msg = `导入完成：成功 ${d.success}，失败 ${d.failed}`;
      if (d.failed) {
        console.warn('[KB] import failures:', d.details.filter((x) => x.status === 'failed'));
      }
      message.success({ content: msg, duration: 5 });
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const handleReindex = async (row: DocItem) => {
    try {
      await knowledgeBaseApi.reindexDocument(id, row.id);
      message.success('已提交重新索引');
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '重建失败');
    }
  };

  const handleDelete = async (row: DocItem) => {
    try {
      await knowledgeBaseApi.deleteDocument(id, row.id);
      message.success('已删除');
      await load();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '标题', dataIndex: 'title', key: 'title',
      render: (title: string, row: DocItem) => (
        <Space direction="vertical" size={0}>
          <b>{title}</b>
          {row.source_type === 'upload' && row.original_filename && (
            <span style={{ color: '#999', fontSize: 12 }}>{row.original_filename}</span>
          )}
        </Space>
      ),
    },
    {
      title: '来源', dataIndex: 'source_type', key: 'source_type', width: 90,
      render: (t: string) => <Tag>{t === 'upload' ? '文件上传' : '在线编辑'}</Tag>,
    },
    {
      title: '索引状态', dataIndex: 'index_status', key: 'index_status', width: 120,
      render: (s: string, row: DocItem) => {
        const tag = STATUS_TAG[s] || STATUS_TAG.pending;
        const el = <Tag color={tag.color}>{tag.text}</Tag>;
        return s === 'failed' && row.index_error
          ? <Tooltip title={row.index_error}>{el}</Tooltip>
          : el;
      },
    },
    { title: '切片', dataIndex: 'chunk_count', key: 'chunk_count', width: 70 },
    {
      title: '操作', key: 'action', width: 240,
      render: (_: any, row: DocItem) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Tooltip title="重新切片 + 向量化">
            <Button size="small" icon={<ThunderboltOutlined />} onClick={() => handleReindex(row)}>重建</Button>
          </Tooltip>
          <Popconfirm title="删除该文档？" description="将同时删除其切片与向量。" okType="danger" onConfirm={() => handleDelete(row)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/knowledge-bases')} />
            <span>文档管理</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建文档</Button>
          </Space>
        }
      >
        <Upload.Dragger
          accept=".pdf,.doc,.docx,.md,.markdown,.txt,.csv,.xlsx"
          showUploadList={false}
          multiple
          disabled={importing}
          beforeUpload={(file, fileList) => {
            // 仅在最后一个文件触发一次批量导入
            if (file === fileList[fileList.length - 1]) {
              void handleBatchImport(fileList as unknown as File[]);
            }
            return false;
          }}
          style={{ marginBottom: 16 }}
        >
          <p className="ant-upload-drag-icon"><ImportOutlined style={{ fontSize: 28 }} /></p>
          <p className="ant-upload-text">{importing ? '正在导入...' : '点击或拖入文件批量导入（可多选）'}</p>
          <p className="ant-upload-hint">支持 PDF / Word(.docx) / Markdown / TXT / CSV / Excel(.xlsx)，单文件 ≤ 20MB</p>
        </Upload.Dragger>

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
            showTotal: (t) => `共 ${t} 篇`,
          }}
        />
      </Card>

      <Modal
        title={editing ? '编辑文档' : '新建文档'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        mask={false}
        destroyOnClose
        width={820}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }, { max: 200 }]}>
            <Input placeholder="文档标题" />
          </Form.Item>
          <Form.Item label="内容" required>
            <DocRichEditor value={contentHtml} onChange={setContentHtml} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
