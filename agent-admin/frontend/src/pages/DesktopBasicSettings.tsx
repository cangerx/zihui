import { useEffect, useState } from 'react';
import { Card, Form, Input, Button, message, Spin, Alert, Space, Upload, ColorPicker, Tabs, Switch } from 'antd';
import { SaveOutlined, ReloadOutlined, UploadOutlined, DeleteOutlined } from '@ant-design/icons';
import { settingApi, cloudBuildApi } from '../services/api';
import TtsProviders from './TtsProviders';

/**
 * 桌面端基础设置（多 tab）
 *
 * 集中承载「下发到 / 服务于桌面端」的站点级配置：
 *  - 桌面端外观：登录页背景图 + 全局主题主色（随 /public/site-config 下发）
 *  - AI PPT 配图：Pixabay 图库（deck 配图三级第一级；key 加密留服务端）
 *  - 解说 TTS：语音合成供应商（key 留服务端，按字符计费）
 * 都属于「桌面端相关、非云控端自身」的设置，归到此页统一管理。
 */

// ---------------- tab 1：桌面端外观 ----------------
function AppearanceSettings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bgUploading, setBgUploading] = useState(false);
  const [botBgUploading, setBotBgUploading] = useState(false);
  const loginBgUrl = Form.useWatch('login_background_url', form);
  const botListBgUrl = Form.useWatch('bot_list_background_url', form);

  const load = async () => {
    setLoading(true);
    try {
      const res = await settingApi.get();
      const s = res.data.settings || {};
      form.setFieldsValue({
        login_background_url: s.login_background_url || '',
        bot_list_background_url: s.bot_list_background_url || '',
        theme_primary_color: s.theme_primary_color || '#F27638',
      });
    } catch {
      message.error('加载失败');
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      // 只提交本 tab 负责的字段，后端按白名单部分更新，不影响其他系统设置
      await settingApi.update({
        login_background_url: values.login_background_url || '',
        bot_list_background_url: values.bot_list_background_url || '',
        theme_primary_color: values.theme_primary_color || '',
      });
      message.success('已保存，桌面端下次启动或刷新生效');
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
    setSaving(false);
  };

  return (
    <Spin spinning={loading}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} disabled={loading}>刷新</Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
      </div>
      <Form form={form} layout="vertical" style={{ maxWidth: 880 }}>
        <Card title="桌面端外观" size="small">
          <Alert
            type="info"
            showIcon
            message="此处配置会下发到桌面端登录页，影响最终用户看到的外观，而非云控端后台自身的样式。修改后桌面端下次启动或刷新生效。"
            style={{ marginBottom: 16 }}
          />
          <Form.Item
            label="登录页背景图"
            tooltip="桌面端登录页全屏背景（cover 自适应任意窗口尺寸）。支持 PNG / JPG / WebP，≤ 5 MB；建议横向大图（如 1920×1080），重要内容居中。留空则用内置品牌橙背景。上传后需点顶部「保存」生效。"
          >
            <Space direction="vertical" size={8}>
              {loginBgUrl ? (
                <img
                  src={loginBgUrl}
                  alt="登录页背景预览"
                  style={{ width: 320, height: 160, objectFit: 'cover', borderRadius: 8, border: '1px solid #f0f0f0' }}
                />
              ) : null}
              <Space>
                <Upload
                  accept="image/png,image/jpeg,image/webp"
                  showUploadList={false}
                  beforeUpload={async (file) => {
                    setBgUploading(true);
                    try {
                      const res = await cloudBuildApi.uploadLoginBackground(file);
                      form.setFieldValue('login_background_url', res.data.image_url);
                      message.success('背景图已上传，点「保存」后生效');
                    } catch (err: any) {
                      message.error(err.response?.data?.error || '上传失败');
                    }
                    setBgUploading(false);
                    return false; // 阻止 antd 默认上传，改由 cloudBuildApi 处理
                  }}
                >
                  <Button icon={<UploadOutlined />} loading={bgUploading}>
                    {loginBgUrl ? '更换背景图' : '上传背景图'}
                  </Button>
                </Upload>
                {loginBgUrl ? (
                  <Button danger icon={<DeleteOutlined />} onClick={() => form.setFieldValue('login_background_url', '')}>
                    移除
                  </Button>
                ) : null}
              </Space>
            </Space>
          </Form.Item>
          {/* login_background_url 实际值用隐藏字段持有，上方 UI 通过 setFieldValue 写入 */}
          <Form.Item name="login_background_url" hidden>
            <Input />
          </Form.Item>

          <Form.Item
            label="数字员工列表页背景图"
            tooltip="桌面端「数字员工」页（启动首页）的整页背景（cover 自适应任意窗口尺寸）。支持 PNG / JPG / WebP，≤ 5 MB；建议横向大图（如 1920×1080），避免高对比花纹影响卡片可读性。留空则用默认纯色背景。上传后需点顶部「保存」生效。"
          >
            <Space direction="vertical" size={8}>
              {botListBgUrl ? (
                <img
                  src={botListBgUrl}
                  alt="数字员工列表页背景预览"
                  style={{ width: 320, height: 160, objectFit: 'cover', borderRadius: 8, border: '1px solid #f0f0f0' }}
                />
              ) : null}
              <Space>
                <Upload
                  accept="image/png,image/jpeg,image/webp"
                  showUploadList={false}
                  beforeUpload={async (file) => {
                    setBotBgUploading(true);
                    try {
                      const res = await cloudBuildApi.uploadBotListBackground(file);
                      form.setFieldValue('bot_list_background_url', res.data.image_url);
                      message.success('背景图已上传，点「保存」后生效');
                    } catch (err: any) {
                      message.error(err.response?.data?.error || '上传失败');
                    }
                    setBotBgUploading(false);
                    return false; // 阻止 antd 默认上传，改由 cloudBuildApi 处理
                  }}
                >
                  <Button icon={<UploadOutlined />} loading={botBgUploading}>
                    {botListBgUrl ? '更换背景图' : '上传背景图'}
                  </Button>
                </Upload>
                {botListBgUrl ? (
                  <Button danger icon={<DeleteOutlined />} onClick={() => form.setFieldValue('bot_list_background_url', '')}>
                    移除
                  </Button>
                ) : null}
              </Space>
            </Space>
          </Form.Item>
          {/* bot_list_background_url 实际值用隐藏字段持有 */}
          <Form.Item name="bot_list_background_url" hidden>
            <Input />
          </Form.Item>

          <Form.Item
            name="theme_primary_color"
            label="主题主色"
            tooltip="桌面端全局主色调。系统会据此自动派生整套深浅色阶（按钮、链接、选中态等）。保存后桌面端启动或刷新即换肤。"
            getValueFromEvent={(color) => (color ? color.toHexString() : '')}
          >
            <ColorPicker
              format="hex"
              showText
              disabledAlpha
              presets={[{ label: '常用', colors: ['#F27638', '#1677ff', '#52c41a', '#722ed1', '#eb2f96', '#fa541c', '#13c2c2', '#2f54eb'] }]}
            />
          </Form.Item>
        </Card>
      </Form>
    </Spin>
  );
}

