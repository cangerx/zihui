import { useState } from 'react'
import { Button, Card, Empty, Image, Popconfirm, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  sharedCreativeTemplateReportsApi,
  type SharedCreativeTemplateReportGroupRow,
  type SharedCreativeTemplateReportReasonCode,
  type SharedCreativeTemplateReportRow,
  type SharedCreativeTemplateStatus,
} from '@/api/sharedCreativeTemplateHub'

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

const STATUS_LABEL: Record<SharedCreativeTemplateStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
}

const STATUS_COLOR: Record<SharedCreativeTemplateStatus, string> = {
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
}

export function SharedCreativeTemplateReportsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'list' | 'grouped'>('list')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [reasonCode, setReasonCode] = useState<SharedCreativeTemplateReportReasonCode | undefined>()
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])

  const { data, isFetching } = useQuery({
    queryKey: ['creativeTemplateHub', 'reports', tab, page, pageSize, reasonCode],
    queryFn: () => sharedCreativeTemplateReportsApi.list({
      page,
      page_size: pageSize,
      reason_code: tab === 'list' ? reasonCode : undefined,
      grouped: tab === 'grouped',
    }),
  })

  const dismissMut = useMutation({
    mutationFn: (id: number) => sharedCreativeTemplateReportsApi.dismiss(id),
    onSuccess: () => {
      message.success('已驳回举报')
      qc.invalidateQueries({ queryKey: ['creativeTemplateHub', 'reports'] })
      qc.invalidateQueries({ queryKey: ['creativeTemplateHub', 'stats'] })
    },
  })

  const batchDismissMut = useMutation({
    mutationFn: (ids: number[]) => sharedCreativeTemplateReportsApi.batchDismiss(ids),
    onSuccess: (resp) => {
      message.success(`已驳回 ${resp.deleted_count} 条举报`)
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['creativeTemplateHub', 'reports'] })
      qc.invalidateQueries({ queryKey: ['creativeTemplateHub', 'stats'] })
    },
  })

  const goTemplate = (sharedId: number) => navigate(`/shared-creative-templates?id=${sharedId}`)
  const listRows = (tab === 'list' ? data?.items as SharedCreativeTemplateReportRow[] | undefined : undefined) || []
  const groupedRows = (tab === 'grouped' ? data?.items as SharedCreativeTemplateReportGroupRow[] | undefined : undefined) || []

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
      <Table<SharedCreativeTemplateReportRow>
        rowKey="id"
        loading={isFetching}
        dataSource={listRows}
        rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as number[]), preserveSelectedRowKeys: true }}
        pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: true, onChange: (p, s) => { setPage(p); setPageSize(s) } }}
        columns={[
          {
            title: '关联模板',
            width: 320,
            render: (_, r) => (
              <Space>
                {r.shared_cover ? <Image src={r.shared_cover} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} /> : <div style={{ width: 48, height: 48, background: '#f0f0f0', borderRadius: 4 }} />}
                <div>
                  <a onClick={() => goTemplate(r.shared_id)}>{r.shared_title || `#${r.shared_id}`}</a>
                  <div><Text type="secondary" style={{ fontSize: 11 }}>来自 {r.source_site_name || '—'} · 被举报 {r.report_count ?? 0} 次</Text></div>
                </div>
              </Space>
            ),
          },
          { title: '模板状态', width: 130, render: (_, r) => <Space size={4}>{r.shared_status && <Tag color={STATUS_COLOR[r.shared_status]}>{STATUS_LABEL[r.shared_status]}</Tag>}{(r.shared_is_visible === false || r.shared_is_visible === 0) && <Tag>已隐藏</Tag>}</Space> },
          { title: '举报理由', dataIndex: 'reason_code', width: 120, render: (v: string) => <Tag color={REASON_COLOR[v] || 'default'}>{REASON_LABEL[v] || v}</Tag> },
          { title: '备注', dataIndex: 'reason_note', ellipsis: true, render: (v: string | null) => v || <Text type="secondary">—</Text> },
          { title: '举报人', width: 200, render: (_, r) => <Space direction="vertical" size={0}><Text>{r.reporter_owner_name || r.reporter_client_id}</Text><Text type="secondary" style={{ fontSize: 11 }}>{r.reporter_domain}</Text></Space> },
          { title: '举报时间', dataIndex: 'created_at', width: 160, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
          { title: '操作', width: 160, render: (_, r) => <Space size={4}><Button size="small" type="link" onClick={() => goTemplate(r.shared_id)}>查看模板</Button><Popconfirm title="驳回该举报？" onConfirm={() => dismissMut.mutate(r.id)}><Button size="small" type="link">驳回举报</Button></Popconfirm></Space> },
        ]}
      />
    </>
  )

  const groupedView = (
    <Table<SharedCreativeTemplateReportGroupRow>
      rowKey="shared_id"
      loading={isFetching}
      dataSource={groupedRows}
      pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: true, onChange: (p, s) => { setPage(p); setPageSize(s) } }}
      columns={[
        { title: '模板', render: (_, r) => <Space>{r.cover_image && <Image src={r.cover_image} width={48} height={48} style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />}<div><a onClick={() => goTemplate(r.shared_id)}>{r.title}</a><div><Text type="secondary" style={{ fontSize: 11 }}>来自 {r.source_site_name}</Text></div></div></Space> },
        { title: '状态', width: 130, render: (_, r) => <Space size={4}><Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Tag>{(r.is_visible === false || r.is_visible === 0) && <Tag>已隐藏</Tag>}</Space> },
        { title: '举报次数', dataIndex: 'report_count', width: 100, align: 'center' as const, sorter: (a, b) => a.report_count - b.report_count, defaultSortOrder: 'descend' as const, render: (v: number) => <Tag color="volcano">{v}</Tag> },
        { title: '自动下架时间', dataIndex: 'auto_hidden_at', width: 180, render: (v: string | null) => v ? <Text type="warning" style={{ fontSize: 12 }}>{v}</Text> : <Text type="secondary">—</Text> },
        { title: '分享时间', dataIndex: 'created_at', width: 170, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
        { title: '操作', width: 100, render: (_, r) => <Button size="small" type="link" onClick={() => goTemplate(r.shared_id)}>处理</Button> },
      ]}
    />
  )

  return (
    <Card>
      <Title level={5} style={{ margin: 0, marginBottom: 12 }}>共享创意模板库 · 举报池</Title>
      <Tabs
        activeKey={tab}
        onChange={(k) => { setTab(k as 'list' | 'grouped'); setPage(1); setSelectedRowKeys([]) }}
        items={[{ key: 'list', label: '举报记录（逐条）', children: listView }, { key: 'grouped', label: '按模板聚合', children: groupedView }]}
      />
      {(!data?.items || data.items.length === 0) && !isFetching && <Empty description={tab === 'list' ? '暂无举报记录' : '暂无被举报的模板'} style={{ marginTop: 24 }} />}
    </Card>
  )
}
