import { useState } from 'react'
import {
  Card,
  Table,
  Button,
  Space,
  Modal,
  Form,
  Input,
  Typography,
  Tag,
  Popconfirm,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { templatesApi, type TemplateCreatePayload, type TemplateUpdatePayload } from '@/api/templates'
import type { TemplateVersion } from '@/types'

const { Title, Text, Paragraph } = Typography
const noMaskStyle = { display: 'none' as const }

export function TemplatesPage() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<TemplateVersion | null>(null)
  const [form] = Form.useForm()

  const { data: items, isFetching } = useQuery({
    queryKey: ['templates'],
    queryFn: templatesApi.list,
  })

  const createMut = useMutation({
    mutationFn: (payload: TemplateCreatePayload) => templatesApi.create(payload),
    onSuccess: () => {
      message.success('已新增版本')
      setCreateOpen(false)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['templates'] })
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: TemplateUpdatePayload }) =>
      templatesApi.update(id, payload),
    onSuccess: () => {
      message.success('已保存')
      setEditing(null)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['templates'] })
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: number) => templatesApi.remove(id),
    onSuccess: () => {
      message.success('已删除')
      qc.invalidateQueries({ queryKey: ['templates'] })
    },
  })

  const setCurrentMut = useMutation({
    mutationFn: (id: number) => templatesApi.setCurrent(id),
    onSuccess: (resp) => {
      message.success(`已激活 ${resp.version}`)
      qc.invalidateQueries({ queryKey: ['templates'] })
    },
  })

  const submitForm = async () => {
    const values = await form.validateFields()
    if (editing) {
      updateMut.mutate({ id: editing.id, payload: { changelog: values.changelog, released_by: values.released_by } })
    } else {
      createMut.mutate(values)
    }
  }

  return (
    <Card>
      <Space style={{ marginBottom: 16 }}>
        <Title level={5} style={{ margin: 0, marginRight: 16 }}>
          模板版本
        </Title>
        <Button
          type="primary"
          onClick={async () => {
            setEditing(null)
            form.resetFields()
            setCreateOpen(true)
            try {
              const draft = await templatesApi.draft()
              if (draft?.version) {
                form.setFieldsValue({
                  version: draft.version,
                  changelog: draft.changelog,
                })
              }
            } catch {
              /* 无草稿时保持空表单 */
            }
          }}
        >
          新增版本
        </Button>
      </Space>

      <Table<TemplateVersion>
        rowKey="id"
        loading={isFetching}
        dataSource={items || []}
        pagination={false}
        columns={[
          {
            title: '版本号',
            dataIndex: 'version',
            width: 140,
            render: (v: string, r) => (
              <Space>
                <Text strong>{v}</Text>
                {r.is_current ? <Tag color="green">当前</Tag> : null}
              </Space>
            ),
          },
          {
            title: '更新内容',
            dataIndex: 'changelog',
            ellipsis: true,
            render: (v: string | null) => v || <Text type="secondary">—</Text>,
          },
          { title: '发布人', dataIndex: 'released_by', width: 130 },
          {
            title: '发布时间',
            dataIndex: 'released_at',
            width: 160,
            render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '—'),
          },
          {
            title: '操作',
            width: 240,
            render: (_, r) => (
              <Space size={4}>
                {!r.is_current && (
                  <Popconfirm title={`将 ${r.version} 设为当前？`} onConfirm={() => setCurrentMut.mutate(r.id)}>
                    <Button size="small" type="link">
                      设为当前
                    </Button>
                  </Popconfirm>
                )}
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setEditing(r)
                    form.setFieldsValue({ changelog: r.changelog, released_by: r.released_by })
                    setCreateOpen(true)
                  }}
                >
                  编辑
                </Button>
                {!r.is_current && (
                  <Popconfirm title="删除该版本？" onConfirm={() => removeMut.mutate(r.id)}>
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={createOpen}
        title={editing ? `编辑版本 - ${editing.version}` : '新增版本'}
        onCancel={() => {
          setCreateOpen(false)
          setEditing(null)
          form.resetFields()
        }}
        onOk={submitForm}
        confirmLoading={createMut.isPending || updateMut.isPending}
        maskStyle={noMaskStyle}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical" requiredMark={false} preserve={false}>
          {!editing && (
            <Form.Item
              label="版本号（语义化 X.Y.Z）"
              name="version"
              rules={[
                { required: true, message: '请输入版本号' },
                { pattern: /^\d+\.\d+\.\d+$/, message: '需为 X.Y.Z 格式' },
              ]}
            >
              <Input placeholder="0.5.5" />
            </Form.Item>
          )}
          <Form.Item label="更新内容（changelog）" name="changelog">
            <Input.TextArea rows={6} placeholder="本次模板修改了哪些内容、增加了哪些能力..." showCount maxLength={5000} />
          </Form.Item>
          <Form.Item label="发布人" name="released_by">
            <Input placeholder="留空则用当前管理员" />
          </Form.Item>
        </Form>
        {editing && (
          <Paragraph type="secondary" style={{ marginTop: 8, fontSize: 12 }}>
            版本号一经发布不可修改。如需变更请新增一个版本并设为当前。
          </Paragraph>
        )}
      </Modal>
    </Card>
  )
}
