import { useEffect, useState } from 'react';
import { Card, Form, Switch, InputNumber, Input, Button, message, Spin, Alert, Space, Select, Tabs, Segmented, Modal, Tag } from 'antd';
import { SaveOutlined, ReloadOutlined, CopyOutlined, ApiOutlined, EyeOutlined } from '@ant-design/icons';
import { settingApi, modelApi, inspirationHubApi } from '../services/api';
import { useCurrencyLabels } from '../contexts/CurrencyContext';

// 云存储容量：DB 存字节，表单按 GB 录入/展示（1 GB = 1073741824 B）
const BYTES_PER_GB = 1073741824;

// 天阙平台公钥：所有商户共用、写死显示，不让运维改（防止误粘脏数据导致验签失败）。
// 后端 TianquePayService 也保留同一份代码内置常量做 fallback，前后端一致。
const TIANQUE_PLATFORM_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAjo1+KBcvwDSIo+nMYLeOJ19J
u4ii0xH66ZxFd869EWFWk/EJa3xIA2+4qGf/Ic7m7zi/NHuCnfUtUDmUdP0JfaZiYwn+
1Ek7tYAOc1+1GxhzcexSJLyJlR2JLMfEM+rZooW4Ei7q3a8jdTWUNoak/bVPXnLEVLrb
IguXABERQ0Ze0X9Fs0y/zkQFg8UjxUN88g2CRfMC6LldHm7UBo+d+WlpOYH7u0OTzoLL
iP/04N1cfTgjjtqTBI7qkOGxYs6aBZHG1DJ6WdP+5w+ho91sBTVajsCxAaMoExWQM2ip
f/1qGdsWmkZScPflBqg7m0olOD87ymAVP/3Tcbvi34bDfwIDAQAB
-----END PUBLIC KEY-----`;

interface Settings {
  register_enabled: boolean;
  register_bonus_enabled: boolean;
  register_bonus_token: number;
  register_bonus_credit: number;
  register_bonus_plan_id: number | null;
  register_bonus_remark: string;
  register_ip_daily_limit: number;
  register_device_unique: boolean;
  register_default_inspiration_uploader: boolean;
  // 短信服务（阿里云）：注册短信验证 + 找回密码
  sms_enabled: boolean;
  sms_access_key_id: string;
  sms_access_key_secret: string;
  sms_sign_name: string;
  sms_template_code: string;
  sms_code_expire_seconds: number;
  sms_send_interval_seconds: number;
  sms_daily_limit_per_mobile: number;
  register_sms_verify_enabled: boolean;
  forgot_password_enabled: boolean;
  has_sms_access_key_secret?: boolean;
  wxpay_enabled: boolean;
  wxpay_mchid: string;
  wxpay_app_id: string;
  wxpay_apiv3_key: string;
  wxpay_cert_serial_no: string;
  wxpay_private_key: string;
  // 验签材料二选一：公钥模式推荐，平台证书为兼容
  wxpay_pub_key_id: string;
  wxpay_pub_key: string;
  wxpay_platform_cert: string;
  has_wxpay_apiv3_key?: boolean;
  has_wxpay_private_key?: boolean;
  // 天阙支付（聚合支付：微信/支付宝/云闪付/数字人民币）
  tianque_enabled: boolean;
  tianque_env: string;          // 'test' | 'prod'
  tianque_version: string;      // '1.2' | '1.0'
  tianque_org_id: string;
  tianque_mno: string;
  tianque_private_key: string;
  has_tianque_private_key?: boolean;
  // 虎皮椒支付（聚合扫码：微信/支付宝，MD5 签名 + 异步 notify）
  xunhupay_enabled: boolean;
  xunhupay_appid: string;
  xunhupay_appsecret: string;
  has_xunhupay_appsecret?: boolean;
  xunhupay_gateway: string;
  currency_label_token: string;
  currency_label_credit: string;
  site_title: string;
  // 登录页背景图 URL + 全局主题主色（桌面端站点级配置，随 /public/site-config 下发）
  login_background_url: string;
  theme_primary_color: string;
  // 存储配置
  storage_type: string;            // 'local' | 'cos' | 'oss'
  cos_secret_id: string;
  cos_secret_key: string;
  cos_region: string;
  cos_bucket: string;
  cos_app_id: string;              // 腾讯云 APPID（10 位数字）
  cos_domain: string;
  has_cos_secret_key?: boolean;
  // 阿里云 OSS 配置
  oss_access_key_id: string;
  oss_access_key_secret: string;
  oss_endpoint: string;            // oss-cn-hangzhou.aliyuncs.com（不含 bucket 前缀）
  oss_bucket: string;
  oss_domain: string;
  has_oss_access_key_secret?: boolean;
  // 桌面端注册页协议（标题 + HTML 富文本）
  register_agreement_title: string;
  register_agreement_content: string;
  privacy_agreement_title: string;
  privacy_agreement_content: string;
  // 桌面端「对话页面默认模型」：新建会话时填入 conversation.active_model_*
  // provider 通常固定 'cloud:default'，model_id 是云端模型表里某条记录的 model_id（裸值）
  chat_default_model_provider: string;
  chat_default_model_id: string;
  // 注：共享灵感库默认启用，endpoint/origin 从云打包配置 + 当前站点域名自动推导，
  // 不再作为表单字段提交；状态走独立的 hubSettings state。
}

// 对话模型下拉选项：来自 /admin/cloud-models 中 type='chat' 的模型
interface ChatModelOption {
  model_id: string;
  name: string;
  provider_name: string;
}

// 加密字段集合：提交时留空 = 不修改
const ENCRYPTED_FIELDS: Array<keyof Settings> = ['wxpay_apiv3_key', 'wxpay_private_key', 'tianque_private_key', 'xunhupay_appsecret', 'cos_secret_key', 'oss_access_key_secret', 'sms_access_key_secret'];

export default function SettingsPage() {
  const [form] = Form.useForm<Settings>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notifyUrl, setNotifyUrl] = useState<string>('');
  const [hasApiv3, setHasApiv3] = useState(false);
  const [hasPrivKey, setHasPrivKey] = useState(false);
  const [hasTianquePrivKey, setHasTianquePrivKey] = useState(false);
  const [hasXunhupaySecret, setHasXunhupaySecret] = useState(false);
  const [cosTesting, setCosTesting] = useState(false);
  const [hasCosSecretKey, setHasCosSecretKey] = useState(false);
  const [ossTesting, setOssTesting] = useState(false);
  const [hasOssSecret, setHasOssSecret] = useState(false);
  const [hasSmsSecret, setHasSmsSecret] = useState(false);
  const [smsTesting, setSmsTesting] = useState(false);
  const [smsTestMobile, setSmsTestMobile] = useState('');
  // 共享灵感库：不再让用户填写 endpoint/origin，后台 GET /settings 返回自动推导值供只读展示。
  const [hubSettings, setHubSettings] = useState<{ endpoint: string; origin: string; ready: boolean } | null>(null);
  const [hubChecking, setHubChecking] = useState(false);
  const [hubCheckResult, setHubCheckResult] = useState<{
    ok: boolean;
    status?: number;
    me?: any;
    reason?: string;
    body?: any;
  } | null>(null);
  // 协议预览 Modal：点「预览」后使用 dangerouslySetInnerHTML 渲染当前表单里的 HTML内容
  const [previewAgreement, setPreviewAgreement] = useState<{ title: string; content: string } | null>(null);
  // 对话默认模型 Tab 用的 chat 类型云端模型选项；load 时一次性拉取
  const [chatModels, setChatModels] = useState<ChatModelOption[]>([]);
  // 验签材料模式：公钥模式（推荐）或平台证书模式（兼容），二选一。
  // load 时根据已有配置自动判定初始模式；save 时按当前模式排他清空另一种。
  const [wxpaySignMode, setWxpaySignMode] = useState<'public_key' | 'platform_cert'>('public_key');
  const bonusEnabled = Form.useWatch('register_bonus_enabled', form);
  const wxpayEnabled = Form.useWatch('wxpay_enabled', form);
  const tianqueEnabled = Form.useWatch('tianque_enabled', form);
  const xunhupayEnabled = Form.useWatch('xunhupay_enabled', form);
  const aiMarkRemovalEnabled = Form.useWatch('ai_mark_removal_enabled', form);
  const storageType = Form.useWatch('storage_type', form);
  const smsEnabled = Form.useWatch('sms_enabled', form);
  const { labels: currencyLabels, refresh: refreshCurrencyLabels } = useCurrencyLabels();

  const load = async () => {
    setLoading(true);
    try {
      // 并行拉：系统设置 + chat 类型云端模型列表（用于「对话模型」Tab 的下拉）
      const [res, modelsRes] = await Promise.all([
        settingApi.get(),
        // 后端 modelApi.list() 返回 { data: CloudModel[] }，这里前端按 type 过滤
        modelApi.list({ per_page: 500 }).catch(() => ({ data: { data: [] as any[] } })),
      ]);
      const s = res.data.settings || {};
      // storage_default_bytes（字节）→ 表单按 GB 展示
      form.setFieldsValue({
        ...s,
        storage_default_gb: Number(s.storage_default_bytes || 0) / BYTES_PER_GB,
      });
      // 抽取 chat 模型；兼容两种返回格式（直接数组 / 包了 data 字段）
      const rawModels: any[] = Array.isArray(modelsRes?.data)
        ? modelsRes.data
        : (modelsRes?.data?.data || []);
      const chats = rawModels
        .filter((m: any) => m?.type === 'chat' && m?.model_id)
        .map((m: any) => ({
          model_id: String(m.model_id),
          name: String(m.name || m.model_id),
          // cloud-models 接口返回的是嵌套 provider 对象（m.provider.name），不是扁平 provider_name；
          // 此处优先取嵌套名，兜底扁平字段，避免同名模型在下拉里无法区分服务商
          provider_name: String(m.provider?.name || m.provider_name || ''),
        }))
        .sort((a, b) => (a.provider_name + a.model_id).localeCompare(b.provider_name + b.model_id));
      setChatModels(chats);
      setHasApiv3(!!s.has_wxpay_apiv3_key);
      setHasPrivKey(!!s.has_wxpay_private_key);
      setHasTianquePrivKey(!!s.has_tianque_private_key);
      setHasXunhupaySecret(!!s.has_xunhupay_appsecret);
      setHasCosSecretKey(!!s.has_cos_secret_key);
      setHasOssSecret(!!s.has_oss_access_key_secret);
      setHasSmsSecret(!!s.has_sms_access_key_secret);
      // 根据已有配置推断验签模式：填了公钥走公钥模式；只填了证书走证书模式；都没填默认推荐公钥模式
      if (s.wxpay_pub_key_id || s.wxpay_pub_key) {
        setWxpaySignMode('public_key');
      } else if (s.wxpay_platform_cert) {
        setWxpaySignMode('platform_cert');
      } else {
        setWxpaySignMode('public_key');
      }
      setNotifyUrl(res.data.wxpay_notify_url_runtime || '');
    } catch {
      message.error('加载失败');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // 单独拉 hub 自动推导的 endpoint/origin/ready，与主表单独立（不会被 handleSave 覆盖）。
  useEffect(() => {
    inspirationHubApi.adminGetSettings()
      .then(res => setHubSettings({
        endpoint: res.data?.endpoint || '',
        origin: res.data?.origin || '',
        ready: !!res.data?.ready,
      }))
      .catch(() => { /* 静默失败，展示会回退 '—' */ });
  }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    // 加密字段为空表示不修改，不要传送给后端（后端也会跳过，两重保障）
    const payload: any = { ...values };
    // storage_default_gb（GB）换算回 storage_default_bytes（字节）后提交
    if ('storage_default_gb' in payload) {
      payload.storage_default_bytes = Math.round(Number(payload.storage_default_gb || 0) * BYTES_PER_GB);
      delete payload.storage_default_gb;
    }
    for (const f of ENCRYPTED_FIELDS) {
      if (payload[f] === '' || payload[f] === undefined || payload[f] === null) {
        delete payload[f];
      }
    }
    // has_xxx 标志位只读，不能提交
    delete payload.has_wxpay_apiv3_key;
    delete payload.has_wxpay_private_key;
    delete payload.has_tianque_private_key;
    delete payload.has_xunhupay_appsecret;
    delete payload.has_cos_secret_key;
    delete payload.has_oss_access_key_secret;
    delete payload.has_sms_access_key_secret;

    // 验签材料按当前模式排他清空另一种，避免两组都填时后端启用不是用户预期的那种
    if (wxpaySignMode === 'public_key') {
      payload.wxpay_platform_cert = '';
    } else {
      payload.wxpay_pub_key_id = '';
      payload.wxpay_pub_key = '';
    }

    setSaving(true);
    try {
      const res = await settingApi.update(payload);
      const s = res.data.settings || {};
      setHasApiv3(!!s.has_wxpay_apiv3_key);
      setHasPrivKey(!!s.has_wxpay_private_key);
      setHasTianquePrivKey(!!s.has_tianque_private_key);
      setHasXunhupaySecret(!!s.has_xunhupay_appsecret);
      setHasCosSecretKey(!!s.has_cos_secret_key);
      setHasOssSecret(!!s.has_oss_access_key_secret);
      setHasSmsSecret(!!s.has_sms_access_key_secret);
      // 提交后清空加密字段，表示下次留空 = 保持
      const reset: any = {};
      for (const f of ENCRYPTED_FIELDS) reset[f] = '';
      form.setFieldsValue(reset);
      // 货币文案可能变了，全局刷新使其他页面同步变化
      refreshCurrencyLabels();
      message.success('已保存');
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
    setSaving(false);
  };

  const handleCopyNotify = async () => {
    if (!notifyUrl) return;
    try {
      await navigator.clipboard.writeText(notifyUrl);
      message.success('已复制回调地址');
    } catch {
      message.error('复制失败，请手动选中复制');
    }
  };

  const handleCosTest = async () => {
    setCosTesting(true);
    try {
      const res = await settingApi.cosTest();
      if (res.data.ok) {
        message.success('COS 配置验证通过');
      } else {
        message.error(res.data.error || '验证失败');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '验证失败');
    }
    setCosTesting(false);
  };

  const handleOssTest = async () => {
    setOssTesting(true);
    try {
      const res = await settingApi.ossTest();
      if (res.data.ok) {
        message.success('OSS 配置验证通过');
      } else {
        message.error(res.data.error || '验证失败');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '验证失败');
    }
    setOssTesting(false);
  };

  const handleSmsTest = async () => {
    const mobile = smsTestMobile.trim();
    if (!mobile) {
      message.warning('请输入接收测试短信的手机号');
      return;
    }
    setSmsTesting(true);
    try {
      const res = await settingApi.smsTest(mobile);
      if (res.data.ok) {
        message.success(res.data.message || '测试短信已发送，请查收');
      } else {
        message.error(res.data.error || '发送失败');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '发送失败');
    }
    setSmsTesting(false);
  };

  // 共享灵感库健康检查：检查当前 endpoint + origin 是否被 hub 接受
  // 提示：修改后需先「保存」再检查，否则读的是上一次保存的值。
  const handleHubHealthCheck = async () => {
    setHubChecking(true);
    setHubCheckResult(null);
    try {
      const res = await inspirationHubApi.adminHealthCheck();
      setHubCheckResult(res.data);
      if (res.data?.ok) {
        message.success('灵感共享市场连接正常');
      } else {
        message.warning('健康检查未通过，查看下方详情');
      }
    } catch (err: any) {
      const reason = err.response?.data?.reason || err.response?.data?.error || err.message || 'request_failed';
      setHubCheckResult({ ok: false, reason });
      message.error('检查请求失败');
    }
    setHubChecking(false);
  };

  const handleWxpayTest = async () => {
    setTesting(true);
    try {
      const res = await settingApi.wxpayTest();
      if (res.data.ok) {
        const modeLabel =
          res.data.mode === 'public_key' ? '公钥模式（永不轮换）' : '平台证书模式';
        const serialPart = res.data.platform_cert_serial
          ? `，证书序列号 ${res.data.platform_cert_serial}`
          : '';
        message.success(`配置验证通过 · ${modeLabel}${serialPart}`);
      } else {
        message.error(res.data.error || '验证失败');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '验证失败');
    }
    setTesting(false);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>系统设置</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={loading}>刷新</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
        </div>
      </div>

      <Spin spinning={loading}>
        <Form form={form} layout="vertical" style={{ maxWidth: 880 }}>
          <Tabs
            defaultActiveKey="basic"
            items={[
              // ============== Tab 1: 站点 ==============
              {
                key: 'basic',
                label: '站点',
                children: (
          <Card title="站点信息" size="small">
            <Alert
              type="info"
              showIcon
              message="站点标题会同步显示于左上角侧边栏与浏览器标签页。修改后代理全局生效。"
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              name="site_title"
              label="站点标题"
              tooltip="由安装向导初始写入，随时可改。最长 50 字，留空会回退默认 Agent Admin。"
              rules={[{ max: 50 }]}
            >
              <Input maxLength={50} placeholder="Agent Admin" style={{ width: 360 }} />
            </Form.Item>

            <Alert
              type="info"
              showIcon
              message="登录页背景图、主题主色等下发到桌面端的外观配置已迁移到「桌面端设置 → 基础设置」。"
              style={{ marginTop: 8 }}
            />
          </Card>
                ),
              },
              // ============== Tab 2: 注册策略 ==============
              {
                key: 'register',
                label: '注册策略',
                children: (
                  <>
          <Card title="注册开放" size="small" style={{ marginBottom: 16 }}>
            <Alert
              type="info"
              showIcon
              message="关闭后，新用户无法通过桌面端注册，已注册用户仍可正常登录。"
              style={{ marginBottom: 16 }}
            />

            <Form.Item name="register_enabled" label="允许新用户注册" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Card>

          <Card title="注册赠送" size="small" style={{ marginBottom: 16 }}>
            <Alert
              type="info"
              showIcon
              message={`开启后，新用户注册完成时自动发放${currencyLabels.token} / ${currencyLabels.credit} / 套餐。`}
              style={{ marginBottom: 16 }}
            />

            <Form.Item name="register_bonus_enabled" label="启用注册赠送" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item
              name="register_bonus_token"
              label={`赠送${currencyLabels.token}`}
              rules={[{ type: 'number', min: 0 }]}
            >
              <InputNumber
                min={0}
                step={1}
                style={{ width: 240 }}
                disabled={!bonusEnabled}
                placeholder="0"
              />
            </Form.Item>

            <Form.Item
              name="register_bonus_credit"
              label={`赠送${currencyLabels.credit}`}
              rules={[{ type: 'number', min: 0 }]}
            >
              <InputNumber
                min={0}
                step={1}
                style={{ width: 240 }}
                disabled={!bonusEnabled}
                placeholder="0"
              />
            </Form.Item>

            <Form.Item
              name="register_bonus_plan_id"
              label="赠送套餐 ID"
              tooltip="填写已启用的套餐 ID；留空表示不赠送套餐"
            >
              <InputNumber
                min={1}
                style={{ width: 240 }}
                disabled={!bonusEnabled}
                placeholder="留空则不赠送套餐"
              />
            </Form.Item>

            <Form.Item
              name="register_bonus_remark"
              label="日志备注"
              rules={[{ max: 200 }]}
            >
              <Input style={{ width: 360 }} disabled={!bonusEnabled} placeholder="新用户注册赠送" />
            </Form.Item>
          </Card>

          <Card title="防刷策略" size="small" style={{ marginBottom: 16 }}>
            <Form.Item
              name="register_ip_daily_limit"
              label="同 IP 每日新注册数上限"
              tooltip="同一 IP 当日新注册用户数达到此值后，本 IP 后续注册不再发奖；设为 0 表示不限"
            >
              <InputNumber min={0} max={1000} step={1} style={{ width: 240 }} />
            </Form.Item>

            <Form.Item
              name="register_device_unique"
              label="同设备仅发一次"
              valuePropName="checked"
              tooltip="客户端会带 X-Device-Id 头；开启后同设备 ID 已注册过用户则不再发奖"
            >
              <Switch />
            </Form.Item>
          </Card>

          <Card title="新用户默认权限" size="small" style={{ marginBottom: 16 }}>
            <Alert
              type="info"
              showIcon
              message="开启后，新注册用户自动获得对应权限。已注册的存量用户不受影响，需在「用户管理」手动调整。"
              style={{ marginBottom: 16 }}
            />

            <Form.Item
              name="register_default_inspiration_uploader"
              label="默认开通「灵感大王」"
              valuePropName="checked"
              tooltip="拥有该权限的用户可在桌面端将创作上传到灵感广场。默认关闭，需管理员按需开通"
            >
              <Switch />
            </Form.Item>
          </Card>

          <Card title="短信验证（阿里云）" size="small" style={{ marginBottom: 16 }}>
            <Alert
              type="info"
              showIcon
              message="对接阿里云短信，用于桌面端「手机号验证码注册」与「找回密码」。AccessKey 加密存储、仅服务端使用，绝不下发客户端。需先在阿里云短信控制台准备：已审核通过的签名、一个含 ${code} 变量的验证码模板（注册与找回共用）。"
              style={{ marginBottom: 16 }}
            />

            <Form.Item name="sms_enabled" label="启用短信服务" valuePropName="checked"
              tooltip="总开关。关闭后注册短信验证与找回密码均不可用">
              <Switch />
            </Form.Item>

            <Space size={16} style={{ width: '100%', display: 'flex', flexWrap: 'wrap' }}>
              <Form.Item name="sms_sign_name" label="短信签名"
                tooltip="阿里云短信控制台「签名管理」中审核通过的签名名称"
                style={{ flex: '1 1 220px' }}>
                <Input maxLength={30} placeholder="例如：某某科技" disabled={!smsEnabled} />
              </Form.Item>
              <Form.Item name="sms_template_code" label="验证码模板 CODE"
                tooltip="阿里云短信模板 CODE，如 SMS_123456789。模板正文须含且仅含一个变量 ${code}"
                style={{ flex: '1 1 220px' }}>
                <Input maxLength={30} placeholder="SMS_xxxxxxxxx" disabled={!smsEnabled} />
              </Form.Item>
            </Space>

            <Form.Item name="sms_access_key_id" label="AccessKey ID"
              tooltip="阿里云 RAM 子账号 AccessKey ID，建议仅授予 AliyunDysmsFullAccess 权限">
              <Input maxLength={64} placeholder="LTAI..." autoComplete="off" disabled={!smsEnabled} />
            </Form.Item>

            <Form.Item name="sms_access_key_secret"
              label={hasSmsSecret ? 'AccessKey Secret（已配置，留空表示不修改）' : 'AccessKey Secret'}
              tooltip="加密存储，后台从不返回明文">
              <Input.Password maxLength={64}
                placeholder={hasSmsSecret ? '留空表示不修改' : 'AccessKey Secret'}
                autoComplete="new-password" disabled={!smsEnabled} />
            </Form.Item>

            <Space size={16} style={{ width: '100%', display: 'flex', flexWrap: 'wrap' }}>
              <Form.Item name="sms_code_expire_seconds" label="验证码有效期（秒）"
                tooltip="验证码多少秒内有效，默认 300（5 分钟）" style={{ flex: '1 1 160px' }}>
                <InputNumber min={60} max={1800} step={60} style={{ width: '100%' }} disabled={!smsEnabled} placeholder="300" />
              </Form.Item>
              <Form.Item name="sms_send_interval_seconds" label="发送间隔（秒）"
                tooltip="同一手机号两次发送的最小间隔，默认 60" style={{ flex: '1 1 160px' }}>
                <InputNumber min={30} max={600} step={10} style={{ width: '100%' }} disabled={!smsEnabled} placeholder="60" />
              </Form.Item>
              <Form.Item name="sms_daily_limit_per_mobile" label="单号每日上限（条）"
                tooltip="单个手机号每天最多发送的验证码条数，默认 10" style={{ flex: '1 1 160px' }}>
                <InputNumber min={1} max={100} step={1} style={{ width: '100%' }} disabled={!smsEnabled} placeholder="10" />
              </Form.Item>
            </Space>

            <Alert
              type="warning"
              showIcon
              message="以下两个开关需在「启用短信服务」开启后才会对桌面端生效。"
              style={{ margin: '8px 0 16px' }}
            />

            <Form.Item name="register_sms_verify_enabled" label="注册需短信验证"
              valuePropName="checked"
              tooltip="开启后，桌面端注册时手机号必填且需输入收到的短信验证码">
              <Switch disabled={!smsEnabled} />
            </Form.Item>

            <Form.Item name="forgot_password_enabled" label="允许找回密码"
              valuePropName="checked"
              tooltip="开启后，桌面端登录页显示「忘记密码」，用户凭手机号 + 验证码重置密码">
              <Switch disabled={!smsEnabled} />
            </Form.Item>

            <Form.Item label="发送测试短信"
              tooltip="用当前已保存的配置向指定手机号发一条真实验证码短信，验证签名 / 模板是否可用。请先点顶部「保存」再测试，会消耗短信额度。">
              <Space.Compact style={{ display: 'flex', maxWidth: 360 }}>
                <Input
                  value={smsTestMobile}
                  onChange={(e) => setSmsTestMobile(e.target.value)}
                  placeholder="接收测试短信的手机号"
                  maxLength={11}
                  disabled={!smsEnabled}
                />
                <Button icon={<ApiOutlined />} loading={smsTesting} onClick={handleSmsTest} disabled={!smsEnabled}>
                  发送测试
                </Button>
              </Space.Compact>
            </Form.Item>
          </Card>
                  </>
                ),
              },
              // ============== Tab 3: 文案 ==============
              {
                key: 'currency',
                label: '文案',
                children: (
          <Card title="界面文案" size="small">
            <Alert
              type="info"
              showIcon
              message="自定义两种钱包类型的显示名称。修改后会同步到桌面端 / Web 客户端。留空使用默认值（金币 / 积分）。"
              style={{ marginBottom: 16 }}
            />
            <Space size={16} style={{ width: '100%', display: 'flex', flexWrap: 'wrap' }}>
              <Form.Item
                name="currency_label_token"
                label="现金钱包名称"
                tooltip="balance_type=token 的货币名称。默认“金币”，使用于按 token 计费的现金扣除"
                rules={[{ max: 20 }]}
                style={{ flex: '1 1 220px' }}
              >
                <Input maxLength={20} placeholder="金币" />
              </Form.Item>
              <Form.Item
                name="currency_label_credit"
                label="积分钱包名称"
                tooltip="balance_type=credit 的货币名称。默认“积分”，使用于按次计费的积分扣除"
                rules={[{ max: 20 }]}
                style={{ flex: '1 1 220px' }}
              >
                <Input maxLength={20} placeholder="积分" />
              </Form.Item>
            </Space>
          </Card>
                ),
              },
              // ============== Tab: 去AI标记 ==============
              {
                key: 'ai_mark_removal',
                label: '去AI标记',
                children: (
          <Card title="去AI标记（本地清除元数据 / 溯源标识）" size="small">
            <Alert
              type="warning"
              showIcon
              message="能力边界与合规提示"
              description="本功能在桌面端本地剥离图片的元数据与溯源标识（C2PA / EXIF / XMP / 中国 AIGC 标签等），不修改画面像素，对 Google SynthID 等像素级鲁棒水印无法去除。部分地区（如中国、印度）对去除 AI 生成标识有法律限制，请依据自身合规判断开放范围。"
              style={{ marginBottom: 16 }}
            />
            <Alert
              type="info"
              showIcon
              message="显示与使用分两层控制"
              description="「显示」由下方总开关控制：开启后所有用户桌面端都会出现入口。「能否使用」再分两种：打开「全局可用」则所有人免授权直接使用；关闭「全局可用」时，需在「权限」或「套餐」中按用户 / 分组 / 套餐授权 allow_ai_mark_removal 后才能使用。"
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              name="ai_mark_removal_enabled"
              label="启用并显示（对所有用户显示入口）"
              tooltip="开启后所有用户桌面端都出现「去AI标记」入口；关闭则全部隐藏且功能整体停用"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
            <Form.Item
              name="ai_mark_removal_use_all"
              label="全局可用（所有人免授权直接使用）"
              tooltip="开启后所有能看到入口的用户都可直接使用（会按下方单价扣费）；关闭时需在「权限」/「套餐」逐个授权才能使用。仅在上方「启用并显示」开启时生效"
              valuePropName="checked"
            >
              <Switch disabled={!aiMarkRemovalEnabled} />
            </Form.Item>
            <Form.Item
              name="ai_mark_removal_credit_per_call"
              label="单次去标记扣费（积分）"
              tooltip="按次计费的全局单价；用户 / 分组 / 套餐可用 ai_mark_removal_credit_per_call 单独覆盖。设为 0 表示免费"
              rules={[{ type: 'number', min: 0 }]}
            >
              <InputNumber min={0} step={0.1} precision={4} style={{ width: 240 }} placeholder="0.1" />
            </Form.Item>
          </Card>
                ),
              },
              // ============== Tab 4: 微信支付 ==============
              {
                key: 'wxpay',
                label: '微信支付',
                children: (
          <Card title="微信支付" size="small"
            extra={<Space size={8}><span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>先保存再测试</span><Button size="small" icon={<ApiOutlined />} loading={testing} onClick={handleWxpayTest} disabled={!wxpayEnabled}>测试连接</Button></Space>}>
            <Alert
              type="info"
              showIcon
              message="开启后软件端可在套餐商城中扫码购买。需提前在微信商户平台完成资质认证 + ICP 备案。"
              style={{ marginBottom: 16 }}
            />

            <Form.Item label="当前回调地址" tooltip="请复制此地址到微信商户平台 → 产品中心 → Native 支付 → 配置回调 URL。可多套部署，各自识别。">
              <Space.Compact style={{ display: 'flex' }}>
                <Input value={notifyUrl} readOnly style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
                <Button icon={<CopyOutlined />} onClick={handleCopyNotify} disabled={!notifyUrl}>复制</Button>
              </Space.Compact>
            </Form.Item>

            <Form.Item name="wxpay_enabled" label="启用微信支付" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Space size={16} style={{ width: '100%', display: 'flex', flexWrap: 'wrap' }}>
              <Form.Item name="wxpay_mchid" label="商户号" tooltip="mchid" style={{ flex: '1 1 220px' }}>
                <Input maxLength={32} placeholder="例如 1234567890" disabled={!wxpayEnabled} />
              </Form.Item>
              <Form.Item name="wxpay_app_id" label="AppID" tooltip="公众号 / 开放平台 AppID" style={{ flex: '1 1 220px' }}>
                <Input maxLength={64} placeholder="wx 开头" disabled={!wxpayEnabled} />
              </Form.Item>
            </Space>

            <Form.Item name="wxpay_cert_serial_no" label="商户证书序列号"
              tooltip="从微信商户平台下载的商户证书 PEM 中获取">
              <Input maxLength={80} placeholder="40 位十六进制字符串" disabled={!wxpayEnabled} />
            </Form.Item>

            <Form.Item name="wxpay_apiv3_key" label={hasApiv3 ? 'APIv3 密钥（已配置，留空表示不修改）' : 'APIv3 密钥'}
              tooltip="微信商户平台 → 账户中心 → API 安全 → APIv3 密钥。加密存储，后台从不返回明文">
              <Input.Password maxLength={64} placeholder={hasApiv3 ? '留空表示不修改' : '32 位字符串'} disabled={!wxpayEnabled} autoComplete="new-password" />
            </Form.Item>

            <Form.Item name="wxpay_private_key" label={hasPrivKey ? '商户 API 私钥（已配置，留空表示不修改）' : '商户 API 私钥'}
              tooltip="商户证书包中的 apiclient_key.pem 全文，以 -----BEGIN 开头">
              <Input.TextArea rows={6} maxLength={4096}
                placeholder={hasPrivKey ? '留空表示不修改' : '-----BEGIN PRIVATE KEY-----\n...'}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                disabled={!wxpayEnabled} />
            </Form.Item>

            <Form.Item label="验签材料"
              tooltip="微信回调验签所需。公钥模式（推荐）配置一次永不过期；平台证书模式每 12 个月需手动换证。二选一">
              <Segmented
                value={wxpaySignMode}
                onChange={(v) => setWxpaySignMode(v as 'public_key' | 'platform_cert')}
                disabled={!wxpayEnabled}
                options={[
                  { value: 'public_key', label: '公钥模式（推荐）' },
                  { value: 'platform_cert', label: '平台证书（兼容）' },
                ]}
                block
              />
            </Form.Item>

            {wxpaySignMode === 'public_key' ? (
              <>
                <Alert
                  type="info"
                  showIcon
                  message="商户后台路径：账户中心 → API 安全 → 微信支付公钥。配置后永不需要换证书"
                  style={{ marginBottom: 12 }}
                />
                <Form.Item name="wxpay_pub_key_id" label="微信支付公钥 ID"
                  tooltip="商户后台「微信支付公钥」页面展示的公钥 ID，如 PUB_KEY_ID_0117xxxxxx">
                  <Input maxLength={80} placeholder="PUB_KEY_ID_..." disabled={!wxpayEnabled} />
                </Form.Item>
                <Form.Item name="wxpay_pub_key" label="微信支付公钥"
                  tooltip="与公钥 ID 配对的 PEM 文本，以 -----BEGIN PUBLIC KEY----- 开头">
                  <Input.TextArea rows={6} maxLength={4096}
                    placeholder="-----BEGIN PUBLIC KEY-----\n..."
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                    disabled={!wxpayEnabled} />
                </Form.Item>
              </>
            ) : (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message="平台证书每 12 个月过期，过期后回调全部验签失败。建议切换到公钥模式"
                  style={{ marginBottom: 12 }}
                />
                <Form.Item name="wxpay_platform_cert" label="微信平台证书"
                  tooltip="可通过《wechatpay-php Tool》下载最新平台证书 PEM，粘贴全文。每年过期需手动更新">
                  <Input.TextArea rows={6} maxLength={8192}
                    placeholder="-----BEGIN CERTIFICATE-----\n..."
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                    disabled={!wxpayEnabled} />
                </Form.Item>
              </>
            )}
          </Card>
                ),
              },
              // ============== Tab 5: 存储 ==============
              {
                key: 'storage',
                label: '资源存储',
                children: (
          <Card title="资源上传存储" size="small"
            extra={
              storageType === 'cos'
                ? <Button size="small" icon={<ApiOutlined />} loading={cosTesting} onClick={handleCosTest}>测试连接</Button>
                : storageType === 'oss'
                ? <Button size="small" icon={<ApiOutlined />} loading={ossTesting} onClick={handleOssTest}>测试连接</Button>
                : null
            }>
            <Alert
              type="info"
              showIcon
              message="所有图片资源（灵感封面、官网截图、云打包图标等）的上传去向。切换存储方式后历史文件 URL 仍然有效，不影响已有数据。"
              style={{ marginBottom: 16 }}
            />

            <Form.Item name="storage_type" label="存储方式"
              tooltip="本地：图片存服务器 public 目录；腾讯云 COS / 阿里云 OSS：图片存对象存储桶（推荐，CDN 加速）">
              <Segmented
                options={[
                  { value: 'local', label: '服务器本地' },
                  { value: 'cos', label: '腾讯云 COS' },
                  { value: 'oss', label: '阿里云 OSS' },
                ]}
                block
              />
            </Form.Item>

            {storageType === 'cos' && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message="保存配置后请先点击右上角「测试连接」验证 SecretId / SecretKey / Region / Bucket 是否正确。"
                  style={{ marginBottom: 12 }}
                />

                <Space size={16} style={{ width: '100%', display: 'flex', flexWrap: 'wrap' }}>
                  <Form.Item name="cos_region" label="地域 (Region)"
                    tooltip="对象存储桶所在地域，如 ap-shanghai / ap-guangzhou / ap-beijing"
                    style={{ flex: '1 1 200px' }}>
                    <Input maxLength={32} placeholder="ap-shanghai" />
                  </Form.Item>
                  <Form.Item name="cos_bucket" label="存储桶名 (Bucket)"
                    tooltip="只填桶名前缀，不包含 APPID 后缀。如在腾讯云控制台看到「my-files-1234567890」，则这里填「my-files」。（也可填入完整名，系统会自动识别）"
                    style={{ flex: '1 1 200px' }}>
                    <Input maxLength={64} placeholder="my-files" />
                  </Form.Item>
                  <Form.Item name="cos_app_id" label="APPID"
                    tooltip="腾讯云账号 APPID，10 位数字。可在「腾讯云控制台 → 账号信息」查看，与桶名一起拼接为 bucket-APPID 作为访问域名。如 Bucket 字段已填入完整名（含 APPID）则可留空"
                    style={{ flex: '1 1 160px' }}>
                    <Input maxLength={20} placeholder="1234567890" />
                  </Form.Item>
                </Space>

                <Form.Item name="cos_secret_id" label="SecretId"
                  tooltip="腾讯云控制台 → 访问管理 → API 密钥管理 → SecretId">
                  <Input maxLength={80} placeholder="AKID..." autoComplete="off" />
                </Form.Item>

                <Form.Item name="cos_secret_key"
                  label={hasCosSecretKey ? 'SecretKey（已配置，留空表示不修改）' : 'SecretKey'}
                  tooltip="加密存储，后台从不返回明文。建议为此 API 密钥单独建子账号并仅授予 COS 读写权限">
                  <Input.Password maxLength={80}
                    placeholder={hasCosSecretKey ? '留空表示不修改' : '32 位字符串'}
                    autoComplete="new-password" />
                </Form.Item>

                <Form.Item name="cos_domain" label="自定义域名（可选）"
                  tooltip="如已为存储桶绑定 CDN 加速域名，填写完整 URL（含 https://）；留空则走默认 cos 域名">
                  <Input maxLength={200} placeholder="https://cdn.example.com" />
                </Form.Item>
              </>
            )}

            {storageType === 'oss' && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message="保存配置后请先点击右上角「测试连接」验证 AccessKeyId / AccessKeySecret / Endpoint / Bucket 是否正确。"
                  style={{ marginBottom: 12 }}
                />

                <Space size={16} style={{ width: '100%', display: 'flex', flexWrap: 'wrap' }}>
                  <Form.Item name="oss_endpoint" label="地域节点 (Endpoint)"
                    tooltip="存储桶所在地域的访问域名，不含 bucket 前缀。如 oss-cn-hangzhou.aliyuncs.com / oss-cn-shanghai.aliyuncs.com"
                    style={{ flex: '1 1 260px' }}>
                    <Input maxLength={120} placeholder="oss-cn-hangzhou.aliyuncs.com" />
                  </Form.Item>
                  <Form.Item name="oss_bucket" label="存储桶名 (Bucket)"
                    tooltip="阿里云 OSS 控制台的 Bucket 名称，与 Endpoint 拼接为 bucket.endpoint 作为访问域名"
                    style={{ flex: '1 1 200px' }}>
                    <Input maxLength={64} placeholder="my-bucket" />
                  </Form.Item>
                </Space>

                <Form.Item name="oss_access_key_id" label="AccessKeyId"
                  tooltip="阿里云控制台 → 访问控制 RAM → 用户 → AccessKey。建议为此单独建子账号并仅授予该 Bucket 读写权限">
                  <Input maxLength={80} placeholder="LTAI..." autoComplete="off" />
                </Form.Item>

                <Form.Item name="oss_access_key_secret"
                  label={hasOssSecret ? 'AccessKeySecret（已配置，留空表示不修改）' : 'AccessKeySecret'}
                  tooltip="加密存储，后台从不返回明文">
                  <Input.Password maxLength={80}
                    placeholder={hasOssSecret ? '留空表示不修改' : 'AccessKeySecret'}
                    autoComplete="new-password" />
                </Form.Item>

                <Form.Item name="oss_domain" label="自定义域名（可选）"
                  tooltip="如已为存储桶绑定 CDN 加速域名，填写完整 URL（含 https://）；留空则走默认 oss 域名">
                  <Input maxLength={200} placeholder="https://cdn.example.com" />
                </Form.Item>
              </>
            )}
          </Card>
                ),
              },
              // ============== Tab: 对话模型 ==============
              {
                key: 'chat_model',
                label: '对话模型',
                children: (
                  <Card title="对话页面默认模型" size="small">
                    <Alert
                      type="info"
                      showIcon
                      message="桌面端新建会话时默认使用此模型。用户在对话页输入框左下角可随时切换，切换后每个会话独立持久记忆。留空表示不预设，桌面端将回退到本地第一个对话模型。"
                      style={{ marginBottom: 16 }}
                    />
                    <Form.Item
                      name="chat_default_model_id"
                      label="默认模型"
                      tooltip="仅可选「云端模型」中 type=chat 的对话模型。需要先在「云端模型」页面创建对应模型。"
                    >
                      <Select
                        showSearch
                        allowClear
                        placeholder="未配置 — 桌面端将自动回退"
                        style={{ width: 480 }}
                        optionFilterProp="label"
                        options={chatModels.map((m) => ({
                          // value 用复合 key `model_id#@provider_name`（与桌面端 CLOUD_KEY_SEP 一致）：
                          // 「同 model_id 多服务商」时各选项 value 唯一，既消除多高亮、又把服务商一并存入，
                          // 让桌面端能精确锁定到具体服务商的模型；provider_name 为空时退化为裸 model_id。
                          value: m.provider_name ? `${m.model_id}#@${m.provider_name}` : m.model_id,
                          label: m.provider_name ? `${m.provider_name} / ${m.model_id}` : m.model_id,
                        }))}
                        notFoundContent={chatModels.length === 0 ? '暂无 chat 类型云端模型，请先在「云端模型」页面创建' : '无匹配'}
                      />
                    </Form.Item>
                    {/* provider 固定 cloud:default，隐藏字段；管理员只需选模型 */}
                    <Form.Item name="chat_default_model_provider" hidden>
                      <Input />
                    </Form.Item>
                  </Card>
                ),
              },
              // ============== Tab: 协议管理 ==============
              {
                key: 'agreements',
                label: '协议管理',
                children: (
                  <>
          <Alert
            type="info"
            showIcon
            message="桌面端注册页点《注册协议》《隐私协议》时会弹窗展示以下内容。支持 HTML 标签（如 &lt;p&gt; &lt;h3&gt; &lt;strong&gt; &lt;a&gt; &lt;ol&gt; &lt;ul&gt; &lt;li&gt; &lt;br&gt;），渲染前会过滤脚本。修改后点顶部「保存」生效。"
            style={{ marginBottom: 16 }}
          />
          <Card title="注册协议" size="small" style={{ marginBottom: 16 }}
            extra={
              <Button size="small" icon={<EyeOutlined />} onClick={() => {
                const v = form.getFieldsValue(['register_agreement_title', 'register_agreement_content']);
                setPreviewAgreement({
                  title: v.register_agreement_title || '注册协议',
                  content: v.register_agreement_content || '<p style="color:#999">未填写内容</p>',
                });
              }}>预览</Button>
            }>
            <Form.Item
              name="register_agreement_title"
              label="标题"
              tooltip="桌面端注册页「阅读并同意」后的链接文案 + 弹窗标题"
              rules={[{ max: 50 }]}
            >
              <Input maxLength={50} placeholder="注册协议" style={{ width: 360 }} />
            </Form.Item>
            <Form.Item
              name="register_agreement_content"
              label="内容（HTML）"
              tooltip="支持常见 HTML 标签。可从 Word / 在线富文本编辑器导出 HTML 后粘贴，也可手写"
              rules={[{ max: 50000 }]}
            >
              <Input.TextArea
                rows={12}
                maxLength={50000}
                placeholder="<h3>注册协议</h3>&#10;<p>...</p>"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </Form.Item>
          </Card>

          <Card title="隐私协议" size="small"
            extra={
              <Button size="small" icon={<EyeOutlined />} onClick={() => {
                const v = form.getFieldsValue(['privacy_agreement_title', 'privacy_agreement_content']);
                setPreviewAgreement({
                  title: v.privacy_agreement_title || '隐私协议',
                  content: v.privacy_agreement_content || '<p style="color:#999">未填写内容</p>',
                });
              }}>预览</Button>
            }>
            <Form.Item
              name="privacy_agreement_title"
              label="标题"
              tooltip="桌面端注册页「阅读并同意」后的链接文案 + 弹窗标题"
              rules={[{ max: 50 }]}
            >
              <Input maxLength={50} placeholder="隐私协议" style={{ width: 360 }} />
            </Form.Item>
            <Form.Item
              name="privacy_agreement_content"
              label="内容（HTML）"
              tooltip="支持常见 HTML 标签。可从 Word / 在线富文本编辑器导出 HTML 后粘贴，也可手写"
              rules={[{ max: 50000 }]}
            >
              <Input.TextArea
                rows={12}
                maxLength={50000}
                placeholder="<h3>隐私协议</h3>&#10;<p>...</p>"
                style={{ fontFamily: 'monospace', fontSize: 12 }}
              />
            </Form.Item>
          </Card>
                  </>
                ),
              },
              // ============== Tab: 共享灵感库 ==============
              {
                key: 'inspiration_hub',
                label: '灵感共享市场',
                children: (
                  <Card
                    title="灵感共享市场（跨站共享）"
                    size="small"
                    extra={
                      <Button
                        size="small"
                        icon={<ApiOutlined />}
                        loading={hubChecking}
                        onClick={handleHubHealthCheck}
                      >
                        健康检查
                      </Button>
                    }
                  >
                    <Alert
                      type="info"
                      showIcon
                      message="灵感共享市场默认启用，与云打包共用同一套域名鉴权。服务端点与本站 Origin 从云打包配置和当前站点域名自动推导，无需在这里填写；仅需在共享服务后台授权本站 Origin 即可。"
                      style={{ marginBottom: 16 }}
                    />

                    <div style={{ background: '#fafafa', padding: 12, borderRadius: 6, fontSize: 13, lineHeight: 2 }}>
                      <div>
                        <span style={{ color: '#888', display: 'inline-block', minWidth: 96 }}>服务端点：</span>
                        <code>{hubSettings?.endpoint || '—'}</code>
                      </div>
                      <div>
                        <span style={{ color: '#888', display: 'inline-block', minWidth: 96 }}>本站 Origin：</span>
                        <code>{hubSettings?.origin || '—'}</code>
                      </div>
                      <div>
                        <span style={{ color: '#888', display: 'inline-block', minWidth: 96 }}>状态：</span>
                        {hubSettings
                          ? (hubSettings.ready ? <Tag color="green">已就绪</Tag> : <Tag color="orange">未就绪</Tag>)
                          : <Tag>加载中</Tag>}
                      </div>
                    </div>

                    {hubCheckResult?.ok && (
                      <Alert
                        type="success"
                        showIcon
                        style={{ marginTop: 12 }}
                        message="健康检查通过"
                        description={
                          <div style={{ fontSize: 12 }}>
                            <div>HTTP 状态：{hubCheckResult.status ?? 200}</div>
                            {hubCheckResult.me && (
                              <>
                                <div>站点名：{hubCheckResult.me.site_name || '—'}</div>
                                <div>是否审核员：{hubCheckResult.me.is_reviewer ? '是' : '否'}</div>
                                {typeof hubCheckResult.me.approve_threshold === 'number' && (
                                  <div>当前通过阈值：{hubCheckResult.me.approve_threshold}</div>
                                )}
                              </>
                            )}
                          </div>
                        }
                      />
                    )}
                    {hubCheckResult && !hubCheckResult.ok && (
                      <Alert
                        type="error"
                        showIcon
                        style={{ marginTop: 12 }}
                        message={`健康检查失败：${hubCheckResult.reason}`}
                        description={
                          <div style={{ fontSize: 12 }}>
                            {hubCheckResult.reason === 'endpoint_empty' && '云打包 base_url 未配置，请检查服务器 .env 的 AGENT_BUILD_BASE_URL'}
                            {hubCheckResult.reason === 'origin_empty' && '无法推导本站 Origin，请检查 APP_URL'}
                            {hubCheckResult.reason === 'origin_unauthorized' && '当前 Origin 未在 agent-build 后台授权，请联系 hub 管理员添加'}
                            {hubCheckResult.reason === 'inspiration_hub_unreachable' && '无法连通服务端点，请检查网络 / URL'}
                            {hubCheckResult.reason === 'http_error' && `服务端返回错误（HTTP ${hubCheckResult.status ?? '?'}）`}
                            {hubCheckResult.body && (
                              <pre style={{ background: '#fafafa', padding: 8, borderRadius: 4, marginTop: 4, maxHeight: 200, overflow: 'auto' }}>
                                {JSON.stringify(hubCheckResult.body, null, 2)}
                              </pre>
                            )}
                          </div>
                        }
                      />
                    )}
                  </Card>
                ),
              },
              // ============== Tab 6: 天阙支付 ==============
              {
                key: 'tianque',
                label: '天阙支付',
                children: (
          <Card title="天阙支付（随行付）" size="small">
            <Alert
              type="info"
              showIcon
              message="天阙是聚合支付服务，一个通道支持微信/支付宝/云闪付/数字人民币。开启后软件端用户可在套餐商城选择此支付方式。"
              style={{ marginBottom: 16 }}
            />

            <Form.Item name="tianque_enabled" label="启用天阙支付" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Space size={16} style={{ width: '100%', display: 'flex', flexWrap: 'wrap' }}>
              <Form.Item name="tianque_env" label="环境" tooltip="测试环境只能跑联调，正式收款必须用生产" style={{ flex: '1 1 200px' }}>
                <Select
                  disabled={!tianqueEnabled}
                  options={[
                    { value: 'test', label: '测试环境' },
                    { value: 'prod', label: '生产环境' },
                  ]}
                  placeholder="请选择"
                />
              </Form.Item>
              <Form.Item name="tianque_version" label="身份类型" tooltip="天阙合作模式：商户用 1.2，服务商用 1.0" style={{ flex: '1 1 200px' }}>
                <Select
                  disabled={!tianqueEnabled}
                  options={[
                    { value: '1.2', label: '商户（1.2）' },
                    { value: '1.0', label: '服务商（1.0）' },
                  ]}
                  placeholder="请选择"
                />
              </Form.Item>
            </Space>

            <Space size={16} style={{ width: '100%', display: 'flex', flexWrap: 'wrap' }}>
              <Form.Item name="tianque_org_id" label="机构号 (orgId)" tooltip="8 位或 10 位纯数字，由天阙分配" style={{ flex: '1 1 220px' }}>
                <Input maxLength={20} placeholder="例如 73007943" disabled={!tianqueEnabled} />
              </Form.Item>
              <Form.Item name="tianque_mno" label="商户号 (mno)" tooltip="399 开头的 15 位纯数字" style={{ flex: '1 1 220px' }}>
                <Input maxLength={20} placeholder="399xxxxxxxxxxxx" disabled={!tianqueEnabled} />
              </Form.Item>
            </Space>

            <Form.Item label="平台公钥（天阙提供）"
              tooltip="天阙平台公钥固定值，云控端已内置无需配置。用于验签天阙响应防篡改">
              <Input.TextArea rows={8} value={TIANQUE_PLATFORM_PUBLIC_KEY} readOnly
                style={{ fontFamily: 'monospace', fontSize: 12, background: '#fafafa', cursor: 'default' }} />
            </Form.Item>

            <Form.Item name="tianque_private_key" label={hasTianquePrivKey ? '商户私钥（已配置，留空表示不修改）' : '商户私钥'}
              tooltip="PKCS8 格式 PEM 全文，以 -----BEGIN PRIVATE KEY----- 开头（注意不含 RSA）。粘贴 base64 内容也可，系统会自动包装">
              <Input.TextArea rows={6} maxLength={4096}
                placeholder={hasTianquePrivKey ? '留空表示不修改' : '-----BEGIN PRIVATE KEY-----\n...'}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                disabled={!tianqueEnabled} />
            </Form.Item>
          </Card>
                ),
              },
              // ============== Tab: 虎皮椒支付 ==============
              {
                key: 'xunhupay',
                label: '虎皮椒支付',
                children: (
          <Card title="虎皮椒支付（xunhupay 聚合扫码）" size="small">
            <Alert
              type="info"
              showIcon
              message="虎皮椒是聚合支付服务，支持微信 / 支付宝扫码。在虎皮椒后台「支付渠道管理 → 我的支付渠道」申请获取 APPID 与 APPSECRET。开启后软件端用户可在套餐商城 / 充值选择此支付方式。"
              style={{ marginBottom: 16 }}
            />

            <Form.Item name="xunhupay_enabled" label="启用虎皮椒支付" valuePropName="checked">
              <Switch />
            </Form.Item>

            <Form.Item name="xunhupay_appid" label="APPID" tooltip="虎皮椒支付渠道的 APPID">
              <Input maxLength={64} placeholder="虎皮椒 APPID" disabled={!xunhupayEnabled} />
            </Form.Item>

            <Form.Item name="xunhupay_appsecret" label={hasXunhupaySecret ? 'APPSECRET（已配置，留空表示不修改）' : 'APPSECRET'}
              tooltip="虎皮椒 APPSECRET，用于 MD5 签名，加密存储，绝不下发前端">
              <Input.Password maxLength={128} autoComplete="new-password"
                placeholder={hasXunhupaySecret ? '留空表示不修改' : '虎皮椒 APPSECRET'}
                disabled={!xunhupayEnabled} />
            </Form.Item>

            <Form.Item name="xunhupay_gateway" label="网关地址（可选）"
              tooltip="留空走默认 https://api.xunhupay.com；如需备用网关可填 https://api.dpweixin.com">
              <Input maxLength={128} placeholder="https://api.xunhupay.com（留空即默认）" disabled={!xunhupayEnabled} />
            </Form.Item>
          </Card>
                ),
              },
              // ============== Tab: 数据同步 ==============
              {
                key: 'cloud-sync',
                label: '数据同步',
                children: (
                  <Card>
                    <Alert type="info" showIcon style={{ marginBottom: 16 }}
                      message="云同步与容量计费"
                      description="桌面端按账号上传数据到云端（落地位置由「资源存储」决定）。开启容量计费后，用户总配额 = 默认赠送 + 套餐容量（在「套餐」中按套餐配置容量），超额按策略限制。" />
                    <Form.Item name="sync_enabled" label="启用云同步" valuePropName="checked"
                      tooltip="关闭后桌面端所有同步请求被拒绝">
                      <Switch />
                    </Form.Item>
                    <Form.Item name="storage_billing_enabled" label="启用容量计费" valuePropName="checked"
                      tooltip="关闭时不限制容量（仅统计用于展示）">
                      <Switch />
                    </Form.Item>
                    <Form.Item name="storage_default_gb" label="注册默认赠送容量（GB）"
                      tooltip="每个用户注册即赠送的基础云存储容量，按 GB 填写（支持小数，如 0.5）。0 表示不赠送。">
                      <InputNumber min={0} step={1} precision={2} style={{ width: 300 }} addonAfter="GB" placeholder="如 1 表示 1GB" />
                    </Form.Item>
                    <Form.Item name="sync_max_blob_mb" label="单文件上限（MB）"
                      tooltip="单个媒体文件允许的最大体积">
                      <InputNumber min={1} max={10240} step={10} style={{ width: 200 }} placeholder="200" />
                    </Form.Item>
                    <Form.Item name="storage_overage_policy" label="超额策略">
                      <Select style={{ width: 320 }}
                        options={[
                          { value: 'readonly', label: '转只读（禁新增/上传，允许下载与删除）' },
                          { value: 'reject', label: '拒绝（直接拒绝写入）' },
                        ]} />
                    </Form.Item>
                  </Card>
                ),
              },
            ]}
          />
        </Form>
      </Spin>

      <Modal
        open={!!previewAgreement}
        title={previewAgreement?.title}
        onCancel={() => setPreviewAgreement(null)}
        footer={<Button onClick={() => setPreviewAgreement(null)}>关闭</Button>}
        width={680}
      >
        <div
          style={{ maxHeight: '60vh', overflowY: 'auto', fontSize: 14, lineHeight: 1.7 }}
          dangerouslySetInnerHTML={{ __html: previewAgreement?.content || '' }}
        />
      </Modal>
    </div>
  );
}
