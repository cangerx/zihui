import { useEffect, useMemo, useState } from 'react';
import {
  Button, Form, Input, InputNumber, message, Modal, Popconfirm, Select, Space,
  Switch, Table, Tag, Tooltip, Typography, Upload, AutoComplete, Image,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, UploadOutlined,
} from '@ant-design/icons';
import { stylePresetApi } from '../services/api';

interface StylePreset {
  id: number;
  name: string;
  prompt_fragment: string;
  sample_image: string;
  category: string;
  sort_order: number;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export default function StylePresetsPage() {
  const [items, setItems] = useState<StylePreset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 20 });
  const [categories, setCategories] = useState<string[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<StylePreset | null>(null);
  const [saving, setSaving] = useState(false);
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [form] = Form.useForm();

  // 本地预览 URL 只随文件选择变化重建（避免每次 render 都 createObjectURL 泄漏）
  const samplePreviewUrl = useMemo(() => (sampleFile ? URL.createObjectURL(sampleFile) : ''), [sampleFile]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await stylePresetApi.list(params);
      setItems(res.data?.items || []);
      setTotal(res.data?.total || 0);
    } catch (err: any) {
      message.error(err.response?.data?.message || '加载失败');
    }
    setLoading(false);
  };

  const loadCategories = async () => {
    try {
      const res = await stylePresetApi.categories();
      setCategories(res.data?.data || []);
    } catch { /* 分类联想失败不影响主流程 */ }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [params]);
  useEffect(() => { loadCategories(); }, []);

  const openCreate = () => {
    setEditing(null);
    setSampleFile(null);
    form.resetFields();
    form.setFieldsValue({ is_enabled: true, sort_order: 0 });
    setModalOpen(true);
  };

  const openEdit = (row: StylePreset) => {
    setEditing(row);
    setSampleFile(null);
    form.setFieldsValue({
      name: row.name,
      category: row.category || undefined,
      prompt_fragment: row.prompt_fragment,
      sort_order: row.sort_order,
      is_enabled: row.is_enabled,
    });
    setModalOpen(true);
  };

  const save = async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('name', values.name);
      fd.append('prompt_fragment', values.prompt_fragment);
      fd.append('category', values.category || '');
      fd.append('sort_order', String(values.sort_order ?? 0));
      fd.append('is_enabled', values.is_enabled ? '1' : '0');
      if (sampleFile) fd.append('sample_image', sampleFile);
      if (editing) {
        fd.append('_method', 'PUT'); // Laravel 只解析 POST 的 multipart，PUT 需伪造
        await stylePresetApi.update(editing.id, fd);
        message.success('已保存');
      } else {
        await stylePresetApi.create(fd);
        message.success('已创建');
      }
      setModalOpen(false);
      load();
      loadCategories();
    } catch (err: any) {
      const errors = err.response?.data?.errors;
      const first = errors ? Object.values(errors)[0] : null;
      message.error(Array.isArray(first) ? String(first[0]) : (err.response?.data?.message || '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: StylePreset) => {
    try {
      await stylePresetApi.delete(row.id);
      message.success('已删除');
      load();
      loadCategories();
    } catch (err: any) {
      message.error(err.response?.data?.message || '删除失败');
    }
  };

  const toggle = async (row: StylePreset) => {
    try {
      await stylePresetApi.toggle(row.id);
      load();
    } catch (err: any) {
      message.error(err.response?.data?.message || '操作失败');
    }
  };

  const columns = [
    {
      title: '示例图', dataIndex: 'sample_image', width: 90,
      render: (v: string) => v
        ? <Image src={v} width={56} height={56} style={{ objectFit: 'cover', borderRadius: 6 }} />
        : <Typography.Text type="secondary" style={{ fontSize: 12 }}>无</Typography.Text>,
    },
    { title: '名称', dataIndex: 'name', width: 140, ellipsis: true },
    { title: '分类', dataIndex: 'category', width: 110, render: (v: string) => v ? <Tag>{v}</Tag> : '-' },
    {
      title: '提示词片段', dataIndex: 'prompt_fragment', ellipsis: true,
      render: (v: string) => (
        <Tooltip title={v} placement="topLeft">
          <span style={{ fontSize: 12 }}>{v}</span>
        </Tooltip>
      ),
    },
    { title: '排序', dataIndex: 'sort_order', width: 70 },
    {
      title: '启用', dataIndex: 'is_enabled', width: 80,
      render: (v: boolean, row: StylePreset) => <Switch checked={v} size="small" onChange={() => toggle(row)} />,
    },
    {
      title: '操作', width: 130, fixed: 'right' as const,
      render: (_: any, row: StylePreset) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)}>编辑</Button>
          <Popconfirm
            title="删除该风格？"
            description="删除后桌面端下次拉取即不可见，已选中它的用户按「无风格」处理。"
            onConfirm={() => remove(row)}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>风格管理</Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建风格</Button>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        <Select
          placeholder="分类筛选" allowClear style={{ width: 140 }}
          options={categories.map((c) => ({ value: c, label: c }))}
          onChange={(v) => setParams({ ...params, category: v, page: 1 })}
        />
        <Input.Search
          placeholder="搜索名称 / 片段" allowClear style={{ width: 220 }}
          onSearch={(v) => setParams({ ...params, keyword: v || undefined, page: 1 })}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          启用的风格会下发到桌面端各生图入口（AI 生图 / 批量生图 / 画布）
        </Typography.Text>
      </Space>

      <Table<StylePreset>
        rowKey="id"
        size="middle"
        columns={columns as any}
        dataSource={items}
        loading={loading}
        scroll={{ x: 900 }}
        pagination={{
          current: params.page, pageSize: params.per_page, total,
          showSizeChanger: true, pageSizeOptions: ['10', '20', '50'],
          onChange: (page, per_page) => setParams({ ...params, page, per_page }),
        }}
      />

      <Modal
        open={modalOpen}
        onCancel={() => { if (!saving) setModalOpen(false); }}
        onOk={save}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        title={editing ? `编辑风格：${editing.name}` : '新建风格'}
        width={560}
        mask={false}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="name" label="风格名称"
            rules={[{ required: true, message: '请输入风格名称' }, { max: 50, message: '最多 50 个字符' }]}
          >
            <Input placeholder="如：日系赛璐璐" maxLength={50} />
          </Form.Item>
          <Form.Item name="category" label="分类" rules={[{ max: 50, message: '最多 50 个字符' }]}>
            <AutoComplete
              placeholder="如：动漫（可输入新分类）"
              options={categories.map((c) => ({ value: c }))}
              filterOption={(input, option) => String(option?.value || '').includes(input)}
            />
          </Form.Item>
          <Form.Item
            name="prompt_fragment" label="提示词片段"
            extra="会拼接到用户提示词尾部（以分隔符隔开）。用自然语言描述风格，全模型通用。"
            rules={[{ required: true, message: '请输入提示词片段' }, { max: 2000, message: '最多 2000 个字符' }]}
          >
            <Input.TextArea rows={4} placeholder="如：日系赛璐璐动画风格，清新配色，柔和光影，干净线条" maxLength={2000} showCount />
          </Form.Item>
          <Form.Item label="示例图（可选，PNG/JPG/WebP，≤2MB；不传则桌面端显示纯文字卡）">
            <Space align="start">
              <Upload
                accept="image/png,image/jpeg,image/webp"
                showUploadList={false}
                beforeUpload={(file) => {
                  if (file.size > 2 * 1024 * 1024) { message.error('图片不能超过 2MB'); return Upload.LIST_IGNORE; }
                  setSampleFile(file);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />}>{sampleFile ? '重新选择' : (editing?.sample_image ? '更换示例图' : '选择图片')}</Button>
              </Upload>
              {samplePreviewUrl ? (
                <Image src={samplePreviewUrl} width={56} height={56} style={{ objectFit: 'cover', borderRadius: 6 }} />
              ) : editing?.sample_image ? (
                <Image src={editing.sample_image} width={56} height={56} style={{ objectFit: 'cover', borderRadius: 6 }} />
              ) : null}
            </Space>
          </Form.Item>
          <Space size="large">
            <Form.Item name="sort_order" label="排序（小的在前）" style={{ marginBottom: 0 }}>
              <InputNumber min={0} max={1000000} style={{ width: 140 }} />
            </Form.Item>
            <Form.Item name="is_enabled" label="启用" valuePropName="checked" style={{ marginBottom: 0 }}>
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
