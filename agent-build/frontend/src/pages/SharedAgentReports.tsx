import { useState } from 'react'
import { Button, Card, Empty, Image, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  sharedAgentReportsApi,
  type SharedAgentReportGroupRow,
  type SharedAgentReportReasonCode,
  type SharedAgentReportRow,
  type SharedAgentStatus,
} from '@/api/sharedAgentHub'

const { Title, Text } = Typography

const REASON_LABEL: Record<string, string> = {
  invalid_image: '图片无效',
  inappropriate: '内容不当',
  duplicate: '重复内容',
  copyright: '侵权',
  other: '其他',
}

const REASON_COLOR: Record<string, string> = {
  invalid_image: 'orange',
  inappropriate: 'volcano',
  duplicate: 'gold',
  copyright: 'red',
  other: 'default',
}

const STATUS_LABEL: Record<SharedAgentStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
}

const STATUS_COLOR: Record<SharedAgentStatus, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
}

export function SharedAgentReportsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'list' | 'grouped'>('list')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [reasonCode, setReasonCode] = useState<SharedAgentReportReasonCode | undefined>()
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])

  const { data, isFetching } = useQuery({
    queryKey: ['agentHub', 'reports', tab, page, pageSize, reasonCode],
    queryFn: () => sharedAgentReportsApi.list({
      page,
      page_size: pageSize,
      reason_code: tab === 'list' ? reasonCode : undefined,
      grouped: tab === 'grouped',
    }),
  })

  const dismissMut = useMutation({
    mutationFn: (id: number) => sharedAgentReportsApi.dismiss(id),
    onSuccess: () => {
      message.success('已驳回举报')
      qc.invalidateQueries({ queryKey: ['agentHub', 'reports'] })
      qc.invalidateQueries({ queryKey: ['agentHub', 'stats'] })
    },
  })

  const batchDismissMut = useMutation({
    mutationFn: (ids: number[]) => sharedAgentReportsApi.batchDismiss(ids),
    onSuccess: (resp) => {
      message.success(`已驳回 ${resp.deleted_count} 条举报`)
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['agentHub', 'reports'] })
      qc.invalidateQueries({ queryKey: ['agentHub', 'stats'] })
    },
  })

  const goAgent = (sharedId: number) => navigate(`/shared-agents?id=${sharedId}`)
  const listRows = (tab === 'list' ? data?.items as SharedAgentReportRow[] | undefined : undefined) || []
  const groupedRows = (tab === 'grouped' ? data?.items as SharedAgentReportGroupRow[] | undefined : undefined) || []

  const listView = (
    <>
      <Space style={{ marginBottom: 12 }} wrap>
        <Select
          allowClear
          placeholder="按理由筛选"
          style={{ width: 160 }}
          value={reasonCode}
          onChange={(v) => { setReasonCode(v); setPage(1) }}
          options={Object.entries(REASON_LABEL).map(([value, label]) => ({ value, label }))}
        />
        {selectedRowKeys.length > 0 && (
          <>
            <Text>已选 {selectedRowKeys.length} 条</Text>
            <Popconfirm title={`确认驳回选中的 ${selectedRowKeys.length} 条举报？`} onConfirm={() => batchDismissMut.mutate(selectedRowKeys)}>
              <Button size="small" loading={batchDismissMut.isPending}>批量驳回</Button>
            </Popconfirm>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>清除选中</Button>
          </>
        )}
      </Space>
      <Table<SharedAgentReportRow>
        rowKey="id"
        loading={isFetching}
        dataSource={listRows}
        rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as number[]), preserveSelectedRowKeys: true }}
        pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: true, onChange: (p, s) => { setPage(p); setPageSize(s) } }}
        columns={[
          {
            title: '关联智能体',
            width: 320,
            render: (_, r) => (
              <Space>
                {r.shared_avatar ? <Image src={r.shared_avatar} width={48} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} /> : <div style={{ width: 48, height: 72, background: '#f0f0f0', borderRadius: 4 }} />}
                <div>
                  <a onClick={() => goAgent(r.shared_id)}>{r.shared_name || `#${r.shared_id}`}</a>
                  <div><Text type="secondary" style={{ fontSize: 11 }}>来自 {r.source_site_name || '—'} · 被举报 {r.report_count ?? 0} 次</Text></div>
                </div>
              </Space>
            ),
          },
          { title: '智能体状态', width: 130, render: (_, r) => <Space size={4}>{r.shared_status && <Tag color={STATUS_COLOR[r.shared_status]}>{STATUS_LABEL[r.shared_status]}</Tag>}{(r.shared_is_visible === false || r.shared_is_visible === 0) && <Tag>已隐藏</Tag>}</Space> },
          { title: '举报理由', dataIndex: 'reason_code', width: 120, render: (v: string) => <Tag color={REASON_COLOR[v] || 'default'}>{REASON_LABEL[v] || v}</Tag> },
          { title: '备注', dataIndex: 'reason_note', ellipsis: true, render: (v: string | null) => v || <Text type="secondary">—</Text> },
          { title: '举报人', width: 200, render: (_, r) => <Space direction="vertical" size={0}><Text>{r.reporter_owner_name || r.reporter_client_id}</Text><Text type="secondary" style={{ fontSize: 11 }}>{r.reporter_domain}</Text></Space> },
          { title: '举报时间', dataIndex: 'created_at', width: 160, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
          { title: '操作', width: 160, render: (_, r) => <Space size={4}><Button size="small" type="link" onClick={() => goAgent(r.shared_id)}>查看智能体</Button><Popconfirm title="驳回该举报？" onConfirm={() => dismissMut.mutate(r.id)}><Button size="small" type="link">驳回举报</Button></Popconfirm></Space> },
        ]}
      />
    </>
  )

  const groupedView = (
    <Table<SharedAgentReportGroupRow>
      rowKey="shared_id"
      loading={isFetching}
      dataSource={groupedRows}
      pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: true, onChange: (p, s) => { setPage(p); setPageSize(s) } }}
      columns={[
        { title: '智能体', render: (_, r) => <Space>{r.avatar && <Image src={r.avatar} width={48} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />}<div><a onClick={() => goAgent(r.shared_id)}>{r.name}</a><div><Text type="secondary" style={{ fontSize: 11 }}>来自 {r.source_site_name}</Text></div></div></Space> },
        { title: '状态', width: 130, render: (_, r) => <Space size={4}><Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Tag>{(r.is_visible === false || r.is_visible === 0) && <Tag>已隐藏</Tag>}</Space> },
        { title: '举报次数', dataIndex: 'report_count', width: 100, align: 'center' as const, sorter: (a, b) => a.report_count - b.report_count, defaultSortOrder: 'descend' as const, render: (v: number) => <Tag color="volcano">{v}</Tag> },
        { title: '自动下架时间', dataIndex: 'auto_hidden_at', width: 180, render: (v: string | null) => v ? <Text type="warning" style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">—</Text> },
        { title: '分享时间', dataIndex: 'created_at', width: 170, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
        { title: '操作', width: 100, render: (_, r) => <Button size="small" type="link" onClick={() => goAgent(r.shared_id)}>处理</Button> },
      ]}
    />
  )

  return (
    <Card>
      <Title level={5} style={{ margin: 0, marginBottom: 12 }}>数字员工 · 举报</Title>
      <Tabs
        activeKey={tab}
        onChange={(k) => { setTab(k as 'list' | 'grouped'); setPage(1); setSelectedRowKeys([]) }}
        items={[{ key: 'list', label: '举报记录（逐条）', children: listView }, { key: 'grouped', label: '按智能体聚合', children: groupedView }]}
      />
      {(!data?.items || data.items.length === 0) && !isFetching && <Empty description={tab === 'list' ? '暂无举报记录' : '暂无被举报的智能体'} style={{ marginTop: 24 }} />}
    </Card>
  )
}
