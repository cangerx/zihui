import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, Switch, message,
  Tag, Popconfirm, Tooltip,
} from 'antd';
import type { TableProps } from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  EyeInvisibleOutlined, EyeOutlined,
} from '@ant-design/icons';
import { docApi } from '../services/api';

/**
 * 文档分类管理页。
 *
 * 设计取舍：
 * - 分类数量一般 < 50，不用分页 / 搜索，整表加载
 * - sort_order 用数字输入而非拖拽：拖拽要引入 dnd-kit 等额外依赖，不划算
 * - 删除时后端会拦下还挂文档的分类（409），前端只显示错误 + 引导去移走文档
 * - 已禁用 / 无文档的分类单独用 Tag 标记，方便 admin 清理
 */

type Category = {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_visible: boolean;
  docs_count?: number;
  created_at: string;
  updated_at: string;
};

export default function DocCategories() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => { void loadList(); }, []);

  const loadList = async () => {
    setLoading(true);
    try {
      const res = await docApi.listCategories();
      // 后端返回 { data: [...] } 包装；兜底兼容裸数组
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setItems(list);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载分类失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ is_visible: true, sort_order: 0 });
    setModalOpen(true);
  };

  const handleEdit = (item: Category) => {
    setEditing(item);
    form.setFieldsValue({
      name: item.name,
      slug: item.slug || '',
      sort_order: item.sort_order ?? 0,
      is_visible: !!item.is_visible,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    let values: any;
    try { values = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      if (editing) {
        await docApi.updateCategory(editing.id, values);
        message.success('分类已更新');
      } else {
        await docApi.createCategory(values);
        message.success('分类已创建');
      }
      setModalOpen(false);
      await loadList();
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

  const handleDelete = async (id: number) => {
    try {
      await docApi.deleteCategory(id);
      message.success('已删除');
      await loadList();
    } catch (e: any) {
      // 后端对"分类下还有文档"返回 409 + 明确提示
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const handleToggleVisibility = async (item: Category) => {
    try {
      await docApi.updateCategory(item.id, { is_visible: !item.is_visible });
      message.success(item.is_visible ? '已隐藏' : '已显示');
      await loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  const columns: TableProps<Category>['columns'] = [
    {
      title: '分类名', dataIndex: 'name', key: 'name',
      render: (name: string, record) => (
        <Space>
          <a onClick={() => handleEdit(record)} style={{ fontWeight: 500 }}>{name}</a>
          {record.slug && <Tag>{record.slug}</Tag>}
        </Space>
      ),
    },
    {
      title: '文档数', dataIndex: 'docs_count', key: 'docs_count', width: 100, align: 'right' as const,
      render: (n?: number) => n ?? 0,
    },
    {
      title: '排序', dataIndex: 'sort_order', key: 'sort_order', width: 80, align: 'center' as const,
      render: (v: number) => <Tag>{v}</Tag>,
    },
    {
      title: '可见性', dataIndex: 'is_visible', key: 'is_visible', width: 100,
      render: (visible: boolean) => visible
        ? <Tag color="success">显示</Tag>
        : <Tag color="default">隐藏</Tag>,
    },
    {
      title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-',
    },
    {
      title: '操作', key: 'action', width: 140, fixed: 'right' as const,
      render: (_: any, record) => (
        <Space size={0}>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Tooltip title={record.is_visible ? '隐藏' : '显示'}>
            <Button
              type="text" size="small"
              icon={record.is_visible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => handleToggleVisibility(record)}
            />
          </Tooltip>
          <Popconfirm
            title={`确定删除分类《${record.name}》？`}
            description={
              (record.docs_count ?? 0) > 0
                ? `该分类下还有 ${record.docs_count} 篇文档，必须先移走才能删除`
                : '分类删除后不可恢复'
            }
            okType="danger"
            disabled={(record.docs_count ?? 0) > 0}
            onConfirm={() => handleDelete(record.id)}
          >
            <Tooltip title={(record.docs_count ?? 0) > 0 ? '分类下有文档，不可删除' : '删除'}>
              <Button
                type="text" size="small" danger icon={<DeleteOutlined />}
                disabled={(record.docs_count ?? 0) > 0}
              />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => void loadList()}>刷新</Button>
        </Space>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增分类</Button>
        </Space>
      </div>

      <Table<Category>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={false}
      />

      <Modal
        open={modalOpen}
        title={editing ? `编辑：${editing.name}` : '新增分类'}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="分类名" rules={[{ required: true, message: '请输入分类名' }, { max: 100 }]}>
            <Input placeholder="例如：快速开始 / 常见问题 / API 参考" />
          </Form.Item>
          <Form.Item
            name="slug"
            label="URL 标识"
            tooltip="可选；留空后端自动生成。仅允许字母、数字、中划线（如 quickstart）"
            rules={[{ pattern: /^[a-z0-9\-]*$/i, message: '只能包含字母、数字、中划线' }, { max: 100 }]}
          >
            <Input placeholder="可选，例如 quickstart" />
          </Form.Item>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Form.Item name="sort_order" label="排序" tooltip="数字越大越靠前">
              <InputNumber min={0} max={9999} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="is_visible" label="可见性" valuePropName="checked">
              <Switch checkedChildren="显示" unCheckedChildren="隐藏" />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
