import { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Select, InputNumber, Input, Radio, message } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { balanceApi, planApi, userApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import { useUrlSyncedParams } from '../hooks/useUrlSyncedParams';
import CurrencyTag from '../components/CurrencyTag';

export default function Balances() {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useUrlSyncedParams<Record<string, any>>({ page: 1, per_page: 50 });
  const [modalOpen, setModalOpen] = useState(false);
  const [batchModal, setBatchModal] = useState(false);
  // 提交中守卫：Modal 确定按钮无内置防连点，网络慢时手抖连点会导致重复入账（金额操作可翻倍）
  const [submitting, setSubmitting] = useState(false);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [form] = Form.useForm();
  const [batchForm] = Form.useForm();
  const { labels } = useCurrencyLabels();
  const typeOptions = [{ value: 'token', label: labels.token }, { value: 'credit', label: labels.credit }];

  // 充值弹窗：入账方式相关状态
  const watchedUserId = Form.useWatch('user_id', form);
  const watchedType = Form.useWatch('balance_type', form);
  const watchedTarget = Form.useWatch('target', form);
  const isPlanQuota = watchedTarget === 'plan_quota';
  const [userPlans, setUserPlans] = useState<any[]>([]);
  const [userPlansLoading, setUserPlansLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const res = await balanceApi.list(params); setData(res.data); } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);
  useEffect(() => {
    userApi.list({ per_page: 500 }).then(res => setUsers(res.data.data || []));
  }, []);

  // 选了用户且切换到「套餐余量」时，拉该用户生效中的套餐供选择
  useEffect(() => {
    if (!isPlanQuota || !watchedUserId) {
      setUserPlans([]);
      return;
    }
    setUserPlansLoading(true);
    planApi.userPlans({ user_id: watchedUserId, status: 'active', per_page: 100 })
      .then(res => setUserPlans(res.data.data || []))
      .catch(() => setUserPlans([]))
      .finally(() => setUserPlansLoading(false));
  }, [isPlanQuota, watchedUserId]);

  const handleRecharge = async () => {
    if (submitting) return;
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await balanceApi.recharge(values);
      message.success(values.target === 'plan_quota' ? '已计入套餐余量' : '已更新');
      setModalOpen(false); form.resetFields(); load();
    } catch (err: any) { message.error(err.response?.data?.error || '操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleBatchRecharge = async () => {
    if (batchSubmitting) return;
    const values = await batchForm.validateFields();
    setBatchSubmitting(true);
    try {
      await balanceApi.batchRecharge(values);
      message.success('批量充值完成');
      setBatchModal(false); batchForm.resetFields(); load();
    } catch (err: any) { message.error(err.response?.data?.error || '操作失败'); }
    finally { setBatchSubmitting(false); }
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户', dataIndex: ['user', 'username'], render: (v: string, r: any) => v || r.user_id },
    { title: '昵称', dataIndex: ['user', 'nickname'] },
    { title: '类型', dataIndex: 'balance_type', render: (v: string) => <CurrencyTag type={v} /> },
    { title: '金额', dataIndex: 'amount', render: (v: string) => <span style={{ fontWeight: 600 }}>{Number(v).toFixed(4)}</span> },
    {
      title: '操作', render: (_: any, r: any) => (
        <Button size="small" icon={<DollarOutlined />} onClick={() => {
          // 先清表单再预填：Form store 的值在 destroyOnClose 下不清除，
          // 不 reset 会残留上次的入账方式 / 套餐 / 金额，可能按残留套餐误入账
          form.resetFields();
          form.setFieldsValue({ user_id: r.user_id, balance_type: r.balance_type });
          setModalOpen(true);
        }}>充值</Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Select placeholder="用户" allowClear style={{ width: 200 }} showSearch optionFilterProp="label"
            value={params.user_id}
            options={users.map(u => ({ value: u.id, label: `${u.username} (${u.nickname})` }))}
            onChange={(v) => setParams({ ...params, user_id: v, page: 1 })} />
          <Select placeholder="类型" allowClear style={{ width: 120 }}
            value={params.balance_type}
            options={typeOptions}
            onChange={(v) => setParams({ ...params, balance_type: v, page: 1 })} />
        </Space>
        <Space>
          <Button onClick={() => setBatchModal(true)}>批量充值</Button>
          <Button type="primary" icon={<DollarOutlined />} onClick={() => { form.resetFields(); setModalOpen(true); }}>
            充值
          </Button>
        </Space>
      </div>

      <Table columns={columns} dataSource={data.data} rowKey="id" loading={loading}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" />

      <Modal title="充值" open={modalOpen}
        onOk={handleRecharge} confirmLoading={submitting} onCancel={() => setModalOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical" initialValues={{ target: 'wallet' }}>
          <Form.Item name="user_id" label="用户" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label"
              onChange={() => {
                // 换用户后已选套餐必然失效，清空重选
                form.setFieldsValue({ user_plan_id: undefined });
              }}
              options={users.map(u => ({ value: u.id, label: `${u.username} (${u.nickname})` }))} />
          </Form.Item>
          <Form.Item name="balance_type" label="类型" rules={[{ required: true }]}>
            <Select options={typeOptions} />
          </Form.Item>
          <Form.Item name="target" label="入账方式">
            <Radio.Group
              onChange={() => {
                // 切换入账方式后，套餐选择与金额校验口径都变了，清掉避免残留
                form.setFieldsValue({ user_plan_id: undefined });
              }}
              options={[
                { value: 'wallet', label: '钱包余额（永久有效，负数可扣除）' },
                { value: 'plan_quota', label: '计入套餐余量（跟随套餐到期）' },
              ]}
            />
          </Form.Item>
          {isPlanQuota && (
            <Form.Item name="user_plan_id" label="目标套餐" rules={[{ required: true, message: '请选择要计入的套餐' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                loading={userPlansLoading}
                placeholder={watchedUserId ? '选择该用户生效中的套餐' : '请先选择用户'}
                options={userPlans.map((up: any) => {
                  const remaining = up.quota_summary?.[watchedType]?.remaining;
                  const expireText = up.expires_at ? `至 ${String(up.expires_at).slice(0, 10)}` : '永久';
                  const remainingText = remaining !== undefined ? `（${labels[watchedType as 'token' | 'credit'] || watchedType}剩余 ${Number(remaining).toFixed(2)}）` : '';
                  return {
                    value: up.id,
                    label: `${up.plan?.name || `套餐${up.plan_id}`} · ${expireText}${remainingText}`,
                  };
                })}
                notFoundContent={userPlansLoading ? '加载中…' : (watchedUserId ? '该用户没有生效中的套餐' : '请先选择用户')}
              />
            </Form.Item>
          )}
          <Form.Item
            name="amount"
            label={isPlanQuota ? '金额（计入套餐余量，只支持正数）' : '金额（负数为扣除）'}
            rules={[
              { required: true },
              {
                validator: (_, value) => {
                  if (isPlanQuota && value !== undefined && value !== null && Number(value) <= 0) {
                    return Promise.reject(new Error('计入套餐余量只支持正数'));
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            <InputNumber style={{ width: '100%' }} min={isPlanQuota ? 0.01 : undefined} />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>

      <Modal title="批量充值" open={batchModal}
        onOk={handleBatchRecharge} confirmLoading={batchSubmitting} onCancel={() => setBatchModal(false)} destroyOnClose>
        <Form form={batchForm} layout="vertical">
          <Form.Item name="user_ids" label="用户" rules={[{ required: true }]}>
            <Select mode="multiple" showSearch optionFilterProp="label"
              options={users.map(u => ({ value: u.id, label: `${u.username} (${u.nickname})` }))} />
          </Form.Item>
          <Form.Item name="balance_type" label="类型" rules={[{ required: true }]}>
            <Select options={typeOptions} />
          </Form.Item>
          <Form.Item name="amount" label="金额" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
