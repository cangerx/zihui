import { useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Modal, QRCode, message } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { openSourceApi } from '@/api/openSource'
import type { OpenSourceBuyer, OpenSourceOrder } from '@/api/openSource'

/**
 * 开源交付（公开页，免登录）。
 * 展示「先锋开源 / 免费开源」两档与对比，先锋档填写购买人信息 → 微信扫码付款 → 人工交付。
 * 克制的中性配色，贴合后台风格，避免花哨 / AI 感；不使用 emoji。
 */

const C = {
  text: '#1f2329',
  sub: '#616872',
  faint: '#98a0aa',
  line: '#e8ebef',
  brand: '#3358ff',
  ok: '#2f9e44',
  bg: '#f5f6f8',
  cardBg: '#ffffff',
  softBrand: '#f4f6ff',
}

/** 一行对比。included 决定「免费档」单元格是否走弱化样式。 */
interface CmpRow {
  key: string
  label: string
  pioneer: string
  free: string
  freeMuted?: boolean
}

const CMP_ROWS: CmpRow[] = [
  { key: 'start', label: '交付起始', pioneer: '即刻交付（7 月 13 日起）', free: '8 月底一次性' },
  {
    key: 'desktop',
    label: '桌面端源码',
    pioneer: '当前最新版 + 未来所有版本',
    free: '仅 8 月底一版（一次性）',
  },
  { key: 'admin', label: '云控端源码', pioneer: '包含（当前 + 未来所有版本）', free: '不在交付范围', freeMuted: true },
  { key: 'auth', label: '授权管理端源码', pioneer: '包含（当前 + 未来所有版本）', free: '不在交付范围', freeMuted: true },
  { key: 'future', label: '未来版本持续交付', pioneer: '包含，长期更新', free: '仅一次，不含后续', freeMuted: true },
  { key: 'group', label: '开源交流群', pioneer: '可加入', free: '不提供', freeMuted: true },
  { key: 'docs', label: '全部开发规则与规范文档', pioneer: '完整交付', free: '不提供', freeMuted: true },
  { key: 'license', label: '授权方式', pioneer: '已授权用户可购买；可自行无限登记授权', free: '仅限原购买时授权的域名使用' },
  { key: 'price', label: '价格', pioneer: '¥500', free: '免费' },
]

type BuyStage = 'form' | 'paying'

