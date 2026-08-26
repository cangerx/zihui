import { Card, Row, Col, Statistic, Typography, Space, Spin, Alert } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/api/dashboard'
import { PACKAGING_RETIRED } from '@/packagingRetired'

const { Title } = Typography

export function DashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard', 'stats', 'week'],
    queryFn: () => dashboardApi.stats('week'),
  })

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Title level={4} style={{ margin: 0 }}>
        概览
      </Title>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        本站给云控域名发放许可，并审核共享内容。日常打包请打开对应云控后台。
      </Typography.Paragraph>
      {PACKAGING_RETIRED && (
        <Alert
          type="info"
          showIcon
          message="打包任务在云控后台"
          description="本站不再排队或调度安装包。要让某站能打 Windows / Mac，在「云控站点」打开对应授权；单价在「系统 → 打包授权定价」。"
        />
      )}
      <Spin spinning={isLoading}>
        <Row gutter={16}>
          <Col span={12}>
            <Card>
              <Statistic
                title="活跃云控站点"
                value={stats?.clients.active ?? 0}
                suffix={`/ ${stats?.clients.total ?? 0}`}
              />
            </Card>
          </Col>
        </Row>
      </Spin>
    </Space>
  )
}
