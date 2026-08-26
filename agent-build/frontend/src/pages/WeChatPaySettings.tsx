import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Radio,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { wechatPayApi } from '@/api/wechatPay'
import type { WeChatPayUpdatePayload } from '@/api/wechatPay'

const { Title, Text, Paragraph } = Typography

type VerifyMode = 'public_key' | 'platform_cert'

/**
 * 微信收款配置：自助付费开通商城授权的收款商户（全局唯一）。
 *
 * 把已部署云控端的微信商户「明文」凭据录入此处即可（不能直接拷云控端数据库密文，
 * 两边 APP_KEY 不同解不开）。仅实现 Native 扫码，跨站收款无需 JSAPI 支付授权目录。
 */
export function WeChatPaySettingsPage() {
  const qc = useQueryClient()
  const { data: cfg, isFetching } = useQuery({
    queryKey: ['settings', 'wechat-pay'],
    queryFn: wechatPayApi.get,
  })

  const [enabled, setEnabled] = useState(false)
  const [mchid, setMchid] = useState('')
  const [appId, setAppId] = useState('')
  const [certSerial, setCertSerial] = useState('')
  const [apiv3Key, setApiv3Key] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [verifyMode, setVerifyMode] = useState<VerifyMode>('public_key')
  const [pubKeyId, setPubKeyId] = useState('')
  const [pubKey, setPubKey] = useState('')
  const [platformCert, setPlatformCert] = useState('')

  useEffect(() => {
    if (!cfg) return
    setEnabled(cfg.enabled)
    setMchid(cfg.mchid)
    setAppId(cfg.app_id)
    setCertSerial(cfg.cert_serial_no)
    setApiv3Key('') // 密文不回填，留空=不修改
    setPrivateKey('')
    setVerifyMode(cfg.verify_mode)
    setPubKeyId(cfg.pub_key_id)
    setPubKey('') // 公钥/证书也不回填明文
    setPlatformCert('')
  }, [cfg])

  const saveMut = useMutation({
    mutationFn: (payload: WeChatPayUpdatePayload) => wechatPayApi.update(payload),
    onSuccess: () => {
      message.success('微信收款配置已保存')
      setApiv3Key('')
      setPrivateKey('')
      setPubKey('')
      setPlatformCert('')
      qc.invalidateQueries({ queryKey: ['settings', 'wechat-pay'] })
    },
    onError: () => message.error('保存失败，请重试'),
  })

  const testMut = useMutation({
    mutationFn: wechatPayApi.test,
    onSuccess: (r) => {
      if (r.ok) message.success(r.msg)
      else message.error(r.msg)
    },
    onError: () => message.error('测试失败，请检查配置'),
  })

  const save = () => {
    if (!mchid.trim() || !appId.trim() || !certSerial.trim()) {
      message.error('商户号 / AppID / 证书序列号为必填')
      return
    }
    const payload: WeChatPayUpdatePayload = {
      enabled,
      mchid: mchid.trim(),
      app_id: appId.trim(),
      cert_serial_no: certSerial.trim(),
    }
    // 加密字段：留空=不修改
    if (apiv3Key.trim()) payload.apiv3_key = apiv3Key.trim()
    if (privateKey.trim()) payload.private_key = privateKey.trim()
    // 验签材料：按所选模式提交（另一模式清空，避免双配）
    if (verifyMode === 'public_key') {
      payload.pub_key_id = pubKeyId.trim()
      if (pubKey.trim()) payload.pub_key = pubKey.trim()
      payload.platform_cert = ''
    } else {
      payload.pub_key_id = ''
      payload.pub_key = ''
      if (platformCert.trim()) payload.platform_cert = platformCert.trim()
    }
    saveMut.mutate(payload)
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>微信收款配置</Title>
          {isFetching ? null : cfg?.enabled ? <Tag color="green">已启用</Tag> : <Tag color="default">未启用</Tag>}
        </Space>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="用于「自助付费开通商城授权」的收款商户（全局唯一）"
          description={
            <>
              请把你已部署云控端里使用的微信商户「明文」凭据录入此处（不能直接拷云控端数据库密文）。
              仅用 Native 扫码：跨站收款无需 JSAPI 支付授权目录 / H5 支付域名报备，但回调域名须为本站公网 https。
              收款进的是该商户号；与云控端共用同一商户号时，对账 / 退款混在一起，请知悉。
            </>
          }
        />

        <Form layout="vertical" disabled={isFetching || saveMut.isPending}>
          <Form.Item label="启用微信收款">
            <Switch checked={enabled} onChange={setEnabled} checkedChildren="开" unCheckedChildren="关" />
          </Form.Item>

          <Form.Item label="商户号 mchid" required>
            <Input value={mchid} onChange={(e) => setMchid(e.target.value)} placeholder="1900000000" maxLength={64} />
          </Form.Item>

          <Form.Item label="AppID（与商户号已绑定的公众号 / 小程序 / APP）" required>
            <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="wx1234567890abcdef" maxLength={64} />
          </Form.Item>

          <Form.Item label="商户 API 证书序列号" required>
            <Input value={certSerial} onChange={(e) => setCertSerial(e.target.value)} placeholder="证书序列号（大写十六进制）" maxLength={128} />
          </Form.Item>

          <Form.Item
            label="APIv3 密钥"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{cfg?.has_apiv3_key ? '已配置，留空则保持不变' : '32 位 APIv3 密钥'}</Text>}
          >
            <Input.Password value={apiv3Key} onChange={(e) => setApiv3Key(e.target.value)} placeholder={cfg?.has_apiv3_key ? '留空不修改' : '请输入 APIv3 密钥'} autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            label="商户私钥（PEM）"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{cfg?.has_private_key ? '已配置，留空则保持不变' : '-----BEGIN PRIVATE KEY----- 开头的完整 PEM'}</Text>}
          >
            <Input.TextArea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder={cfg?.has_private_key ? '留空不修改' : '-----BEGIN PRIVATE KEY-----\n...'}
              rows={4}
              autoComplete="off"
            />
          </Form.Item>

          <Form.Item label="回调验签材料">
            <Radio.Group value={verifyMode} onChange={(e) => setVerifyMode(e.target.value)} optionType="button">
              <Radio value="public_key">公钥模式（推荐，免轮换）</Radio>
              <Radio value="platform_cert">平台证书模式</Radio>
            </Radio.Group>
          </Form.Item>

          {verifyMode === 'public_key' ? (
            <>
              <Form.Item label="微信支付公钥 ID">
                <Input value={pubKeyId} onChange={(e) => setPubKeyId(e.target.value)} placeholder="PUB_KEY_ID_xxxxxxxx" maxLength={128} />
              </Form.Item>
              <Form.Item
                label="微信支付公钥（PEM）"
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{cfg?.has_pub_key ? '已配置，留空则保持不变' : '-----BEGIN PUBLIC KEY----- 开头'}</Text>}
              >
                <Input.TextArea value={pubKey} onChange={(e) => setPubKey(e.target.value)} placeholder={cfg?.has_pub_key ? '留空不修改' : '-----BEGIN PUBLIC KEY-----\n...'} rows={4} />
              </Form.Item>
            </>
          ) : (
            <Form.Item
              label="微信平台证书（PEM）"
              extra={<Text type="secondary" style={{ fontSize: 12 }}>{cfg?.has_platform_cert ? '已配置，留空则保持不变' : '-----BEGIN CERTIFICATE----- 开头（每 12 个月需更换）'}</Text>}
            >
              <Input.TextArea value={platformCert} onChange={(e) => setPlatformCert(e.target.value)} placeholder={cfg?.has_platform_cert ? '留空不修改' : '-----BEGIN CERTIFICATE-----\n...'} rows={4} />
            </Form.Item>
          )}

          <Space>
            <Button type="primary" onClick={save} loading={saveMut.isPending}>保存</Button>
            <Button onClick={() => testMut.mutate()} loading={testMut.isPending}>测试连通</Button>
          </Space>
        </Form>
      </Card>

      <Card size="small">
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          本商户同时用于以下两个公开收款页（均免登录、微信 Native 扫码；回调地址须本站公网 https 可达，微信下单时动态传入，无需在商户平台报备支付目录）：
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 4 }}>
          · 商城授权自助页：<Text code>/admin/buy</Text> —— 回调 <Text code>/api/self-serve/mall-auth/notify</Text>（用户输入域名后扫码付费开通）
          · 打包授权自助页：<Text code>/admin/buy-packaging</Text> —— 回调 <Text code>/api/self-serve/packaging/notify</Text>
        </Paragraph>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          · 开源交付页：<Text code>/admin/opensource</Text> —— 回调 <Text code>/api/open-source/notify</Text>（填写购买人信息后扫码付费，先锋开源 ¥500）
        </Paragraph>
      </Card>
    </Space>
  )
}

export default WeChatPaySettingsPage
