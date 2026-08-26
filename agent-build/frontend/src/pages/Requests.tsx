import { useState } from 'react'
import { Card, Table, Space, Select, Input, DatePicker, Button, Typography, Tooltip, Tag } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { requestsApi, type RequestListParams } from '@/api/requests'
import type { BuildRequest, BuildStatus } from '@/types'
import { BuildStatusBadge, MirrorStatusBadge, PlatformBadge } from '@/components/StatusBadge'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

const STATUS_OPTIONS: { label: string; value: BuildStatus }[] = [
  { label: '排队中', value: 'queued' },
  { label: '打包中', value: 'building' },
  { label: '已完成', value: 'success' },
  { label: '已交付', value: 'delivered' },
  { label: '已清理', value: 'purged' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
  { label: '已过期', value: 'expired' },
]

/**
 * 「卡住」判定，阈值与后端 MirrorWatchdog 保持一致，按中转阶段区分：
 *  - pending（已完成、等 worker 领取镜像）：超 30 分钟未被领取 = worker 可能未在运行。
 *  - mirroring（worker 已领取、正在下载）：mac 双 100MB+ 包跨境可能下 40-60 分钟，阈值放宽到
 *    90 分钟，基准用领取时间 mirror_assigned_at，避免把「正在慢慢下大包」误标成「卡住」。
 * 返回卡住分钟数；未达阈值（含正常中转中）返回 null。
 */
function mirrorStuckMinutes(r: BuildRequest): number | null {
  if (r.status !== 'success') return null
  if (r.mirror_status === 'pending' && r.finished_at) {
    const min = dayjs().diff(dayjs(r.finished_at), 'minute')
    return min >= 30 ? min : null
  }
  if (r.mirror_status === 'mirroring') {
    const base = r.mirror_assigned_at || r.finished_at
    if (!base) return null
    const min = dayjs().diff(dayjs(base), 'minute')
    return min >= 90 ? min : null
  }
  return null
}

export function RequestsPage() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [filters, setFilters] = useState<RequestListParams>({})
  const [keywordInput, setKeywordInput] = useState('')

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['requests', page, pageSize, filters],
    queryFn: () => requestsApi.list({ ...filters, page, page_size: pageSize }),
    refetchInterval: 8000,
  })

  const onRangeChange = (range: [Dayjs | null, Dayjs | null] | null) => {
    setFilters((f) => ({
      ...f,
      date_from: range?.[0]?.startOf('day').format('YYYY-MM-DD HH:mm:ss') || undefined,
      date_to: range?.[1]?.endOf('day').format('YYYY-MM-DD HH:mm:ss') || undefined,
    }))
    setPage(1)
  }

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Title level={5} style={{ margin: 0, marginRight: 16 }}>
          打包任务
        </Title>
        <Select<BuildStatus>
          allowClear
          placeholder="状态"
          style={{ width: 130 }}
          value={filters.status}
          onChange={(v) => {
            setFilters((f) => ({ ...f, status: v }))
            setPage(1)
          }}
          options={STATUS_OPTIONS}
        />
        <Select<'win' | 'mac'>
          allowClear
          placeholder="平台"
          style={{ width: 110 }}
          value={filters.platform}
          onChange={(v) => {
            setFilters((f) => ({ ...f, platform: v }))
            setPage(1)
          }}
          options={[
            { label: 'Windows', value: 'win' },
            { label: 'macOS', value: 'mac' },
          ]}
        />
        <Select<'normal' | 'oem'>
          allowClear
          placeholder="模式"
          style={{ width: 110 }}
          value={filters.build_mode}
          onChange={(v) => {
            setFilters((f) => ({ ...f, build_mode: v }))
            setPage(1)
          }}
          options={[
            { label: '普通', value: 'normal' },
            { label: 'OEM', value: 'oem' },
          ]}
        />
        <Input.Search
          placeholder="OEM 项目 Key"
          allowClear
          style={{ width: 180 }}
          onSearch={(v) => {
            setFilters((f) => ({ ...f, oem_project_key: v || undefined }))
            setPage(1)
          }}
        />
        <Input.Search
          placeholder="按域名 / 运维姓名搜索"
          allowClear
          style={{ width: 260 }}
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onSearch={(v) => {
            setFilters((f) => ({ ...f, keyword: v || undefined }))
            setPage(1)
          }}
        />
        <RangePicker onChange={(r) => onRangeChange(r as [Dayjs | null, Dayjs | null] | null)} />
        <Button onClick={() => refetch()}>刷新</Button>
      </Space>

      <Table<BuildRequest>
        rowKey="build_id"
        loading={isFetching}
        dataSource={data?.items || []}
        onRow={(r) => (mirrorStuckMinutes(r) !== null ? { style: { background: '#fff1f0' } } : {})}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          onChange: (p, s) => {
            setPage(p)
            setPageSize(s)
          },
        }}
        columns={[
          {
            title: 'Build ID',
            dataIndex: 'build_id',
            width: 280,
            render: (v: string) => (
              <Tooltip title={v}>
                <Text code style={{ fontSize: 12 }}>
                  {v.slice(0, 8)}…{v.slice(-4)}
                </Text>
              </Tooltip>
            ),
          },
          { title: 'App', dataIndex: 'app_name', width: 130, ellipsis: true },
          {
            title: '模式',
            dataIndex: 'build_mode',
            width: 110,
            render: (v: string, r: BuildRequest) => (v === 'oem'
              ? <Tooltip title={r.oem_project_key || ''}><Tag color="purple">OEM</Tag></Tooltip>
              : <Tag>普通</Tag>),
          },
          {
            title: '平台',
            dataIndex: 'platform',
            width: 100,
            render: (v: 'win' | 'mac') => <PlatformBadge platform={v} />,
          },
          { title: '版本', dataIndex: 'app_version', width: 100 },
          {
            title: '状态',
            dataIndex: 'status',
            width: 110,
            render: (v: BuildStatus) => <BuildStatusBadge status={v} />,
          },
          {
            title: '中转',
            dataIndex: 'mirror_status',
            width: 120,
            render: (_: unknown, r: BuildRequest) => {
              const stuckMin = mirrorStuckMinutes(r)
              if (stuckMin !== null) {
                const reason = r.mirror_status === 'pending'
                  ? '已完成但超 30 分钟未被 worker 领取，worker 可能未在运行'
                  : '中转超 90 分钟未完成，下载可能卡死或跨境过慢'
                return (
                  <Tooltip title={reason}>
                    <Tag color="error">卡住 {stuckMin} 分钟</Tag>
                  </Tooltip>
                )
              }
              if (!r.mirror_status) return <Text type="secondary">-</Text>
              return <MirrorStatusBadge status={r.mirror_status} />
            },
          },
          {
            title: '域名 / 运维',
            dataIndex: 'domain',
            width: 220,
            ellipsis: true,
            render: (_: unknown, r: BuildRequest) => (
              <div style={{ lineHeight: 1.3 }}>
                <div style={{ fontSize: 12 }}>
                  {r.domain || <Text type="secondary">（授权已删除）</Text>}
                </div>
                <div style={{ fontSize: 11, color: '#999' }}>
                  {r.owner_name || <Text type="secondary">未填姓名</Text>}
                </div>
              </div>
            ),
          },
          {
            title: '创建时间',
            dataIndex: 'created_at',
            width: 160,
            render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '-'),
          },
          {
            title: '操作',
            width: 80,
            fixed: 'right',
            render: (_, r) => (
              <Button type="link" size="small" onClick={() => navigate(`/requests/${r.build_id}`)}>
                详情
              </Button>
            ),
          },
        ]}
        scroll={{ x: 1400 }}
      />
    </Card>
  )
}
