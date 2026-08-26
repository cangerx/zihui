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
import { packagingOrdersApi } from '@/api/packagingLicense'
import type { AdminPackagingOrder } from '@/api/packagingLicense'

const { Title, Text } = Typography

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '待支付', color: 'orange' },
  paid: { label: '已支付', color: 'green' },
  closed: { label: '已关闭', color: 'default' },
  failed: { label: '失败', color: 'red' },
  expired: { label: '已过期', color: 'default' },
}

export function PackagingOrdersPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)

  const { data, isFetching } = useQuery({
    queryKey: ['packaging-orders', page, pageSize, status, search],
    queryFn: () => packagingOrdersApi.list({ page, page_size: pageSize, status, search: search || undefined }),
  })

  const { data: detail } = useQuery({
    queryKey: ['packaging-order-detail', detailId],
    queryFn: () => packagingOrdersApi.get(detailId!),
    enabled: detailId !== null,
  })

  const syncMut = useMutation({
    mutationFn: (id: number) => packagingOrdersApi.sync(id),
    onSuccess: (r) => {
      message.success('已同步，微信状态：' + r.wx_trade_state)
      qc.invalidateQueries({ queryKey: ['packaging-orders'] })
    },
    onError: () => message.error('同步失败'),
  })

  const closeMut = useMutation({
    mutationFn: (id: number) => packagingOrdersApi.close(id),
    onSuccess: () => {
      message.success('订单已关闭')
      qc.invalidateQueries({ queryKey: ['packaging-orders'] })
    },
    onError: () => message.error('关单失败'),
  })

  const columns: ColumnsType<AdminPackagingOrder> = [
    {
      title: '订单号',
      dataIndex: 'order_no',
      width: 230,
      render: (v: string) => <Text copyable style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: '域名', dataIndex: 'domain', ellipsis: true },
    {
      title: '档位',
      dataIndex: 'features',
      width: 160,
      render: (v: string[]) => (v || []).map((f) => (f === 'mac' ? 'Mac' : 'Windows')).join('、'),
    },
    { title: '金额', dataIndex: 'amount', width: 90 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => {
        const meta = STATUS_META[v] || { label: v, color: 'default' }
        return <Tag color={meta.color}>{meta.label}</Tag>
      },
    },
    {
      title: '操作',
      width: 220,
      render: (_, row) => (
        <Space>
          <Button size="small" type="link" onClick={() => setDetailId(row.id)}>详情</Button>
          {row.status === 'pending' && (
            <Button size="small" type="link" loading={syncMut.isPending} onClick={() => syncMut.mutate(row.id)}>
              同步
            </Button>
          )}
          {row.status === 'pending' && (
            <Popconfirm title="关闭该未支付订单？" onConfirm={() => closeMut.mutate(row.id)}>
              <Button size="small" type="link">关单</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Title level={4} style={{ marginTop: 0 }}>打包授权订单</Title>
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input
            placeholder="域名或订单号"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onPressEnter={() => { setSearch(searchInput.trim()); setPage(1) }}
            style={{ width: 220 }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 140 }}
            value={status}
            options={Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label }))}
            onChange={(v) => { setStatus(v); setPage(1) }}
          />
          <Button onClick={() => { setSearch(searchInput.trim()); setPage(1) }}>查询</Button>
          <Button onClick={() => qc.invalidateQueries({ queryKey: ['packaging-orders'] })}>刷新</Button>
        </Space>
        <Table
          rowKey="id"
          loading={isFetching}
          columns={columns}
          dataSource={data?.items || []}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            onChange: (p, ps) => { setPage(p); setPageSize(ps) },
          }}
        />
      </Card>
      <Drawer title="订单详情" width={480} open={detailId !== null} onClose={() => setDetailId(null)}>
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="订单号">{detail.order_no}</Descriptions.Item>
            <Descriptions.Item label="域名">{detail.domain}</Descriptions.Item>
            <Descriptions.Item label="档位">{(detail.features || []).join(', ')}</Descriptions.Item>
            <Descriptions.Item label="金额">{detail.amount}</Descriptions.Item>
            <Descriptions.Item label="状态">{detail.status}</Descriptions.Item>
            <Descriptions.Item label="微信单号">{detail.wx_transaction_id || '—'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  )
}

export default PackagingOrdersPage
