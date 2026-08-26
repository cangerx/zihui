import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, InputNumber, message, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { rechargeApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';

const STATUS_OPTIONS = [{ value: 'active', label: '启用' }, { value: 'disabled', label: '禁用' }];

export default function RechargeConfigPage() {
  const { labels } = useCurrencyLabels();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [packages, setPackages] = useState<any[]>([]);
  const [configForm] = Form.useForm();
  const [pkgOpen, setPkgOpen] = useState(false);
  const [pkgEditing, setPkgEditing] = useState<any>(null);
  const [pkgForm] = Form.useForm();

  const balanceLabel = (t: string) => (t === 'token' ? labels.token : labels.credit);
  const BALANCE_OPTIONS = [{ value: 'token', label: labels.token }, { value: 'credit', label: labels.credit }];

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await rechargeApi.config();
      configForm.setFieldsValue({
        enabled: !!data.enabled,
        token_enabled: data.token_enabled !== false,
        credit_enabled: data.credit_enabled !== false,
        min_amount: Number(data.min_amount ?? 1),
        token_ratio: Number(data.token_ratio ?? 1),
        credit_ratio: Number(data.credit_ratio ?? 1),
        token_bonus_rules: data.token_bonus_rules || [],
        credit_bonus_rules: data.credit_bonus_rules || [],
      });
      setPackages(data.packages || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载失败');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const saveConfig = async () => {
    let values: any;
    try { values = await configForm.validateFields(); } catch { return; }
    setSaving(true);
    try {
      await rechargeApi.updateConfig({
        enabled: !!values.enabled,
        token_enabled: !!values.token_enabled,
        credit_enabled: !!values.credit_enabled,
        min_amount: Number(values.min_amount ?? 1),
        token_ratio: Number(values.token_ratio ?? 1),
        credit_ratio: Number(values.credit_ratio ?? 1),
        token_bonus_rules: (values.token_bonus_rules || []).filter((r: any) => r && Number(r.threshold) > 0 && Number(r.bonus) > 0),
        credit_bonus_rules: (values.credit_bonus_rules || []).filter((r: any) => r && Number(r.threshold) > 0 && Number(r.bonus) > 0),
      });
      message.success('已保存直充配置');
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const openPkg = (row?: any) => {
    setPkgEditing(row || null);
    pkgForm.resetFields();
    pkgForm.setFieldsValue(row
      ? { balance_type: row.balance_type, title: row.title, pay_amount: Number(row.pay_amount), base_amount: Number(row.base_amount), bonus_amount: Number(row.bonus_amount), status: row.status, sort: Number(row.sort) }
      : { balance_type: 'credit', status: 'active', sort: 0, bonus_amount: 0 });
    setPkgOpen(true);
  };
  const savePkg = async () => {
    let values: any;
    try { values = await pkgForm.validateFields(); } catch { return; }
    try {
      if (pkgEditing) await rechargeApi.updatePackage(pkgEditing.id, values);
      else await rechargeApi.createPackage(values);
      message.success('已保存档位');
      setPkgOpen(false);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存档位失败');
    }
  };
  const delPkg = async (id: number) => {
    try {
      await rechargeApi.deletePackage(id);
      message.success('已删除');
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败');
    }
  };

  const bonusRulesField = (name: string, unitLabel: string) => (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div>
          {fields.map((field) => (
            <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
              <Form.Item {...field} name={[field.name, 'threshold']} rules={[{ required: true, message: '满额' }]} noStyle>
                <InputNumber min={0} precision={2} placeholder="满" style={{ width: 130 }} addonBefore="满" addonAfter="元" />
              </Form.Item>
              <Form.Item {...field} name={[field.name, 'bonus']} rules={[{ required: true, message: '赠送' }]} noStyle>
                <InputNumber min={0} precision={4} placeholder="送" style={{ width: 160 }} addonBefore="送" addonAfter={unitLabel} />
              </Form.Item>
              <MinusCircleOutlined onClick={() => remove(field.name)} />
            </Space>
          ))}
          <Button type="dashed" onClick={() => add({ threshold: undefined, bonus: undefined })} icon={<PlusOutlined />} size="small">添加赠送档</Button>
        </div>
      )}
    </Form.List>
  );

  return <Space direction="vertical" size={16} style={{ width: '100%' }}>
    <Card title="直充配置" loading={loading} extra={<Button type="primary" loading={saving} onClick={saveConfig}>保存配置</Button>}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} message={`用户在桌面端可按金额或快捷档位充值${labels.token}/${labels.credit}。本金与赠送都进钱包永久有效，订单参与 OEM 分佣。`} />
      <Form form={configForm} layout="vertical">
        <Row gutter={16}>
          <Col span={8}><Form.Item name="enabled" label="启用直充" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col span={8}><Form.Item name="token_enabled" label={`显示${labels.token}充值`} valuePropName="checked" tooltip={`关闭后桌面端充值页隐藏「${labels.token}」充值入口，且拒绝该类型下单`}><Switch /></Form.Item></Col>
          <Col span={8}><Form.Item name="credit_enabled" label={`显示${labels.credit}充值`} valuePropName="checked" tooltip={`关闭后桌面端充值页隐藏「${labels.credit}」充值入口，且拒绝该类型下单`}><Switch /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={8}><Form.Item name="min_amount" label="自由金额起充（元）" rules={[{ required: true }]}><InputNumber min={0} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="token_ratio" label={`${labels.token}兑换比例（1 元 = N）`} rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={12}><Form.Item name="credit_ratio" label={`${labels.credit}兑换比例（1 元 = N）`} rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}><Form.Item label={`${labels.token}阶梯赠送（满 X 元送 Y，按金额命中最高档）`}>{bonusRulesField('token_bonus_rules', labels.token)}</Form.Item></Col>
          <Col span={12}><Form.Item label={`${labels.credit}阶梯赠送（满 X 元送 Y）`}>{bonusRulesField('credit_bonus_rules', labels.credit)}</Form.Item></Col>
        </Row>
      </Form>
    </Card>

    <Card title="快捷充值档位" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => openPkg()}>新增档位</Button>}>
      <Table rowKey="id" loading={loading} dataSource={packages} pagination={false} columns={[
        { title: '类型', dataIndex: 'balance_type', width: 90, render: (v: string) => <Tag color={v === 'token' ? 'gold' : 'blue'}>{balanceLabel(v)}</Tag> },
        { title: '标题', dataIndex: 'title', render: (v: string) => v || '-' },
        { title: '支付金额', dataIndex: 'pay_amount', width: 110, render: (v: any) => `¥${Number(v).toFixed(2)}` },
        { title: '到账', dataIndex: 'base_amount', width: 100, render: (v: any) => Number(v) },
        { title: '赠送', dataIndex: 'bonus_amount', width: 100, render: (v: any) => Number(v) > 0 ? <Tag color="green">+{Number(v)}</Tag> : '-' },
        { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '启用' : '禁用'}</Tag> },
        { title: '排序', dataIndex: 'sort', width: 70 },
        { title: '操作', width: 140, render: (_: any, r: any) => <Space size={4}><Button size="small" onClick={() => openPkg(r)}>编辑</Button><Popconfirm title="确认删除？" onConfirm={() => delPkg(r.id)}><Button size="small" danger>删除</Button></Popconfirm></Space> },
      ] as any} />
    </Card>

    <Modal title={pkgEditing ? '编辑充值档位' : '新增充值档位'} open={pkgOpen} onOk={savePkg} onCancel={() => setPkgOpen(false)} destroyOnClose mask={false}>
      <Form form={pkgForm} layout="vertical">
        <Form.Item name="balance_type" label="充值类型" rules={[{ required: true }]}><Select options={BALANCE_OPTIONS} disabled={!!pkgEditing} /></Form.Item>
        <Form.Item name="title" label="标题"><Input placeholder={`如 充50送5${labels.credit}`} /></Form.Item>
        <Row gutter={16}>
          <Col span={8}><Form.Item name="pay_amount" label="支付金额（元）" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item name="base_amount" label="基础到账" rules={[{ required: true }]}><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item></Col>
          <Col span={8}><Form.Item name="bonus_amount" label="赠送"><InputNumber min={0} precision={4} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}><Form.Item name="status" label="状态"><Select options={STATUS_OPTIONS} /></Form.Item></Col>
          <Col span={12}><Form.Item name="sort" label="排序"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
      </Form>
    </Modal>
  </Space>;
}
