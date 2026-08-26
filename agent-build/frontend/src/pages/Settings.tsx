import { useEffect, useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
  Alert,
  Tag,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { settingsApi } from '@/api/settings'
import type { AlertProvider } from '@/api/settings'
import { updateApi } from '@/api/updates'
import { PACKAGING_RETIRED } from '@/packagingRetired'

const { Title, Text, Paragraph } = Typography

/**
 * 系统设置 → 站点。
 * 收款配置、在线更新已拆到同组其它子页；本页只保留站点概况，以及未下线时的打包维护项。
 */
export function SettingsPage() {
  const qc = useQueryClient()
  const { data: current } = useQuery({
    queryKey: ['updates', 'current'],
    queryFn: async () => {
      const { data } = await updateApi.current()
      return data
    },
  })
  const { data: maintenance, isFetching: maintLoading } = useQuery({
    queryKey: ['settings', 'maintenance', 'build'],
    queryFn: settingsApi.getBuildMaintenance,
    enabled: !PACKAGING_RETIRED,
  })

  const [enabled, setEnabled] = useState(false)
  const [messageText, setMessageText] = useState('')
  const [minVersionText, setMinVersionText] = useState('')

  useEffect(() => {
    if (!maintenance) return
    setEnabled(maintenance.enabled)
    setMessageText(maintenance.message ?? '')
    setMinVersionText(maintenance.min_admin_version ?? '')
  }, [maintenance])

  const trimmedMinVersion = minVersionText.trim()
  const minVersionValid =
    trimmedMinVersion === '' || /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(trimmedMinVersion)

  const saveMut = useMutation({
    mutationFn: settingsApi.updateBuildMaintenance,
    onSuccess: (resp) => {
      message.success(resp.enabled ? '维护模式已开启' : '维护模式已关闭')
      qc.invalidateQueries({ queryKey: ['settings', 'maintenance', 'build'] })
    },
    onError: () => {
      message.error('保存失败，请重试')
    },
  })

  const save = () => {
    if (!minVersionValid) {
      message.error('最低版本号必须为 X.Y.Z 格式（如 1.3.4），或留空不限制')
      return
    }
    saveMut.mutate({
      enabled,
      message: messageText.trim() === '' ? null : messageText.trim(),
      min_admin_version: trimmedMinVersion === '' ? null : trimmedMinVersion,
    })
  }

  const dirty =
    !!maintenance &&
    (enabled !== maintenance.enabled ||
      (messageText || '') !== (maintenance.message ?? '') ||
      trimmedMinVersion !== (maintenance.min_admin_version ?? ''))

  // ===== 中转告警通知 =====
  const { data: alert, isFetching: alertLoading } = useQuery({
    queryKey: ['settings', 'alert'],
    queryFn: settingsApi.getAlert,
    refetchInterval: PACKAGING_RETIRED ? false : 8000,
    enabled: !PACKAGING_RETIRED,
  })

  const [alertEnabled, setAlertEnabled] = useState(false)
  const [alertProvider, setAlertProvider] = useState<AlertProvider>('custom')
  const [alertWebhook, setAlertWebhook] = useState('')
  const [alertKeyword, setAlertKeyword] = useState('')

  useEffect(() => {
    if (!alert) return
    setAlertEnabled(alert.enabled)
    setAlertProvider(alert.provider)
    setAlertWebhook('') // 不回填密文；留空表示不修改
    setAlertKeyword(alert.keyword ?? '')
  }, [alert])

  const saveAlertMut = useMutation({
    mutationFn: settingsApi.updateAlert,
    onSuccess: () => {
      message.success('告警配置已保存')
      setAlertWebhook('')
      qc.invalidateQueries({ queryKey: ['settings', 'alert'] })
    },
    onError: () => {
      message.error('保存失败，请重试')
    },
  })

  const testAlertMut = useMutation({
    mutationFn: settingsApi.testAlert,
    onSuccess: (r) => {
      if (r.ok) message.success('测试已发送：' + r.msg)
      else message.error('发送失败：' + r.msg)
    },
    onError: () => {
      message.error('发送失败，请检查配置')
    },
  })

  const alertDirty =
    !!alert &&
    (alertEnabled !== alert.enabled ||
      alertProvider !== alert.provider ||
      alertWebhook.trim() !== '' ||
      (alertKeyword || '') !== (alert.keyword ?? ''))

  const saveAlert = () => {
    saveAlertMut.mutate({
      enabled: alertEnabled,
      provider: alertProvider,
      webhook_url: alertWebhook.trim() === '' ? undefined : alertWebhook.trim(),
      keyword: alertKeyword.trim(),
    })
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>
            本站
          </Title>
          {current?.version ? <Tag color="green">v{current.version}</Tag> : null}
        </Space>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          微信商户凭据在「系统 → 收款方式」；升级本后台在「系统 → 在线更新」。
          打包授权定价在「系统 → 打包授权定价」，安装包任务在各云控后台。
        </Paragraph>
      </Card>
      {PACKAGING_RETIRED ? (
        <Alert
          type="info"
          showIcon
          message="打包任务不在本站调度"
          description="打包维护开关与中转告警已从本站下线。本页不再请求相关接口。"
        />
      ) : null}
      {!PACKAGING_RETIRED && (
      <>
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>
            中转告警通知
          </Title>
          {alertLoading ? (
            <Spin size="small" />
          ) : alert?.enabled ? (
            <Tag color="green">已启用</Tag>
          ) : (
            <Tag color="default">未启用</Tag>
          )}
          {alert &&
            (alert.worker.busy ? (
              <Tag color="processing">worker 处理中（下大包）</Tag>
            ) : alert.worker.online ? (
              <Tag color="success">中转 worker 在线</Tag>
            ) : (
              <Tag color="error">worker 离线</Tag>
            ))}
          {alert && alert.stuck_count > 0 && (
            <Tag color="error">{alert.stuck_count} 个打包卡在中转</Tag>
          )}
        </Space>

        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          打包「已完成」后家庭电脑中转长时间未推进、或 mirror worker 失联时，系统每 5 分钟巡检并通过 webhook
          推送告警（带冷却，不会刷屏），故障恢复后再发一条恢复通知。建议先「发送测试」确认渠道可达。
        </Paragraph>

        <Form layout="vertical" disabled={alertLoading || saveAlertMut.isPending}>
          <Form.Item label="启用告警">
            <Switch
              checked={alertEnabled}
              onChange={setAlertEnabled}
              checkedChildren="开"
              unCheckedChildren="关"
            />
          </Form.Item>

          <Form.Item label="通知渠道">
            <Select<AlertProvider>
              value={alertProvider}
              onChange={setAlertProvider}
              style={{ maxWidth: 260 }}
              options={[
                { label: '钉钉群机器人', value: 'dingtalk' },
                { label: '企业微信群机器人', value: 'wework' },
                { label: '飞书群机器人', value: 'feishu' },
                { label: 'Server 酱', value: 'serverchan' },
                { label: '自定义 Webhook', value: 'custom' },
              ]}
            />
          </Form.Item>

          <Form.Item
            label="Webhook 地址"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                {alert?.has_webhook_url
                  ? `已配置（${alert.webhook_url_masked}），留空则保持不变`
                  : '填写机器人 Webhook 完整地址'}
              </Text>
            }
          >
            <Input.Password
              value={alertWebhook}
              onChange={(e) => setAlertWebhook(e.target.value)}
              placeholder={alert?.has_webhook_url ? '留空不修改' : 'https://...'}
              autoComplete="new-password"
            />
          </Form.Item>

          <Form.Item
            label="关键词（可选）"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                钉钉 / 企业微信若使用「自定义关键词」安全设置，请填一个会出现在消息中的关键词（如 agent-build）。
              </Text>
            }
          >
            <Input
              value={alertKeyword}
              onChange={(e) => setAlertKeyword(e.target.value)}
              placeholder="agent-build"
              maxLength={50}
              allowClear
              style={{ maxWidth: 260 }}
            />
          </Form.Item>

          <Space>
            <Button type="primary" onClick={saveAlert} loading={saveAlertMut.isPending} disabled={!alertDirty}>
              保存
            </Button>
            <Button onClick={() => testAlertMut.mutate()} loading={testAlertMut.isPending}>
              发送测试
            </Button>
            {alert?.worker.last_poll_at && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                worker 最后心跳：{alert.worker.last_poll_at}
              </Text>
            )}
            {alertDirty && (
              <Text type="warning" style={{ fontSize: 12 }}>
                有未保存的修改
              </Text>
            )}
          </Space>
        </Form>
      </Card>

      <Card>
        <Space style={{ marginBottom: 12 }}>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>
            云打包维护
          </Title>
          {maintLoading ? (
            <Spin size="small" />
          ) : enabled ? (
            <Tag color="red">维护中</Tag>
          ) : (
            <Tag color="green">正常</Tag>
          )}
        </Space>

        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          开启后，所有云控端的「一键云打包」页面会展示维护提示横幅，并禁用「提交打包」按钮；
          已在排队/打包中的任务不受影响，云控端管理员只是无法新提交。
        </Paragraph>

        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="例外：在「客户端管理」中开启了「维护期可打包」的云控端不受此开关影响，维护期间仍可正常打包，可用于指定客户端做生产测试。"
        />

        <Form layout="vertical" disabled={maintLoading || saveMut.isPending}>
          <Form.Item label="启用维护模式">
            <Switch
              checked={enabled}
              onChange={setEnabled}
              checkedChildren="开"
              unCheckedChildren="关"
            />
          </Form.Item>

          <Form.Item
            label="维护说明（可选）"
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                留空则在云控端使用默认文案：
                {maintenance?.default_message
                  ? `「${maintenance.default_message}」`
                  : '「云打包更新维护中，暂停打包，请稍后刷新查看。」'}
              </Text>
            }
          >
            <Input.TextArea
              rows={3}
              maxLength={500}
              showCount
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder={maintenance?.default_message ?? '云打包更新维护中，暂停打包，请稍后刷新查看。'}
            />
          </Form.Item>

          <Form.Item
            label="云控端最低版本（可选）"
            validateStatus={minVersionValid ? undefined : 'error'}
            help={
              !minVersionValid ? (
                '格式必须为 X.Y.Z（如 1.3.4），或留空不限制'
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  云控端提交打包请求时携带 X-Admin-Version；版本低于此值或不带版本头的请求会被
                  426 拒绝并返回中文升级提示（已升级的云控端在「一键云打包」页同步展示升级横幅）。
                  留空表示不限制版本。
                </Text>
              )
            }
          >
            <Input
              placeholder="1.3.4"
              value={minVersionText}
              onChange={(e) => setMinVersionText(e.target.value)}
              maxLength={50}
              allowClear
              style={{ maxWidth: 200 }}
            />
          </Form.Item>

          <Space>
            <Button
              type="primary"
              onClick={save}
              loading={saveMut.isPending}
              disabled={!dirty || !minVersionValid}
            >
              保存
            </Button>
            {dirty && <Text type="warning" style={{ fontSize: 12 }}>有未保存的修改</Text>}
          </Space>
        </Form>
      </Card>

      <Alert
        type="warning"
        showIcon
        message="腾讯云 COS 直传方案已于 0.5.0 下线"
        description={
          <>
            自 0.5.0 起，agent-build 改用「家庭电脑中转 + mirror 站点直拉」方案，腾讯云 COS 配置已彻底弃用。
            本页保留 COS 配置 UI 仅作历史功能资料查看，所有字段不可编辑，前端不会请求任何 COS 相关接口。
          </>
        }
      />

      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Title level={5} style={{ margin: 0, marginRight: 16 }}>
            腾讯云 COS
          </Title>
          <Tag color="default">已下线</Tag>
        </Space>

        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          原 GitHub Actions 打包完成后，产物推送至此 COS 桶，云控端通过预签 URL 直拉。
          0.5.0 切换至家庭电脑中转方案后已废弃；对应字段定义保留如下供历史查阅。
        </Paragraph>

        <Form layout="vertical" requiredMark={false} disabled>
          <Form.Item label="所属地域 Region">
            <Input placeholder="ap-guangzhou" autoComplete="off" />
          </Form.Item>

          <Form.Item
            label={
              <Space>
                <span>存储桶 Bucket（含 APPID 后缀）</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  形如 4810-1304118579
                </Text>
              </Space>
            }
          >
            <Input placeholder="4810-1304118579" autoComplete="off" />
          </Form.Item>

          <Form.Item label="APPID（纯展示用）">
            <Input placeholder="1304118579" autoComplete="off" />
          </Form.Item>

          <Form.Item label="SecretId">
            <Input placeholder="AKIDxxxxxxxx" autoComplete="off" />
          </Form.Item>

          <Form.Item label="SecretKey">
            <Input.Password placeholder="（已下线，不再保存）" autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            label={
              <Space>
                <span>自定义访问域名</span>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  原用作云控端 / 桌面 Agent 拉文件的 CDN 加速域名
                </Text>
              </Space>
            }
          >
            <Input placeholder="https://cos3.xiaoyinet.cn" autoComplete="off" />
          </Form.Item>
        </Form>
      </Card>

      <Card size="small">
        <Title level={5} style={{ marginTop: 0 }}>
          历史方案：预签 URL 工作机制
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          云控端调 <Text code>/dl/{'{token}'}</Text> 拉文件时，agent-build 后端会按 DB 中保存的{' '}
          <Text code>cos_object_prefix</Text> 拼出对象 key，用 COS SecretId/SecretKey 现场签名一个 30 分钟有效的
          GET URL，然后 302 redirect 到该 URL；云控端 follow redirect 后直接连 COS 自定义域名拉，全程不经过
          agent-build 服务器中转。该机制随 <Text code>/dl/{'{token}'}</Text> 路由一并在 0.5.0 下线。
        </Paragraph>
      </Card>
      </>
      )}
    </Space>
  )
}
