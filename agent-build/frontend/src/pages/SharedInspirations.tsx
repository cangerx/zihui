import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Image,
  Input,
  List,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { categoriesApi, inspirationsApi } from '@/api/sharedInspirationHub'
import type {
  SharedInspiration,
  SharedInspirationStatus,
  SharedInspirationListResponse,
  SharedInspirationDetailResponse,
} from '@/types'

const { Title, Text, Paragraph } = Typography

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

const REASON_CODE_LABEL: Record<string, string> = {
  invalid_image: '图片无效',
  inappropriate: '内容不当',
  duplicate: '重复内容',
  copyright: '侵权',
  other: '其他',
}

/**
 * 共享灵感库 · 灵感池
 *
 * 平台后台审核运营页面：
 *  - 顶部 Stats（7 个数字 + Top sources / Top downloaded / 7 天分享趋势，可折叠）
 *  - 主表格（筛选 + 列表 + 强制通过/驳回 + 上下架 + 删除 + 批量删除）
 *  - 详情 Drawer（含 reviews 投票详情 + reports 举报记录）
 *
 * URL ?id=xxx 会自动打开对应详情，便于举报池页面跳转过来。
 */
export function SharedInspirationsPage() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<SharedInspirationStatus | undefined>()
  const [categoryId, setCategoryId] = useState<number | undefined>()
  const [visibility, setVisibility] = useState<'all' | 'visible' | 'hidden'>('all')
  const [search, setSearch] = useState('')
  const [sourceClientId, setSourceClientId] = useState<string>('')

  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([])
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const [rejectModalId, setRejectModalId] = useState<number | null>(null)
  const [rejectForm] = Form.useForm<{ reason: string }>()

  // URL ?id= 同步到 drawerId
  useEffect(() => {
    const idStr = searchParams.get('id')
    if (idStr) {
      const id = Number(idStr)
      if (!isNaN(id)) setDrawerId(id)
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
    queryKey: ['inspirationHub', 'stats'],
    queryFn: inspirationsApi.stats,
  })

  const { data: categories } = useQuery({
    queryKey: ['inspirationHub', 'categories'],
    queryFn: categoriesApi.list,
  })

  const { data, isFetching } = useQuery<SharedInspirationListResponse>({
    queryKey: ['inspirationHub', 'list', page, pageSize, status, categoryId, visibility, search, sourceClientId],
    queryFn: () =>
      inspirationsApi.list({
        page,
        page_size: pageSize,
        status,
        category_id: categoryId,
        visibility: visibility === 'all' ? undefined : visibility,
        search: search || undefined,
        source_client_id: sourceClientId || undefined,
      }),
  })

  const { data: detail, isFetching: detailLoading } = useQuery<SharedInspirationDetailResponse>({
    queryKey: ['inspirationHub', 'detail', drawerId],
    queryFn: () => inspirationsApi.get(drawerId as number),
    enabled: drawerId !== null,
  })

  const refreshList = () => {
    qc.invalidateQueries({ queryKey: ['inspirationHub', 'list'] })
    qc.invalidateQueries({ queryKey: ['inspirationHub', 'stats'] })
    if (drawerId !== null) {
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'detail', drawerId] })
    }
  }

  const forceApproveMut = useMutation({
    mutationFn: (id: number) => inspirationsApi.forceApprove(id),
    onSuccess: () => {
      message.success('已强制通过')
      refreshList()
    },
  })

  const forceRejectMut = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      inspirationsApi.forceReject(id, { reason }),
    onSuccess: () => {
      message.success('已强制驳回')
      setRejectModalId(null)
      rejectForm.resetFields()
      refreshList()
    },
  })

  const setVisibilityMut = useMutation({
    mutationFn: ({ id, is_visible }: { id: number; is_visible: boolean }) =>
      inspirationsApi.setVisibility(id, { is_visible }),
    onSuccess: (_, vars) => {
      message.success(vars.is_visible ? '已恢复显示' : '已下架')
      refreshList()
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: number) => inspirationsApi.remove(id),
    onSuccess: () => {
      message.success('已删除')
      if (drawerId !== null) closeDrawer()
      refreshList()
    },
  })

  const batchRemoveMut = useMutation({
    mutationFn: (ids: number[]) => inspirationsApi.batchRemove(ids),
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

  // ============ render ============

  const statsBlocks = (
    <Card size="small" style={{ marginBottom: 12 }}>
      <Row gutter={[16, 12]}>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Statistic title="灵感总数" value={stats?.stats.total ?? 0} loading={statsLoading} />
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Statistic
            title="待审核"
            value={stats?.stats.pending ?? 0}
            valueStyle={{ color: '#faad14' }}
            loading={statsLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Statistic
            title="已通过"
            value={stats?.stats.approved ?? 0}
            valueStyle={{ color: '#52c41a' }}
            loading={statsLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Statistic
            title="已驳回"
            value={stats?.stats.rejected ?? 0}
            valueStyle={{ color: '#ff4d4f' }}
            loading={statsLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Statistic
            title="隐藏中"
            value={stats?.stats.hidden ?? 0}
            valueStyle={{ color: '#8c8c8c' }}
            loading={statsLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Statistic
            title="举报池"
            value={stats?.stats.reports_open ?? 0}
            valueStyle={{ color: stats?.stats.reports_open ? '#ff4d4f' : undefined }}
            loading={statsLoading}
          />
        </Col>
        <Col xs={12} sm={8} md={6} lg={3}>
          <Statistic title="活跃审核员" value={stats?.stats.reviewers ?? 0} loading={statsLoading} />
        </Col>
        <Col xs={24} sm={24} md={24} lg={3}>
          <Statistic
            title="近 7 天分享"
            value={stats?.trend_7d.reduce((s, d) => s + d.count, 0) ?? 0}
            loading={statsLoading}
          />
        </Col>
      </Row>

      <Collapse
        ghost
        size="small"
        items={[
          {
            key: 'detail',
            label: <Text type="secondary">展开看 Top 来源 / Top 下载 / 7 天趋势</Text>,
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                  <Title level={5} style={{ marginTop: 0 }}>
                    Top 来源云控端（按分享数）
                  </Title>
                  {!stats?.top_sources?.length ? (
                    <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      size="small"
                      dataSource={stats.top_sources}
                      renderItem={(s) => (
                        <List.Item>
                          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Space size={4}>
                              <Text>{s.owner_name || '—'}</Text>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {s.domain}
                              </Text>
                            </Space>
                            <Tag>{s.cnt}</Tag>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}
                </Col>
                <Col xs={24} md={8}>
                  <Title level={5} style={{ marginTop: 0 }}>
                    Top 热度灵感
                  </Title>
                  {!stats?.top_downloaded?.length ? (
                    <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      size="small"
                      dataSource={stats.top_downloaded}
                      renderItem={(item) => (
                        <List.Item
                          style={{ cursor: 'pointer' }}
                          onClick={() => setDrawerId(item.id)}
                        >
                          <Space>
                            <img
                              src={item.cover_image}
                              alt=""
                              style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 4 }}
                            />
                            <div>
                              <div style={{ fontSize: 12 }}>{item.title}</div>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                来自 {item.source_site_name}
                              </Text>
                            </div>
                          </Space>
                          <Tag color="blue">{item.download_count}</Tag>
                        </List.Item>
                      )}
                    />
                  )}
                </Col>
                <Col xs={24} md={8}>
                  <Title level={5} style={{ marginTop: 0 }}>
                    近 7 天分享走势
                  </Title>
                  {!stats?.trend_7d ? null : (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {stats.trend_7d.map((d) => {
                        const max = Math.max(1, ...stats.trend_7d.map((x) => x.count))
                        const pct = (d.count / max) * 100
                        return (
                          <Space key={d.date} style={{ width: '100%' }}>
                            <Text style={{ fontSize: 12, width: 80, color: '#8c8c8c' }}>
                              {d.date.slice(5)}
                            </Text>
                            <Progress
                              percent={pct}
                              showInfo={false}
                              size="small"
                              style={{ flex: 1, minWidth: 100 }}
                            />
                            <Text style={{ fontSize: 12, width: 24, textAlign: 'right' }}>
                              {d.count}
                            </Text>
                          </Space>
                        )
                      })}
                    </Space>
                  )}
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </Card>
  )

  return (
    <>
      {statsBlocks}

      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>
            灵感池
          </Title>
          <Input.Search
            placeholder="搜索 标题 / 提示词 / 站名"
            allowClear
            style={{ width: 280 }}
            onSearch={(v) => {
              setSearch(v)
              setPage(1)
            }}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={[
              { label: '待审核', value: 'pending' },
              { label: '已通过', value: 'approved' },
              { label: '已驳回', value: 'rejected' },
            ]}
          />
          <Select
            allowClear
            placeholder="分类"
            style={{ width: 160 }}
            value={categoryId}
            onChange={(v) => {
              setCategoryId(v)
              setPage(1)
            }}
            options={(categories || []).map((c) => ({ label: c.name, value: c.id }))}
          />
          <Select
            placeholder="可见性"
            style={{ width: 120 }}
            value={visibility}
            onChange={(v) => {
              setVisibility(v)
              setPage(1)
            }}
            options={[
              { label: '全部', value: 'all' },
              { label: '显示中', value: 'visible' },
              { label: '已隐藏', value: 'hidden' },
            ]}
          />
          <Input
            placeholder="按 client_id 过滤来源"
            style={{ width: 180 }}
            value={sourceClientId}
            onChange={(e) => setSourceClientId(e.target.value)}
            onPressEnter={() => setPage(1)}
            allowClear
          />
        </Space>

        {selectedRowKeys.length > 0 && (
          <Space style={{ marginBottom: 12 }} wrap>
            <Text>已选 {selectedRowKeys.length} 条</Text>
            <Popconfirm
              title={`确认删除选中的 ${selectedRowKeys.length} 条灵感？`}
              description="删除后关联的投票/举报记录会一并清理。此操作不可撤销。"
              onConfirm={() => batchRemoveMut.mutate(selectedRowKeys)}
              overlayStyle={{ maxWidth: 320 }}
            >
              <Button size="small" danger loading={batchRemoveMut.isPending}>
                批量删除
              </Button>
            </Popconfirm>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>
              清除选中
            </Button>
          </Space>
        )}

        <Table<SharedInspiration>
          rowKey="id"
          loading={isFetching}
          dataSource={data?.items || []}
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
              title: '封面',
              dataIndex: 'cover_image',
              width: 80,
              render: (v: string) => (
                <Image
                  src={v}
                  alt=""
                  width={56}
                  height={56}
                  style={{ objectFit: 'cover', borderRadius: 4 }}
                  fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56'><rect width='56' height='56' fill='%23f0f0f0'/></svg>"
                />
              ),
            },
            {
              title: '标题 / 来源',
              ellipsis: true,
              render: (_, r) => (
                <div>
                  <div>
                    <a onClick={() => setDrawerId(r.id)}>{r.title}</a>
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    来自 {r.source_site_name}
                    {r.source_owner_name ? ` · ${r.source_owner_name}` : ''}
                  </Text>
                  <div style={{ marginTop: 4 }}>
                    <Space size={4} wrap>
                      {r.ref_images?.length ? <Tag color="cyan">参考图 {r.ref_images.length} 张</Tag> : null}
                      {r.generation_size ? <Tag>尺寸 {r.generation_size}</Tag> : null}
                    </Space>
                  </div>
                </div>
              ),
            },
            {
              title: '分类',
              dataIndex: 'category_name',
              width: 110,
              render: (v: string) => v || <Tag>—</Tag>,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (v: SharedInspirationStatus, r) => (
                <Space direction="vertical" size={2}>
                  <Tag color={STATUS_COLOR[v]}>{STATUS_LABEL[v]}</Tag>
                  {!r.is_visible && (
                    <Tooltip
                      title={
                        r.auto_hidden_at
                          ? `因举报于 ${r.auto_hidden_at} 自动下架`
                          : '已被平台手动下架'
                      }
                    >
                      <Tag color="default" style={{ marginRight: 0 }}>
                        已隐藏
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: '票数',
              width: 110,
              render: (_, r) => (
                <Space size={4}>
                  <Tooltip title="通过票数">
                    <Tag color="green">{r.approve_count}</Tag>
                  </Tooltip>
                  <Tooltip title="驳回票数">
                    <Tag color="red">{r.reject_count}</Tag>
                  </Tooltip>
                </Space>
              ),
            },
            {
              title: '举报',
              dataIndex: 'report_count',
              width: 70,
              render: (v: number) => (v > 0 ? <Tag color="volcano">{v}</Tag> : <Text type="secondary">0</Text>),
            },
            {
              title: '热度',
              dataIndex: 'download_count',
              width: 70,
              render: (v: number) => <Text>{v}</Text>,
            },
            {
              title: '分享时间',
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
              width: 220,
              fixed: 'right' as const,
              render: (_, r) => (
                <Space size={4} wrap>
                  <Button size="small" type="link" onClick={() => setDrawerId(r.id)}>
                    详情
                  </Button>
                  {r.status === 'pending' && (
                    <>
                      <Popconfirm
                        title="强制通过此灵感？"
                        description="无视投票阈值直接置为 approved。建议仅在审核员长期不投票或紧急情况下使用。"
                        onConfirm={() => forceApproveMut.mutate(r.id)}
                      >
                        <Button size="small" type="link" style={{ color: '#52c41a' }}>
                          强制通过
                        </Button>
                      </Popconfirm>
                      <Button
                        size="small"
                        type="link"
                        danger
                        onClick={() => {
                          rejectForm.resetFields()
                          setRejectModalId(r.id)
                        }}
                      >
                        强制驳回
                      </Button>
                    </>
                  )}
                  {r.status === 'approved' &&
                    (r.is_visible ? (
                      <Popconfirm
                        title="临时下架此灵感？"
                        description="云控端将看不到该灵感。可随时恢复显示。"
                        onConfirm={() => setVisibilityMut.mutate({ id: r.id, is_visible: false })}
                      >
                        <Button size="small" type="link">
                          下架
                        </Button>
                      </Popconfirm>
                    ) : (
                      <Button
                        size="small"
                        type="link"
                        onClick={() => setVisibilityMut.mutate({ id: r.id, is_visible: true })}
                      >
                        恢复显示
                      </Button>
                    ))}
                  <Popconfirm
                    title="永久删除此灵感？"
                    description="删除后关联的投票/举报记录会一并清理。此操作不可撤销。"
                    onConfirm={() => removeMut.mutate(r.id)}
                  >
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* 详情 Drawer */}
      <Drawer
        title={detail?.inspiration ? `灵感详情 #${detail.inspiration.id}` : '灵感详情'}
        open={drawerId !== null}
        onClose={closeDrawer}
        width={760}
        maskStyle={{ display: 'none' }}
      >
        {detailLoading || !detail ? (
          <Empty description="加载中..." />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Image
              src={detail.inspiration.cover_image}
              alt={detail.inspiration.title}
              style={{ borderRadius: 6, maxHeight: 320, objectFit: 'cover', width: '100%' }}
            />

            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="标题" span={2}>
                {detail.inspiration.title}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_COLOR[detail.inspiration.status]}>
                  {STATUS_LABEL[detail.inspiration.status]}
                </Tag>
                {!detail.inspiration.is_visible && (
                  <Tag color="default">已隐藏</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="分类">
                {detail.inspiration.category_name || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="尺寸">
                {detail.inspiration.generation_size || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="来源云控端">
                {detail.inspiration.source_owner_name || detail.inspiration.source_client_id}
                <br />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {detail.inspiration.source_domain || '客户端已被删除'} ·{' '}
                  {detail.inspiration.source_site_name}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="本地 ID">
                <Text code>{detail.inspiration.source_local_id}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="通过票数">
                <Text strong style={{ color: '#52c41a' }}>
                  {detail.inspiration.approve_count}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="驳回票数">
                <Text strong style={{ color: '#ff4d4f' }}>
                  {detail.inspiration.reject_count}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="举报数">
                <Text strong style={{ color: detail.inspiration.report_count > 0 ? '#ff4d4f' : undefined }}>
                  {detail.inspiration.report_count}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="热度">{detail.inspiration.download_count}</Descriptions.Item>
              <Descriptions.Item label="分享时间">{detail.inspiration.created_at}</Descriptions.Item>
              <Descriptions.Item label="结算时间">
                {detail.inspiration.reviewed_at || '—'}
              </Descriptions.Item>
              {detail.inspiration.auto_hidden_at && (
                <Descriptions.Item label="自动下架时间" span={2}>
                  <Text type="warning">{detail.inspiration.auto_hidden_at}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {!!detail.inspiration.ref_images?.length && (
              <Card size="small" title={`参考图（${detail.inspiration.ref_images.length}）`}>
                <Image.PreviewGroup>
                  <Space size={8} wrap>
                    {detail.inspiration.ref_images.map((url, index) => (
                      <Image
                        key={`${url}-${index}`}
                        src={url}
                        width={84}
                        height={84}
                        style={{ objectFit: 'cover', borderRadius: 4 }}
                      />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </Card>
            )}

            <Card size="small" title="提示词">
              {detail.inspiration.prompt_cn && (
                <Paragraph style={{ marginBottom: 8 }}>
                  <Tag color="blue">中</Tag> {detail.inspiration.prompt_cn}
                </Paragraph>
              )}
              {detail.inspiration.prompt_en && (
                <Paragraph style={{ marginBottom: 0 }}>
                  <Tag color="purple">EN</Tag> {detail.inspiration.prompt_en}
                </Paragraph>
              )}
              {!detail.inspiration.prompt_cn && !detail.inspiration.prompt_en && (
                <Text type="secondary">未填提示词</Text>
              )}
            </Card>

            <Tabs
              defaultActiveKey="reviews"
              items={[
                {
                  key: 'reviews',
                  label: `投票记录（${detail.reviews.length}）`,
                  children: detail.reviews.length === 0 ? (
                    <Empty description="暂无投票" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      size="small"
                      dataSource={detail.reviews}
                      renderItem={(rv) => (
                        <List.Item>
                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            <Space>
                              <Tag color={rv.action === 'approve' ? 'green' : 'red'}>
                                {rv.action === 'approve' ? '通过' : '驳回'}
                              </Tag>
                              <Text>
                                {rv.reviewer_owner_name || rv.reviewer_client_id}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {rv.reviewer_domain}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {rv.created_at}
                              </Text>
                            </Space>
                            {rv.reason && (
                              <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                                理由：{rv.reason}
                              </Text>
                            )}
                          </Space>
                        </List.Item>
                      )}
                    />
                  ),
                },
                {
                  key: 'reports',
                  label: `举报记录（${detail.reports.length}）`,
                  children: detail.reports.length === 0 ? (
                    <Empty description="暂无举报" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      size="small"
                      dataSource={detail.reports}
                      renderItem={(rp) => (
                        <List.Item>
                          <Space direction="vertical" size={2} style={{ width: '100%' }}>
                            <Space>
                              <Tag color="volcano">
                                {REASON_CODE_LABEL[rp.reason_code] || rp.reason_code}
                              </Tag>
                              <Text>
                                {rp.reporter_owner_name || rp.reporter_client_id}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {rp.reporter_domain}
                              </Text>
                              <Text type="secondary" style={{ fontSize: 11 }}>
                                {rp.created_at}
                              </Text>
                            </Space>
                            {rp.reason_note && (
                              <Text type="secondary" style={{ fontSize: 12, marginLeft: 4 }}>
                                备注：{rp.reason_note}
                              </Text>
                            )}
                          </Space>
                        </List.Item>
                      )}
                    />
                  ),
                },
              ]}
            />

            <Space wrap>
              {detail.inspiration.status === 'pending' && (
                <>
                  <Popconfirm
                    title="强制通过此灵感？"
                    onConfirm={() => forceApproveMut.mutate(detail.inspiration.id)}
                  >
                    <Button type="primary" loading={forceApproveMut.isPending}>
                      强制通过
                    </Button>
                  </Popconfirm>
                  <Button
                    danger
                    onClick={() => {
                      rejectForm.resetFields()
                      setRejectModalId(detail.inspiration.id)
                    }}
                  >
                    强制驳回
                  </Button>
                </>
              )}
              {detail.inspiration.status === 'approved' &&
                (detail.inspiration.is_visible ? (
                  <Popconfirm
                    title="临时下架此灵感？"
                    onConfirm={() =>
                      setVisibilityMut.mutate({ id: detail.inspiration.id, is_visible: false })
                    }
                  >
                    <Button>下架</Button>
                  </Popconfirm>
                ) : (
                  <Button
                    onClick={() =>
                      setVisibilityMut.mutate({ id: detail.inspiration.id, is_visible: true })
                    }
                    loading={setVisibilityMut.isPending}
                  >
                    恢复显示
                  </Button>
                ))}
              <Popconfirm
                title="永久删除此灵感？"
                onConfirm={() => removeMut.mutate(detail.inspiration.id)}
              >
                <Button danger loading={removeMut.isPending}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          </Space>
        )}
      </Drawer>

      {/* 强制驳回 Modal */}
      <Modal
        open={rejectModalId !== null}
        title="强制驳回"
        onOk={onForceRejectSubmit}
        onCancel={() => {
          setRejectModalId(null)
          rejectForm.resetFields()
        }}
        confirmLoading={forceRejectMut.isPending}
        width={460}
        maskStyle={{ display: 'none' }}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="平台强制驳回会无视投票阈值直接将状态置为 rejected。仅在内容明显违规需要紧急处理时使用。"
        />
        <Form form={rejectForm} layout="vertical" preserve={false}>
          <Form.Item
            label="驳回理由"
            name="reason"
            rules={[
              { required: true, message: '请填写驳回理由' },
              { min: 2, max: 255, message: '理由需 2-255 字' },
            ]}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                理由仅会留存在后台审计日志，不会通过 status-batch 接口推送给源站点
              </Text>
            }
          >
            <Input.TextArea rows={3} maxLength={255} showCount placeholder="例如：图片不可访问 / 内容违规 / ..." />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
