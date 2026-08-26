import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Image,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { reportsApi } from '@/api/sharedInspirationHub'
import type {
  ReportReasonCode,
  SharedInspirationReportGroupRow,
  SharedInspirationReportRow,
  SharedInspirationStatus,
} from '@/types'

const { Title, Text } = Typography

const REASON_CODE_LABEL: Record<string, string> = {
  invalid_image: '图片无效',
  inappropriate: '内容不当',
  duplicate: '重复内容',
  copyright: '侵权',
  other: '其他',
}

const REASON_CODE_COLOR: Record<string, string> = {
  invalid_image: 'orange',
  inappropriate: 'volcano',
  duplicate: 'gold',
  copyright: 'red',
  other: 'default',
}

const STATUS_LABEL: Record<SharedInspirationStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
}

const STATUS_COLOR: Record<SharedInspirationStatus, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
}

/**
 * 共享灵感库 · 举报池
 *
 * 两种视图：
 *  - 逐条视图：每条举报独立成行，可看 reason_code / reason_note，可驳回单条/批量
 *  - 聚合视图：按 shared_id 聚合，看哪些灵感被举报最多，便于直接跳转处理灵感
 *
 * 「驳回举报」= 删除该 reports 行 + 对应 inspirations.report_count -1。
 *  不会自动恢复 is_visible（因举报自动下架的内容需平台手动在「灵感池」恢复显示）。
 */
