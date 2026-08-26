import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  InputNumber,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { hubSettingsApi } from '@/api/sharedInspirationHub'
import type { InspirationHubSettings } from '@/types'

const { Title, Text, Paragraph } = Typography

/**
 * 共享灵感库 · 阈值设置
 *
 * 4 个 system_settings key（group_key='inspiration_hub'）：
 *  - approve_threshold     X 票通过审核
 *  - reject_threshold      Y 票驳回审核
 *  - report_threshold      N 人举报后自动下架
 *  - submit_daily_limit    单云控端每天最多分享条数
 *
 * 当前活跃审核员数 < 通过/驳回阈值时后端会返回 warnings，本页用 Alert 展示但不阻止保存。
 */
export function SharedInspirationSettingsPage() {
  const qc = useQueryClient()
  const { data, isFetching } = useQuery({
    queryKey: ['inspirationHub', 'settings'],
    queryFn: hubSettingsApi.get,
  })

  const [form, setForm] = useState<InspirationHubSettings>({
    approve_threshold: 3,
    reject_threshold: 2,
    report_threshold: 5,
    submit_daily_limit: 20,
  })

  useEffect(() => {
    if (data?.settings) {
      setForm(data.settings)
    }
  }, [data?.settings])

  const dirty = useMemo(() => {
    if (!data?.settings) return false
    return (
      form.approve_threshold !== data.settings.approve_threshold ||
      form.reject_threshold !== data.settings.reject_threshold ||
      form.report_threshold !== data.settings.report_threshold ||
      form.submit_daily_limit !== data.settings.submit_daily_limit
    )
  }, [data?.settings, form])

  const saveMut = useMutation({
    mutationFn: (payload: Partial<InspirationHubSettings>) => hubSettingsApi.update(payload),
    onSuccess: () => {
      message.success('已保存')
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'settings'] })
    },
  })

  const onSave = () => {
    if (!dirty) return
    saveMut.mutate(form)
  }

  const onResetToDefaults = () => {
    if (!data?.defaults) return
    setForm(data.defaults)
  }

  if (isFetching && !data) {
    return (
      <Card>
        <Spin />
      </Card>
    )
  }

  const activeReviewers = data?.active_reviewers ?? 0

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Space style={{ marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>
            共享灵感库 · 阈值设置
          </Title>
          <Tag color={activeReviewers > 0 ? 'blue' : 'red'}>
            当前活跃审核员 {activeReviewers} 位
          </Tag>
        </Space>

        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          云控端社区治理机制由「投票阈值」+「举报阈值」+「每日分享上限」三层组成：
          审核员投票达 <Text code>approve / reject</Text> 阈值后自动结算；用户举报达
          <Text code> report</Text> 阈值后自动隐藏；分享行为受 <Text code>daily_limit</Text> 限速。
          阈值大于活跃审核员数时不会阻塞保存，但新分享会永远停留在「待审核」状态。
        </Paragraph>

        {data?.warnings && data.warnings.length > 0 && (
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            {data.warnings.map((w) => (
              <Alert
                key={w.code}
                type={w.code === 'no_active_reviewers' ? 'error' : 'warning'}
                showIcon
                message={w.message}
              />
            ))}
          </Space>
        )}

        <Form layout="vertical" disabled={isFetching || saveMut.isPending} requiredMark={false}>
          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item
              label="审核通过阈值"
              extra={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  累计 N 个 approve 票后状态置为「已通过」
                </Text>
              }
              style={{ flex: 1, minWidth: 200 }}
            >
              <InputNumber
                min={1}
                max={100}
                style={{ width: '100%' }}
                value={form.approve_threshold}
                onChange={(v) => setForm((s) => ({ ...s, approve_threshold: Number(v) || 1 }))}
                addonAfter={
                  activeReviewers > 0 && form.approve_threshold > activeReviewers ? (
                    <Tag color="red" style={{ margin: 0 }}>不可达</Tag>
                  ) : (
                    <span style={{ color: '#999' }}>/ {activeReviewers}</span>
                  )
                }
              />
            </Form.Item>

            <Form.Item
              label="审核驳回阈值"
              extra={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  累计 N 个 reject 票后状态置为「已驳回」（reject 优先于 approve）
                </Text>
              }
              style={{ flex: 1, minWidth: 200 }}
            >
              <InputNumber
                min={1}
                max={100}
                style={{ width: '100%' }}
                value={form.reject_threshold}
                onChange={(v) => setForm((s) => ({ ...s, reject_threshold: Number(v) || 1 }))}
                addonAfter={
                  activeReviewers > 0 && form.reject_threshold > activeReviewers ? (
                    <Tag color="red" style={{ margin: 0 }}>不可达</Tag>
                  ) : (
                    <span style={{ color: '#999' }}>/ {activeReviewers}</span>
                  )
                }
              />
            </Form.Item>
          </Space>

          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item
              label="举报阈值"
              extra={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  累计 N 个不同 client 举报后自动 is_visible=false（仍可在后台「灵感池」恢复）
                </Text>
              }
              style={{ flex: 1, minWidth: 200 }}
            >
              <InputNumber
                min={1}
                max={1000}
                style={{ width: '100%' }}
                value={form.report_threshold}
                onChange={(v) => setForm((s) => ({ ...s, report_threshold: Number(v) || 1 }))}
              />
            </Form.Item>

            <Form.Item
              label="每日分享上限（每云控端）"
              extra={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  单一 client_id 当日已 share 数量达此值后再 submit 返 429
                </Text>
              }
              style={{ flex: 1, minWidth: 200 }}
            >
              <InputNumber
                min={1}
                max={1000}
                style={{ width: '100%' }}
                value={form.submit_daily_limit}
                onChange={(v) => setForm((s) => ({ ...s, submit_daily_limit: Number(v) || 1 }))}
              />
            </Form.Item>
          </Space>

          <Space>
            <Button type="primary" onClick={onSave} loading={saveMut.isPending} disabled={!dirty}>
              保存
            </Button>
            <Button onClick={onResetToDefaults} disabled={!data?.defaults}>
              恢复默认值
            </Button>
            {dirty && <Text type="warning" style={{ fontSize: 12 }}>有未保存的修改</Text>}
          </Space>
        </Form>
      </Card>

      <Card size="small">
        <Title level={5} style={{ marginTop: 0 }}>
          默认值
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          系统初始默认：
          <Text code>approve = {data?.defaults.approve_threshold ?? 3}</Text>、
          <Text code>reject = {data?.defaults.reject_threshold ?? 2}</Text>、
          <Text code>report = {data?.defaults.report_threshold ?? 5}</Text>、
          <Text code>daily = {data?.defaults.submit_daily_limit ?? 20}</Text>。
          调整时务必先在「客户端」页任命好审核员（首批建议 3-5 位），让阈值有意义。
        </Paragraph>
      </Card>
    </Space>
  )
}
