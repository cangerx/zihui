import { useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography, message } from 'antd';
import { cloudBuildApi } from '../../services/api';

const { Title, Paragraph, Text } = Typography;

export default function CloudBuildGithubSettingsPage() {
  const [form] = Form.useForm();
  const [licensed, setLicensed] = useState(false);
  const [hasToken, setHasToken] = useState(false);

  const load = async () => {
    try {
      const res = await cloudBuildApi.getGithubSettings();
      setLicensed(res.data.can_use_github_packaging === true);
      setHasToken(res.data.has_token === true);
      form.setFieldsValue({
        repo: res.data.repo || '',
        token: '',
      });
    } catch {
      message.error('读取 GitHub 配置失败');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    const values = await form.validateFields(['repo', 'token']);
    try {
      const res = await cloudBuildApi.saveGithubSettings({
        repo: values.repo,
        token: values.token || '',
      });
      setLicensed(res.data.can_use_github_packaging === true);
      setHasToken(res.data.has_token === true);
      form.setFieldsValue({
        repo: res.data.repo || '',
        token: '',
      });
      message.success('已保存');
    } catch (err: any) {
      const code = err.response?.data?.error;
      if (code === 'packaging_not_licensed') {
        message.error('尚未获得打包授权，无法保存 GitHub 配置');
        load();
        return;
      }
      message.error(err.response?.data?.error || '保存失败');
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <Title level={3} style={{ marginTop: 0 }}>云打包 GitHub</Title>
      <Paragraph type="secondary">
        只填构建仓名与 token。Token 加密存储，回显不显示明文。未填 token 时沿用已保存值；都空则回退服务器环境变量。
      </Paragraph>
      {!licensed && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="尚未获得云控端打包授权"
          description="请联系授权平台开通后再配置。"
        />
      )}
      <Card>
        <Form form={form} layout="vertical" disabled={!licensed}>
          <Form.Item
            label="构建仓"
            name="repo"
            rules={[{ required: true, message: '请填写 owner/name' }, { pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, message: '格式应为 owner/name' }]}
          >
            <Input placeholder="owner/name" />
          </Form.Item>
          <Form.Item
            label="GitHub Token"
            name="token"
            extra={hasToken ? '已保存 token，留空表示不修改。' : '未保存 token，将回退环境变量。'}
          >
            <Input.Password placeholder={hasToken ? '已配置（留空不修改）' : 'ghp_ 或 github_pat_'} autoComplete="off" />
          </Form.Item>
          <Button type="primary" onClick={save} disabled={!licensed}>保存</Button>
          <Text type="secondary" style={{ marginLeft: 12 }}>不在此填写 workflow 或回调地址。</Text>
        </Form>
      </Card>
    </div>
  );
}
