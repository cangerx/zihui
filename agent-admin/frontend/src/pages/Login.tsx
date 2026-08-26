import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfigProvider, Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { authApi } from '../services/api';
import { setToken, setUser } from '../services/auth';
import { useSiteInfo } from '../contexts/CurrencyContext';

const PRIMARY = '#2f6fed';
const BRAND_ICON = `${import.meta.env.BASE_URL}brand-icon.png`;

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const site = useSiteInfo();

  const brandName = useMemo(() => {
    const t = (site.title || '').trim();
    if (!t || t === 'Agent Admin') return '好伙伴';
    return t;
  }, [site.title]);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const { data } = await authApi.login(values);
      if (data.user?.role !== 'admin') {
        message.error('该账号无权访问管理后台');
        return;
      }
      setToken(data.token);
      setUser(data.user);
      message.success('登录成功');
      navigate('/dashboard');
    } catch (err: any) {
      message.error(err.response?.data?.error || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: PRIMARY,
          borderRadius: 8,
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
        },
      }}
    >
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          color: '#161c2d',
          background:
            'radial-gradient(900px 520px at 85% 18%, rgba(71, 59, 240, 0.38), transparent 55%), #1b202f',
        }}
      >
        <div
          style={{
            width: 400,
            padding: '40px 36px 32px',
            background: '#fff',
            borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.28)',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <img
              src={BRAND_ICON}
              alt=""
              width={48}
              height={48}
              style={{ display: 'block', margin: '0 auto 14px', borderRadius: 10 }}
            />
            <h1
              style={{
                margin: 0,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 0.2,
                color: '#161c2d',
              }}
            >
              {brandName}
            </h1>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 13,
                color: '#6e727d',
                fontWeight: 500,
              }}
            >
              管理后台
            </p>
          </div>

          <Form onFinish={onFinish} size="large" requiredMark={false}>
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 8 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                style={{ height: 42, fontWeight: 600 }}
              >
                登录
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>
    </ConfigProvider>
  );
}
