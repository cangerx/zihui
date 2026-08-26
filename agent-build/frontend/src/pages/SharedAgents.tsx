import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Form,
  Image,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  sharedAgentCategoriesApi,
  sharedAgentsApi,
  type SharedAgent,
  type SharedAgentDetailResponse,
  type SharedAgentListResponse,
  type SharedAgentStatus,
} from '@/api/sharedAgentHub'

const { Title, Text, Paragraph } = Typography

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

const TOOL_APPROVAL_LABEL: Record<string, string> = {
  off: '无需确认',
  destructive: '危险操作需确认',
  all: '全部需确认',
}

const REASON_CODE_LABEL: Record<string, string> = {
  invalid_image: '图片无效',
  inappropriate: '内容不当',
  duplicate: '重复内容',
  copyright: '侵权',
  other: '其他',
}

const isVisible = (v: boolean | 0 | 1) => v === true || v === 1
const isImageGen = (v: boolean | 0 | 1) => v === true || v === 1

export function SharedAgentsPage() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<SharedAgentStatus | undefined>()
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [visibility, setVisibility] = useState<'all' | 'visible' | 'hidden'>('all')
  const [search, setSearch] = useState('')
  const [sourceClientId, setSourceClientId] = useState('')
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const [rejectModalId, setRejectModalId] = useState<number | null>(null)
  const [rejectForm] = Form.useForm<{ reason: string }>()

  useEffect(() => {
    const idStr = searchParams.get('id')
    if (idStr) {
      const id = Number(idStr)
      if (!Number.isNaN(id)) setDrawerId(id)
    }
  }, [searchParams])

  const closeDrawer = () => {
    setDrawerId(null)
    if (searchParams.has('id')) {
      const next = new URLSearchParams(searchParams)
      next.delete('id')
      setSearchParams(next, { replace: true })
    }
  }

  const { data: stats, isFetching: statsLoading } = useQuery({
    queryKey: ['agentHub', 'stats'],
    queryFn: sharedAgentsApi.stats,
  })

  const { data: categories } = useQuery({
    queryKey: ['agentHub', 'categories'],
    queryFn: sharedAgentCategoriesApi.list,
  })

  const { data, isFetching } = useQuery<SharedAgentListResponse>({
    queryKey: ['agentHub', 'list', page, pageSize, status, categoryId, visibility, search, sourceClientId],
    queryFn: () => sharedAgentsApi.list({
      page,
      page_size: pageSize,
      status,
      category_id: categoryId,
      visibility: visibility === 'all' ? undefined : visibility,
      search: search || undefined,
      source_client_id: sourceClientId || undefined,
    }),
  })

  const { data: detail, isFetching: detailLoading } = useQuery<SharedAgentDetailResponse>({
    queryKey: ['agentHub', 'detail', drawerId],
    queryFn: () => sharedAgentsApi.get(drawerId as number),
    enabled: drawerId !== null,
  })

  const refreshList = () => {
    qc.invalidateQueries({ queryKey: ['agentHub', 'list'] })
    qc.invalidateQueries({ queryKey: ['agentHub', 'stats'] })
    if (drawerId !== null) qc.invalidateQueries({ queryKey: ['agentHub', 'detail', drawerId] })
  }

  const forceApproveMut = useMutation({
    mutationFn: (id: number) => sharedAgentsApi.forceApprove(id),
    onSuccess: () => {
      message.success('已强制通过')
      refreshList()
    },
  })

  const forceRejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => sharedAgentsApi.forceReject(id, { reason }),
    onSuccess: () => {
      message.success('已强制驳回')
      setRejectModalId(null)
      rejectForm.resetFields()
      refreshList()
    },
  })

  const setVisibilityMut = useMutation({
    mutationFn: ({ id, is_visible }: { id: number; is_visible: boolean }) => sharedAgentsApi.setVisibility(id, { is_visible }),
    onSuccess: (_, vars) => {
      message.success(vars.is_visible ? '已恢复显示' : '已下架')
      refreshList()
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: number) => sharedAgentsApi.remove(id),
    onSuccess: () => {
      message.success('已删除')
      if (drawerId !== null) closeDrawer()
      refreshList()
    },
  })

  const batchRemoveMut = useMutation({
    mutationFn: (ids: number[]) => sharedAgentsApi.batchRemove(ids),
    onSuccess: (resp) => {
      message.success(`已删除 ${resp.deleted_count} 条`)
      setSelectedRowKeys([])
      refreshList()
    },
  })

  const onForceRejectSubmit = async () => {
    if (rejectModalId === null) return
    const values = await rejectForm.validateFields()
    forceRejectMut.mutate({ id: rejectModalId, reason: values.reason })
  }

  const currentAgent = detail?.agent

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card size="small">
        <Row gutter={[16, 12]}>
          <Col xs={12} sm={8} md={6} lg={3}><Statistic title="智能体总数" value={stats?.stats.total ?? 0} loading={statsLoading} /></Col>
          <Col xs={12} sm={8} md={6} lg={3}><Statistic title="待审核" value={stats?.stats.pending ?? 0} valueStyle={{ color: '#faad14' }} loading={statsLoading} /></Col>
          <Col xs={12} sm={8} md={6} lg={3}><Statistic title="已通过" value={stats?.stats.approved ?? 0} valueStyle={{ color: '#52c41a' }} loading={statsLoading} /></Col>
          <Col xs={12} sm={8} md={6} lg={3}><Statistic title="已驳回" value={stats?.stats.rejected ?? 0} valueStyle={{ color: '#ff4d4f' }} loading={statsLoading} /></Col>
          <Col xs={12} sm={8} md={6} lg={3}><Statistic title="隐藏中" value={stats?.stats.hidden ?? 0} valueStyle={{ color: '#8c8c8c' }} loading={statsLoading} /></Col>
          <Col xs={12} sm={8} md={6} lg={3}><Statistic title="举报池" value={stats?.stats.reports_open ?? 0} valueStyle={{ color: stats?.stats.reports_open ? '#ff4d4f' : undefined }} loading={statsLoading} /></Col>
          <Col xs={12} sm={8} md={6} lg={3}><Statistic title="活跃审核员" value={stats?.stats.reviewers ?? 0} loading={statsLoading} /></Col>
          <Col xs={24} sm={24} md={24} lg={3}><Statistic title="近 7 天分享" value={stats?.trend_7d.reduce((sum, d) => sum + d.count, 0) ?? 0} loading={statsLoading} /></Col>
        </Row>
      </Card>

      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>数字员工 · 内容</Title>
          <Select allowClear placeholder="状态" style={{ width: 120 }} value={status} onChange={(v) => { setStatus(v); setPage(1) }} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))} />
          <Select allowClear placeholder="分类" style={{ width: 160 }} value={categoryId} onChange={(v) => { setCategoryId(v); setPage(1) }} options={(categories || []).map((c) => ({ value: c.id, label: c.name }))} />
          <Select style={{ width: 120 }} value={visibility} onChange={(v) => { setVisibility(v); setPage(1) }} options={[{ value: 'all', label: '全部显示' }, { value: 'visible', label: '仅上架' }, { value: 'hidden', label: '仅隐藏' }]} />
          <Input.Search placeholder="名称 / 描述 / 系统提示词" allowClear style={{ width: 240 }} value={search} onChange={(e) => setSearch(e.target.value)} onSearch={() => setPage(1)} />
          <Input placeholder="source_client_id" allowClear style={{ width: 180 }} value={sourceClientId} onChange={(e) => setSourceClientId(e.target.value)} onPressEnter={() => setPage(1)} />
          {selectedRowKeys.length > 0 && (
            <Popconfirm title={`确认删除选中的 ${selectedRowKeys.length} 条智能体？`} onConfirm={() => batchRemoveMut.mutate(selectedRowKeys)}>
              <Button danger loading={batchRemoveMut.isPending}>批量删除</Button>
            </Popconfirm>
          )}
        </Space>

        <Table<SharedAgent>
          rowKey="id"
          loading={isFetching}
          dataSource={data?.items || []}
          rowSelection={{ selectedRowKeys, onChange: (keys) => setSelectedRowKeys(keys as number[]) }}
          pagination={{ current: page, pageSize, total: data?.total || 0, showSizeChanger: true, onChange: (p, s) => { setPage(p); setPageSize(s) } }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 70 },
            {
              title: '智能体',
              width: 360,
              render: (_, r) => (
                <Space align="start">
                  {r.avatar ? <Image src={r.avatar} width={60} height={90} style={{ objectFit: 'cover', borderRadius: 6 }} preview={false} /> : <div style={{ width: 60, height: 90, background: '#f0f0f0', borderRadius: 6 }} />}
                  <div>
                    <a onClick={() => setDrawerId(r.id)}>{r.name}</a>
                    <div><Text type="secondary" style={{ fontSize: 12 }}>{r.category_name || '未分类'}</Text></div>
                    <Text type="secondary" style={{ fontSize: 12 }}>来自 {r.source_site_name || r.source_client_id}</Text>
                  </div>
                </Space>
              ),
            },
            { title: '状态', width: 130, render: (_, r) => <Space size={4}><Tag color={STATUS_COLOR[r.status]}>{STATUS_LABEL[r.status]}</Tag>{!isVisible(r.is_visible) && <Tag>已隐藏</Tag>}</Space> },
            { title: '票数', width: 150, render: (_, r) => <Space size={4}><Tag color="green">通过 {r.approve_count}</Tag><Tag color="red">驳回 {r.reject_count}</Tag></Space> },
            { title: '举报', dataIndex: 'report_count', width: 80, align: 'center' as const, render: (v: number) => <Tag color={v > 0 ? 'volcano' : 'default'}>{v}</Tag> },
            { title: '下载', dataIndex: 'download_count', width: 80, align: 'center' as const },
            { title: '分享时间', dataIndex: 'created_at', width: 170, render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text> },
            {
              title: '操作',
              width: 250,
              fixed: 'right' as const,
              render: (_, r) => (
                <Space size={4} wrap>
                  <Button size="small" type="link" onClick={() => setDrawerId(r.id)}>详情</Button>
                  {r.status !== 'approved' && <Button size="small" type="link" onClick={() => forceApproveMut.mutate(r.id)}>通过</Button>}
                  {r.status !== 'rejected' && <Button size="small" type="link" danger onClick={() => setRejectModalId(r.id)}>驳回</Button>}
                  <Button size="small" type="link" onClick={() => setVisibilityMut.mutate({ id: r.id, is_visible: !isVisible(r.is_visible) })}>{isVisible(r.is_visible) ? '下架' : '上架'}</Button>
                  <Popconfirm title="确认删除该智能体？" onConfirm={() => removeMut.mutate(r.id)}><Button size="small" type="link" danger>删除</Button></Popconfirm>
                </Space>
              ),
            },
          ]}
          scroll={{ x: 1300 }}
        />
      </Card>

      <Drawer open={drawerId !== null} title={currentAgent ? `智能体详情 #${currentAgent.id}` : '智能体详情'} onClose={closeDrawer} width={760} loading={detailLoading} mask={false}>
        {currentAgent && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Space align="start">
              {currentAgent.avatar && <Image src={currentAgent.avatar} width={140} height={210} style={{ objectFit: 'cover', borderRadius: 8 }} />}
              <Space direction="vertical" size={4}>
                <Title level={5} style={{ margin: 0 }}>{currentAgent.name}</Title>
                <Space size={4}><Tag color={STATUS_COLOR[currentAgent.status]}>{STATUS_LABEL[currentAgent.status]}</Tag>{!isVisible(currentAgent.is_visible) && <Tag>已隐藏</Tag>}</Space>
                <Text type="secondary">{currentAgent.description || '无描述'}</Text>
              </Space>
            </Space>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="分类">{currentAgent.category_name || currentAgent.category_id}</Descriptions.Item>
              <Descriptions.Item label="工具审批">{TOOL_APPROVAL_LABEL[currentAgent.tool_approval] || currentAgent.tool_approval || '未设置'}</Descriptions.Item>
              <Descriptions.Item label="图片生成">{isImageGen(currentAgent.enable_image_gen) ? '已开启' : '未开启'}</Descriptions.Item>
              <Descriptions.Item label="来源站点">{currentAgent.source_site_name}</Descriptions.Item>
              <Descriptions.Item label="source_client_id" span={2}>{currentAgent.source_client_id}</Descriptions.Item>
              <Descriptions.Item label="下载次数">{currentAgent.download_count}</Descriptions.Item>
              <Descriptions.Item label="举报次数">{currentAgent.report_count}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title="系统提示词"><Paragraph copyable style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{currentAgent.system_prompt || '无'}</Paragraph></Card>
            <Card size="small" title="工具技能">
              {currentAgent.tool_skill_ids?.length ? <Space wrap>{currentAgent.tool_skill_ids.map((t) => <Tag key={t}>{t}</Tag>)}</Space> : <Text type="secondary">无工具技能</Text>}
            </Card>
            <Card size="small" title="标签">
              {currentAgent.tags?.length ? <Space wrap>{currentAgent.tags.map((t) => <Tag key={t} color="blue">{t}</Tag>)}</Space> : <Text type="secondary">无标签</Text>}
            </Card>
            <Card size="small" title="审核记录">
              {detail?.reviews?.length ? <List size="small" dataSource={detail.reviews} renderItem={(r) => <List.Item><Space><Tag color={r.action === 'approve' ? 'green' : 'red'}>{r.action === 'approve' ? '通过' : '驳回'}</Tag><Text>{r.reviewer_owner_name || r.reviewer_client_id}</Text><Text type="secondary">{r.reason || '无理由'}</Text><Text type="secondary">{r.created_at}</Text></Space></List.Item>} /> : <Text type="secondary">暂无审核记录</Text>}
            </Card>
            <Card size="small" title="举报记录">
              {detail?.reports?.length ? <List size="small" dataSource={detail.reports} renderItem={(r) => <List.Item><Space><Tag>{REASON_CODE_LABEL[r.reason_code] || r.reason_code}</Tag><Text>{r.reporter_owner_name || r.reporter_client_id}</Text><Text type="secondary">{r.reason_note || '无备注'}</Text><Text type="secondary">{r.created_at}</Text></Space></List.Item>} /> : <Text type="secondary">暂无举报</Text>}
            </Card>
          </Space>
        )}
      </Drawer>

      <Modal open={rejectModalId !== null} title="强制驳回智能体" onOk={onForceRejectSubmit} onCancel={() => { setRejectModalId(null); rejectForm.resetFields() }} confirmLoading={forceRejectMut.isPending} maskStyle={{ display: 'none' }} destroyOnClose>
        <Form form={rejectForm} layout="vertical" preserve={false}>
          <Form.Item name="reason" label="驳回理由" rules={[{ required: true, min: 2, max: 255, message: '请输入 2-255 字驳回理由' }]}>
            <Input.TextArea rows={4} placeholder="说明驳回原因" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
