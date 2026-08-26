import { useEffect, useState } from 'react';
import { Drawer, Table, Button, Space, Modal, Form, Input, InputNumber, Popconfirm, Tag, Tooltip, message, Typography, Select } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { credentialApi } from '../services/api';

/**
 * 凭证池抽屉：管理某个 provider 下的 API Key 集合。
 *
 * GatewayRouter 调度逻辑：
 *   - 池子里 status=active 的行按 weight 轮询（或加权随机，由 config 决定）
 *   - 调用失败 fail_count++，达 config('gateway.credential_fail_invalid_threshold') 阈值
 *     时自动置 invalid（不删除，可手动「重置」恢复）
 *   - 池子全空时回落到 cloud_providers.api_key 字段（保证老 provider 零行为变化）
 *
 * 设计要点：
 *   - api_key 走 mask 显示（前 4 + *** + 后 4），不向前端暴露明文
 *   - 编辑 api_key 留空表示「保持不变」（与 provider 编辑表单一致）
 *   - 重置：fail_count 归零 + status=active；用于管理员确认 key 仍可用后救回
 *   - 删除：软删除（保留 UsageRecord 关联），不会真物理删
 *   - mask={false}：遵循项目规则「弹窗只加阴影不加遮罩」
 */

interface Credential {
  id: number;
  provider_id: number;
  name: string;
  api_key_masked: string;
  weight: number;
  status: string;
  fail_count: number;
  last_used_at: string | null;
  last_failed_at: string | null;
  last_error: string;
  remark: string;
  created_at: string | null;
}

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  active:    { color: 'green',    label: '正常' },
  exhausted: { color: 'orange',   label: '额度耗尽' },
  invalid:   { color: 'red',      label: '已失活' },
  disabled:  { color: 'default',  label: '已禁用' },
};

const STATUS_OPTIONS = [
  { value: 'active',    label: '正常' },
  { value: 'exhausted', label: '额度耗尽' },
  { value: 'invalid',   label: '已失活' },
  { value: 'disabled',  label: '已禁用' },
];

interface Props {
  providerId: number | null;
  providerName: string;
  open: boolean;
  onClose: () => void;
}

export default function ProviderCredentialsDrawer({ providerId, providerName, open, onClose }: Props) {
  const [list, setList] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null); // null=新增模式，number=编辑模式
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async () => {
    if (!providerId) return;
    setLoading(true);
    try {
      const res = await credentialApi.list(providerId);
      setList(res.data?.data ?? []);
    } catch {
      // 静默：抽屉打开时偶发的网络抖动不需要打扰用户
    } finally {
      setLoading(false);
    }
  };

  // open 切换 + providerId 切换都重新拉
  useEffect(() => { if (open && providerId) load(); }, [open, providerId]);

  const handleOpenAdd = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ weight: 1 });
    setModalOpen(true);
  };

  const handleOpenEdit = (c: Credential) => {
    setEditingId(c.id);
    form.setFieldsValue({
      name:    c.name,
      api_key: '',
      weight:  c.weight,
      status:  c.status,
      remark:  c.remark,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!providerId) return;
    const values = await form.validateFields();
    try {
      if (editingId) {
        const payload: any = { ...values };
        // 编辑时空 api_key 表示保持不变
        if (!payload.api_key) delete payload.api_key;
        await credentialApi.update(editingId, payload);
        message.success('已更新');
      } else {
        await credentialApi.create(providerId, values);
        message.success('已添加');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.error || '操作失败');
    }
  };

  const handleReactivate = async (c: Credential) => {
    try {
      await credentialApi.reactivate(c.id);
      message.success('已重置');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.error || '重置失败');
    }
  };

  const handleDelete = async (c: Credential) => {
    try {
      await credentialApi.delete(c.id);
      message.success('已删除');
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.error || '删除失败');
    }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '名称', dataIndex: 'name',
      render: (v: string) => v || <Typography.Text type="secondary">未命名</Typography.Text>,
    },
    {
      title: 'Key', dataIndex: 'api_key_masked', width: 160,
      render: (v: string) => <code style={{ fontSize: 11 }}>{v}</code>,
    },
    { title: '权重', dataIndex: 'weight', width: 60 },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        const m = STATUS_MAP[v] || { color: 'default', label: v };
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: '失败次数', dataIndex: 'fail_count', width: 90,
      render: (v: number) => v > 0 ? <Tag color="orange">{v}</Tag> : <span style={{ color: '#999' }}>{v}</span>,
    },
    {
      title: '最近使用', dataIndex: 'last_used_at', width: 150,
      render: (v: string | null) => v
        ? <span style={{ fontSize: 12 }}>{dayjs(v).format('MM-DD HH:mm:ss')}</span>
        : <Typography.Text type="secondary" style={{ fontSize: 12 }}>未使用</Typography.Text>,
    },
    {
      title: '最近错误', dataIndex: 'last_error', ellipsis: true,
      render: (v: string) => v
        ? <Tooltip title={v}><Typography.Text type="danger" style={{ fontSize: 12 }}>{v}</Typography.Text></Tooltip>
        : <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '操作', width: 220,
      render: (_: any, c: Credential) => (
        <Space size="small">
          <Button size="small" onClick={() => handleOpenEdit(c)}>编辑</Button>
          <Tooltip title="清零失败计数并恢复为 active 状态">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => handleReactivate(c)}>重置</Button>
          </Tooltip>
          <Popconfirm title="确认删除？（软删除，可在数据库恢复）" onConfirm={() => handleDelete(c)}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Drawer
        title={`凭证池：${providerName || ''}`}
        placement="right"
        width={1080}
        open={open}
        onClose={onClose}
        mask={false}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>添加凭证</Button>
        }
      >
        <div style={{ marginBottom: 12, fontSize: 12, color: '#666' }}>
          网关按权重轮询挑选 active 状态的凭证；连续失败达阈值后自动 invalid（不删除，可点「重置」恢复）。
          池子为空时回落使用服务商主表的 API Key，保证老服务商零行为变化。
        </div>
        <Table
          rowKey="id"
          dataSource={list}
          columns={columns as any}
          loading={loading}
          pagination={false}
          size="small"
        />
      </Drawer>

      <Modal
        title={editingId ? '编辑凭证' : '添加凭证'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" tooltip="人类可读的标签，如「主号」「备用 1」「团队成员 A 报销」">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item
            name="api_key"
            label="API 密钥"
            rules={editingId ? [] : [{ required: true, message: '请填写 API 密钥' }]}
            extra={editingId ? '留空保持不变' : ''}
          >
            <Input.Password placeholder={editingId ? '留空保持不变' : ''} />
          </Form.Item>
          <Form.Item name="weight" label="权重" tooltip="加权策略下按比例随机；轮询策略下不影响。1-65535">
            <InputNumber min={1} max={65535} style={{ width: 200 }} />
          </Form.Item>
          {editingId !== null && (
            <Form.Item name="status" label="状态" tooltip="invalid 状态会被网关跳过；点「重置」按钮可一键恢复">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          )}
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
