import { useMemo, useState } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Input,
  Select,
  Modal,
  Form,
  InputNumber,
  Progress,
  Typography,
  Popconfirm,
  Switch,
  Tag,
  Radio,
  Alert,
  Descriptions,
  Tooltip,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PACKAGING_RETIRED } from '@/packagingRetired'
import {
  clientsApi,
  type ClientCreatePayload,
  type ClientUpdatePayload,
  type ClientBatchImportPayload,
  type ClientBatchItemResult,
  type QuotaResetScope,
} from '@/api/clients'
import type { BuildClient, ClientStatus, MallKey, PackagingFeature } from '@/types'
import { ClientStatusBadge } from '@/components/StatusBadge'

const { Title, Text, Paragraph } = Typography
const noMaskStyle = { display: 'none' as const }

/**
 * 商城注册表（前端）：新增第 N 个商城在此追加一项即可（列开关、批量按钮自动按此渲染）。
 * mall_key 死契约：严格 'ewei' / 'dianda'，与后端 / 桌面端一致。
 * label 为后台管理可见的真名（终端用户永远只看到云控端自定义商城名，不暴露此真名）。
 */
const MALL_OPTIONS: Array<{ key: MallKey; label: string; columnTitle: string; tip: string }> = [
  {
    key: 'ewei',
    label: 'eweishop',
    columnTitle: '店铺图(ewei)',
    tip: '店铺商品图 - eweishop：开放后该云控端可对旗下用户开放该商城的店铺商品图（云控端再做 per-user 二级门控）',
  },
  {
    key: 'dianda',
    label: '点大商城',
    columnTitle: '店铺图(点大)',
    tip: '店铺商品图 - 点大商城：开放后该云控端可对旗下用户开放该商城的店铺商品图（云控端再做 per-user 二级门控）',
  },
  {
    key: 'qdyun',
    label: '全端云商城',
    columnTitle: '店铺图(全端云)',
    tip: '店铺商品图 - 全端云商城：开放后该云控端可对旗下用户开放该商城的店铺商品图（云控端再做 per-user 二级门控）',
  },
]

/** 取某 client 对某商城的授权位：优先 mall_authorizations，ewei 回退旧字段 can_use_ewei_shop */
function getMallAuth(client: BuildClient, mallKey: MallKey): boolean {
  const fromMap = client.mall_authorizations?.[mallKey]
  if (typeof fromMap === 'boolean') return fromMap
  if (mallKey === 'ewei') return !!client.can_use_ewei_shop
  return false
}

const STATUS_LABEL: Record<ClientStatus, string> = {
  active: '正常',
  suspended: '停用',
  expired: '过期',
}

const BATCH_ITEM_STATUS_LABEL: Record<string, string> = {
  ok: '成功',
  duplicate: '域名已存在',
  invalid: '格式不合法',
  not_found: '客户端不存在',
  has_active_builds: '有进行中的打包任务',
}

