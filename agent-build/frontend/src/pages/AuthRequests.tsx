import { useState } from 'react'
import { App, Card, Table, Space, Select, Input, DatePicker, Button, Typography, Tooltip, Tag, Descriptions, Popconfirm } from 'antd'
import { useQuery } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'
import { authRequestsApi, type AuthRequestListParams } from '@/api/authRequests'
import type { AuthRequestRecord } from '@/types'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

const RESULT_OPTIONS = [
  { label: '被拒', value: 'denied' as const },
  { label: '通过', value: 'allowed' as const },
]

const REASON_OPTIONS = [
  { label: '域名未授权', value: 'domain_not_authorized' },
  { label: '缺少来源(Origin)', value: 'origin_required' },
  { label: '来源无效', value: 'invalid_origin' },
  { label: '授权已停用', value: 'client_inactive' },
  { label: '授权已过期', value: 'client_expired' },
  { label: '通过', value: 'ok' },
]

const REASON_LABELS: Record<string, string> = {
  ok: '通过',
  origin_required: '缺少来源(Origin)',
  invalid_origin: '来源无效',
  domain_not_authorized: '域名未授权',
  client_inactive: '授权已停用',
  client_expired: '授权已过期',
}

export function AuthRequestsPage() {
  const { message } = App.useApp()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  // 默认聚焦「被拒」，方便直接定位未授权请求；清空筛选可查看全部
  const [filters, setFilters] = useState<AuthRequestListParams>({ result: 'denied' })

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['auth-requests', page, pageSize, filters],
    queryFn: () => authRequestsApi.list({ ...filters, page, page_size: pageSize }),
  })

  const onRangeChange = (range: [Dayjs | null, Dayjs | null] | null) => {
    setFilters((f) => ({
      ...f,
      date_from: range?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss') || undefined,
      date_to: range?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss') || undefined,
    }))
    setPage(1)
  }

  const onClearDenied = async () => {
    try {
      const res = await authRequestsApi.clearDenied()
      message.success(`已清空 ${res.deleted} 条被拒记录`)
      setPage(1)
      refetch()
    } catch {
      // 错误已由 http 响应拦截器统一提示
    }
  }

  return (
    <Card>
      <Space style={{ marginBottom: 8 }} wrap>
        <Title level={5} style={{ margin: 0, marginRight: 16 }}>
          授权日志
        </Title>
        <Select<'allowed' | 'denied'>
          allowClear
          placeholder="结果"
          style={{ width: 110 }}
          value={filters.result}
          onChange={(v) => {
            setFilters((f) => ({ ...f, result: v }))
            setPage(1)
          }}
          options={RESULT_OPTIONS}
        />
        <Select<string>
          allowClear
          placeholder="原因"
          style={{ width: 180 }}
          value={filters.reason}
          onChange={(v) => {
            setFilters((f) => ({ ...f, reason: v }))
            setPage(1)
          }}
          options={REASON_OPTIONS}
        />
        <Input.Search
          placeholder="搜索 域名 / host / 客户端"
          allowClear
          style={{ width: 260 }}
          onSearch={(v) => {
            setFilters((f) => ({ ...f, keyword: v || undefined }))
            setPage(1)
          }}
        />
        <RangePicker onChange={(r) => onRangeChange(r as [Dayjs | null, Dayjs | null] | null)} />
        <Button onClick={() => refetch()}>刷新</Button>
        <Popconfirm
          title="清空被拒记录"
          description="将删除全部「被拒」记录（成功记录不受影响），此操作不可恢复。"
          okText="清空"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          onConfirm={onClearDenied}
        >
          <Button danger>清空被拒记录</Button>
        </Popconfirm>
      </Space>
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          记录每次云控端授权校验。排查「域名已授权却报未授权」时，看被拒行实际发来的 origin / host 与原因即可定位。成功记录仅滚动保留最新 500 条；被拒记录全部保留，可用上方「清空被拒记录」手动清理。
        </Text>
      </div>

      <Table<AuthRequestRecord>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data?.items || []}
        expandable={{
          expandedRowRender: (r) => (
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="origin">{r.origin || '-'}</Descriptions.Item>
              <Descriptions.Item label="host">{r.host || '-'}</Descriptions.Item>
              <Descriptions.Item label="referer">{r.referer || '-'}</Descriptions.Item>
              <Descriptions.Item label="请求">{`${r.method || ''} /${r.path || ''}`}</Descriptions.Item>
              <Descriptions.Item label="IP">{r.ip || '-'}</Descriptions.Item>
              <Descriptions.Item label="云控端版本">{r.admin_version || '-'}</Descriptions.Item>
              <Descriptions.Item label="User-Agent">{r.user_agent || '-'}</Descriptions.Item>
            </Descriptions>
          ),
        }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          },
        }}
        columns={[
          {
            title: '时间',
            dataIndex: 'created_at',
            width: 170,
            render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
          },
          {
            title: '结果',
            dataIndex: 'result',
            width: 80,
            render: (v: string) =>
              v === 'allowed' ? <Tag color="success">通过</Tag> : <Tag color="error">被拒</Tag>,
          },
          {
            title: '原因',
            dataIndex: 'reason',
            width: 130,
            render: (v: string) =>
              v === 'ok' ? <Tag color="success">通过</Tag> : <Tag color="error">{REASON_LABELS[v] || v}</Tag>,
          },
          {
            title: 'origin（实际发来）',
            dataIndex: 'origin',
            width: 240,
            ellipsis: true,
            render: (v: string | null) => v || <Text type="secondary">-</Text>,
          },
          {
            title: 'host',
            dataIndex: 'host',
            width: 200,
            ellipsis: true,
            render: (v: string | null) => v || <Text type="secondary">-</Text>,
          },
          {
            title: '客户端',
            dataIndex: 'client_id',
            width: 160,
            ellipsis: true,
            render: (v: string | null) => v || <Text type="secondary">未命中</Text>,
          },
          { title: 'IP', dataIndex: 'ip', width: 130, ellipsis: true },
          {
            title: '云控端版本',
            dataIndex: 'admin_version',
            width: 110,
            render: (v: string | null) => v || '-',
          },
          {
            title: 'User-Agent',
            dataIndex: 'user_agent',
            ellipsis: true,
            render: (v: string | null) =>
              v ? (
                <Tooltip title={v}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {v}
                  </Text>
                </Tooltip>
              ) : (
                '-'
              ),
          },
        ]}
        scroll={{ x: 1500 }}
      />
    </Card>
  )
}
