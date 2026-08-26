import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Form, InputNumber, Space, Spin, Tag, Typography, message } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  creativeTemplateHubSettingsApi,
  type CreativeTemplateHubSettings,
} from '@/api/sharedCreativeTemplateHub'

const { Title, Text, Paragraph } = Typography

export function SharedCreativeTemplateSettingsPage() {
  const qc = useQueryClient()
  const { data, isFetching } = useQuery({
    queryKey: ['creativeTemplateHub', 'settings'],
    queryFn: creativeTemplateHubSettingsApi.get,
  })

  const [form, setForm] = useState<CreativeTemplateHubSettings>({
    approve_threshold: 3,
    reject_threshold: 2,
    report_threshold: 5,
    submit_daily_limit: 20,
  })

  useEffect(() => {
    if (data?.settings) setForm(data.settings)
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
    mutationFn: (payload: Partial<CreativeTemplateHubSettings>) => creativeTemplateHubSettingsApi.update(payload),
    onSuccess: () => {
      message.success('已保存')
      qc.invalidateQueries({ queryKey: ['creativeTemplateHub', 'settings'] })
    },
  })

  if (isFetching && !data) {
    return <Card><Spin /></Card>
  }

  const activeReviewers = data?.active_reviewers ?? 0

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Space style={{ marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>共享创意模板库 · 阈值设置</Title>
          <Tag color={activeReviewers > 0 ? 'blue' : 'red'}>当前活跃审核员 {activeReviewers} 位</Tag>
        </Space>

        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          创意模板共享库复用云控端共享库审核员身份。审核员投票达 <Text code>approve / reject</Text> 阈值后自动结算；用户举报达 <Text code>report</Text> 阈值后自动隐藏；分享行为受每日上限限制。
        </Paragraph>

        {data?.warnings && data.warnings.length > 0 && (
          <Space direction="vertical" style={{ width: '100%', marginBottom: 16 }}>
            {data.warnings.map((w) => (
              <Alert key={w.code} type={w.code === 'no_active_reviewers' ? 'error' : 'warning'} showIcon message={w.message} />
            ))}
          </Space>
        )}

        <Form layout="vertical" disabled={isFetching || saveMut.isPending} requiredMark={false}>
          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item label="审核通过阈值" extra={<Text type="secondary" style={{ fontSize: 12 }}>累计 N 个 approve 票后状态置为「已通过」</Text>} style={{ flex: 1, minWidth: 200 }}>
              <InputNumber
                min={1}
                max={100}
                style={{ width: '100%' }}
                value={form.approve_threshold}
                onChange={(v) => setForm((s) => ({ ...s, approve_threshold: Number(v) || 1 }))}
                addonAfter={activeReviewers > 0 && form.approve_threshold > activeReviewers ? <Tag color="red" style={{ margin: 0 }}>不可达</Tag> : <span style={{ color: '#999' }}>/ {activeReviewers}</span>}
              />
            </Form.Item>
            <Form.Item label="审核驳回阈值" extra={<Text type="secondary" style={{ fontSize: 12 }}>累计 N 个 reject 票后状态置为「已驳回」</Text>} style={{ flex: 1, minWidth: 200 }}>
              <InputNumber
                min={1}
                max={100}
                style={{ width: '100%' }}
                value={form.reject_threshold}
                onChange={(v) => setForm((s) => ({ ...s, reject_threshold: Number(v) || 1 }))}
                addonAfter={activeReviewers > 0 && form.reject_threshold > activeReviewers ? <Tag color="red" style={{ margin: 0 }}>不可达</Tag> : <span style={{ color: '#999' }}>/ {activeReviewers}</span>}
              />
            </Form.Item>
          </Space>

          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item label="举报阈值" extra={<Text type="secondary" style={{ fontSize: 12 }}>累计 N 个不同 client 举报后自动隐藏</Text>} style={{ flex: 1, minWidth: 200 }}>
              <InputNumber min={1} max={1000} style={{ width: '100%' }} value={form.report_threshold} onChange={(v) => setForm((s) => ({ ...s, report_threshold: Number(v) || 1 }))} />
            </Form.Item>
            <Form.Item label="每日分享上限（每云控端）" extra={<Text type="secondary" style={{ fontSize: 12 }}>单一 client_id 当日提交达此值后返 429</Text>} style={{ flex: 1, minWidth: 200 }}>
              <InputNumber min={1} max={1000} style={{ width: '100%' }} value={form.submit_daily_limit} onChange={(v) => setForm((s) => ({ ...s, submit_daily_limit: Number(v) || 1 }))} />
            </Form.Item>
          </Space>

          <Space>
            <Button type="primary" onClick={() => dirty && saveMut.mutate(form)} loading={saveMut.isPending} disabled={!dirty}>保存</Button>
            <Button onClick={() => data?.defaults && setForm(data.defaults)} disabled={!data?.defaults}>恢复默认值</Button>
            {dirty && <Text type="warning" style={{ fontSize: 12 }}>有未保存的修改</Text>}
          </Space>
        </Form>
      </Card>
    </Space>
  )
}
