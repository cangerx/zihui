import { useState } from 'react';
import { Card, Form, Input, Button, message } from 'antd';
import { authApi } from '../services/api';

export default function ChangePassword() {
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const onFinish = async (values: { old_password: string; new_password: string; confirm: string }) => {
    if (values.new_password !== values.confirm) {
      message.error('两次密码不一致');
      return;
    }
    setLoading(true);
    try {
      await authApi.changePassword({ old_password: values.old_password, new_password: values.new_password });
      message.success('密码已修改');
      form.resetFields();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 400 }}>
      <h2 style={{ marginBottom: 24 }}>修改密码</h2>
      <Card>
        <Form form={form} onFinish={onFinish} layout="vertical">
          <Form.Item name="old_password" label="当前密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="new_password" label="新密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="confirm" label="确认密码" rules={[{ required: true }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading}>修改密码</Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
