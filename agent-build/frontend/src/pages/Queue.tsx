import {
  Card,
  Row,
  Col,
  Statistic,
  Button,
  Space,
  Typography,
  Alert,
  Tag,
  message,
  Popconfirm,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queueApi } from '@/api/queue'

const { Title, Text } = Typography

export function QueuePage() {
  const qc = useQueryClient()

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['queue', 'status'],
    queryFn: queueApi.status,
    refetchInterval: 3000,
  })

  const pauseMut = useMutation({
    mutationFn: queueApi.pause,
    onSuccess: () => {
      message.warning('已暂停 dispatch，新的打包请求会被拒绝（建议尽快恢复）')
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
  })

  const resumeMut = useMutation({
    mutationFn: queueApi.resume,
    onSuccess: () => {
      message.success('已恢复 dispatch')
      qc.invalidateQueries({ queryKey: ['queue'] })
    },
  })

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <Title level={4} style={{ margin: 0 }}>
          打包队列
        </Title>
        <Space>
          <Button onClick={() => refetch()} loading={isFetching}>
            刷新
          </Button>
          {data?.paused ? (
            <Popconfirm title="恢复 dispatch？" onConfirm={() => resumeMut.mutate()}>
              <Button type="primary" loading={resumeMut.isPending}>
                恢复 dispatch
              </Button>
            </Popconfirm>
          ) : (
            <Popconfirm
              title="暂停 dispatch？"
              description="新的打包请求会被拒绝（已入队的不受影响）。"
              onConfirm={() => pauseMut.mutate()}
            >
              <Button danger loading={pauseMut.isPending}>
                暂停 dispatch
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Space>

      {data?.paused && (
        <Alert
          type="warning"
          showIcon
          message="dispatch 已暂停"
          description="新的 /api/build/request 会被拒绝。已经在排队/打包中的任务继续执行。"
        />
      )}

      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic
              title="dispatch 状态"
              valueRender={() =>
                data?.paused ? (
                  <Tag color="warning" style={{ fontSize: 14, padding: '2px 12px' }}>
                    已暂停
                  </Tag>
                ) : (
                  <Tag color="success" style={{ fontSize: 14, padding: '2px 12px' }}>
                    正常
                  </Tag>
                )
              }
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="排队中" value={data?.queued ?? 0} />
            <Text type="secondary" style={{ fontSize: 12 }}>等待 dispatch</Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="打包中" value={data?.building ?? 0} />
            <Text type="secondary" style={{ fontSize: 12 }}>GitHub Actions 运行中</Text>
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="近 1 小时" value={data?.last_hour.success ?? 0} suffix="成功" />
            <Text type="secondary" style={{ fontSize: 12 }}>失败/取消 {data?.last_hour.failed_or_cancelled ?? 0}</Text>
          </Card>
        </Col>
      </Row>

      <Card title="状态分布（全部历史）">
        {data?.totals && Object.keys(data.totals).length > 0 ? (
          <Space wrap>
            {Object.entries(data.totals).map(([k, v]) => (
              <Tag key={k} color="blue" style={{ fontSize: 13, padding: '4px 12px' }}>
                {k} · {v}
              </Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">暂无</Text>
        )}
      </Card>
    </Space>
  )
}
