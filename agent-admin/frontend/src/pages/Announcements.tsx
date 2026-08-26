import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, Switch,
  message, Popconfirm, Tag, Tooltip, Typography,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { announcementApi } from '../services/api';
import RichTextEditor from '../components/RichTextEditor';

const { Title, Paragraph } = Typography;

interface Announcement {
  id: number;
  title: string;
  content: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export default function AnnouncementsPage() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewItem, setPreviewItem] = useState<Announcement | null>(null);
  const [form] = Form.useForm<{ title: string; content: string; enabled: boolean; sort_order: number }>();

  const loadList = async () => {
    setLoading(true);
    try {
      const res = await announcementApi.list();
      setItems(res.data?.items || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载公告列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadList(); }, []);

  const openCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ title: '', content: '', enabled: true, sort_order: 0 });
    setModalOpen(true);
  };

  const openEdit = (item: Announcement) => {
    setEditingId(item.id);
    form.setFieldsValue({
      title: item.title,
      content: item.content,
      enabled: item.enabled,
      sort_order: item.sort_order,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingId) {
        await announcementApi.update(editingId, values);
        message.success('已更新');
      } else {
        await announcementApi.create(values);
        message.success('已创建');
      }
      setModalOpen(false);
      loadList();
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验失败，Antd 会自动展示
      message.error(e?.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await announcementApi.delete(id);
      message.success('已删除');
      loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败');
    }
  };

  const handleToggle = async (id: number) => {
    try {
      await announcementApi.toggle(id);
      loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '切换状态失败');
    }
  };

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 280,
      render: (t: string) => <span style={{ fontWeight: 500 }}>{t}</span>,
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 90,
      render: (v: boolean, row: Announcement) => (
        <Switch checked={v} onChange={() => handleToggle(row.id)} size="small" />
      ),
    },
    {
      title: '排序',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 80,
      render: (v: number) => (
        <Tooltip title="数值大的优先展示；相同排序按 ID 倒序兜底">
          <Tag color={v > 0 ? 'blue' : 'default'}>{v}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 170,
      render: (t: string) => t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 230,
      render: (_: unknown, row: Announcement) => (
        <Space>
          <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => setPreviewItem(row)}>
            预览
          </Button>
          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Popconfirm
            title="删除公告？"
            description="此操作不可撤销"
            okType="danger"
            onConfirm={() => handleDelete(row.id)}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>公告管理</Title>
          <Paragraph type="secondary" style={{ margin: 0, marginTop: 4 }}>
            桌面端登录后会拉取当前启用的排序最高的一条公告并在顶部栏展示。
          </Paragraph>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增公告</Button>
      </div>

      <Table
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
        size="middle"
      />

      <Modal
        title={editingId ? '编辑公告' : '新增公告'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            label="标题"
            name="title"
            rules={[
              { required: true, message: '请输入标题' },
              { max: 200, message: '标题不能超过 200 字' },
            ]}
          >
            <Input placeholder="如：系统维护公告 / 新功能上线" maxLength={200} showCount />
          </Form.Item>

          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item label="启用" name="enabled" valuePropName="checked" style={{ marginBottom: 16 }}>
              <Switch />
            </Form.Item>
            <Form.Item label="排序" name="sort_order" tooltip="数值大的优先展示，相同按 ID 倒序">
              <InputNumber min={-9999} max={9999} />
            </Form.Item>
          </div>

          <Form.Item
            label="内容"
            name="content"
            rules={[
              { required: true, message: '请输入公告内容' },
              {
                validator: async (_, v: string) => {
                  // contentEditable 的空白也是 <br> / <div><br></div>，要剔除再判空；
                  // 但含 <img> 视为有内容（纯图片公告，如海报式通知，也是合法公告）
                  if (/<img[\s>]/i.test(v || '')) return;
                  const plain = (v || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim();
                  if (!plain) throw new Error('请输入公告内容');
                },
              },
            ]}
          >
            <RichTextEditorField />
          </Form.Item>
        </Form>
      </Modal>

      {/* 预览弹窗：按桌面端公告弹窗的展示方式渲染富文本 */}
      <Modal
        title={previewItem?.title || '公告预览'}
        open={!!previewItem}
        onCancel={() => setPreviewItem(null)}
        footer={[<Button key="ok" onClick={() => setPreviewItem(null)}>关闭</Button>]}
        width={640}
      >
        {previewItem && (
          <div
            className="announcement-preview-content"
            style={{ fontSize: 14, lineHeight: 1.7 }}
            dangerouslySetInnerHTML={{ __html: previewItem.content || '<p style="color:#bfbfbf">（无内容）</p>' }}
          />
        )}
        <style>{`
          .announcement-preview-content a { color: #1677ff; text-decoration: underline; }
          .announcement-preview-content ul, .announcement-preview-content ol { padding-left: 24px; margin: 4px 0; }
          .announcement-preview-content p { margin: 4px 0; }
          /* 与桌面端公告弹窗的插图样式保持一致：容器内等比缩放居中 */
          .announcement-preview-content img { max-width: 100%; height: auto; display: block; margin: 8px auto; border-radius: 8px; }
        `}</style>
      </Modal>
    </div>
  );
}

/**
 * 把 RichTextEditor 包一层 Form.Item 受控接口。
 * Antd Form.Item 的 value / onChange 会自动注入。
 */
function RichTextEditorField({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  return (
    <RichTextEditor
      value={value || ''}
      onChange={(html) => onChange?.(html)}
      placeholder="支持粗体、斜体、下划线、列表、链接、插图；从 Word 等外部粘贴会自动剥掉样式。"
    />
  );
}
