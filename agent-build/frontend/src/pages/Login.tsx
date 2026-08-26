import { useState } from 'react'
import { Card, Form, Input, Button, Typography } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import { authApi } from '@/api/auth'
import { authStore } from '@/store/auth'

const { Title, Text } = Typography

interface LoginForm {
  username: string
  password: string
}

interface LocationState {
  from?: string
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: LoginForm) => {
    setLoading(true)
    try {
      const data = await authApi.login(values.username, values.password)
      authStore.set(data.token, data.user)
      const state = location.state as LocationState | null
      navigate(state?.from || '/', { replace: true })
    } catch {
      // 错误已在 axios 拦截器统一提示
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login">
      <Card className="admin-login__card" styles={{ body: { padding: '32px 28px' } }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div
            style={{
              display: 'inline-flex',
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 12,
              borderRadius: 8,
              background: '#2f6fed',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            授
          </div>
          <Title level={4} style={{ margin: 0, color: '#1a2030' }}>
            授权管理后台
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            管理已授权的云控端
          </Text>
        </div>
        <Form<LoginForm>
          layout="vertical"
          onFinish={onFinish}
          size="large"
          requiredMark={false}
          initialValues={{ username: '', password: '' }}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input autoComplete="username" placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            label="密码"
            name="password"
            rules={[{ required: true, message: '请输入密码' }, { min: 6, message: '至少 6 位' }]}
          >
            <Input.Password autoComplete="current-password" placeholder="" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, marginTop: 8 }}>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
