import { useEffect } from 'react'
import { Alert, Button, Card, Form, InputNumber, Switch, Typography, message } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { packagingLicenseApi } from '@/api/packagingLicense'

const { Title, Paragraph, Text } = Typography

export function PackagingLicenseSettingsPage() {
  const qc = useQueryClient()
  const [form] = Form.useForm()
  const { data, isFetching } = useQuery({
    queryKey: ['settings', 'packaging-license'],
    queryFn: packagingLicenseApi.get,
  })

  useEffect(() => {
    if (!data) return
    form.setFieldsValue(data)
  }, [data, form])

  const saveMut = useMutation({
    mutationFn: packagingLicenseApi.update,
    onSuccess: (saved) => {
      qc.setQueryData(['settings', 'packaging-license'], saved)
      message.success('已保存打包授权定价')
    },
    onError: () => message.error('保存失败'),
  })

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>打包授权定价</Title>
      <Paragraph type="secondary">
        只定「云控端打包授权 / Mac 打包授权」的单价和是否开放自助购买。给某个站开通或关掉，走「云控站点」开关，不在这里审每一笔打包。
      </Paragraph>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="价格为 0 时即使上架开启也不会成交，避免零元刷开通。公开购买页：/admin/buy-packaging"
      />
      <Card loading={isFetching}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ win_price: 0, mac_price: 0, self_serve_enabled: false }}
          onFinish={(values) => saveMut.mutate(values)}
        >
          <Form.Item
            label="云控端打包授权单价（元）"
            name="win_price"
            rules={[{ required: true, type: 'integer', min: 0, message: '请填写不低于 0 的整数' }]}
          >
            <InputNumber min={0} max={100000} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item
            label="Mac 打包授权单价（元）"
            name="mac_price"
            extra="打 Mac 须同时开通 Windows 档。未开通 Windows 时购买页会强制一并购买。"
            rules={[{ required: true, type: 'integer', min: 0, message: '请填写不低于 0 的整数' }]}
          >
            <InputNumber min={0} max={100000} style={{ width: 240 }} />
          </Form.Item>
          <Form.Item label="开放自助购买" name="self_serve_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saveMut.isPending}>
            保存
          </Button>
          <Text type="secondary" style={{ marginLeft: 12 }}>
            未配置时默认单价 0、不上架。
          </Text>
        </Form>
      </Card>
    </div>
  )
}

export default PackagingLicenseSettingsPage
