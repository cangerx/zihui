import {
  Card,
  Descriptions,
  Space,
  Button,
  Typography,
  Steps,
  Tag,
  Alert,
  Popconfirm,
  Spin,
  message,
  Tooltip,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { requestsApi } from '@/api/requests'
import type { BuildRequestDetail, BuildStatus } from '@/types'
import { BuildStatusBadge, PlatformBadge } from '@/components/StatusBadge'

const { Title, Text, Paragraph, Link } = Typography

const TERMINAL_FAIL: BuildStatus[] = ['failed', 'cancelled', 'expired']
const NON_PURGEABLE: BuildStatus[] = ['queued', 'building', 'pending', 'cancelled', 'purged']

interface TimelineStep {
  title: string
  description?: string
  ts?: string | null
}

function buildTimeline(b: BuildRequestDetail): TimelineStep[] {
  const steps: TimelineStep[] = [
    { title: '已创建', ts: b.created_at },
    { title: '入队', ts: b.queued_at },
    { title: 'GitHub Actions 启动', ts: b.started_at },
    { title: '打包完成', ts: b.finished_at },
    { title: '云控端已交付', ts: b.delivered_at },
  ]
  if (b.purged_at) {
    steps.push({ title: 'artifact 已清理', ts: b.purged_at })
  }
  return steps
}

function currentStep(b: BuildRequestDetail): number {
  if (b.purged_at) return 5
  if (b.delivered_at) return 4
  if (b.finished_at) return 3
  if (b.started_at) return 2
  if (b.queued_at) return 1
  return 0
}

export function RequestDetailPage() {
  const { buildId } = useParams<{ buildId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['request', buildId],
    queryFn: () => requestsApi.get(buildId!),
    enabled: !!buildId,
    refetchInterval: (q) => {
      const d = q.state.data as BuildRequestDetail | undefined
      if (!d) return 5000
      return ['queued', 'building', 'success'].includes(d.status) ? 4000 : false
    },
  })

  const cancelMut = useMutation({
    mutationFn: () => requestsApi.forceCancel(buildId!),
    onSuccess: () => {
      message.success('已强制取消，配额已退还')
      qc.invalidateQueries({ queryKey: ['request', buildId] })
    },
  })

  const retryMut = useMutation({
    mutationFn: () => requestsApi.retry(buildId!),
    onSuccess: (resp) => {
      message.success(`已重试，新 build_id: ${resp.build_id}`)
      navigate(`/requests/${resp.build_id}`)
    },
  })

  const purgeMut = useMutation({
    mutationFn: () => requestsApi.forcePurge(buildId!),
    onSuccess: () => {
      message.success('已清理 artifact')
      qc.invalidateQueries({ queryKey: ['request', buildId] })
    },
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spin />
      </div>
    )
  }
  if (error || !data) {
    return <Alert type="error" showIcon message="加载失败" description="任务不存在或网络错误" />
  }

  const githubRunUrl =
    data.executor_run_id && data.client_id
      ? `https://github.com/your-org/your-build-repo/actions/runs/${data.executor_run_id}`
      : null

  const cancellable = !['success', 'delivered', 'purged', 'failed', 'expired', 'cancelled'].includes(data.status)
  const retryable = TERMINAL_FAIL.includes(data.status)
  const purgeable = !NON_PURGEABLE.includes(data.status)

  let supplementaryParsed: Array<{ filename: string; role: string; size: number }> = []
  if (data.artifact_files) {
    try {
      supplementaryParsed = JSON.parse(data.artifact_files)
    } catch {
      // ignore
    }
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <Space>
          <Button onClick={() => navigate(-1)}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>
            {data.app_name} <Text type="secondary" style={{ fontSize: 14 }}>{data.app_version}</Text>
          </Title>
          <BuildStatusBadge status={data.status} />
          <PlatformBadge platform={data.platform} />
        </Space>
        <Space>
          {cancellable && (
            <Popconfirm
              title="强制取消此任务？"
              description="若 GitHub Actions 在跑会一并取消，配额返还。"
              onConfirm={() => cancelMut.mutate()}
            >
              <Button danger loading={cancelMut.isPending}>
                强制取消
              </Button>
            </Popconfirm>
          )}
          {retryable && (
            <Popconfirm title="基于本任务发起新一次打包？" onConfirm={() => retryMut.mutate()}>
              <Button type="primary" loading={retryMut.isPending}>
                重试
              </Button>
            </Popconfirm>
          )}
          {purgeable && (
            <Popconfirm
              title="清理该任务的 artifact？"
              description="将释放云端存储；不可恢复。"
              onConfirm={() => purgeMut.mutate()}
            >
              <Button loading={purgeMut.isPending}>清理 artifact</Button>
            </Popconfirm>
          )}
        </Space>
      </Space>

      <Card title="状态进度">
        <Steps
          current={currentStep(data)}
          status={data.status === 'failed' || data.status === 'cancelled' ? 'error' : 'process'}
          items={buildTimeline(data).map((s) => ({
            title: s.title,
            description: s.ts ? dayjs(s.ts).format('YYYY-MM-DD HH:mm:ss') : '—',
          }))}
        />
        {data.error_message && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 16 }}
            message="错误信息"
            description={data.error_message}
          />
        )}
      </Card>

      <Card title="基础信息">
        <Descriptions column={2} bordered size="small">
          <Descriptions.Item label="Build ID" span={2}>
            <Text code copyable={{ text: data.build_id }}>
              {data.build_id}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Client ID">
            <Text code>{data.client_id}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="App">{data.app_name}</Descriptions.Item>
          <Descriptions.Item label="平台">
            <PlatformBadge platform={data.platform} />
          </Descriptions.Item>
          <Descriptions.Item label="版本">{data.app_version}</Descriptions.Item>
          <Descriptions.Item label="打包模式">
            {data.build_mode === 'oem' ? <Tag color="purple">OEM</Tag> : <Tag>普通</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="OEM 项目 Key">
            {data.oem_project_key ? <Text code>{data.oem_project_key}</Text> : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="App ID">
            {data.app_id ? <Text code>{data.app_id}</Text> : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="更新路径">
            {data.update_path ? <Text code>{data.update_path}</Text> : '—'}
          </Descriptions.Item>
          <Descriptions.Item label="GitHub Run" span={2}>
            {githubRunUrl ? (
              <Link href={githubRunUrl} target="_blank">
                #{data.executor_run_id}
              </Link>
            ) : (
              <Tag>未触发</Tag>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="产物信息">
        {data.artifact_path ? (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="主产物路径" span={2}>
              <Text code>{data.artifact_path}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="大小">
              {data.artifact_size != null ? `${(data.artifact_size / 1024 / 1024).toFixed(2)} MB` : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="SHA-256">
              {data.artifact_sha256 ? (
                <Tooltip title={data.artifact_sha256}>
                  <Text code style={{ fontSize: 12 }}>{data.artifact_sha256.slice(0, 16)}…</Text>
                </Tooltip>
              ) : (
                '—'
              )}
            </Descriptions.Item>
            {supplementaryParsed.length > 0 && (
              <Descriptions.Item label="完整文件清单（含 latest.yml / .blockmap）" span={2}>
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  {supplementaryParsed.map((f) => (
                    <div key={f.filename}>
                      <Tag color={f.role === 'primary' ? 'blue' : f.role === 'metadata' ? 'green' : 'purple'}>
                        {f.role}
                      </Tag>
                      <Text>{f.filename}</Text>
                      <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        {f.size} B
                      </Text>
                    </div>
                  ))}
                </Space>
              </Descriptions.Item>
            )}
          </Descriptions>
        ) : (
          <Paragraph type="secondary">尚未生成产物</Paragraph>
        )}
      </Card>
    </Space>
  )
}
