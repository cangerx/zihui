import { useEffect, useState } from 'react'
import { Button, Card, Input, Space, Table, Tabs, Tag, Typography, Upload, message } from 'antd'
import { skillRegistryApi } from '@/api/skillRegistry'

type VersionRow = {
  version_id: string
  skill_id: string
  version: string
  status: string
  sha256?: string
  permissions?: { filesystem?: string; network?: { domains?: string[] }; commands?: string[] }
  scan_report?: { ok?: boolean; file_count?: number; package_size?: number }
  reject_reason?: string
  manifest?: { name?: string; version?: string }
}

type SkillRow = { skill_id: string; name: string; slug: string; status: string }

export function SkillRegistryPage() {
  const [pending, setPending] = useState<VersionRow[]>([])
  const [published, setPublished] = useState<SkillRow[]>([])
  const [reports, setReports] = useState<any[]>([])
  const [evidence, setEvidence] = useState('')
  const [versionsBySkill, setVersionsBySkill] = useState<Record<string, VersionRow[]>>({})

  const reload = async () => {
    const [p, list, r] = await Promise.all([
      skillRegistryApi.pending(),
      skillRegistryApi.list(),
      skillRegistryApi.reports(),
    ])
    setPending(p.data || [])
    setPublished(list.data || [])
    setReports(r.data || [])
  }

  useEffect(() => {
    reload().catch((e) => message.error(e.message || '加载失败'))
  }, [])

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          Skills 目录
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
          审核通过后才会进入各云控的技能目录，不是安装包审批。
        </Typography.Paragraph>
      </div>
      <Upload
        accept=".zip"
        showUploadList={false}
        beforeUpload={async (file) => {
          try {
            await skillRegistryApi.upload(file)
            message.success('已上传，进入待审')
            await reload()
          } catch (e: any) {
            message.error(e.response?.data?.error || '上传失败')
          }
          return false
        }}
      >
        <Button type="primary">代投稿 ZIP</Button>
      </Upload>
      <Input.TextArea
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="审核证据（权限摘要核对、扫描结论）"
        rows={2}
      />
      <Tabs
        items={[
          {
            key: 'pending',
            label: '待审',
            children: (
              <Table
                rowKey="version_id"
                dataSource={pending}
                pagination={false}
                columns={[
                  { title: '版本', dataIndex: 'version' },
                  { title: 'Skill', dataIndex: 'skill_id' },
                  {
                    title: '权限',
                    render: (_, row) => (
                      <span>
                        文件 {row.permissions?.filesystem || 'none'}
                        {' / '}命令 {(row.permissions?.commands || []).join(',') || '无'}
                      </span>
                    ),
                  },
                  {
                    title: '扫描',
                    render: (_, row) =>
                      row.scan_report?.ok ? (
                        <Tag color="green">{row.scan_report.file_count} 文件</Tag>
                      ) : (
                        <Tag color="red">失败</Tag>
                      ),
                  },
                  {
                    title: '操作',
                    render: (_, row) => (
                      <Space>
                        <Button size="small" type="primary" onClick={() => skillRegistryApi.review(row.version_id, 'approve', evidence).then(reload)}>
                          发布
                        </Button>
                        <Button size="small" danger onClick={() => skillRegistryApi.review(row.version_id, 'reject', evidence).then(reload)}>
                          驳回
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'published',
            label: '已发布',
            children: (
              <Table
                rowKey="skill_id"
                dataSource={published}
                pagination={false}
                columns={[
                  { title: '名称', dataIndex: 'name' },
                  { title: 'slug', dataIndex: 'slug' },
                  { title: '状态', dataIndex: 'status', render: (v) => <Tag>{v}</Tag> },
                  {
                    title: '操作',
                    render: (_, row) => (
                      <Button size="small" onClick={() => skillRegistryApi.show(row.skill_id).then((d) => message.info(`版本数 ${(d.versions || []).length}`))}>
                        详情
                      </Button>
                    ),
                  },
                ]}
                expandable={{
                  expandedRowRender: (row) => (
                    <Table
                      rowKey="version_id"
                      pagination={false}
                      size="small"
                      dataSource={versionsBySkill[row.skill_id] || []}
                      columns={[
                        { title: '版本号', dataIndex: 'version' },
                        { title: '状态', dataIndex: 'status', render: (v: string) => <Tag>{v}</Tag> },
                        { title: 'sha256', dataIndex: 'sha256', ellipsis: true },
                        {
                          title: '操作',
                          render: (_, ver) =>
                            ver.status === 'published' ? (
                              <Button
                                size="small"
                                danger
                                onClick={() =>
                                  skillRegistryApi.revoke(ver.version_id, evidence || 'ui-revoke').then(async () => {
                                    message.success('已撤回，包文件未改写')
                                    const d = await skillRegistryApi.show(row.skill_id)
                                    setVersionsBySkill((m) => ({ ...m, [row.skill_id]: d.versions || [] }))
                                    await reload()
                                  })
                                }
                              >
                                撤回
                              </Button>
                            ) : null,
                        },
                      ]}
                    />
                  ),
                  onExpand: async (expanded, row) => {
                    if (!expanded || versionsBySkill[row.skill_id]) return
                    const d = await skillRegistryApi.show(row.skill_id)
                    setVersionsBySkill((m) => ({ ...m, [row.skill_id]: d.versions || [] }))
                  },
                }}
              />
            ),
          },
          {
            key: 'reports',
            label: '报告',
            children: (
              <Table
                rowKey="id"
                dataSource={reports}
                pagination={false}
                columns={[
                  { title: 'Skill', dataIndex: 'skill_id' },
                  { title: '版本', dataIndex: 'version_id' },
                  { title: '原因', dataIndex: 'reason' },
                ]}
              />
            ),
          },
        ]}
      />
      <Card size="small">撤回已发布版本会生成新事件，不会改写 ZIP。</Card>
    </Space>
  )
}
