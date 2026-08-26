import { useEffect, useState } from 'react'
import { Button, Card, Checkbox, Input, QRCode, message } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { packagingSelfServeApi } from '@/api/packagingLicense'
import type { PackagingOrder, PackagingQueryResult } from '@/api/packagingLicense'

const C = {
  text: '#1a2030',
  sub: '#5b6575',
  line: '#d7e2f0',
  brand: '#2f6fed',
  ok: '#2f6fed',
}

export function BuyPackagingPage() {
  const [domainInput, setDomainInput] = useState('')
  const [queried, setQueried] = useState<PackagingQueryResult | null>(null)
  const [wantWin, setWantWin] = useState(false)
  const [wantMac, setWantMac] = useState(false)
  const [order, setOrder] = useState<PackagingOrder | null>(null)
  const [paidDone, setPaidDone] = useState(false)

  const prices = queried?.prices ?? { win: 0, mac: 0 }
  const hasWin = !!queried?.can_use_github_packaging
  const hasMac = !!queried?.can_use_mac_packaging
  const winLocked = wantMac && !hasWin

  const queryMut = useMutation({
    mutationFn: (domain: string) => packagingSelfServeApi.query(domain),
    onSuccess: (res) => {
      setQueried(res)
      setWantWin(false)
      setWantMac(false)
      setOrder(null)
      setPaidDone(false)
    },
    onError: () => message.error('查询失败，请稍后重试'),
  })

  const orderMut = useMutation({
    mutationFn: (vars: { domain: string; features: Array<'win' | 'mac'> }) =>
      packagingSelfServeApi.createOrder(vars.domain, vars.features),
    onSuccess: (res) => {
      setOrder(res)
      setPaidDone(false)
    },
  })

  const { data: polled } = useQuery({
    queryKey: ['packaging-order', order?.order_no],
    queryFn: () => packagingSelfServeApi.getOrder(order!.order_no),
    enabled: !!order && order.status === 'pending' && !paidDone,
    refetchInterval: 3000,
  })

  useEffect(() => {
    if (!polled) return
    if (polled.status === 'paid') {
      setPaidDone(true)
      setOrder(null)
      message.success('支付成功，打包授权已开通')
      if (queried?.domain) {
        packagingSelfServeApi.query(queried.domain).then((res) => {
          setQueried(res)
          setWantWin(false)
          setWantMac(false)
        })
      }
    }
  }, [polled, queried?.domain])

  const features: Array<'win' | 'mac'> = []
  if (wantWin || winLocked) features.push('win')
  if (wantMac) features.push('mac')

  let amount = 0
  if ((wantWin || winLocked) && !hasWin) amount += prices.win
  if (wantMac && !hasMac) amount += prices.mac

  const canBuy = !!queried?.found && !!queried.purchasable && features.length > 0 && amount > 0

  return (
    <div style={{ minHeight: '100vh', background: '#f3f6fb', padding: 24 }}>
      <Card style={{ maxWidth: 520, margin: '40px auto', borderColor: C.line }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: C.text, marginBottom: 8 }}>开通云控打包授权</div>
        <div style={{ color: C.sub, marginBottom: 20, fontSize: 13 }}>
          输入已登记的云控域名，勾选需要开通的档位后扫码付款。
        </div>
        <Input
          value={domainInput}
          onChange={(e) => setDomainInput(e.target.value)}
          placeholder="例如 agent.example.com"
          onPressEnter={() => domainInput.trim() && queryMut.mutate(domainInput.trim())}
        />
        <Button
          type="primary"
          style={{ marginTop: 12, background: C.brand }}
          loading={queryMut.isPending}
          onClick={() => domainInput.trim() && queryMut.mutate(domainInput.trim())}
        >
          查询
        </Button>

        {queried && !queried.found && (
          <div style={{ marginTop: 16, color: '#a8071a' }}>该域名不在授权列表中。</div>
        )}

        {queried?.found && (
          <div style={{ marginTop: 20 }}>
            <div style={{ marginBottom: 8, color: C.sub }}>域名 {queried.domain} · 状态 {queried.status}</div>
            {!queried.self_serve_enabled && (
              <div style={{ color: '#a8071a', marginBottom: 12 }}>自助购买未上架，请联系授权平台开通。</div>
            )}
            <Checkbox
              checked={hasWin || wantWin || winLocked}
              disabled={hasWin || winLocked}
              onChange={(e) => setWantWin(e.target.checked)}
            >
              云控端打包授权（Windows）{hasWin ? ' · 已开通' : ` · ${prices.win} 元`}
            </Checkbox>
            <div style={{ height: 8 }} />
            <Checkbox
              checked={hasMac || wantMac}
              disabled={hasMac}
              onChange={(e) => {
                setWantMac(e.target.checked)
                if (e.target.checked && !hasWin) setWantWin(true)
              }}
            >
              Mac 打包授权{hasMac ? ' · 已开通' : ` · ${prices.mac} 元`}
            </Checkbox>
            {winLocked && (
              <div style={{ marginTop: 8, color: C.sub, fontSize: 12 }}>
                打 Mac 须同时开通 Windows 档，已自动计入。
              </div>
            )}
            <div style={{ marginTop: 16, color: C.text }}>应付 {amount} 元</div>
            <Button
              type="primary"
              style={{ marginTop: 12, background: C.brand }}
              disabled={!canBuy}
              loading={orderMut.isPending}
              onClick={() => queried.domain && orderMut.mutate({ domain: queried.domain, features })}
            >
              扫码支付
            </Button>
          </div>
        )}

        {order?.code_url && order.status === 'pending' && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
            <QRCode value={order.code_url} size={180} />
            <div style={{ marginTop: 8, color: C.sub }}>请使用微信扫码，订单号 {order.order_no}</div>
          </div>
        )}

        {paidDone && <div style={{ marginTop: 16, color: C.ok }}>已开通，可回到云控后台提交打包。</div>}
      </Card>
    </div>
  )
}

export default BuyPackagingPage
