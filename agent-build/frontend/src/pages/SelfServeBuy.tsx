import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Checkbox, Input, QRCode, message } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { selfServeApi } from '@/api/selfServe'
import type { SelfServeOrder, SelfServeQueryResult } from '@/api/selfServe'
import type { MallKey } from '@/types'

const MALL_ORDER: MallKey[] = ['ewei', 'dianda', 'qdyun']
const DEFAULT_LABELS: Record<MallKey, string> = {
  ewei: 'eweishop',
  dianda: '点大商城',
  qdyun: '全端云商城',
}

// 克制的中性配色（贴合后台风格，避免花哨/AI 感）
const C = {
  text: '#1f2329',
  sub: '#8a9099',
  faint: '#bfbfbf',
  line: '#eef0f3',
  brand: '#3358ff',
  ok: '#52a447',
  warn: '#d4380d',
}

/**
 * 商城授权自助开通（公开页，免登录）。
 * 仅展现层，查询 / 下单 / 轮询 / 计价逻辑与后端契约保持不变。
 */
export function SelfServeBuyPage() {
  const [domainInput, setDomainInput] = useState('')
  const [queried, setQueried] = useState<SelfServeQueryResult | null>(null)
  const [selected, setSelected] = useState<MallKey[]>([])
  const [order, setOrder] = useState<SelfServeOrder | null>(null)
  const [paidDone, setPaidDone] = useState(false)

  const labels = queried?.labels ?? DEFAULT_LABELS
  const prices = queried?.prices ?? { single: 50, bundle: 100 }

  const queryMut = useMutation({
    mutationFn: (domain: string) => selfServeApi.query(domain),
    onSuccess: (res) => {
      setQueried(res)
      setSelected([])
      setOrder(null)
      setPaidDone(false)
    },
    onError: () => message.error('查询失败，请稍后重试'),
  })

  const orderMut = useMutation({
    mutationFn: (vars: { domain: string; malls: MallKey[] }) =>
      selfServeApi.createOrder(vars.domain, vars.malls),
    onSuccess: (res) => {
      setOrder(res)
      setPaidDone(false)
    },
    onError: () => {
      // 具体错误已由 http 拦截器以 message 弹出
    },
  })

  const { data: polled } = useQuery({
    queryKey: ['self-serve-order', order?.order_no],
    queryFn: () => selfServeApi.getOrder(order!.order_no),
    enabled: !!order && order.status === 'pending' && !paidDone,
    refetchInterval: 3000,
  })

  useEffect(() => {
    if (!polled) return
    if (polled.status === 'paid') {
      setPaidDone(true)
      setOrder(null)
      message.success('支付成功，授权已开通')
      if (queried?.domain) {
        selfServeApi.query(queried.domain).then((res) => {
          setQueried(res)
          setSelected([])
        })
      }
    } else if (polled.status === 'expired' || polled.status === 'closed') {
      message.warning('二维码已过期，请重新发起支付')
      setOrder(null)
    }
  }, [polled, queried?.domain])

  const doQuery = () => {
    const d = domainInput.trim()
    if (!d) {
      message.warning('请输入域名')
      return
    }
    queryMut.mutate(d)
  }

  const selectableCount = useMemo(
    () => (queried?.malls ? MALL_ORDER.filter((k) => !queried.malls![k]).length : 0),
    [queried],
  )

  const amount = useMemo(() => {
    const n = selected.length
    if (n <= 0) return 0
    return n === 1 ? prices.single : prices.bundle
  }, [selected, prices])

  const toggleMall = (key: MallKey, checked: boolean) => {
    setSelected((prev) => (checked ? [...prev, key] : prev.filter((k) => k !== key)))
  }

  const submitOrder = () => {
    if (!queried?.domain || selected.length === 0) return
    orderMut.mutate({ domain: queried.domain, malls: selected })
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#f7f8fa',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '44px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 440 }}>
        <Card
          variant="outlined"
          style={{ borderColor: C.line, borderRadius: 10, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}
          styles={{ body: { padding: 24 } }}
        >
          <div style={{ fontSize: 17, fontWeight: 600, color: C.text }}>开通商城授权</div>
          <div style={{ fontSize: 13, color: C.sub, marginTop: 4, marginBottom: 18 }}>
            输入云控端域名，查询并开通店铺商品图授权
          </div>

          {/* 促销提示：克制的一行，左侧细条强调 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderLeft: `3px solid ${C.brand}`,
              background: '#f5f7ff',
              borderRadius: '0 6px 6px 0',
              padding: '9px 12px',
              marginBottom: 18,
            }}
          >
            <span
              style={{
                flex: 'none',
                fontSize: 12,
                fontWeight: 600,
                color: C.brand,
                border: `1px solid ${C.brand}`,
                borderRadius: 3,
                padding: '0 5px',
                lineHeight: '18px',
              }}
            >
              限时
            </span>
            <span style={{ fontSize: 13, color: C.text }}>
              开通 2 个商城即赠第 3 个 · 2~3 个一口价 ¥{prices.bundle}
            </span>
          </div>

          <Input.Search
            size="large"
            placeholder="云控端域名，如 admin.example.com"
            enterButton="查询"
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            onSearch={doQuery}
            loading={queryMut.isPending}
          />

          {queried && !queried.found && (
            <div style={{ marginTop: 16, fontSize: 13, color: C.warn }}>
              该域名不在授权列表中，请确认域名或联系服务商。
            </div>
          )}

          {queried?.found && (
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, color: C.sub, marginBottom: 10 }}>
                {queried.domain}
                {!queried.purchasable && (
                  <span style={{ color: C.warn, marginLeft: 8 }}>
                    （状态：{queried.status}，暂不可开通）
                  </span>
                )}
              </div>

              <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
                {MALL_ORDER.map((key, idx) => {
                  const authorized = !!queried.malls?.[key]
                  const checked = authorized || selected.includes(key)
                  const disabled = authorized || !queried.purchasable || !!order
                  return (
                    <label
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px',
                        borderTop: idx ? `1px solid ${C.line}` : 'none',
                        cursor: disabled ? 'default' : 'pointer',
                        background: checked && !authorized ? '#f5f7ff' : '#fff',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onChange={(e) => toggleMall(key, e.target.checked)}
                        />
                        <span style={{ fontSize: 14, color: C.text }}>{labels[key] ?? key}</span>
                      </span>
                      <span style={{ fontSize: 12, color: authorized ? C.ok : C.faint }}>
                        {authorized ? '已开通' : '未开通'}
                      </span>
                    </label>
                  )
                })}
              </div>

              {selectableCount === 0 && (
                <div style={{ marginTop: 14, fontSize: 13, color: C.ok }}>
                  三个商城均已开通，无需再操作。
                </div>
              )}

              {queried.purchasable && selectableCount > 0 && !order && (
                <div style={{ marginTop: 18 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      marginBottom: 14,
                    }}
                  >
                    <span style={{ fontSize: 13, color: C.sub }}>已选 {selected.length} 项</span>
                    <span>
                      <span style={{ fontSize: 13, color: C.sub }}>应付 </span>
                      <span style={{ fontSize: 22, fontWeight: 600, color: C.text }}>¥{amount}</span>
                    </span>
                  </div>
                  <Button
                    type="primary"
                    size="large"
                    block
                    disabled={selected.length === 0}
                    loading={orderMut.isPending}
                    onClick={submitOrder}
                  >
                    微信扫码支付
                  </Button>
                </div>
              )}
            </div>
          )}

          {order?.code_url && (
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <QRCode value={order.code_url} size={176} bordered={false} style={{ margin: '0 auto' }} />
              <div style={{ marginTop: 10, fontSize: 14, color: C.text }}>
                微信扫码支付 <b style={{ fontSize: 18 }}>¥{order.amount}</b>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: C.sub }}>支付成功后自动开通，无需刷新</div>
              <Button type="link" size="small" onClick={() => setOrder(null)} style={{ marginTop: 4 }}>
                取消
              </Button>
            </div>
          )}

          {paidDone && (
            <div
              style={{
                marginTop: 18,
                padding: '11px 14px',
                background: '#f3faf2',
                border: `1px solid #d6ecd2`,
                borderRadius: 8,
                fontSize: 13,
                color: C.ok,
              }}
            >
              开通成功。云控端最长约 90 秒自动同步，或在云控端后台点「立即刷新」即时生效。
            </div>
          )}
        </Card>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 12, color: C.faint }}>
          支付遇到问题请联系服务商
        </div>
      </div>
    </div>
  )
}

export default SelfServeBuyPage
