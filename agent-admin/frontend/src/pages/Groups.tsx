import { useEffect, useState } from 'react';
import { Table, Button, Space, Modal, Form, Input, message, Popconfirm, Tag, Select, Switch, Alert, Tooltip } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { groupApi, userApi } from '../services/api';
import BatchDeleteButton from '../components/BatchDeleteButton';

export default function Groups() {
  const [data, setData] = useState<any>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 50 });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [memberModal, setMemberModal] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<number[]>([]);
  const [form] = Form.useForm();
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);

  const load = async () => {
    setLoading(true);
    try { const res = await groupApi.list(params); setData(res.data); } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [params]);

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editing) { await groupApi.update(editing.id, values); message.success('已更新'); }
      else { await groupApi.create(values); message.success('已创建'); }
      setModalOpen(false); form.resetFields(); setEditing(null); load();
    } catch (err: any) { message.error(err.response?.data?.error || '操作失败'); }
  };

  const openMembers = async (group: any) => {
    setMemberModal(group);
    try {
      const res = await groupApi.get(group.id);
      setMembers(res.data.members || []);
      const usersRes = await userApi.list({ per_page: 500 });
      setAllUsers(usersRes.data.data || []);
    } catch {}
  };

  const addMembers = async () => {
    if (!selectedUsers.length) return;
    try {
      await groupApi.addMembers(memberModal.id, selectedUsers);
      message.success('成员已加入当前分组（原有分组已清除）');
      setSelectedUsers([]);
      openMembers(memberModal);
      load();
    } catch (err: any) { message.error(err.response?.data?.error || '操作失败'); }
  };

  const removeMember = async (userId: number) => {
    await groupApi.removeMembers(memberModal.id, [userId]);
    openMembers(memberModal);
    load();
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name' },
    { title: '描述', dataIndex: 'description' },
    { title: '默认', dataIndex: 'is_default', width: 70, render: (v: boolean) => v ? <Tag color="blue">默认</Tag> : '-' },
    { title: '成员数', dataIndex: 'members_count', render: (v: number) => <Tag>{v}</Tag> },
    {
      title: '操作', render: (_: any, r: any) => (
        <Space size="small">
          <Button size="small" onClick={() => openMembers(r)}>成员</Button>
          <Button size="small" onClick={() => { setEditing(r); form.setFieldsValue(r); setModalOpen(true); }}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={async () => { await groupApi.delete(r.id); load(); }}>
            <Button size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const memberIds = members.map((m: any) => m.id);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
        <div />
        <Space>
          <BatchDeleteButton
            selectedKeys={selectedKeys}
            onClear={() => setSelectedKeys([])}
            batchDelete={groupApi.batchDelete}
            onDone={load}
            itemName="分组"
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>
            添加分组
          </Button>
        </Space>
      </div>

      <Table columns={columns} dataSource={data.data} rowKey="id" loading={loading}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          onChange: (keys) => setSelectedKeys(keys as number[]),
        }}
        pagination={{ current: params.page, pageSize: params.per_page, total: data.total,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }) }}
        size="small" />

      <Modal title={editing ? '编辑分组' : '添加分组'} open={modalOpen}
        onOk={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); }} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Form.Item name="is_default" label="注册时自动分配" valuePropName="checked"><Switch /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`成员管理 - ${memberModal?.name || ''}`} open={!!memberModal} footer={null}
        onCancel={() => setMemberModal(null)} width={600}>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="单分组独占策略：加入当前分组后，用户原有的其他分组将被清除。一个用户同一时间只能在一个分组中。"
        />
        <div style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
          <Select mode="multiple" style={{ flex: 1 }} placeholder="选择要加入当前分组的用户" value={selectedUsers}
            onChange={setSelectedUsers}
            filterOption={(input, option) =>
              ((option as any)?.searchText || '').toLowerCase().includes(input.toLowerCase())
            }
            options={allUsers.filter((u: any) => !memberIds.includes(u.id)).map((u: any) => {
              const groupName = u.groups?.[0]?.name;
              return {
                value: u.id,
                label: (
                  <>
                    {u.username} ({u.nickname})
                    {groupName ? (
                      <span style={{ color: 'rgba(22,119,255,0.67)', marginLeft: 6 }}>
                        · {groupName}
                      </span>
                    ) : null}
                  </>
                ),
                searchText: `${u.username} ${u.nickname} ${groupName || ''}`,
              };
            })} />
          <Tooltip title="将所选用户加入当前分组，同时清除他们原有的其他分组">
            <Button type="primary" onClick={addMembers} disabled={!selectedUsers.length}>加入本分组</Button>
          </Tooltip>
        </div>
        <Table size="small" dataSource={members} rowKey="id" pagination={false}
          columns={[
            { title: '用户名', dataIndex: 'username' },
            { title: '昵称', dataIndex: 'nickname' },
            { title: '状态', dataIndex: 'status', render: (v: string) => <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? '正常' : '禁用'}</Tag> },
            { title: '', render: (_: any, r: any) => (
              <Popconfirm title="确认移除？" onConfirm={() => removeMember(r.id)}>
                <Button size="small" danger>移除</Button>
              </Popconfirm>
            )},
          ]} />
      </Modal>
    </div>
  );
}
