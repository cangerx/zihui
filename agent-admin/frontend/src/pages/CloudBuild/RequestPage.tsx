import { useEffect, useState } from 'react';
import {
  Card, Form, Input, Select, Button, message, Typography, Alert, Space, Tag, Spin,
  Upload, Image, Modal,
} from 'antd';
import type { UploadProps } from 'antd/es/upload';
import { CloudUploadOutlined, RocketOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { cloudBuildApi } from '../../services/api';
import {
  CLOUD_BUILD_ICON_RULE_TEXT,
  getCloudBuildIconUploadErrorMessage,
  validateCloudBuildIcon,
} from '../../utils/cloudBuildIcon';

const { Title, Paragraph, Text } = Typography;

interface TemplateInfo {
  current_version?: string;
  changelog?: string;
  released_at?: string;
}

interface AuthCheckResult {
  authorized: boolean;
  reason?: string;
  message?: string;
  client_id?: string;
  domain?: string;
  origin?: string;
  daily_limit?: number;
  daily_used?: number;
  daily_remaining?: number;
  monthly_limit?: number;
  expires_at?: string | null;
  /** 打包平台侧的「云打包维护开关」，为 true 时禁止提交新任务 */
  maintenance?: boolean;
  maintenance_message?: string | null;
  /** 打包平台要求的云控端最低版本，null 表示不限制 */
  min_admin_version?: string | null;
  /** 由 agent-build 按 X-Admin-Version 头派生：当前云控端版本号 */
  current_admin_version?: string | null;
  /** 云控端版本是否低于 min_admin_version（由 agent-build 计算后下发，前端直接消费） */
  admin_version_too_low?: boolean;
  can_use_github_packaging?: boolean;
  can_use_mac_packaging?: boolean;
}

const DEFAULT_MAINTENANCE_TEXT = '云打包更新维护中，暂停打包，请稍后刷新查看。';

export default function CloudBuildRequestPage() {
  const [form] = Form.useForm();
  const [customerServiceForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [tplLoading, setTplLoading] = useState(false);
  const [tpl, setTpl] = useState<TemplateInfo | null>(null);
  const [tplError, setTplError] = useState<string | null>(null);
  const [iconUploading, setIconUploading] = useState(false);
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const [iconMeta, setIconMeta] = useState<{ width: number; height: number; bytes: number } | null>(null);
  const [customerServiceOpen, setCustomerServiceOpen] = useState(false);
  const [customerServiceImageUrl, setCustomerServiceImageUrl] = useState<string | null>(null);
  const [customerServiceUploading, setCustomerServiceUploading] = useState(false);
  const [customerServiceSaving, setCustomerServiceSaving] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [auth, setAuth] = useState<AuthCheckResult | null>(null);
  const watchedAppName = Form.useWatch('app_name', form) || '';
  const navigate = useNavigate();

  const loadTemplate = async () => {
    setTplLoading(true);
    setTplError(null);
    try {
      const res = await cloudBuildApi.templateInfo();
      setTpl(res.data);
    } catch (err: any) {
      setTplError(err.response?.data?.error || '获取模板版本失败');
    }
    setTplLoading(false);
  };

  const loadAuth = async () => {
    setAuthLoading(true);
    try {
      const res = await cloudBuildApi.authCheck();
      setAuth(res.data);
    } catch (err: any) {
      setAuth({
        authorized: false,
        reason: 'request_failed',
        message: err.response?.data?.message || err.message || '授权预检请求失败',
      });
    }
    setAuthLoading(false);
  };

  useEffect(() => {
    (async () => {
      // 先加载上次保存的应用名 + 图标（该站点多个管理员共享同一份配置）
      cloudBuildApi.getProfile().then(res => {
        const p = res.data || {};
        if (p.app_name) form.setFieldValue('app_name', p.app_name);
        if (p.icon_url) {
          form.setFieldValue('icon_url', p.icon_url);
          setIconUrl(p.icon_url);
        }
        customerServiceForm.setFieldsValue({
          customer_service_title: p.customer_service_title || '',
          customer_service_image_url: p.customer_service_image_url || '',
        });
        setCustomerServiceImageUrl(p.customer_service_image_url || null);
      }).catch(() => { /* 首次进页没保存过是正常的，忽略即可 */ });
      await loadAuth();
      // 已授权时再拉模板信息；未授权时模板信息也拉不到（同样需要 hmac+domain）
      loadTemplate();
    })();
  }, []);

  const authorized = auth?.authorized === true;
  const packagingLicensed = auth?.can_use_github_packaging === true;
  const macLicensed = auth?.can_use_mac_packaging === true;
  const maintenance = authorized && auth?.maintenance === true;
  const maintenanceText = (auth?.maintenance_message && auth.maintenance_message.trim()) || DEFAULT_MAINTENANCE_TEXT;
  const adminVersionTooLow = authorized && auth?.admin_version_too_low === true;
  const minAdminVersion = (auth?.min_admin_version || '').trim();
  const currentAdminVersion = (auth?.current_admin_version || '').trim();

  const uploadProps: UploadProps = {
    name: 'icon',
    listType: 'picture-card',
    accept: 'image/png',
    showUploadList: false,
    maxCount: 1,
    beforeUpload: async (file) => {
      const result = await validateCloudBuildIcon(file);
      if (result !== true) {
        message.error(result);
        return Upload.LIST_IGNORE;
      }
      return true;
    },
    customRequest: async ({ file, onSuccess, onError }) => {
      setIconUploading(true);
      try {
        const res = await cloudBuildApi.uploadIcon(file as File);
        setIconUrl(res.data.icon_url);
        setIconMeta({
          width: res.data.width,
          height: res.data.height,
          bytes: res.data.bytes,
        });
        form.setFieldValue('icon_url', res.data.icon_url);
        form.validateFields(['icon_url']).catch(() => {});
        // 持久化到 system_settings，下次进入页面自动回填
        cloudBuildApi.saveProfile({ icon_url: res.data.icon_url }).catch(() => {});
        message.success('图标上传成功');
        onSuccess?.(res.data);
      } catch (err: any) {
        message.error(getCloudBuildIconUploadErrorMessage(err));
        onError?.(err);
      }
      setIconUploading(false);
    },
  };

  const removeIcon = () => {
    setIconUrl(null);
    setIconMeta(null);
    form.setFieldValue('icon_url', undefined);
    cloudBuildApi.saveProfile({ icon_url: '' }).catch(() => {});
  };

  const uploadCustomerServiceImage = async (file: File) => {
    setCustomerServiceUploading(true);
    try {
      const res = await cloudBuildApi.uploadCustomerServiceImage(file);
      const imageUrl = res.data.image_url;
      setCustomerServiceImageUrl(imageUrl);
      customerServiceForm.setFieldValue('customer_service_image_url', imageUrl);
      message.success('客服图片上传成功');
    } catch (err: any) {
      message.error(err.response?.data?.error || '客服图片上传失败');
    }
    setCustomerServiceUploading(false);
    return Upload.LIST_IGNORE;
  };

  const openCustomerService = () => {
    setCustomerServiceOpen(true);
  };

  const saveCustomerService = async () => {
    const values = await customerServiceForm.validateFields();
    setCustomerServiceSaving(true);
    try {
      await cloudBuildApi.saveProfile({
        customer_service_title: values.customer_service_title || '',
        customer_service_image_url: values.customer_service_image_url || '',
      });
      message.success('客服信息已保存');
      setCustomerServiceOpen(false);
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
    setCustomerServiceSaving(false);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const res = await cloudBuildApi.request({
        app_name: values.app_name,
        platform: values.platform,
        icon_url: values.icon_url,
      });
      message.success(`已加入打包队列: ${res.data.build_id}`);
      navigate('/cloud-build/history', { state: { highlight_build_id: res.data.build_id } });
    } catch (err: any) {
      const detail = err.response?.data;
      if (detail?.error === 'agent_build_rejected') {
        const inner = detail.agent_build_response;
        const code = inner?.error_code;
        if (code === 'maintenance_mode') {
          message.error(inner?.error || '云打包平台维护中，暂停打包');
          loadAuth();
        } else if (code === 'admin_version_too_low') {
          message.error(inner?.error || '云控端版本过低，请先升级');
          loadAuth();
        } else if (inner?.error === 'quota_exceeded') {
          message.error(`今日打包配额已用完 (${inner.daily_used}/${inner.daily_limit})`);
        } else if (inner?.error === 'client_busy') {
          message.error(`你有进行中的任务: ${inner.build_id} (${inner.status})`);
        } else if (inner?.error === 'packaging_not_licensed' || inner?.error === 'packaging_mac_not_licensed') {
          message.error('尚未获得打包授权，请联系授权平台开通');
          loadAuth();
        } else {
          message.error(`agent-build 拒绝: ${inner?.error || JSON.stringify(inner)}`);
        }
      } else if (detail?.error === 'packaging_not_licensed' || detail?.error === 'packaging_mac_not_licensed') {
        message.error('尚未获得打包授权，请联系授权平台开通');
        loadAuth();
      } else {
        message.error(detail?.message || detail?.error || '提交失败');
      }
    }
    setSubmitting(false);
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0 }}>
          <RocketOutlined /> 一键云打包
        </Title>
        <Button onClick={openCustomerService}>客服信息</Button>
      </div>

      {authLoading ? (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space><Spin size="small" /> <Text type="secondary">正在校验本站打包授权…</Text></Space>
        </Card>
      ) : !authorized ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="本站尚未获得打包平台授权"
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div>{auth?.message || '未知原因，请联系打包平台管理员。'}</div>
              {auth?.origin && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    本站发起请求的域名是 <Tag color="red">{auth.origin}</Tag>，未在打包平台授权列表中。
                  </Text>
                </div>
              )}
              {auth?.reason && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>错误代码：<code>{auth.reason}</code></Text>
                </div>
              )}
              <div>
                <Button size="small" icon={<ReloadOutlined />} onClick={loadAuth}>重新检测</Button>
              </div>
            </Space>
          }
        />
      ) : (
        <Card
          size="small"
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <Tag color="green">已授权</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{auth?.domain}</Text>
              {typeof auth?.daily_limit === 'number' && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  · 今日配额 {auth?.daily_used ?? 0}/{auth?.daily_limit}
                </Text>
              )}
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={loadTemplate} loading={tplLoading} />
            </Space>
          }
        >
          {tplLoading ? <Spin size="small" /> : tplError ? (
            <Alert type="error" showIcon message={tplError} description="可能 agent-build 后端不可达或客户端凭据未配置。" />
          ) : tpl ? (
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <div><Text type="secondary">模板版本：</Text><Tag color="blue">{tpl.current_version || '0.0.0'}</Tag></div>
              {tpl.released_at && <div><Text type="secondary">released_at：</Text><Text>{tpl.released_at}</Text></div>}
              {tpl.changelog && <Paragraph type="secondary" style={{ marginBottom: 0, whiteSpace: 'pre-line' }}>{tpl.changelog}</Paragraph>}
            </Space>
          ) : null}
        </Card>
      )}

      {maintenance && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="云打包平台维护中"
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div>{maintenanceText}</div>
              <div>
                <Button size="small" icon={<ReloadOutlined />} onClick={loadAuth}>重新检测</Button>
              </div>
            </Space>
          }
        />
      )}

      {!maintenance && adminVersionTooLow && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="云控端版本过低，已被打包平台限制"
          description={
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <div>
                打包平台要求的最低云控端版本为
                <Tag color="blue" style={{ marginLeft: 4, marginRight: 4 }}>{minAdminVersion || '?'}</Tag>
                ，当前云控端版本为
                <Tag color="red" style={{ marginLeft: 4 }}>{currentAdminVersion || '未知'}</Tag>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  请先在管理后台「在线更新」升级云控端到 {minAdminVersion || '最新版'} 或更高版本，再回到本页申请打包。
                </Text>
              </div>
              <div>
                <Button size="small" icon={<ReloadOutlined />} onClick={loadAuth}>重新检测</Button>
              </div>
            </Space>
          }
        />
      )}

      {authorized && !packagingLicensed && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="尚未获得云控端打包授权"
          description="请联系授权平台开通「云控端打包授权」后再提交打包或配置 GitHub。"
        />
      )}

      <Card>
        <Form form={form} layout="vertical" disabled={submitting || !authorized || !packagingLicensed}>
          <Form.Item
            label="应用名称"
            name="app_name"
            rules={[
              { required: true, message: '请输入应用名称' },
              { max: 50, message: '不超过 50 个字' },
            ]}
            extra={
              <>
                将作为安装包标题、桌面快捷方式和开始菜单项的显示名
                <br />
                名称不可以含有空格和特殊符号
              </>
            }
          >
            <Input
              placeholder="例如：我的数字员工"
              allowClear
              onBlur={() => {
                const v = form.getFieldValue('app_name');
                cloudBuildApi.saveProfile({ app_name: v ?? '' }).catch(() => {});
              }}
            />
          </Form.Item>

          <Form.Item
            label="应用图标"
            name="icon_url"
            rules={[{ required: true, message: '请上传应用图标' }]}
            extra={`${CLOUD_BUILD_ICON_RULE_TEXT}。将用于生成 Windows / macOS 安装包的程序图标。`}
          >
            <Space align="start" size="large">
              <Upload {...uploadProps}>
                {iconUrl ? (
                  <Image
                    src={iconUrl}
                    alt="应用图标"
                    width={96}
                    height={96}
                    preview={false}
                    style={{ objectFit: 'contain', borderRadius: 4 }}
                  />
                ) : iconUploading ? (
                  <Spin />
                ) : (
                  <div>
                    <PlusOutlined />
                    <div style={{ marginTop: 8, fontSize: 12 }}>选择 PNG</div>
                  </div>
                )}
              </Upload>
              {iconUrl && iconMeta && (
                <Space direction="vertical" size={4}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {iconMeta.width} x {iconMeta.height}，{(iconMeta.bytes / 1024).toFixed(1)} KB
                  </Text>
                  <Button size="small" type="link" danger onClick={removeIcon}>
                    重新选择
                  </Button>
                </Space>
              )}
            </Space>
          </Form.Item>

          <Form.Item
            label="目标平台"
            name="platform"
            rules={[{ required: true, message: '请选择平台' }]}
            initialValue="win"
          >
            <Select>
              <Select.Option value="win">Windows (.exe)</Select.Option>
              <Select.Option value="mac" disabled={!macLicensed}>macOS (.zip){!macLicensed ? '（未开通 Mac 授权）' : ''}</Select.Option>
            </Select>
          </Form.Item>

          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="说明"
            description="提交后任务进入排队，由 GitHub Actions 后台打包，约 5 分钟完成。完成后系统会自动拉取产物到本地 /public/updates/，桌面端的「在线更新」即可识别新版本。"
          />

          <Button
            type="primary"
            size="large"
            icon={<CloudUploadOutlined />}
            onClick={submit}
            loading={submitting}
            disabled={!authorized || !packagingLicensed || maintenance || adminVersionTooLow || !watchedAppName || !iconUrl}
            block
          >
            {!authorized
              ? '本站未获授权，无法提交'
              : !packagingLicensed
                ? '未获打包授权，无法提交'
                : maintenance
                ? '平台维护中，暂停提交'
                : adminVersionTooLow
                  ? `云控端版本过低，请先升级到 ${minAdminVersion || '最新版'}`
                  : !watchedAppName
                    ? '请填写应用名称'
                    : !iconUrl
                      ? '请上传应用图标'
                      : '提交打包'}
          </Button>
        </Form>
      </Card>

      <Modal
        title="客服信息"
        open={customerServiceOpen}
        onCancel={() => setCustomerServiceOpen(false)}
        onOk={saveCustomerService}
        confirmLoading={customerServiceSaving}
        width={520}
        destroyOnClose
        mask={false}
      >
        <Form form={customerServiceForm} layout="vertical">
          <Form.Item label="标题" name="customer_service_title" rules={[{ max: 50, message: '不超过 50 个字' }]}>
            <Input placeholder="例如：联系客服" allowClear />
          </Form.Item>
          <Form.Item label="图片 URL" name="customer_service_image_url" rules={[{ type: 'url', message: '请输入有效 URL' }]}>
            <Input
              allowClear
              onChange={(e) => setCustomerServiceImageUrl(e.target.value || null)}
              addonAfter={
                <Upload showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(file) => uploadCustomerServiceImage(file)}>
                  <Button size="small" loading={customerServiceUploading}>上传</Button>
                </Upload>
              }
            />
          </Form.Item>
          {customerServiceImageUrl && (
            <Image src={customerServiceImageUrl} alt="客服信息" width="100%" style={{ borderRadius: 8 }} />
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            标题和图片都填写后，桌面端用户中心才会显示客服信息卡片；清空任一项则不显示。
          </Text>
        </Form>
      </Modal>
    </div>
  );
}
