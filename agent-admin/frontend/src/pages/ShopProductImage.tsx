import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Form, Input, Result, Space, Switch, Table, Tabs, Tag, message,
} from 'antd';
import { ReloadOutlined, SettingOutlined, SafetyOutlined, ShoppingOutlined } from '@ant-design/icons';
import { eweiShopApi, settingApi, permissionApi, userApi, groupApi } from '../services/api';

// 解析 policy_value（后端可能回 JSON 字符串 "true" / 原始布尔）
function parseBool(v: any): boolean {
  if (typeof v === 'string') {
    try { return !!JSON.parse(v); } catch { return v === 'true' || v === '1'; }
  }
  return !!v;
}

// ===== 商城注册表（前端单一事实源；新增商城在此加一行）=====
// mall_key 严格与三端一致；policyKey/settingKey 参数化，避免硬编码 ewei。
type MallKey = 'ewei' | 'dianda' | 'qdyun';
interface MallMeta {
  key: MallKey;
  tabLabel: string;     // 顶层 Tab 标签（真实平台名，云控端后台可见）
  policyKey: string;    // allow_{mall}_shop
  settingKey: string;   // {mall}_shop_mall_name
}
const MALLS: MallMeta[] = [
  { key: 'ewei', tabLabel: 'eweishop', policyKey: 'allow_ewei_shop', settingKey: 'ewei_shop_mall_name' },
  { key: 'dianda', tabLabel: '点大商城', policyKey: 'allow_dianda_shop', settingKey: 'dianda_shop_mall_name' },
  { key: 'qdyun', tabLabel: '全端云商城', policyKey: 'allow_qdyun_shop', settingKey: 'qdyun_shop_mall_name' },
];

/**
 * 「店铺商品图」独立功能管理页（桌面端设置 → 店铺商品图）。
 *
 * 按商城分区（顶层 Tab：eweishop / 点大商城）。每个商城各自：
 *  - 一级授权态（含真实平台名）：未授权 → 「请联系服务商开通」；已授权 → 基础设置 + 使用权限。
 *  - 基础设置：自定义商城显示名（system_settings.{mall}_shop_mall_name，走通用 settingApi）。
 *  - 使用权限：默认全员关闭，按用户/分组开放（PermissionPolicy.allow_{mall}_shop，走 permissionApi）。
 */
