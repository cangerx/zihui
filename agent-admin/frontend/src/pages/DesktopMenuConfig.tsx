import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Input, InputNumber, message, Modal, Popconfirm, Radio, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { desktopMenuApi } from '../services/api';

interface MenuItem {
  key: string;
  label: string;
  group: string;
  is_group: boolean;
  permission_controlled: boolean;
  visible: boolean;
  title: string;
}

// ===== 自定义菜单（custom_items）=====

interface CustomItem {
  key: string;
  title: string;
  group_key: string;
  target_type: 'internal' | 'external';
  target: string;
  open_mode: 'browser' | 'window';
  icon: string;
  sort: number;
  visible: boolean;
}

interface GroupOption { key: string; label: string }

const TARGET_TYPE_LABEL: Record<string, string> = { internal: '内部页面', external: '外部链接' };
const OPEN_MODE_LABEL: Record<string, string> = { browser: '系统浏览器', window: '应用内窗口' };
const ICON_LABEL: Record<string, string> = { link: '链接', page: '页面', app: '应用', star: '星标' };

/** 前端生成菜单 key（后端校验 ^[a-zA-Z0-9_-]{1,40}$ 与数组内唯一） */
function genCustomKey(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const emptyCustomItem = (): CustomItem => ({
  key: genCustomKey(),
  title: '',
  group_key: '',
  target_type: 'external',
  target: '',
  open_mode: 'browser',
  icon: 'link',
  sort: 0,
  visible: true,
});

export default function DesktopMenuConfigPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await desktopMenuApi.config();
      setItems((data.items || []).map((it: any) => ({ ...it })));
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载菜单配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const patch = (key: string, changes: Partial<MenuItem>) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...changes } : it)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = items
        .filter((it) => !it.permission_controlled)
        .map((it) => ({ key: it.key, visible: it.visible, title: (it.title || '').trim() }));
      await desktopMenuApi.updateConfig(payload);
      message.success('已保存，桌面端将在下次登录或刷新后生效');
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: '菜单项',
      width: 300,
      render: (_: any, r: MenuItem) => (
        <Space direction="vertical" size={2}>
          <Space size={6}>
            {r.is_group ? <Tag color="purple">分组</Tag> : null}
            <Typography.Text strong>{r.label}</Typography.Text>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {r.group ? `属于「${r.group}」 · ` : ''}{r.key}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '显示 / 隐藏',
      width: 140,
      render: (_: any, r: MenuItem) =>
        r.permission_controlled
          ? <Tag>由权限控制</Tag>
          : <Switch checked={r.visible} onChange={(v) => patch(r.key, { visible: v })} checkedChildren="显示" unCheckedChildren="隐藏" />,
    },
    {
      title: '自定义名称',
      width: 280,
      render: (_: any, r: MenuItem) =>
        r.permission_controlled
          ? <Typography.Text type="secondary">—</Typography.Text>
          : <Input value={r.title} placeholder={`默认：${r.label}`} maxLength={50} allowClear onChange={(e) => patch(r.key, { title: e.target.value })} />,
    },
    {
      title: '说明',
      render: (_: any, r: MenuItem) =>
        r.permission_controlled
          ? <Typography.Text type="secondary">由用户功能权限控制，不受菜单配置影响</Typography.Text>
          : <Typography.Text type="secondary">{[r.visible ? '' : '已隐藏', r.title ? `显示为「${r.title}」` : ''].filter(Boolean).join('；') || '默认'}</Typography.Text>,
    },
  ];

  return (
    <>
      <Card
        title="桌面端菜单配置"
        extra={(
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存</Button>
          </Space>
        )}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="配置客户端侧栏的显示、隐藏与名称。隐藏分组会隐藏全部子项；由用户权限控制的功能只能在用户或分组中开通。保存后，客户端下次登录或刷新生效。"
        />
        <Table rowKey="key" loading={loading} dataSource={items} pagination={false} columns={columns as any} size="middle" />
      </Card>
      <CustomMenuCard />
    </>
  );
}