// ---------------- tab 2：AI PPT 配图（Pixabay） ----------------
function PixabaySettings() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const enabled = Form.useWatch('pixabay_enabled', form);

  const load = async () => {
    setLoading(true);
    try {
      const res = await settingApi.get();
      const s = res.data.settings || {};
      setHasKey(!!s.has_pixabay_api_key);
      form.setFieldsValue({ pixabay_enabled: !!s.pixabay_enabled, pixabay_api_key: '' });
    } catch {
      message.error('加载失败');
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      // pixabay_api_key 为加密字段，留空则不提交（保持原值），仅 pixabay_enabled 总提交
      const payload: Record<string, any> = { pixabay_enabled: !!v.pixabay_enabled };
      if (v.pixabay_api_key) payload.pixabay_api_key = v.pixabay_api_key;
      await settingApi.update(payload);
      message.success('已保存');
      load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
    setSaving(false);
  };

  return (
    <Spin spinning={loading}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} disabled={loading}>刷新</Button>
        <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
      </div>
      <Form form={form} layout="vertical" style={{ maxWidth: 880 }}>
        <Card title="Pixabay 图片搜索" size="small">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="AI PPT（deck）配图三级中的第一级：真实素材图。桌面端做 PPT 取配图时优先经服务端代调 Pixabay，拿不到再降级到 AI 生图、最后自绘装饰图。API Key 加密存储、仅服务端使用，绝不下发客户端。Key 免费获取：pixabay.com/api/docs。"
          />
          <Form.Item
            name="pixabay_enabled"
            label="启用 Pixabay 配图"
            valuePropName="checked"
            tooltip="总开关。关闭后 deck 配图直接走 AI 生图 / 自绘装饰图"
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="pixabay_api_key"
            label="API Key"
            tooltip="Pixabay 开放平台的 API Key（加密存储）"
            extra={hasKey ? '已配置。留空则不修改；填写新值则覆盖。' : '尚未配置'}
          >
            <Input.Password
              placeholder={hasKey ? '已配置，留空则不修改' : '填入 Pixabay API Key'}
              autoComplete="new-password"
              disabled={!enabled}
            />
          </Form.Item>
        </Card>
      </Form>
    </Spin>
  );
}

export default function DesktopBasicSettings() {
  return (
    <Tabs
      defaultActiveKey="appearance"
      items={[
        { key: 'appearance', label: '桌面端外观', children: <AppearanceSettings /> },
        // AI PPT 配图暂时下线；解说 TTS 仍是桌面口播的有效配置入口。
        { key: 'pixabay', label: 'AI PPT 配图', children: <PixabaySettings /> },
        { key: 'tts', label: '解说 TTS', children: <TtsProviders /> },
      ].filter((t) => t.key !== 'pixabay')}
    />
  );
}
