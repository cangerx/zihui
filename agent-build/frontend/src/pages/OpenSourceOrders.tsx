import { useState } from 'react'
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { openSourceOrdersApi } from '@/api/openSourceOrders'
import type { AdminOpenSourceOrder } from '@/api/openSourceOrders'
import type { OpenSourceOrderStatus } from '@/api/openSource'

const { Title, Text, Paragraph } = Typography

const STATUS_META: Record<OpenSourceOrderStatus, { label: string; color: string }> = {
  pending: { label: '待支付', color: 'orange' },
  paid: { label: '已支付', color: 'green' },
  closed: { label: '已关闭', color: 'default' },
  failed: { label: '失败', color: 'red' },
  expired: { label: '已过期', color: 'default' },
}

const TIER_LABEL: Record<string, string> = {
  pioneer: '先锋开源',
}

/**
 * 开源交付订单管理：列表（含购买人信息）/ 详情 / 主动查单同步 / 关单 / 标记交付。
 */
export function OpenSourceOrdersPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<OpenSourceOrderStatus | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)

  const { data, isFetching } = useQuery({
    queryKey: ['open-source-orders', page, pageSize, status, search],
    queryFn: () => openSourceOrdersApi.list({ page, page_size: pageSize, status, search: search || undefined }),
  })

  const { data: detail } = useQuery({
    queryKey: ['open-source-order-detail', detailId],
    queryFn: () => openSourceOrdersApi.get(detailId!),
    enabled: detailId !== null,
  })

  const syncMut = useMutation({
    mutationFn: (id: number) => openSourceOrdersApi.sync(id),
    onSuccess: (r) => {
      message.success('已同步，微信状态：' + r.wx_trade_state)
      qc.invalidateQueries({ queryKey: ['open-source-orders'] })
    },
    onError: () => message.error('同步失败'),
  })

  const closeMut = useMutation({
    mutationFn: (id: number) => openSourceOrdersApi.close(id),
    onSuccess: () => {
      message.success('订单已关闭')
      qc.invalidateQueries({ queryKey: ['open-source-orders'] })
    },
    onError: () => message.error('关单失败'),
  })

  const deliverMut = useMutation({
    mutationFn: (v: { id: number; delivered: boolean }) => openSourceOrdersApi.deliver(v.id, v.delivered),
    onSuccess: (_r, v) => {
      message.success(v.delivered ? '已标记交付' : '已取消交付标记')
      qc.invalidateQueries({ queryKey: ['open-source-orders'] })
    },
    onError: () => message.error('操作失败'),
  })

  const columns: ColumnsType<AdminOpenSourceOrder> = [
    {
      title: '订单号',
      dataIndex: 'order_no',
      width: 220,
      render: (v: string) => <Text copyable style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: '购买人',
      key: 'buyer',
      width: 200,
      render: (_, r) => (
        <div style={{ lineHeight: 1.5 }}>
          <div><Text strong>{r.buyer_name}</Text></div>
          <div style={{ fontSize: 12, color: '#8a9099' }}>{r.buyer_phone} · 微信 {r.buyer_wechat}</div>
          <div style={{ fontSize: 12, color: '#8a9099' }}>{r.buyer_email}</div>
          {r.buyer_domain && <div style={{ fontSize: 12, color: '#8a9099' }}>授权域名 {r.buyer_domain}</div>}
        </div>
      ),
    },
    {
      title: '档位',
      dataIndex: 'tier',
      width: 100,
      render: (t: string) => <Tag color="blue">{TIER_LABEL[t] ?? t}</Tag>,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 90,
      render: (v: string) => <Text strong>¥{v}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: OpenSourceOrderStatus) => {
        const m = STATUS_META[s] ?? { label: s, color: 'default' }
        return <Tag color={m.color}>{m.label}</Tag>
      },
    },
    {
      title: '交付',
      dataIndex: 'delivered',
      width: 80,
      render: (d: boolean) => (d ? <Tag color="green">已交付</Tag> : <Tag>未交付</Tag>),
    },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string | null) => fmt(v) },
    { title: '支付时间', dataIndex: 'paid_at', width: 160, render: (v: string | null) => fmt(v) },
    {
      title: '操作',
      key: 'actions',
      width: 250,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4} wrap>
          <Button size="small" onClick={() => setDetailId(r.id)}>详情</Button>
          <Button
            size="small"
            onClick={() => syncMut.mutate(r.id)}
            loading={syncMut.isPending && syncMut.variables === r.id}
          >
            同步
          </Button>
          {r.status === 'paid' && (
            <Button
              size="small"
              type={r.delivered ? 'default' : 'primary'}
              onClick={() => deliverMut.mutate({ id: r.id, delivered: !r.delivered })}
              loading={deliverMut.isPending && deliverMut.variables?.id === r.id}
            >
              {r.delivered ? '取消交付' : '标记交付'}
            </Button>
          )}
          {r.status === 'pending' && (
            <Popconfirm title="确认关闭该未支付订单？" onConfirm={() => closeMut.mutate(r.id)}>
              <Button size="small" danger>关单</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Title level={5} style={{ margin: 0, marginRight: 16 }}>开源交付订单</Title>
        <Input.Search
          placeholder="按姓名 / 电话 / 微信 / 邮箱 / 订单号搜索"
          allowClear
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={(v) => {
            setSearch(v.trim())
            setPage(1)
          }}
          style={{ width: 300 }}
        />
        <Select<OpenSourceOrderStatus>
          placeholder="状态筛选"
          allowClear
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          style={{ width: 140 }}
          options={[
            { label: '待支付', value: 'pending' },
            { label: '已支付', value: 'paid' },
            { label: '已关闭', value: 'closed' },
            { label: '失败', value: 'failed' },
          ]}
        />
        <Button onClick={() => qc.invalidateQueries({ queryKey: ['open-source-orders'] })}>刷新</Button>
      </Space>

      <Table<AdminOpenSourceOrder>
        rowKey="id"
        size="small"
        loading={isFetching}
        columns={columns}
        dataSource={data?.items ?? []}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => {
            setPage(p)
            setPageSize(ps)
          },
        }}
        scroll={{ x: 1200 }}
      />

      <Drawer
        title="订单详情"
        width={520}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
        mask={false}
      >
        {detail && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="订单号">{detail.order_no}</Descriptions.Item>
              <Descriptions.Item label="档位">{TIER_LABEL[detail.tier] ?? detail.tier}</Descriptions.Item>
              <Descriptions.Item label="姓名">{detail.buyer_name}</Descriptions.Item>
              <Descriptions.Item label="电话"><Text copyable>{detail.buyer_phone}</Text></Descriptions.Item>
              <Descriptions.Item label="微信号"><Text copyable>{detail.buyer_wechat}</Text></Descriptions.Item>
              <Descriptions.Item label="邮箱"><Text copyable>{detail.buyer_email}</Text></Descriptions.Item>
              <Descriptions.Item label="已授权域名"><Text copyable>{detail.buyer_domain ?? '-'}</Text></Descriptions.Item>
              <Descriptions.Item label="金额">¥{detail.amount} {detail.currency}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={(STATUS_META[detail.status] ?? { color: 'default' }).color}>
                  {(STATUS_META[detail.status] ?? { label: detail.status }).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="交付状态">
                {detail.delivered ? <Tag color="green">已交付</Tag> : <Tag>未交付</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="微信交易号">{detail.wx_transaction_id ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="下单 IP">{detail.client_ip ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{fmt(detail.created_at)}</Descriptions.Item>
              <Descriptions.Item label="过期时间">{fmt(detail.expires_at)}</Descriptions.Item>
              <Descriptions.Item label="支付时间">{fmt(detail.paid_at)}</Descriptions.Item>
              <Descriptions.Item label="交付时间">{fmt(detail.delivered_at)}</Descriptions.Item>
              <Descriptions.Item label="关闭时间">{fmt(detail.closed_at)}</Descriptions.Item>
            </Descriptions>
            {detail.notify_payload && (
              <>
                <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 4 }}>回调原始报文</Paragraph>
                <pre
                  style={{
                    background: '#f5f6f8',
                    padding: 12,
                    borderRadius: 6,
                    fontSize: 12,
                    maxHeight: 280,
                    overflow: 'auto',
                  }}
                >
                  {prettyJson(detail.notify_payload)}
                </pre>
              </>
            )}
          </>
        )}
      </Drawer>
    </Card>
  )
}

function fmt(v: string | null | undefined): string {
  if (!v) return '-'
  return new Date(v).toLocaleString('zh-CN', { hour12: false })
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export default OpenSourceOrdersPage