export function ClientsPage() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ClientStatus | undefined>()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<BuildClient | null>(null)
  const [form] = Form.useForm()

  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])

  const [importOpen, setImportOpen] = useState(false)
  const [importForm] = Form.useForm()
  const [importDomainsText, setImportDomainsText] = useState('')

  const [batchStatusOpen, setBatchStatusOpen] = useState(false)
  const [batchTargetStatus, setBatchTargetStatus] = useState<ClientStatus>('suspended')

  const [batchResetOpen, setBatchResetOpen] = useState(false)
  const [batchResetScope, setBatchResetScope] = useState<QuotaResetScope>('today')

  const [batchLimitOpen, setBatchLimitOpen] = useState(false)
  const [batchLimitForm] = Form.useForm()

  const [batchResult, setBatchResult] = useState<{
    title: string
    success: number
    failed: number
    failures: ClientBatchItemResult[]
  } | null>(null)

  const { data, isFetching } = useQuery({
    queryKey: ['clients', page, pageSize, search, statusFilter],
    queryFn: () =>
      clientsApi.list({
        page,
        page_size: pageSize,
        search: search || undefined,
        status: statusFilter,
      }),
  })

  const createMut = useMutation({
    mutationFn: (payload: ClientCreatePayload) => clientsApi.create(payload),
    onSuccess: () => {
      message.success('已新建')
      setFormOpen(false)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ClientUpdatePayload }) =>
      clientsApi.update(id, payload),
    onSuccess: () => {
      message.success('已保存')
      setFormOpen(false)
      setEditing(null)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => clientsApi.remove(id),
    onSuccess: () => {
      message.success('已删除')
      qc.invalidateQueries({ queryKey: ['clients'] })
    },
  })

  const batchImportMut = useMutation({
    mutationFn: (payload: ClientBatchImportPayload) => clientsApi.batchImport(payload),
    onSuccess: (resp) => {
      setImportOpen(false)
      importForm.resetFields()
      setImportDomainsText('')
      qc.invalidateQueries({ queryKey: ['clients'] })
      setBatchResult({
        title: '批量导入结果',
        success: resp.success_count,
        failed: resp.failed_count,
        failures: resp.results.filter((r) => r.status !== 'ok'),
      })
    },
  })

  const batchDeleteMut = useMutation({
    mutationFn: (client_ids: string[]) => clientsApi.batchDelete({ client_ids }),
    onSuccess: (resp) => {
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['clients'] })
      setBatchResult({
        title: '批量删除结果',
        success: resp.success_count,
        failed: resp.failed_count,
        failures: resp.results.filter((r) => r.status !== 'ok'),
      })
    },
  })

  const batchUpdateStatusMut = useMutation({
    mutationFn: ({ client_ids, status }: { client_ids: string[]; status: ClientStatus }) =>
      clientsApi.batchUpdateStatus({ client_ids, status }),
    onSuccess: (resp) => {
      setBatchStatusOpen(false)
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(`已把 ${resp.success_count} 条客户端状态改为 ${STATUS_LABEL[resp.target_status]}`)
    },
  })

  const batchResetQuotaMut = useMutation({
    mutationFn: ({ client_ids, scope }: { client_ids: string[]; scope: QuotaResetScope }) =>
      clientsApi.batchResetQuota({ client_ids, scope }),
    onSuccess: (resp) => {
      setBatchResetOpen(false)
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['clients'] })
      const scopeLabel = { today: '今日', month: '本月', all: '全部' }[resp.scope]
      message.success(`已重置 ${resp.client_count} 个客户端的${scopeLabel}配额（清除 ${resp.deleted_records} 条记录）`)
    },
  })

  const batchUpdateLimitMut = useMutation({
    mutationFn: ({
      client_ids,
      daily_limit,
      monthly_limit,
    }: { client_ids: string[]; daily_limit?: number | null; monthly_limit?: number | null }) =>
      clientsApi.batchUpdateLimit({ client_ids, daily_limit, monthly_limit }),
    onSuccess: (resp) => {
      setBatchLimitOpen(false)
      batchLimitForm.resetFields()
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['clients'] })
      const parts: string[] = []
      if (resp.daily_limit !== null) parts.push(`日配额 ${resp.daily_limit}`)
      if (resp.monthly_limit !== null) parts.push(`月配额 ${resp.monthly_limit}`)
      message.success(`已把 ${resp.success_count} 条客户端的${parts.join('、')}更新成功`)
    },
  })

  // 共享灵感库审核员任命（单条在表格 Switch onChange 中调用，批量在顶部批量按钮调用）
  const setReviewerMut = useMutation({
    mutationFn: ({ client_id, is_hub_reviewer }: { client_id: string; is_hub_reviewer: boolean }) =>
      clientsApi.setReviewer(client_id, { is_hub_reviewer }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(resp.is_hub_reviewer ? '已任命为审核员' : '已取消审核员')
    },
  })

  const batchSetReviewerMut = useMutation({
    mutationFn: ({ client_ids, is_hub_reviewer }: { client_ids: string[]; is_hub_reviewer: boolean }) =>
      clientsApi.batchSetReviewer({ client_ids, is_hub_reviewer }),
    onSuccess: (resp) => {
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(
        `已把 ${resp.success_count} 条客户端${resp.is_hub_reviewer ? '设为' : '取消'}审核员`,
      )
    },
  })

  // 维护期可打包豁免（单条在表格 Switch onChange 中调用，批量在顶部批量按钮调用）
  const setMaintenanceExemptMut = useMutation({
    mutationFn: ({ client_id, maintenance_exempt }: { client_id: string; maintenance_exempt: boolean }) =>
      clientsApi.setMaintenanceExempt(client_id, { maintenance_exempt }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(resp.maintenance_exempt ? '已设为维护期可打包' : '已取消维护期可打包')
    },
  })

  const batchSetMaintenanceExemptMut = useMutation({
    mutationFn: ({ client_ids, maintenance_exempt }: { client_ids: string[]; maintenance_exempt: boolean }) =>
      clientsApi.batchSetMaintenanceExempt({ client_ids, maintenance_exempt }),
    onSuccess: (resp) => {
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(
        `已把 ${resp.success_count} 条客户端${resp.maintenance_exempt ? '设为' : '取消'}维护期可打包`,
      )
    },
  })

  // 「店铺商品图」按商城一级授权（单条在表格 Switch onChange 中调用，批量在顶部批量按钮调用）。
  // 走通用 setMallAuth/batchSetMallAuth（mall_key in 'ewei'|'dianda'）；ewei 后端会同步回写旧列。
  const mallLabel = (k: MallKey) => MALL_OPTIONS.find((m) => m.key === k)?.label ?? k

  const setMallAuthMut = useMutation({
    mutationFn: ({ client_id, mall_key, authorized }: { client_id: string; mall_key: MallKey; authorized: boolean }) =>
      clientsApi.setMallAuth(client_id, { mall_key, authorized }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(
        `已${resp.authorized ? '开放' : '关闭'}「${mallLabel(resp.mall_key)}」店铺商品图`,
      )
    },
  })

  const batchSetMallAuthMut = useMutation({
    mutationFn: ({ client_ids, mall_key, authorized }: { client_ids: string[]; mall_key: MallKey; authorized: boolean }) =>
      clientsApi.batchSetMallAuth({ client_ids, mall_key, authorized }),
    onSuccess: (resp) => {
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(
        `已把 ${resp.success_count} 条客户端${resp.authorized ? '开放' : '关闭'}「${mallLabel(resp.mall_key)}」店铺商品图`,
      )
    },
  })

  const packagingLabel = (f: PackagingFeature) => (f === 'mac' ? 'Mac 打包授权' : '云控端打包授权')

  const setPackagingAuthMut = useMutation({
    mutationFn: ({ client_id, feature, authorized }: { client_id: string; feature: PackagingFeature; authorized: boolean }) =>
      clientsApi.setPackagingAuth(client_id, { feature, authorized }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(`已${resp.authorized ? '开放' : '关闭'}「${packagingLabel(resp.feature)}」`)
    },
  })

  const batchSetPackagingAuthMut = useMutation({
    mutationFn: ({ client_ids, feature, authorized }: { client_ids: string[]; feature: PackagingFeature; authorized: boolean }) =>
      clientsApi.batchSetPackagingAuth({ client_ids, feature, authorized }),
    onSuccess: (resp) => {
      setSelectedRowKeys([])
      qc.invalidateQueries({ queryKey: ['clients'] })
      message.success(`已把 ${resp.success_count} 条客户端${resp.authorized ? '开放' : '关闭'}「${packagingLabel(resp.feature)}」`)
    },
  })

  // 批量授权弹窗状态：选商城 + 开/关
  const [batchMallOpen, setBatchMallOpen] = useState(false)
  const [batchMallKey, setBatchMallKey] = useState<MallKey>(MALL_OPTIONS[0].key)
  const [batchMallAuthorized, setBatchMallAuthorized] = useState(true)
  const [batchPackagingOpen, setBatchPackagingOpen] = useState(false)
  const [batchPackagingFeature, setBatchPackagingFeature] = useState<PackagingFeature>('win')
  const [batchPackagingAuthorized, setBatchPackagingAuthorized] = useState(true)

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ daily_limit: 3, monthly_limit: 30 })
    setFormOpen(true)
  }

  const openEdit = (record: BuildClient) => {
    setEditing(record)
    form.setFieldsValue({
      domain: record.domain,
      owner_name: record.owner_name,
      owner_phone: record.owner_phone,
      daily_limit: record.daily_limit,
      monthly_limit: record.monthly_limit,
      status: record.status,
      expires_at: record.expires_at,
    })
    setFormOpen(true)
  }

  const onSubmit = async () => {
    const values = await form.validateFields()
    if (editing) {
      updateMut.mutate({ id: editing.client_id, payload: values })
    } else {
      createMut.mutate(values)
    }
  }

  const openImport = () => {
    importForm.resetFields()
    importForm.setFieldsValue({ daily_limit: 3, monthly_limit: 30 })
    setImportDomainsText('')
    setImportOpen(true)
  }

  const parsedImportDomains = useMemo(() => {
    return importDomainsText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s !== '')
  }, [importDomainsText])

  const onImportSubmit = async () => {
    if (parsedImportDomains.length === 0) {
      message.warning('请至少粘贴一个域名')
      return
    }
    const values = await importForm.validateFields()
    batchImportMut.mutate({
      domains: parsedImportDomains,
      owner_name: values.owner_name,
      owner_phone: values.owner_phone,
      daily_limit: values.daily_limit,
      monthly_limit: values.monthly_limit,
      expires_at: values.expires_at,
    })
  }

  const openBatchStatus = () => {
    setBatchTargetStatus('suspended')
    setBatchStatusOpen(true)
  }

  const onBatchStatusConfirm = () => {
    batchUpdateStatusMut.mutate({
      client_ids: selectedRowKeys,
      status: batchTargetStatus,
    })
  }

  const onBatchDelete = () => {
    batchDeleteMut.mutate(selectedRowKeys)
  }

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Title level={5} style={{ margin: 0, marginRight: 16 }}>
          云控站点
        </Title>
        <Input.Search
          placeholder="搜索 域名 / 负责人 / 手机号"
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
          value={statusFilter}
          onChange={(v) => {
            setStatusFilter(v)
            setPage(1)
          }}
          options={[
            { label: '正常', value: 'active' },
            { label: '停用', value: 'suspended' },
            { label: '过期', value: 'expired' },
          ]}
        />
        <Button type="primary" onClick={openCreate}>
          新建客户端
        </Button>
        <Button onClick={openImport}>批量导入</Button>
      </Space>

      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 12 }} wrap>
          <Text>已选 {selectedRowKeys.length} 条</Text>
          <Button size="small" onClick={openBatchStatus}>
            批量修改状态
          </Button>
          {!PACKAGING_RETIRED && (
            <>
          <Button size="small" onClick={() => { setBatchResetScope('today'); setBatchResetOpen(true) }}>
            批量重置额度
          </Button>
          <Button size="small" onClick={() => { batchLimitForm.resetFields(); setBatchLimitOpen(true) }}>
            批量修改配额
          </Button>
            </>
          )}
          <Popconfirm
            title={`确认任命选中的 ${selectedRowKeys.length} 条云控端为「共享灵感库审核员」？`}
            description="被任命后，其可在云控端看到待审池并投票（通过/驳回）。不会提示被任命方。"
            onConfirm={() => batchSetReviewerMut.mutate({ client_ids: selectedRowKeys, is_hub_reviewer: true })}
            overlayStyle={{ maxWidth: 320 }}
          >
            <Button size="small" loading={batchSetReviewerMut.isPending}>
              批量设为审核员
            </Button>
          </Popconfirm>
          <Popconfirm
            title={`确认取消选中的 ${selectedRowKeys.length} 条云控端的审核员身份？`}
            description="取消后该云控端将看不到待审池，已投过的票保留。"
            onConfirm={() => batchSetReviewerMut.mutate({ client_ids: selectedRowKeys, is_hub_reviewer: false })}
            overlayStyle={{ maxWidth: 320 }}
          >
            <Button size="small" loading={batchSetReviewerMut.isPending}>
              批量取消审核员
            </Button>
          </Popconfirm>
          {!PACKAGING_RETIRED && (
            <>
          <Popconfirm
            title={`确认让选中的 ${selectedRowKeys.length} 条云控端「维护期可打包」？`}
            description="开启后，即使平台全局打包维护已开启，这些云控端仍可正常提交打包（用于指定客户端做生产测试）。"
            onConfirm={() => batchSetMaintenanceExemptMut.mutate({ client_ids: selectedRowKeys, maintenance_exempt: true })}
            overlayStyle={{ maxWidth: 320 }}
          >
            <Button size="small" loading={batchSetMaintenanceExemptMut.isPending}>
              批量设为维护期可打包
            </Button>
          </Popconfirm>
          <Popconfirm
            title={`确认取消选中的 ${selectedRowKeys.length} 条云控端的「维护期可打包」？`}
            description="取消后，平台维护期这些云控端将与其他客户端一样暂停打包。"
            onConfirm={() => batchSetMaintenanceExemptMut.mutate({ client_ids: selectedRowKeys, maintenance_exempt: false })}
            overlayStyle={{ maxWidth: 320 }}
          >
            <Button size="small" loading={batchSetMaintenanceExemptMut.isPending}>
              批量取消维护期可打包
            </Button>
          </Popconfirm>
            </>
          )}
          <Button
            size="small"
            loading={batchSetMallAuthMut.isPending}
            onClick={() => {
              setBatchMallKey(MALL_OPTIONS[0].key)
              setBatchMallAuthorized(true)
              setBatchMallOpen(true)
            }}
          >
            批量设置店铺商品图授权
          </Button>
          <Button
            size="small"
            loading={batchSetPackagingAuthMut.isPending}
            onClick={() => {
              setBatchPackagingFeature('win')
              setBatchPackagingAuthorized(true)
              setBatchPackagingOpen(true)
            }}
          >
            批量设置打包授权
          </Button>
          <Popconfirm
            title={`确认删除选中的 ${selectedRowKeys.length} 条客户端？`}
            description="有进行中打包任务的条目会跳过不删；配额记录会一并清空。"
            onConfirm={onBatchDelete}
            overlayStyle={{ maxWidth: 320 }}
          >
            <Button size="small" danger loading={batchDeleteMut.isPending}>
              批量删除
            </Button>
          </Popconfirm>
          <Button size="small" onClick={() => setSelectedRowKeys([])}>
            清除选中
          </Button>
        </Space>
      )}

      <Table<BuildClient>
        rowKey="client_id"
        loading={isFetching}
        dataSource={data?.items || []}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
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
          { title: '域名', dataIndex: 'domain', ellipsis: true },
          { title: '负责人', dataIndex: 'owner_name', width: 120 },
          {
            title: '手机号',
            dataIndex: 'owner_phone',
            width: 140,
            render: (v: string | null) => v || <Tag>未填</Tag>,
          },
          ...(PACKAGING_RETIRED
            ? []
            : [
                {
                  title: '配额（已用 / 上限）',
                  width: 200,
                  render: (_: unknown, r: BuildClient) => {
                    const dailyPct = r.daily_limit > 0 ? Math.min(100, (r.daily_used / r.daily_limit) * 100) : 0
                    const monthlyPct = r.monthly_limit > 0 ? Math.min(100, (r.monthly_used / r.monthly_limit) * 100) : 0
                    const dailyExceeded = r.daily_used >= r.daily_limit
                    const monthlyExceeded = r.monthly_used >= r.monthly_limit
                    return (
                      <div style={{ lineHeight: 1.4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span>日</span>
                          <span style={{ color: dailyExceeded ? '#ff4d4f' : undefined, fontWeight: dailyExceeded ? 600 : 400 }}>
                            {r.daily_used} / {r.daily_limit}
                          </span>
                        </div>
                        <Progress
                          percent={dailyPct}
                          showInfo={false}
                          size="small"
                          status={dailyExceeded ? 'exception' : 'normal'}
                          style={{ marginBottom: 2 }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                          <span>月</span>
                          <span style={{ color: monthlyExceeded ? '#ff4d4f' : undefined, fontWeight: monthlyExceeded ? 600 : 400 }}>
                            {r.monthly_used} / {r.monthly_limit}
                          </span>
                        </div>
                        <Progress
                          percent={monthlyPct}
                          showInfo={false}
                          size="small"
                          status={monthlyExceeded ? 'exception' : 'normal'}
                        />
                      </div>
                    )
                  },
                },
              ]),
          {
            title: '状态',
            dataIndex: 'status',
            width: 100,
            render: (v: ClientStatus) => <ClientStatusBadge status={v} />,
          },
          {
            title: (
              <Tooltip title="共享灵感库审核员：被任命后可在云控端「待审池」页面投票通过或驳回其他云控端提交的共享灵感">
                <span style={{ borderBottom: '1px dashed #aaa', cursor: 'help' }}>审核员</span>
              </Tooltip>
            ),
            dataIndex: 'is_hub_reviewer',
            width: 90,
            align: 'center' as const,
            render: (v: boolean | undefined, r) => (
              <Switch
                size="small"
                checked={!!v}
                loading={
                  setReviewerMut.isPending &&
                  setReviewerMut.variables?.client_id === r.client_id
                }
                onChange={(checked) =>
                  setReviewerMut.mutate({ client_id: r.client_id, is_hub_reviewer: checked })
                }
              />
            ),
          },
          ...(PACKAGING_RETIRED
            ? []
            : [
                {
                  title: (
                    <Tooltip title="维护期可打包：开启后，即使平台「云打包维护」全局开关已开启，该云控端仍可正常提交打包，用于指定客户端做生产测试">
                      <span style={{ borderBottom: '1px dashed #aaa', cursor: 'help' }}>维护期可打包</span>
                    </Tooltip>
                  ),
                  dataIndex: 'maintenance_exempt',
                  width: 110,
                  align: 'center' as const,
                  render: (v: boolean | undefined, r: BuildClient) => (
                    <Switch
                      size="small"
                      checked={!!v}
                      loading={
                        setMaintenanceExemptMut.isPending &&
                        setMaintenanceExemptMut.variables?.client_id === r.client_id
                      }
                      onChange={(checked) =>
                        setMaintenanceExemptMut.mutate({ client_id: r.client_id, maintenance_exempt: checked })
                      }
                    />
                  ),
                },
              ]),
          // 按商城渲染：每个商城一列开关（mall_key 死契约 'ewei'/'dianda'）
          {
            title: (
              <Tooltip title="云控端打包授权：开放后该云控可配置 GitHub 并提交 Windows 打包">
                <span style={{ borderBottom: '1px dashed #aaa', cursor: 'help' }}>云控端打包</span>
              </Tooltip>
            ),
            key: 'packaging_win',
            width: 110,
            align: 'center' as const,
            render: (_: unknown, r: BuildClient) => (
              <Switch
                size="small"
                checked={!!r.can_use_github_packaging}
                loading={
                  setPackagingAuthMut.isPending &&
                  setPackagingAuthMut.variables?.client_id === r.client_id &&
                  setPackagingAuthMut.variables?.feature === 'win'
                }
                onChange={(checked) =>
                  setPackagingAuthMut.mutate({ client_id: r.client_id, feature: 'win', authorized: checked })
                }
              />
            ),
          },
          {
            title: (
              <Tooltip title="Mac 打包授权：打 Mac 还须同时开通云控端打包授权">
                <span style={{ borderBottom: '1px dashed #aaa', cursor: 'help' }}>Mac 打包</span>
              </Tooltip>
            ),
            key: 'packaging_mac',
            width: 100,
            align: 'center' as const,
            render: (_: unknown, r: BuildClient) => (
              <Switch
                size="small"
                checked={!!r.can_use_mac_packaging}
                loading={
                  setPackagingAuthMut.isPending &&
                  setPackagingAuthMut.variables?.client_id === r.client_id &&
                  setPackagingAuthMut.variables?.feature === 'mac'
                }
                onChange={(checked) =>
                  setPackagingAuthMut.mutate({ client_id: r.client_id, feature: 'mac', authorized: checked })
                }
              />
            ),
          },
          ...MALL_OPTIONS.map((mall) => ({
            title: (
              <Tooltip title={mall.tip}>
                <span style={{ borderBottom: '1px dashed #aaa', cursor: 'help' }}>{mall.columnTitle}</span>
              </Tooltip>
            ),
            key: `mall_${mall.key}`,
            width: 110,
            align: 'center' as const,
            render: (_: unknown, r: BuildClient) => (
              <Switch
                size="small"
                checked={getMallAuth(r, mall.key)}
                loading={
                  setMallAuthMut.isPending &&
                  setMallAuthMut.variables?.client_id === r.client_id &&
                  setMallAuthMut.variables?.mall_key === mall.key
                }
                onChange={(checked) =>
                  setMallAuthMut.mutate({ client_id: r.client_id, mall_key: mall.key, authorized: checked })
                }
              />
            ),
          })),
          {
            title: '过期时间',
            dataIndex: 'expires_at',
            width: 160,
            render: (v) => v || <Tag>不限</Tag>,
          },
          {
            title: '操作',
            width: 160,
            render: (_, r) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该客户端？"
                  description="若有进行中的打包任务将拒绝删除。"
                  onConfirm={() => removeMut.mutate(r.client_id)}
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

      {/* 新建 / 编辑 Modal */}
      <Modal
        open={formOpen}
        title={editing ? `编辑客户端 - ${editing.domain}` : '新建客户端'}
        onOk={onSubmit}
        onCancel={() => {
          setFormOpen(false)
          setEditing(null)
          form.resetFields()
        }}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={520}
        maskStyle={noMaskStyle}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false} preserve={false}>
          <Form.Item
            label="授权域名 / IP"
            name="domain"
            rules={[
              { required: true, message: '请输入授权域名 / IP' },
              {
                validator: (_, v) => {
                  if (!v) return Promise.resolve()
                  const raw = String(v).trim().replace(/\/+$/, '')
                  const candidate = /^[a-z][a-z0-9+\-.]*:\/\//i.test(raw) ? raw : `https://${raw}`
                  try {
                    const u = new URL(candidate)
                    return u.hostname ? Promise.resolve() : Promise.reject(new Error('无法识别域名 / IP'))
                  } catch {
                    return Promise.reject(new Error('格式不正确：支持域名 / IP / IP:端口，可不带 http(s) 前缀'))
                  }
                },
              },
            ]}
            extra="支持域名 / IP / IP:端口，可不带 http(s) 前缀；按 host 比对放行（忽略 http/https 与端口差异），存储时统一归一化"
          >
            <Input placeholder="admin.example.com 或 1.2.3.4:8080" />
          </Form.Item>
          <Form.Item label="客户姓名" name="owner_name" rules={[{ required: true, max: 100 }]}>
            <Input placeholder="仅作管理后台显示用" />
          </Form.Item>
          <Form.Item
            label="手机号"
            name="owner_phone"
            rules={[{ max: 30 }]}
          >
            <Input placeholder="可空，仅作管理后台显示用" />
          </Form.Item>
          {!PACKAGING_RETIRED && (
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item label="日配额" name="daily_limit" style={{ flex: 1 }}>
              <InputNumber min={1} max={1000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="月配额" name="monthly_limit" style={{ flex: 1 }}>
              <InputNumber min={1} max={10000} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          )}
          {editing && (
            <Form.Item label="状态" name="status">
              <Select
                options={[
                  { label: '正常', value: 'active' },
                  { label: '停用', value: 'suspended' },
                  { label: '过期', value: 'expired' },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item label="过期时间（ISO 字符串，可空）" name="expires_at">
            <Input placeholder="2026-12-31 23:59:59" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量导入 Modal */}
      <Modal
        open={importOpen}
        title="批量导入客户端"
        onOk={onImportSubmit}
        onCancel={() => {
          setImportOpen(false)
          importForm.resetFields()
          setImportDomainsText('')
        }}
        confirmLoading={batchImportMut.isPending}
        width={620}
        maskStyle={noMaskStyle}
        destroyOnClose
        okText={parsedImportDomains.length > 0 ? `导入 ${parsedImportDomains.length} 条` : '导入'}
        okButtonProps={{ disabled: parsedImportDomains.length === 0 }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="每行一个域名 / IP（支持 IP:端口，可不带 http(s) 前缀，存储时统一归一化）。所有导入的客户端共用下方的负责人、手机号和配额。"
        />
        <Form.Item label={`授权域名列表（已识别 ${parsedImportDomains.length} 条）`} required>
          <Input.TextArea
            rows={8}
            value={importDomainsText}
            onChange={(e) => setImportDomainsText(e.target.value)}
            placeholder={'admin.client-a.com\nhttps://admin.client-b.com\n1.2.3.4:8080'}
          />
        </Form.Item>
        <Form form={importForm} layout="vertical" requiredMark={false} preserve={false}>
          <Form.Item label="负责人（所有导入客户端共用）" name="owner_name" rules={[{ required: true, max: 100 }]}>
            <Input placeholder="如「批量导入」或具体负责人姓名" />
          </Form.Item>
          <Form.Item label="手机号（所有导入客户端共用，可空）" name="owner_phone" rules={[{ max: 30 }]}>
            <Input placeholder="可空，仅作管理后台显示用" />
          </Form.Item>
          {!PACKAGING_RETIRED && (
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item label="日配额" name="daily_limit" style={{ flex: 1 }}>
              <InputNumber min={1} max={1000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="月配额" name="monthly_limit" style={{ flex: 1 }}>
              <InputNumber min={1} max={10000} style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          )}
          <Form.Item label="过期时间（ISO 字符串，可空）" name="expires_at">
            <Input placeholder="留空则不限期" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量修改状态 Modal */}
      <Modal
        open={batchStatusOpen}
        title={`批量修改 ${selectedRowKeys.length} 条客户端的状态`}
        onOk={onBatchStatusConfirm}
        onCancel={() => setBatchStatusOpen(false)}
        confirmLoading={batchUpdateStatusMut.isPending}
        width={420}
        maskStyle={noMaskStyle}
        okText={`改为 ${STATUS_LABEL[batchTargetStatus]}`}
      >
        <Paragraph type="secondary">选择要改为的目标状态：</Paragraph>
        <Radio.Group
          value={batchTargetStatus}
          onChange={(e) => setBatchTargetStatus(e.target.value)}
        >
          <Radio value="active">正常</Radio>
          <Radio value="suspended">停用</Radio>
          <Radio value="expired">过期</Radio>
        </Radio.Group>
      </Modal>

      {/* 批量重置额度 Modal */}
      <Modal
        open={batchResetOpen}
        title={`批量重置 ${selectedRowKeys.length} 条客户端的已用配额`}
        onOk={() => batchResetQuotaMut.mutate({ client_ids: selectedRowKeys, scope: batchResetScope })}
        onCancel={() => setBatchResetOpen(false)}
        confirmLoading={batchResetQuotaMut.isPending}
        width={420}
        maskStyle={noMaskStyle}
        okText="确认重置"
      >
        <Paragraph type="secondary">重置后，选中客户端的已用打包次数将归零，可重新打包。</Paragraph>
        <Radio.Group
          value={batchResetScope}
          onChange={(e) => setBatchResetScope(e.target.value)}
        >
          <Radio value="today">仅今日</Radio>
          <Radio value="month">本月</Radio>
          <Radio value="all">全部历史</Radio>
        </Radio.Group>
      </Modal>

      {/* 批量修改配额 Modal */}
      <Modal
        open={batchLimitOpen}
        title={`批量修改 ${selectedRowKeys.length} 条客户端的配额上限`}
        onOk={async () => {
          const values = await batchLimitForm.validateFields()
          const daily = values.daily_limit
          const monthly = values.monthly_limit
          if (daily == null && monthly == null) {
            message.warning('请至少填写日配额或月配额其中一项')
            return
          }
          batchUpdateLimitMut.mutate({
            client_ids: selectedRowKeys,
            daily_limit: daily ?? null,
            monthly_limit: monthly ?? null,
          })
        }}
        onCancel={() => setBatchLimitOpen(false)}
        confirmLoading={batchUpdateLimitMut.isPending}
        width={460}
        maskStyle={noMaskStyle}
        okText="确认修改"
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="留空表示不修改该项；已填的字段会覆盖所有选中客户端的对应上限。本操作不影响已用次数。"
        />
        <Form form={batchLimitForm} layout="vertical" preserve={false}>
          <Form.Item
            label="日配额上限"
            name="daily_limit"
            rules={[{ type: 'integer', min: 1, max: 1000, message: '需为 1-1000 的整数' }]}
          >
            <InputNumber min={1} max={1000} placeholder="留空不修改" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            label="月配额上限"
            name="monthly_limit"
            rules={[{ type: 'integer', min: 1, max: 10000, message: '需为 1-10000 的整数' }]}
          >
            <InputNumber min={1} max={10000} placeholder="留空不修改" style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量设置店铺商品图授权（按商城）Modal */}
      <Modal
        open={batchMallOpen}
        title={`批量设置 ${selectedRowKeys.length} 条云控端的店铺商品图授权`}
        onOk={() =>
          batchSetMallAuthMut.mutate({
            client_ids: selectedRowKeys,
            mall_key: batchMallKey,
            authorized: batchMallAuthorized,
          })
        }
        onCancel={() => setBatchMallOpen(false)}
        confirmLoading={batchSetMallAuthMut.isPending}
        width={460}
        maskStyle={noMaskStyle}
        okText={batchMallAuthorized ? '批量开放' : '批量关闭'}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="选择要操作的商城与开/关。授权变更最长约 90 秒在桌面端生效；ewei 会同步旧的 can_use_ewei_shop 字段（兼容老云控端）。"
        />
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          商城：
        </Paragraph>
        <Radio.Group
          value={batchMallKey}
          onChange={(e) => setBatchMallKey(e.target.value)}
          style={{ marginBottom: 16 }}
        >
          {MALL_OPTIONS.map((m) => (
            <Radio key={m.key} value={m.key}>
              {m.label}
            </Radio>
          ))}
        </Radio.Group>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          操作：
        </Paragraph>
        <Radio.Group
          value={batchMallAuthorized}
          onChange={(e) => setBatchMallAuthorized(e.target.value)}
        >
          <Radio value={true}>开放</Radio>
          <Radio value={false}>关闭</Radio>
        </Radio.Group>
      </Modal>

      <Modal
        open={batchPackagingOpen}
        title={`批量设置 ${selectedRowKeys.length} 条云控端的打包授权`}
        onOk={() =>
          batchSetPackagingAuthMut.mutate({
            client_ids: selectedRowKeys,
            feature: batchPackagingFeature,
            authorized: batchPackagingAuthorized,
          })
        }
        onCancel={() => setBatchPackagingOpen(false)}
        confirmLoading={batchSetPackagingAuthMut.isPending}
        width={460}
        maskStyle={noMaskStyle}
        okText={batchPackagingAuthorized ? '批量开放' : '批量关闭'}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="关 Mac 不影响 Windows 档；关 Windows 不自动关 Mac。云控打 Mac 仍须两档都开。"
        />
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          档位：
        </Paragraph>
        <Radio.Group
          value={batchPackagingFeature}
          onChange={(e) => setBatchPackagingFeature(e.target.value)}
          style={{ marginBottom: 16 }}
        >
          <Radio value="win">云控端打包授权</Radio>
          <Radio value="mac">Mac 打包授权</Radio>
        </Radio.Group>
        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          操作：
        </Paragraph>
        <Radio.Group
          value={batchPackagingAuthorized}
          onChange={(e) => setBatchPackagingAuthorized(e.target.value)}
        >
          <Radio value={true}>开放</Radio>
          <Radio value={false}>关闭</Radio>
        </Radio.Group>
      </Modal>

      {/* 批量操作结果 Modal */}
      <Modal
        open={!!batchResult}
        title={batchResult?.title}
        onCancel={() => setBatchResult(null)}
        onOk={() => setBatchResult(null)}
        cancelButtonProps={{ style: { display: 'none' } }}
        okText="我知道了"
        width={620}
        maskStyle={noMaskStyle}
      >
        {batchResult && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="成功">
                <Text strong>{batchResult.success}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="失败">
                <Text strong type={batchResult.failed > 0 ? 'danger' : undefined}>
                  {batchResult.failed}
                </Text>
              </Descriptions.Item>
            </Descriptions>
            {batchResult.failed > 0 && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message={`${batchResult.failed} 条失败，明细：`}
                />
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(r) => r.input || r.client_id || JSON.stringify(r)}
                  dataSource={batchResult.failures}
                  columns={[
                    {
                      title: '目标',
                      dataIndex: 'input',
                      render: (_, r) => r.input || r.domain || r.client_id || '—',
                      ellipsis: true,
                    },
                    {
                      title: '失败原因',
                      dataIndex: 'status',
                      width: 200,
                      render: (v: string, r) => {
                        const label = BATCH_ITEM_STATUS_LABEL[v] || v
                        if (r.active_count) {
                          return `${label}（${r.active_count} 个）`
                        }
                        return label
                      },
                    },
                  ]}
                />
              </>
            )}
          </Space>
        )}
      </Modal>
    </Card>
  )
}
