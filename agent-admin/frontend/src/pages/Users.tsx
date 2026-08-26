import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Input, Select, Modal, Form, message, Popconfirm, Alert, Switch, Dropdown } from 'antd';
import { PlusOutlined, SearchOutlined, DownOutlined, EyeOutlined } from '@ant-design/icons';
import { oemProjectApi, userApi } from '../services/api';
import { getUser } from '../services/auth';
import { useCurrencyLabels } from '../contexts/CurrencyContext';
import BatchDeleteButton from '../components/BatchDeleteButton';
import UserDetailModal from '../components/UserDetailModal';

export default function Users() {
  const { labels } = useCurrencyLabels();
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 20 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [pwdModal, setPwdModal] = useState<any>(null);
  const [form] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [oemForm] = Form.useForm();
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [viewingId, setViewingId] = useState<number | null>(null);
  const [oemProjects, setOemProjects] = useState<any[]>([]);
  const [oemModalUser, setOemModalUser] = useState<any>(null);
  const [oemSaving, setOemSaving] = useState(false);
  const meId = getUser()?.id;

  // 列表接口 with('balances') 返回数组,从中取指定类型余额
  const pickBalance = (row: any, type: 'token' | 'credit') => {
    const list = Array.isArray(row?.balances) ? row.balances : [];
    const item = list.find((b: any) => b?.balance_type === type);
    return item ? Number(item.amount) : 0;
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await userApi.list(params);
      setData(res.data);
    } catch {}
    setLoading(false);
  };

  const loadOemProjects = async () => {
    try {
      const res = await oemProjectApi.list({ page: 1, page_size: 500 });
      setOemProjects(res.data.items || []);
    } catch { }
  };

  useEffect(() => { load(); }, [params]);
  useEffect(() => { loadOemProjects(); }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await userApi.update(editing.id, values);
        message.success('已更新');
      } else {
        await userApi.create(values);
        message.success('已创建');
      }
      setModalOpen(false);
      form.resetFields();
      setEditing(null);
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  // 批量设置「灵感大王」权限：value 为 true 开启 / false 关闭
  const handleBatchSetInspiration = async (value: boolean) => {
    if (!selectedKeys.length) {
      message.warning('请先勾选用户');
      return;
    }
    try {
      const res = await userApi.batchSetInspirationUploader(selectedKeys, value);
      message.success(`已${value ? '开启' : '关闭'} ${res.data.updated} 个用户的灵感大王权限`);
      setSelectedKeys([]);
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量设置失败');
    }
  };

  const handleResetPwd = async () => {
    const values = await pwdForm.validateFields();
    try {
      await userApi.resetPassword(pwdModal.id, values);
      message.success('密码已重置');
      setPwdModal(null);
      pwdForm.resetFields();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const openOemModal = async (row: any) => {
    setOemModalUser(row);
    oemForm.resetFields();
    try {
      const res = await userApi.oemProjects(row.id);
      oemForm.setFieldsValue({
        projects: (res.data.projects || []).map((p: any) => ({
          oem_project_key: p.oem_project_key,
          role: p.role || 'owner',
          status: p.status || 'active',
        })),
      });
    } catch (err: any) {
      message.error(err.response?.data?.error || '加载 OEM 绑定失败');
    }
  };

  const saveOemProjects = async () => {
    if (!oemModalUser) return;
    const values = await oemForm.validateFields();
    setOemSaving(true);
    try {
      await userApi.syncOemProjects(oemModalUser.id, values.projects || []);
      message.success('OEM 绑定已保存');
      setOemModalUser(null);
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存 OEM 绑定失败');
    }
    setOemSaving(false);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '用户名', dataIndex: 'username' },
    { title: '昵称', dataIndex: 'nickname' },
    { title: '邮箱', dataIndex: 'email' },
    {
      title: labels.token, width: 110, align: 'right' as const,
      render: (_: any, r: any) => (
        <span style={{ fontWeight: 600, color: '#fa8c16' }}>{pickBalance(r, 'token').toFixed(4)}</span>
      ),
    },
    {
      title: labels.credit, width: 110, align: 'right' as const,
      render: (_: any, r: any) => (
        <span style={{ fontWeight: 600, color: '#722ed1' }}>{pickBalance(r, 'credit').toFixed(4)}</span>
      ),
    },
    { title: '角色', dataIndex: 'role', width: 90, render: (v: string) => <Tag color={v === 'admin' ? 'red' : 'blue'}>{v === 'admin' ? '管理员' : '用户'}</Tag> },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '正常' : '禁用'}</Tag> },
    {
      title: '灵感大王',
      dataIndex: 'inspiration_uploader',
      width: 100,
      render: (v: boolean) => v ? <Tag color="gold">已开启</Tag> : <span style={{ color: '#bbb' }}>-</span>,
    },
    {
      title: 'OEM 身份',
      dataIndex: 'oem_projects',
      width: 180,
      render: (projects: any[]) => {
        if (!projects?.length) return <span style={{ color: '#bbb' }}>-</span>;
        return (
          <Space size={4} wrap>
            {projects.slice(0, 2).map((p) => (
              <Tag key={p.oem_project_key} color={p.status === 'active' ? 'purple' : 'default'}>
                {p.name || p.oem_project_key}
              </Tag>
            ))}
            {projects.length > 2 && <Tag>+{projects.length - 2}</Tag>}
          </Space>
        );
      },
    },
    {
      title: '操作', width: 380, render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => setViewingId(r.id)}>查看</Button>
          <Button size="small" onClick={() => { setEditing(r); form.setFieldsValue(r); setModalOpen(true); }}>编辑</Button>
          <Button size="small" onClick={() => openOemModal(r)}>OEM绑定</Button>
          <Button size="small" onClick={() => setPwdModal(r)}>重置密码</Button>
          <Button size="small" onClick={async () => {
            await userApi.toggleStatus(r.id);
            load();
          }}>{r.status === 'active' ? '禁用' : '启用'}</Button>
          <Popconfirm title="确认删除？" onConfirm={async () => { await userApi.delete(r.id); load(); }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Input placeholder="搜索" prefix={<SearchOutlined />} allowClear
            onPressEnter={(e: any) => setParams({ ...params, keyword: e.target.value, page: 1 })}
            onChange={(e) => !e.target.value && setParams({ ...params, keyword: '', page: 1 })} />
          <Select placeholder="角色" allowClear style={{ width: 120 }}
            options={[{ value: 'admin', label: '管理员' }, { value: 'user', label: '用户' }]}
            onChange={(v) => setParams({ ...params, role: v, page: 1 })} />
          <Select placeholder="状态" allowClear style={{ width: 120 }}
            options={[{ value: 'active', label: '正常' }, { value: 'disabled', label: '禁用' }]}
            onChange={(v) => setParams({ ...params, status: v, page: 1 })} />
          <Select placeholder="OEM 身份" allowClear style={{ width: 130 }}
            options={[{ value: '1', label: '有 OEM' }, { value: '0', label: '无 OEM' }]}
            onChange={(v) => setParams({ ...params, has_oem_identity: v, page: 1 })} />
          <Select placeholder="OEM 项目" allowClear showSearch style={{ width: 180 }}
            optionFilterProp="label"
            options={oemProjects.map((p) => ({ value: p.project_key, label: `${p.name} (${p.project_key})` }))}
            onChange={(v) => setParams({ ...params, oem_project_key: v, page: 1 })} />
        </Space>
        <Space>
          <Dropdown
            disabled={!selectedKeys.length}
            menu={{
              items: [
                {
                  key: 'on',
                  label: (
                    <Popconfirm
                      title={`确认开启 ${selectedKeys.length} 个用户的灵感大王权限？`}
                      onConfirm={() => handleBatchSetInspiration(true)}
                    >
                      <span>批量开启灵感大王</span>
                    </Popconfirm>
                  ),
                },
                {
                  key: 'off',
                  label: (
                    <Popconfirm
                      title={`确认关闭 ${selectedKeys.length} 个用户的灵感大王权限？`}
                      onConfirm={() => handleBatchSetInspiration(false)}
                    >
                      <span>批量关闭灵感大王</span>
                    </Popconfirm>
                  ),
                },
              ],
            }}
          >
            <Button disabled={!selectedKeys.length}>
              灵感大王 <DownOutlined />
            </Button>
          </Dropdown>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={userApi.batchDelete}
            onDone={load}
            itemName="用户"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>
            添加用户
          </Button>
        </Space>
      </div>

      <Table columns={columns} dataSource={data.data} rowKey="id" loading={loading}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as number[]),
          getCheckboxProps: (r: any) => ({ disabled: r.id === meId }),
        }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" />

      <Modal title={editing ? '编辑用户' : '添加用户'} open={modalOpen}
        onOk={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); }}
        destroyOnClose mask={false}>
        <Form form={form} layout="vertical">
          {editing && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={editing.id === getUser()?.id
                ? '用户名是登录账号，修改后请用新用户名重新登录（建议改完立即退出再登录）'
                : '用户名是登录账号，修改后该用户需要用新用户名登录'}
            />
          )}
          <Form.Item name="username" label="用户名"
            rules={[
              { required: true, message: '用户名必填' },
              { min: 6, max: 16, message: '用户名长度需 6-16 个字符' },
              { pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, message: '只能含中文 / 英文 / 数字 / 下划线' },
            ]}>
            <Input placeholder="中文 / 英文 / 数字 / 下划线，6-16 位" />
          </Form.Item>
          {!editing && <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少 6 位' }]}><Input.Password placeholder="至少 6 位" /></Form.Item>}
          <Form.Item name="nickname" label="昵称"
            rules={[
              { min: 2, max: 30, message: '昵称长度需 2-30 个字符' },
              { pattern: /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, message: '只能含中文 / 英文 / 数字 / 下划线' },
            ]}>
            <Input placeholder="中文 / 英文 / 数字 / 下划线，2-30 位（全局唯一）" />
          </Form.Item>
          <Form.Item name="phone" label="手机号"
            rules={[{ max: 20, message: '手机号最多 20 位' }]}>
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '邮箱格式无效' }]}>
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="role" label="角色" initialValue="user">
            <Select options={[{ value: 'admin', label: '管理员' }, { value: 'user', label: '用户' }]} />
          </Form.Item>
          <Form.Item
            name="inspiration_uploader"
            label="灵感大王"
            valuePropName="checked"
            initialValue={false}
            extra="开启后该用户在桌面端可将创作上传到灵感广场"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title="重置密码" open={!!pwdModal}
        onOk={handleResetPwd} onCancel={() => { setPwdModal(null); pwdForm.resetFields(); }}
        destroyOnClose mask={false}>
        <Form form={pwdForm} layout="vertical">
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={oemModalUser ? `OEM 项目绑定：${oemModalUser.nickname || oemModalUser.username}` : 'OEM 项目绑定'}
        open={!!oemModalUser}
        onOk={saveOemProjects}
        onCancel={() => setOemModalUser(null)}
        confirmLoading={oemSaving}
        width={760}
        destroyOnClose
        mask={false}
      >
        <Form form={oemForm} layout="vertical">
          <Form.List name="projects">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ width: '100%' }}>
                    <Form.Item
                      {...field}
                      name={[field.name, 'oem_project_key']}
                      rules={[{ required: true, message: '请选择 OEM 项目' }]}
                    >
                      <Select
                        showSearch
                        placeholder="选择 OEM 项目"
                        style={{ width: 300 }}
                        optionFilterProp="label"
                        options={oemProjects.map((p) => ({ value: p.project_key, label: `${p.name} (${p.project_key})` }))}
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'role']} initialValue="owner">
                      <Select
                        style={{ width: 120 }}
                        options={[{ value: 'owner', label: '负责人' }, { value: 'manager', label: '协管人' }]}
                      />
                    </Form.Item>
                    <Form.Item {...field} name={[field.name, 'status']} initialValue="active">
                      <Select
                        style={{ width: 120 }}
                        options={[{ value: 'active', label: '启用' }, { value: 'disabled', label: '停用' }]}
                      />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)}>移除</Button>
                  </Space>
                ))}
                <Button onClick={() => add({ role: 'owner', status: 'active' })}>添加绑定</Button>
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>

      <UserDetailModal
        open={viewingId !== null}
        userId={viewingId}
        onClose={() => setViewingId(null)}
      />
    </div>
  );
}