/** 自定义菜单管理：即时整体保存（每次增删改后立即整体提交，避免忘记点保存） */
function CustomMenuCard() {
  const [list, setList] = useState<CustomItem[]>([]);
  // listRef 与 list 同步：persist 基于 ref 取最新值，连续操作不丢前次改动
  const listRef = useRef<CustomItem[]>([]);
  // persist 串行队列：整体保存范式下并发 PUT 乱序到达会互相覆盖，串行后后到者一定基于最新内容
  const persistQueue = useRef<Promise<any>>(Promise.resolve());
  const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);
  const [iconOptions, setIconOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CustomItem | null>(null); // null=关闭弹窗
  const [isNew, setIsNew] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await desktopMenuApi.customItems();
      const items = (data.items || []).map((it: any) => ({ ...it }));
      listRef.current = items;
      setList(items);
      setGroupOptions(data.group_options || []);
      setIconOptions(data.icon_options || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载自定义菜单失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  /** 整体保存的实际执行体（永远经 persistQueue 串行）；返回是否成功 */
  const doPersist = async (next: CustomItem[], okText: string): Promise<boolean> => {
    setSaving(true);
    try {
      await desktopMenuApi.updateCustomItems(next.map((it) => ({ ...it })));
      message.success(okText);
      // 重拉而非本地 setList(next)：服务端按 sort 排好序，显示与持久态即时一致
      await load();
      return true;
    } catch (e: any) {
      // Laravel 422 结构：{ message, errors: { 字段: [msg...] } }——取首字段首条（后端校验文案已中文化）
      const errs = e?.response?.data?.errors;
      const first = errs ? Object.values(errs)[0] : null;
      const detail = Array.isArray(first) ? first[0] : null;
      message.error(detail || e?.response?.data?.message || e?.response?.data?.error || '保存失败');
      load();
      return false;
    } finally {
      setSaving(false);
    }
  };

  /** 整体提交入口：串行化，连续操作按序基于最新列表执行 */
  const persist = (next: CustomItem[], okText: string): Promise<boolean> => {
    const p = persistQueue.current.then(() => doPersist(next, okText));
    persistQueue.current = p.catch(() => {});
    return p;
  };

  const onEditSubmit = async () => {
    if (!editing) return;
    const next = isNew ? [...listRef.current, editing] : listRef.current.map((it) => (it.key === editing.key ? editing : it));
    const ok = await persist(next, isNew ? '已新增菜单' : '已保存修改');
    // 仅成功才关弹窗：失败时保留表单内容，用户可修正后重试（doPersist 失败已重拉列表）
    if (ok) setEditing(null);
  };

  const onDelete = async (key: string) => {
    await persist(listRef.current.filter((it) => it.key !== key), '已删除');
  };

  const patchList = (key: string, changes: Partial<CustomItem>) => {
    const next = listRef.current.map((it) => (it.key === key ? { ...it, ...changes } : it));
    persist(next, '已保存');
  };

  const groupLabel = (key: string) => groupOptions.find((g) => g.key === key)?.label || (key || '顶级（无分组）');

  const customColumns = [
    {
      title: '菜单名称',
      width: 200,
      render: (_: any, r: CustomItem) => (
        <Space size={6}>
          <Tag color="blue">{ICON_LABEL[r.icon] || r.icon}</Tag>
          <Typography.Text strong>{r.title}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '所属菜单组',
      width: 150,
      render: (_: any, r: CustomItem) => <Typography.Text>{groupLabel(r.group_key)}</Typography.Text>,
    },
    {
      title: '跳转目标',
      render: (_: any, r: CustomItem) => (
        <Space size={6}>
          <Tag color={r.target_type === 'internal' ? 'geekblue' : 'orange'}>{TARGET_TYPE_LABEL[r.target_type]}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }} copyable={{ text: r.target }}>
            {r.target.length > 48 ? `${r.target.slice(0, 48)}…` : r.target}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '打开方式',
      width: 110,
      render: (_: any, r: CustomItem) =>
        r.target_type === 'external'
          ? <Typography.Text>{OPEN_MODE_LABEL[r.open_mode] || r.open_mode}</Typography.Text>
          : <Typography.Text type="secondary">—</Typography.Text>,
    },
    {
      title: '排序',
      width: 90,
      // 只读展示：onChange 即时整体保存会在连续输入时产生并发 PUT 竞态（后发先至覆盖新值），
      // 排序调整走编辑弹窗（弹窗提交即单次整体保存）
      render: (_: any, r: CustomItem) => <Typography.Text type="secondary">{r.sort}</Typography.Text>,
    },
    {
      title: '显示',
      width: 90,
      render: (_: any, r: CustomItem) => (
        <Switch size="small" checked={r.visible} onChange={(v) => patchList(r.key, { visible: v })} />
      ),
    },
    {
      title: '操作',
      width: 140,
      render: (_: any, r: CustomItem) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => { setIsNew(false); setEditing({ ...r }); }}>编辑</Button>
          <Popconfirm title={`确定删除菜单「${r.title}」？`} okText="删除" cancelText="取消" onConfirm={() => onDelete(r.key)}>
            <Button size="small" type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="自定义菜单"
      style={{ marginTop: 16 }}
      extra={(
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setIsNew(true); setEditing(emptyCustomItem()); }}>新增菜单</Button>
        </Space>
      )}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="向桌面端左侧栏追加自定义菜单：可挂到现有菜单组或顶级；跳转目标支持桌面端内部页面（如 /chat）或外部链接。外部链接默认在系统浏览器打开，也可选「应用内窗口」（桌面端新建独立窗口加载）。所有操作即时生效，桌面端下次登录或刷新后可见。"
      />
      <Table rowKey="key" loading={loading || saving} dataSource={list} pagination={false} columns={customColumns as any} size="middle" locale={{ emptyText: '暂无自定义菜单，点击右上角「新增菜单」创建' }} />

      <Modal
        title={isNew ? '新增自定义菜单' : '编辑自定义菜单'}
        open={!!editing}
        onOk={onEditSubmit}
        onCancel={() => setEditing(null)}
        okText={isNew ? '新增' : '保存'}
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        width={520}
      >
        {editing && (
          <Space direction="vertical" size={12} style={{ width: '100%', marginTop: 8 }}>
            <div>
              <Typography.Text strong>菜单名称</Typography.Text>
              <Input value={editing.title} maxLength={30} placeholder="显示在侧边栏的名称" style={{ marginTop: 4 }} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div>
              <Typography.Text strong>所属菜单组</Typography.Text>
              <Select value={editing.group_key} style={{ width: '100%', marginTop: 4 }} onChange={(v) => setEditing({ ...editing, group_key: v })}
                options={groupOptions.map((g) => ({ value: g.key, label: g.label }))} />
            </div>
            <div>
              <Typography.Text strong>跳转类型</Typography.Text>
              <div style={{ marginTop: 4 }}>
                <Radio.Group value={editing.target_type} onChange={(e) => setEditing({ ...editing, target_type: e.target.value, target: '' })}
                  options={[{ value: 'external', label: '外部链接' }, { value: 'internal', label: '桌面端内部页面' }]} optionType="button" />
              </div>
            </div>
            <div>
              <Typography.Text strong>{editing.target_type === 'internal' ? '内部页面路径' : '外部链接 URL'}</Typography.Text>
              <Input
                value={editing.target}
                maxLength={500}
                placeholder={editing.target_type === 'internal' ? '/chat（以 / 开头的桌面端路由）' : 'https://example.com/page'}
                style={{ marginTop: 4 }}
                onChange={(e) => setEditing({ ...editing, target: e.target.value })}
              />
            </div>
            {editing.target_type === 'external' && (
              <div>
                <Typography.Text strong>打开方式</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <Radio.Group value={editing.open_mode} onChange={(e) => setEditing({ ...editing, open_mode: e.target.value })}
                    options={[{ value: 'browser', label: '系统浏览器（默认，最安全）' }, { value: 'window', label: '应用内窗口（独立窗口加载）' }]} />
                </div>
              </div>
            )}
            <Space size={24} wrap>
              <span>
                <Typography.Text strong>图标</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <Select value={editing.icon} style={{ width: 120 }} onChange={(v) => setEditing({ ...editing, icon: v })}
                    options={iconOptions.map((k) => ({ value: k, label: ICON_LABEL[k] || k }))} />
                </div>
              </span>
              <span>
                <Typography.Text strong>排序（小在前）</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <InputNumber min={0} max={9999} precision={0} value={editing.sort} onChange={(v) => setEditing({ ...editing, sort: typeof v === 'number' ? v : 0 })} />
                </div>
              </span>
              <span>
                <Typography.Text strong>显示</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <Switch checked={editing.visible} onChange={(v) => setEditing({ ...editing, visible: v })} />
                </div>
              </span>
            </Space>
          </Space>
        )}
      </Modal>
    </Card>
  );
}