export function OpenSourceDeliveryPage() {
  const [modalOpen, setModalOpen] = useState(false)
  const [stage, setStage] = useState<BuyStage>('form')
  const [order, setOrder] = useState<OpenSourceOrder | null>(null)
  const [paidDone, setPaidDone] = useState(false)
  const [form] = Form.useForm<OpenSourceBuyer>()

  const { data: config } = useQuery({
    queryKey: ['open-source-config'],
    queryFn: () => openSourceApi.config(),
    staleTime: 60_000,
  })
  const price = config?.tiers?.pioneer?.price ?? 500

  const orderMut = useMutation({
    mutationFn: (buyer: OpenSourceBuyer) => openSourceApi.createOrder(buyer),
    onSuccess: (res) => {
      setOrder(res)
      setStage('paying')
      setPaidDone(false)
    },
    onError: () => {
      // 具体错误已由 http 拦截器以 message 弹出
    },
  })

  const { data: polled } = useQuery({
    queryKey: ['open-source-order', order?.order_no],
    queryFn: () => openSourceApi.getOrder(order!.order_no),
    enabled: !!order && order.status === 'pending' && !paidDone,
    refetchInterval: 3000,
  })

  useEffect(() => {
    if (!polled) return
    if (polled.status === 'paid') {
      setPaidDone(true)
      setOrder(null)
      message.success('支付成功')
    } else if (polled.status === 'expired' || polled.status === 'closed') {
      message.warning('二维码已过期，请重新发起支付')
      setOrder(null)
      setStage('form')
    }
  }, [polled])

  const openBuy = () => {
    setModalOpen(true)
    setStage('form')
    setOrder(null)
    setPaidDone(false)
    form.resetFields()
  }

  const closeBuy = () => {
    setModalOpen(false)
    setOrder(null)
    setPaidDone(false)
    setStage('form')
  }

  const submitForm = () => {
    form.validateFields().then((vals) => {
      const buyer: OpenSourceBuyer = {
        buyer_name: vals.buyer_name.trim(),
        buyer_phone: vals.buyer_phone.trim(),
        buyer_wechat: vals.buyer_wechat.trim(),
        buyer_email: vals.buyer_email.trim(),
        buyer_domain: vals.buyer_domain.trim(),
      }
      orderMut.mutate(buyer)
    })
  }

  const modalTitle = useMemo(() => {
    if (paidDone) return '支付成功'
    return stage === 'paying' ? '微信扫码支付' : '先锋开源 · 购买信息'
  }, [stage, paidDone])

  return (
    <div style={{ minHeight: '100vh', background: C.bg, padding: '48px 16px 64px' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* 头部 */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.text, letterSpacing: 0.5 }}>
            本项目开源交付
          </div>
          <div style={{ fontSize: 14, color: C.sub, marginTop: 10, lineHeight: 1.7 }}>
            桌面端、云控端、授权管理端完整源码开源。两种交付方式，按需选择。
          </div>
        </div>

        {/* 两档卡片 */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 28 }}>
          {/* 先锋开源 */}
          <div
            style={{
              flex: '1 1 340px',
              background: C.cardBg,
              border: `1.5px solid ${C.brand}`,
              borderRadius: 12,
              padding: 26,
              position: 'relative',
              boxShadow: '0 4px 16px rgba(51,88,255,0.08)',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 18,
                right: 18,
                fontSize: 12,
                fontWeight: 600,
                color: C.brand,
                background: C.softBrand,
                border: `1px solid ${C.brand}`,
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              推荐
            </span>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>先锋开源</div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 6 }}>即刻交付，全量 + 未来所有版本</div>
            <div style={{ margin: '18px 0 8px' }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: C.text }}>¥{price}</span>
              <span style={{ fontSize: 13, color: C.faint, marginLeft: 8 }}>一次付费</span>
            </div>
            {/* 核心特权：突出「可自行无限登记授权」，与免费档「仅限原授权域名」形成对比 */}
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: C.softBrand,
                border: `1px solid ${C.brand}`,
                borderRadius: 8,
                padding: '11px 12px',
              }}
            >
              <span
                style={{
                  flex: 'none',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  background: C.brand,
                  borderRadius: 4,
                  padding: '2px 7px',
                }}
              >
                核心特权
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>
                可自行<span style={{ color: C.brand }}>无限登记授权</span>，授权域名数量不限
              </span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 22px' }}>
              {[
                '桌面端、云控端、授权管理端完整源码',
                '当前最新版本，7 月 13 日起交付',
                '未来所有版本持续交付',
                '全部开发规则与规范文档',
                '加入本项目开源交流群',
                '已授权用户可购买',
              ].map((t) => (
                <li key={t} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 13.5, color: C.text }}>
                  <span style={{ color: C.brand, fontWeight: 700 }}>·</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <Button type="primary" size="large" block onClick={openBuy}>
              立即获取（¥{price}）
            </Button>
            {config && !config.pay_enabled && (
              <div style={{ marginTop: 10, fontSize: 12, color: C.faint, textAlign: 'center' }}>
                收款通道维护中，如需购买请联系服务方
              </div>
            )}
          </div>

          {/* 免费开源 */}
          <div
            style={{
              flex: '1 1 340px',
              background: C.cardBg,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              padding: 26,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>免费开源</div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 6 }}>8 月底一次性，对已购买授权者开放</div>
            <div style={{ margin: '18px 0 8px' }}>
              <span style={{ fontSize: 30, fontWeight: 700, color: C.text }}>免费</span>
              <span style={{ fontSize: 13, color: C.faint, marginLeft: 8 }}>8 月底开放</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 22px' }}>
              {[
                '仅桌面端源码，一次性交付',
                '8 月底对已购买授权的所有人免费开源',
                '授权：仅限原购买时授权的域名使用',
                '不含云控端、授权管理端',
                '不含未来版本、交流群与文档',
              ].map((t, i) => (
                <li
                  key={t}
                  style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 13.5, color: i >= 3 ? C.faint : C.text }}
                >
                  <span style={{ color: C.faint, fontWeight: 700 }}>·</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
            <Button size="large" block disabled>
              8 月底开放，敬请关注
            </Button>
          </div>
        </div>

        {/* 对比表 */}
        <div
          style={{
            background: C.cardBg,
            border: `1px solid ${C.line}`,
            borderRadius: 12,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '16px 22px', fontSize: 15, fontWeight: 600, color: C.text, borderBottom: `1px solid ${C.line}` }}>
            两种交付方式对比
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr style={{ background: '#fafbfc' }}>
                  <th style={thStyle(C, 'left', 200)}>对比项</th>
                  <th style={thStyle(C, 'left')}>
                    <span style={{ color: C.brand }}>先锋开源</span>
                  </th>
                  <th style={thStyle(C, 'left')}>免费开源</th>
                </tr>
              </thead>
              <tbody>
                {CMP_ROWS.map((r) => (
                  <tr key={r.key} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={tdStyle({ color: C.sub, weight: 500 })}>{r.label}</td>
                    <td style={tdStyle({ color: r.key === 'price' ? C.text : C.text, weight: r.key === 'price' ? 700 : 400 })}>
                      {r.pioneer}
                    </td>
                    <td style={tdStyle({ color: r.freeMuted ? C.faint : C.text, weight: r.key === 'price' ? 700 : 400 })}>
                      {r.free}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 22, fontSize: 12, color: C.faint, lineHeight: 1.8 }}>
          付费后我们将通过你填写的微信 / 邮箱联系你完成交付（拉群 + 发送代码包与规则文档）。
          <br />
          购买遇到问题请联系服务方。
        </div>
      </div>

      {/* 购买弹窗（只加阴影，不加背景遮罩） */}
      <Modal
        title={modalTitle}
        open={modalOpen}
        onCancel={closeBuy}
        footer={null}
        maskClosable={false}
        mask={false}
        width={420}
        styles={{ content: { boxShadow: '0 6px 28px rgba(0,0,0,0.16)' } }}
      >
        {paidDone ? (
          <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.ok }}>支付成功，感谢支持</div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 12, lineHeight: 1.8 }}>
              我们会尽快通过你填写的微信 / 邮箱联系你，
              <br />
              拉你进开源交流群并发送代码包与规则文档。
            </div>
            <Button type="primary" style={{ marginTop: 22 }} onClick={closeBuy}>
              完成
            </Button>
          </div>
        ) : stage === 'paying' && order?.code_url ? (
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <QRCode value={order.code_url} size={184} bordered={false} style={{ margin: '0 auto' }} />
            <div style={{ marginTop: 12, fontSize: 14, color: C.text }}>
              微信扫码支付 <b style={{ fontSize: 20 }}>¥{order.amount}</b>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: C.sub }}>支付成功后自动跳转，无需刷新</div>
            <Button type="link" size="small" style={{ marginTop: 6 }} onClick={() => { setOrder(null); setStage('form') }}>
              返回修改信息
            </Button>
          </div>
        ) : (
          <div style={{ paddingTop: 6 }}>
            <div style={{ fontSize: 13, color: C.sub, marginBottom: 16 }}>
              先锋开源面向已获授权的用户。请填写购买人信息并登记已授权域名，用于核对授权、付费后联系并交付（拉群、发送代码包与文档）。
            </div>
            <Form form={form} layout="vertical" requiredMark={false}>
              <Form.Item
                name="buyer_name"
                label="姓名"
                rules={[{ required: true, message: '请填写姓名' }, { max: 60, message: '姓名过长' }]}
              >
                <Input placeholder="您的姓名" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="buyer_phone"
                label="电话"
                rules={[
                  { required: true, message: '请填写电话' },
                  { pattern: /^[0-9+\-\s]{5,40}$/, message: '电话格式不正确' },
                ]}
              >
                <Input placeholder="手机号 / 联系电话" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="buyer_wechat"
                label="微信号"
                rules={[{ required: true, message: '请填写微信号' }, { max: 80, message: '微信号过长' }]}
              >
                <Input placeholder="用于拉你进交流群" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="buyer_email"
                label="邮箱"
                rules={[
                  { required: true, message: '请填写邮箱' },
                  { type: 'email', message: '邮箱格式不正确' },
                ]}
              >
                <Input placeholder="用于发送代码包与文档" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="buyer_domain"
                label="已授权域名"
                extra="先锋开源面向已获授权的用户，请登记你已授权的域名，供核对授权"
                rules={[
                  { required: true, message: '请填写已授权域名' },
                  { pattern: /^[A-Za-z0-9.\-:/]+$/, message: '域名格式不正确' },
                ]}
              >
                <Input placeholder="你已授权的域名，如 admin.example.com" autoComplete="off" />
              </Form.Item>
              <Button
                type="primary"
                size="large"
                block
                loading={orderMut.isPending}
                onClick={submitForm}
              >
                生成收款码 · ¥{price}
              </Button>
            </Form>
          </div>
        )}
      </Modal>
    </div>
  )
}

function thStyle(c: typeof C, align: 'left' | 'center', width?: number): React.CSSProperties {
  return {
    textAlign: align,
    padding: '12px 22px',
    fontSize: 13,
    fontWeight: 600,
    color: c.text,
    width,
    whiteSpace: 'nowrap',
  }
}

function tdStyle(opt: { color: string; weight: number }): React.CSSProperties {
  return {
    padding: '12px 22px',
    fontSize: 13.5,
    color: opt.color,
    fontWeight: opt.weight,
    lineHeight: 1.6,
  }
}

export default OpenSourceDeliveryPage