export function SharedInspirationReportsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const [tab, setTab] = useState<'list' | 'grouped'>('list')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [reasonCode, setReasonCode] = useState<ReportReasonCode | undefined>()
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])

  const { data, isFetching } = useQuery({
    queryKey: ['inspirationHub', 'reports', tab, page, pageSize, reasonCode],
    queryFn: () =>
      reportsApi.list({
        page,
        page_size: pageSize,
        reason_code: tab === 'list' ? reasonCode : undefined,
        grouped: tab === 'grouped',
      }),
  })

  const dismissMut = useMutation({
    mutationFn: (id: number) => reportsApi.dismiss(id),
    onSuccess: () => {
      message.success('已驳回举报')
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'reports'] })
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'stats'] })
    },
  })

  const batchDismissMut = useMutation({
    mutationFn: (ids: number[]) => reportsApi.batchDismiss(ids),
    onSuccess: (resp) => {
      message.success(`已驳回 ${resp.deleted_count} 条举报`)
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'reports'] })
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'stats'] })
    },
  })

  const goInspiration = (sharedId: number) => {
    navigate(`/shared-inspirations?id=${sharedId}`)
  }

  // ===== 逐条视图 =====
  const listRows = (tab === 'list' ? (data?.items as SharedInspirationReportRow[] | undefined) : undefined) || []

  const listView = (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          placeholder="按理由筛选"
          style={{ width: 160 }}
          value={reasonCode}
          onChange={(v) => {
            setReasonCode(v)
            setPage(1)
          }}
          options={Object.entries(REASON_CODE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        {selectedRowKeys.length > 0 && (
          <>
            <Text>已选 {selectedRowKeys.length} 条</Text>
            <Popconfirm
              title={`确认驳回选中的 ${selectedRowKeys.length} 条举报？`}
              description="驳回后这些举报记录将被删除，对应灵感的 report_count 同步减少。已自动下架的灵感不会自动恢复显示。"
              onConfirm={() => batchDismissMut.mutate(selectedRowKeys)}
              overlayStyle={{ maxWidth: 320 }}
            >
              <Button size="small" loading={batchDismissMut.isPending}>
                批量驳回
              </Button>
            </Popconfirm>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>
              清除选中
            </Button>
          </>
        )}
      </Space>

      <Table<SharedInspirationReportRow>
        rowKey="id"
        loading={isFetching}
        dataSource={listRows}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
          preserveSelectedRowKeys: true,
        }}
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
            title: '关联灵感',
            width: 320,
            render: (_, r) => (
              <Space>
                {r.shared_cover ? (
                  <Image
                    src={r.shared_cover}
                    alt=""
                    width={48}
                    height={48}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                    preview={false}
                  />
                ) : (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      background: '#f0f0f0',
                      borderRadius: 4,
                    }}
                  />
                )}
                <div>
                  <div>
                    <a onClick={() => goInspiration(r.shared_id)}>{r.shared_title || `#${r.shared_id}`}</a>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    来自 {r.source_site_name || '—'}
                    {' · '}
                    被举报 {r.report_count ?? 0} 次
                  </Text>
                </div>
              </Space>
            ),
          },
          {
            title: '灵感状态',
            width: 130,
            render: (_, r) => (
              <Space size={4}>
                {r.shared_status && (
                  <Tag color={STATUS_COLOR[r.shared_status]}>{STATUS_LABEL[r.shared_status]}</Tag>
                )}
                {r.shared_is_visible === false || r.shared_is_visible === 0 ? (
                  <Tag color="default">已隐藏</Tag>
                ) : null}
              </Space>
            ),
          },
          {
            title: '举报理由',
            dataIndex: 'reason_code',
            width: 120,
            render: (v: ReportReasonCode) => (
              <Tag color={REASON_CODE_COLOR[v] || 'default'}>{REASON_CODE_LABEL[v] || v}</Tag>
            ),
          },
          {
            title: '备注',
            dataIndex: 'reason_note',
            ellipsis: true,
            render: (v: string | null) =>
              v ? (
                <Tooltip title={v}>
                  <Text style={{ fontSize: 12 }}>{v}</Text>
                </Tooltip>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  —
                </Text>
              ),
          },
          {
            title: '举报人',
            width: 200,
            render: (_, r) => (
              <Space direction="vertical" size={0}>
                <Text>{r.reporter_owner_name || r.reporter_client_id}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {r.reporter_domain}
                </Text>
              </Space>
            ),
          },
          {
            title: '举报时间',
            dataIndex: 'created_at',
            width: 160,
            render: (v: string) => (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {v}
              </Text>
            ),
          },
          {
            title: '操作',
            width: 160,
            render: (_, r) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => goInspiration(r.shared_id)}>
                  查看灵感
                </Button>
                <Popconfirm
                  title="驳回该举报？"
                  description="举报记录会被删除，对应灵感的 report_count 同步 -1。已自动下架的灵感不会自动恢复显示。"
                  onConfirm={() => dismissMut.mutate(r.id)}
                  overlayStyle={{ maxWidth: 320 }}
                >
                  <Button size="small" type="link">
                    驳回举报
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </>
  )

  // ===== 聚合视图 =====
  const groupedRows = (tab === 'grouped' ? (data?.items as SharedInspirationReportGroupRow[] | undefined) : undefined) || []

  const groupedView = (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="按灵感聚合视图：哪些灵感被举报最多。点击「处理」跳转到灵感池详情，进行强制驳回 / 删除等操作。"
      />
      <Table<SharedInspirationReportGroupRow>
        rowKey="shared_id"
        loading={isFetching}
        dataSource={groupedRows}
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
            title: '灵感',
            render: (_, r) => (
              <Space>
                {r.cover_image ? (
                  <Image
                    src={r.cover_image}
                    alt=""
                    width={48}
                    height={48}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                    preview={false}
                  />
                ) : null}
                <div>
                  <div>
                    <a onClick={() => goInspiration(r.shared_id)}>{r.title}</a>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    来自 {r.source_site_name}
                  </Text>
                </div>
              </Space>
            ),
          },
          {
            title: '状态',
            width: 130,
            render: (_, r) => (
              <Space size={4}>
                <Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Tag>
                {(r.is_visible === false || r.is_visible === 0) && <Tag color="default">已隐藏</Tag>}
              </Space>
            ),
          },
          {
            title: '举报次数',
            dataIndex: 'report_count',
            width: 100,
            align: 'center' as const,
            sorter: (a, b) => a.report_count - b.report_count,
            defaultSortOrder: 'descend' as const,
            render: (v: number) => <Tag color="volcano">{v}</Tag>,
          },
          {
            title: '自动下架时间',
            dataIndex: 'auto_hidden_at',
            width: 180,
            render: (v: string | null) =>
              v ? (
                <Text type="warning" style={{ fontSize: 12 }}>
                  {v}
                </Text>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  —
                </Text>
              ),
          },
          {
            title: '分享时间',
            dataIndex: 'created_at',
            width: 170,
            render: (v: string) => (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {v}
              </Text>
            ),
          },
          {
            title: '操作',
            width: 100,
            render: (_, r) => (
              <Button size="small" type="link" onClick={() => goInspiration(r.shared_id)}>
                处理
              </Button>
            ),
          },
        ]}
      />
    </>
  )

  return (
    <Card>
      <Title level={5} style={{ margin: 0, marginBottom: 12 }}>
        共享灵感库 · 举报池
      </Title>

      <Tabs
        activeKey={tab}
        onChange={(k) => {
          setTab(k as 'list' | 'grouped')
          setPage(1)
          setSelectedRowKeys([])
        }}
        items={[
          {
            key: 'list',
            label: '举报记录（逐条）',
            children: listView,
          },
          {
            key: 'grouped',
            label: '按灵感聚合',
            children: groupedView,
          },
        ]}
      />

      {(!data?.items || data.items.length === 0) && !isFetching && (
        <Empty
          description={tab === 'list' ? '暂无举报记录' : '暂无被举报的灵感'}
          style={{ marginTop: 24 }}
        />
      )}
    </Card>
  )
}