export default function ShopProductImagePage() {
  // 一级授权 map：{ewei:bool, dianda:bool}；后台展示用的平台真名 map
  const [authLoading, setAuthLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [mallAuth, setMallAuth] = useState<Record<string, boolean>>({});
  const [platformLabels, setPlatformLabels] = useState<Record<string, string>>({});
  const [activeMall, setActiveMall] = useState<MallKey>('ewei');

  const loadAuth = async () => {
    setAuthLoading(true);
    try {
      const res = await eweiShopApi.authorization();
      setMallAuth(res.data?.malls || {});
      setPlatformLabels(res.data?.platform_labels || {});
    } catch {
      setMallAuth({});
    } finally {
      setAuthLoading(false);
    }
  };
  useEffect(() => { loadAuth(); }, []);

  const refreshAuth = async (mall?: MallKey) => {
    setRefreshing(true);
    try {
      const res = await eweiShopApi.refreshAuth(mall);
      setMallAuth(res.data?.malls || {});
      setPlatformLabels(res.data?.platform_labels || {});
      const ok = mall ? !!res.data?.malls?.[mall] : !!res.data?.authorized;
      message.success(ok ? '已刷新：本站已获授权' : '已刷新：本站仍未获授权');
    } catch (e: any) {
      message.error('刷新失败：' + (e?.response?.data?.error || e?.message));
    } finally { setRefreshing(false); }
  };

  if (authLoading) {
    return <Card loading style={{ minHeight: 200 }} />;
  }

  return (
    <div>
      <h2 style={{ marginTop: 0 }}><ShoppingOutlined /> 店铺商品图</h2>
      <Tabs
        activeKey={activeMall}
        onChange={(k) => setActiveMall(k as MallKey)}
        items={MALLS.map((m) => ({
          key: m.key,
          label: (
            <span>
              {platformLabels[m.key] || m.tabLabel}
              {mallAuth[m.key]
                ? <Tag color="green" style={{ marginLeft: 8 }}>已授权</Tag>
                : <Tag style={{ marginLeft: 8 }}>未授权</Tag>}
            </span>
          ),
          children: (
            <MallSection
              meta={m}
              authorized={!!mallAuth[m.key]}
              realName={platformLabels[m.key] || m.tabLabel}
              refreshing={refreshing}
              onRefresh={() => refreshAuth(m.key)}
            />
          ),
        }))}
      />
    </div>
  );
}

// ===== 单商城分区（授权态 + 基础设置 + 使用权限）=====
function MallSection({
  meta, authorized, realName, refreshing, onRefresh,
}: {
  meta: MallMeta;
  authorized: boolean;
  realName: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<'settings' | 'permissions'>('settings');

  // ===== 基础设置：商城显示名（settingKey = {mall}_shop_mall_name）=====
  const [settingsForm] = Form.useForm();
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const loadSettings = async () => {
    setSettingsLoading(true);
    try {
      const res = await settingApi.get();
      settingsForm.setFieldsValue({
        mall_name: res.data?.settings?.[meta.settingKey] ?? '商城',
      });
    } catch (e: any) {
      message.error('加载设置失败：' + (e?.response?.data?.error || e?.message));
    } finally { setSettingsLoading(false); }
  };
  const saveSettings = async (values: any) => {
    setSettingsSaving(true);
    try {
      const name = String(values.mall_name || '').trim() || '商城';
      await settingApi.update({ [meta.settingKey]: name });
      settingsForm.setFieldValue('mall_name', name);
      message.success('已保存，桌面端最长约 1 分钟内刷新生效');
    } catch (e: any) {
      message.error('保存失败：' + (e?.response?.data?.error || e?.message));
    } finally { setSettingsSaving(false); }
  };

  // ===== 使用权限：按用户/分组开关 allow_{mall}_shop =====
  const [users, setUsers] = useState<any[]>([]);
  const [groups, setGroups] = useState<any[]>([]);
  const [userVal, setUserVal] = useState<Record<number, boolean>>({});
  const [groupVal, setGroupVal] = useState<Record<number, boolean>>({});
  const [permLoading, setPermLoading] = useState(false);
  const [savingTarget, setSavingTarget] = useState<string>(''); // 形如 "user:3" / "group:1"
  const [userSearch, setUserSearch] = useState('');

  const loadPermissions = async () => {
    setPermLoading(true);
    try {
      const [uRes, gRes, pRes] = await Promise.all([
        userApi.list({ per_page: 1000 }),
        groupApi.list({ per_page: 500 }),
        permissionApi.list({ policy_key: meta.policyKey, per_page: 1000 }),
      ]);
      setUsers(uRes.data?.data || []);
      setGroups(gRes.data?.data || []);
      const uv: Record<number, boolean> = {};
      const gv: Record<number, boolean> = {};
      for (const p of (pRes.data?.data || [])) {
        if (p.source_plan_id) continue; // 套餐发放的策略不在此页管理
        const val = parseBool(p.policy_value);
        if (p.target_type === 'user') uv[p.target_id] = val;
        else if (p.target_type === 'group') gv[p.target_id] = val;
      }
      setUserVal(uv);
      setGroupVal(gv);
    } catch (e: any) {
      message.error('加载权限失败：' + (e?.response?.data?.error || e?.message));
    } finally { setPermLoading(false); }
  };

  const toggle = async (type: 'user' | 'group', id: number, checked: boolean) => {
    setSavingTarget(`${type}:${id}`);
    try {
      await permissionApi.batchCreate({
        targets: [{ type, id }],
        policy_key: meta.policyKey,
        policy_value: checked,
      });
      if (type === 'user') setUserVal((m) => ({ ...m, [id]: checked }));
      else setGroupVal((m) => ({ ...m, [id]: checked }));
      message.success(checked ? '已开放' : '已关闭');
    } catch (e: any) {
      message.error('操作失败：' + (e?.response?.data?.error || e?.message));
    } finally { setSavingTarget(''); }
  };

  // 按 tab 懒加载（仅在已授权时）
  useEffect(() => {
    if (!authorized) return;
    if (tab === 'settings') loadSettings();
    if (tab === 'permissions') loadPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, tab]);

  const filteredUsers = useMemo(() => {
    const kw = userSearch.trim().toLowerCase();
    if (!kw) return users;
    return users.filter((u) => `${u.username || ''} ${u.nickname || ''}`.toLowerCase().includes(kw));
  }, [users, userSearch]);

  if (!authorized) {
    return (
      <Result
        status="warning"
        title={`本站尚未开通「${realName}」店铺商品图功能`}
        subTitle="该功能需由服务商授权后方可启用与配置。如需开通，请联系您的服务商。"
        extra={
          <Button icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
            我已联系开通，刷新状态
          </Button>
        }
      />
    );
  }

  const renderSettings = () => (
    <Card loading={settingsLoading} style={{ maxWidth: 640 }}>
      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 16 }}
        message={`本站已获授权（平台：${realName}）`}
        description="可在下方自定义商城显示名称，并到「使用权限」为指定用户 / 分组开放本功能。"
        action={
          <Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
            刷新授权
          </Button>
        }
      />
      <Form layout="vertical" form={settingsForm} onFinish={saveSettings}>
        <Form.Item
          name="mall_name"
          label="商城显示名称"
          extra="桌面端「店铺商品图」里对接的商城/平台，对终端用户显示的名称（不暴露具体平台品牌）。留空默认「商城」。"
          rules={[{ max: 20, message: '不超过 20 个字' }]}
        >
          <Input placeholder="商城" maxLength={20} style={{ maxWidth: 320 }} />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={settingsSaving}>保存</Button>
            <Button icon={<ReloadOutlined />} onClick={loadSettings} disabled={settingsLoading}>重新加载</Button>
          </Space>
        </Form.Item>
      </Form>
    </Card>
  );

  const renderPermissions = () => (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="默认所有用户不可用，在此为指定用户或分组开放"
        description="开关打开即为该用户 / 分组开放本商城「店铺商品图」；桌面端最长约 1 分钟内刷新生效。用户同时受所在分组影响（分组开放则其成员可用）。"
      />
      <Card
        size="small"
        title="按用户"
        extra={
          <Input.Search
            placeholder="搜索用户名 / 昵称"
            allowClear
            style={{ width: 240 }}
            onSearch={setUserSearch}
            onChange={(e) => { if (!e.target.value) setUserSearch(''); }}
          />
        }
      >
        <Table
          size="small"
          rowKey="id"
          loading={permLoading}
          dataSource={filteredUsers}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          columns={[
            { title: '用户', render: (_: any, u: any) => (u.nickname ? `${u.nickname}（${u.username}）` : u.username) },
            { title: 'ID', dataIndex: 'id', width: 80 },
            {
              title: '可用', width: 100, render: (_: any, u: any) => (
                <Switch
                  size="small"
                  checked={!!userVal[u.id]}
                  loading={savingTarget === `user:${u.id}`}
                  onChange={(c) => toggle('user', u.id, c)}
                />
              ),
            },
          ]}
        />
      </Card>
      <Card size="small" title="按分组">
        <Table
          size="small"
          rowKey="id"
          loading={permLoading}
          dataSource={groups}
          pagination={false}
          columns={[
            { title: '分组', dataIndex: 'name' },
            { title: 'ID', dataIndex: 'id', width: 80 },
            {
              title: '可用', width: 100, render: (_: any, g: any) => (
                <Switch
                  size="small"
                  checked={!!groupVal[g.id]}
                  loading={savingTarget === `group:${g.id}`}
                  onChange={(c) => toggle('group', g.id, c)}
                />
              ),
            },
          ]}
        />
      </Card>
    </Space>
  );

  return (
    <Tabs
      activeKey={tab}
      onChange={(k) => setTab(k as any)}
      items={[
        { key: 'settings', label: <><SettingOutlined /> 基础设置</>, children: renderSettings() },
        { key: 'permissions', label: <><SafetyOutlined /> 使用权限</>, children: renderPermissions() },
      ]}
    />
  );
}
