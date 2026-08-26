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
import { selfServeOrdersApi } from '@/api/selfServeOrders'
import type { AdminSelfServeOrder } from '@/api/selfServeOrders'
import type { SelfServeOrderStatus } from '@/api/selfServe'

const { Title, Text, Paragraph } = Typography

const STATUS_META: Record<SelfServeOrderStatus, { label: string; color: string }> = {
  pending: { label: '待支付', color: 'orange' },
  paid: { label: '已支付', color: 'green' },
  closed: { label: '已关闭', color: 'default' },
  failed: { label: '失败', color: 'red' },
  expired: { label: '已过期', color: 'default' },
}

/**
 * 自助付费订单管理：列表 / 详情 / 主动查单同步 / 关单。
 */
export function SelfServeOrdersPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<SelfServeOrderStatus | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)

  const { data, isFetching } = useQuery({
    queryKey: ['self-serve-orders', page, pageSize, status, search],
    queryFn: () => selfServeOrdersApi.list({ page, page_size: pageSize, status, search: search || undefined }),
  })

  const { data: detail } = useQuery({
    queryKey: ['self-serve-order-detail', detailId],
    queryFn: () => selfServeOrdersApi.get(detailId!),
    enabled: detailId !== null,
  })

  const syncMut = useMutation({
    mutationFn: (id: number) => selfServeOrdersApi.sync(id),
    onSuccess: (r) => {
      message.success('已同步，微信状态：' + r.wx_trade_state)
      qc.invalidateQueries({ queryKey: ['self-serve-orders'] })
    },
    onError: () => message.error('同步失败'),
  })

  const closeMut = useMutation({
    mutationFn: (id: number) => selfServeOrdersApi.close(id),
    onSuccess: () => {
      message.success('订单已关闭')
      qc.invalidateQueries({ queryKey: ['self-serve-orders'] })
    },
    onError: () => message.error('关单失败'),
  })

  const columns: ColumnsType<AdminSelfServeOrder> = [
    {
      title: '订单号',
      dataIndex: 'order_no',
      width: 230,
      render: (v: string) => <Text copyable style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: '域名', dataIndex: 'domain', ellipsis: true },
    {
      title: '商城',
      dataIndex: 'mall_labels',
      width: 180,
      render: (labels: string[]) => (
        <Space size={4} wrap>
          {labels.map((l) => (
            <Tag key={l} color="blue">{l}</Tag>
          ))}
        </Space>
      ),
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
      render: (s: SelfServeOrderStatus) => {
        const m = STATUS_META[s] ?? { label: s, color: 'default' }
        return <Tag color={m.color}>{m.label}</Tag>
      },
    },
    { title: '创建时间', dataIndex: 'created_at', width: 170, render: (v: string | null) => fmt(v) },
    { title: '支付时间', dataIndex: 'paid_at', width: 170, render: (v: string | null) => fmt(v) },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" onClick={() => setDetailId(r.id)}>详情</Button>
          <Button
            size="small"
            onClick={() => syncMut.mutate(r.id)}
            loading={syncMut.isPending && syncMut.variables === r.id}
          >
            同步
          </Button>
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
        <Title level={5} style={{ margin: 0, marginRight: 16 }}>商城授权订单</Title>
        <Input.Search
          placeholder="按域名 / 订单号搜索"
          allowClear
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onSearch={(v) => {
            setSearch(v.trim())
            setPage(1)
          }}
          style={{ width: 240 }}
        />
        <Select<SelfServeOrderStatus>
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
        <Button onClick={() => qc.invalidateQueries({ queryKey: ['self-serve-orders'] })}>刷新</Button>
      </Space>

      <Table<AdminSelfServeOrder>
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
        scroll={{ x: 1100 }}
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
              <Descriptions.Item label="域名">{detail.domain}</Descriptions.Item>
              <Descriptions.Item label="client_id">{detail.client_id ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="开通商城">
                <Space size={4} wrap>
                  {detail.mall_labels.map((l) => <Tag key={l} color="blue">{l}</Tag>)}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="金额">¥{detail.amount} {detail.currency}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={(STATUS_META[detail.status] ?? { color: 'default' }).color}>
                  {(STATUS_META[detail.status] ?? { label: detail.status }).label}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="微信交易号">{detail.wx_transaction_id ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="下单 IP">{detail.client_ip ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">{fmt(detail.created_at)}</Descriptions.Item>
              <Descriptions.Item label="过期时间">{fmt(detail.expires_at)}</Descriptions.Item>
              <Descriptions.Item label="支付时间">{fmt(detail.paid_at)}</Descriptions.Item>
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

function fmt(v: string | null): string {
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

export default SelfServeOrdersPage
