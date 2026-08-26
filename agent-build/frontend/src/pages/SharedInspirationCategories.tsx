import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import { categoriesApi } from '@/api/sharedInspirationHub'
import type { ApiErrorBody, SharedInspirationCategory } from '@/types'

const { Title, Text, Paragraph } = Typography

interface CategoryFormValues {
  name: string
  slug: string
  sort_order: number
}

/**
 * 共享灵感库 · 分类管理
 *
 * - 14 个默认分类由 SharedInspirationCategorySeeder 写入
 * - slug 是 kebab-case 持久标识，云控端可能用作本地映射缓存键，改动需谨慎
 * - 删除前后端会校验有无灵感引用（category_in_use 错误码）
 */
export function SharedInspirationCategoriesPage() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SharedInspirationCategory | null>(null)
  const [form] = Form.useForm<CategoryFormValues>()

  const { data, isFetching } = useQuery({
    queryKey: ['inspirationHub', 'categories'],
    queryFn: categoriesApi.list,
  })

  const createMut = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => {
      message.success('已新建分类')
      setModalOpen(false)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'categories'] })
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CategoryFormValues> }) =>
      categoriesApi.update(id, payload),
    onSuccess: () => {
      message.success('已保存')
      setModalOpen(false)
      setEditing(null)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'categories'] })
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: number) => categoriesApi.remove(id),
    onSuccess: () => {
      message.success('已删除')
      qc.invalidateQueries({ queryKey: ['inspirationHub', 'categories'] })
    },
    onError: (err: AxiosError<ApiErrorBody>) => {
      const data = err.response?.data
      if (data?.error === 'category_in_use') {
        const cnt = (data.inspiration_count as number) ?? 0
        message.error(`该分类下还有 ${cnt} 条灵感，请先迁移或删除这些灵感`)
      }
    },
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    const maxSort = (data || []).reduce((m, c) => Math.max(m, c.sort_order), 0)
    form.setFieldsValue({ sort_order: maxSort + 10 })
    setModalOpen(true)
  }

  const openEdit = (record: SharedInspirationCategory) => {
    setEditing(record)
    form.setFieldsValue({
      name: record.name,
      slug: record.slug,
      sort_order: record.sort_order,
    })
    setModalOpen(true)
  }

  const onSubmit = async () => {
    const values = await form.validateFields()
    if (editing) {
      updateMut.mutate({ id: editing.id, payload: values })
    } else {
      createMut.mutate(values)
    }
  }

  return (
    <Card>
      <Space style={{ marginBottom: 16 }} wrap>
        <Title level={5} style={{ margin: 0, marginRight: 16 }}>
          共享灵感库 · 分类管理
        </Title>
        <Button type="primary" onClick={openCreate}>
          新建分类
        </Button>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="slug 是云控端可能用作本地映射缓存的稳定标识符；改 slug 不会丢数据，但已经下发的云控端可能短时间无法识别新 slug。建议谨慎修改。"
      />

      <Table<SharedInspirationCategory>
        rowKey="id"
        size="middle"
        loading={isFetching}
        dataSource={data || []}
        pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '中文名', dataIndex: 'name', width: 160 },
          {
            title: 'Slug',
            dataIndex: 'slug',
            width: 200,
            render: (v: string) => <Text code>{v}</Text>,
          },
          {
            title: '排序',
            dataIndex: 'sort_order',
            width: 80,
            sorter: (a, b) => a.sort_order - b.sort_order,
            defaultSortOrder: 'ascend',
          },
          {
            title: '已用灵感数',
            dataIndex: 'inspiration_count',
            width: 120,
            align: 'center' as const,
            render: (v: number | undefined) => (
              <Tag color={(v || 0) > 0 ? 'blue' : 'default'}>{v ?? 0}</Tag>
            ),
            sorter: (a, b) => (a.inspiration_count ?? 0) - (b.inspiration_count ?? 0),
          },
          {
            title: '更新时间',
            dataIndex: 'updated_at',
            width: 170,
            render: (v: string) => <Text type="secondary">{v}</Text>,
          },
          {
            title: '操作',
            width: 130,
            render: (_, r) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除该分类？"
                  description={
                    (r.inspiration_count ?? 0) > 0
                      ? `当前下还有 ${r.inspiration_count} 条灵感，删除会被后端拒绝`
                      : '确认无误后将永久删除该分类'
                  }
                  onConfirm={() => removeMut.mutate(r.id)}
                >
                  <Button size="small" type="link" danger disabled={(r.inspiration_count ?? 0) > 0}>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        open={modalOpen}
        title={editing ? `编辑分类 - ${editing.name}` : '新建分类'}
        onOk={onSubmit}
        onCancel={() => {
          setModalOpen(false)
          setEditing(null)
          form.resetFields()
        }}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={460}
        maskStyle={{ display: 'none' }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false} preserve={false}>
          <Form.Item
            label="中文名"
            name="name"
            rules={[{ required: true, max: 50, message: '请输入 1-50 字' }]}
          >
            <Input placeholder="例如：人物肖像" />
          </Form.Item>
          <Form.Item
            label="Slug（kebab-case，云控端持久标识）"
            name="slug"
            rules={[
              { required: true, max: 50 },
              { pattern: /^[a-z0-9][a-z0-9-]*$/, message: '只能用小写字母、数字、连字符；不可以连字符开头' },
            ]}
            extra={
              editing ? (
                <Text type="warning" style={{ fontSize: 12 }}>
                  已发布的 slug 修改后，云控端缓存可能短时间识别不到，请谨慎
                </Text>
              ) : undefined
            }
          >
            <Input placeholder="例如：portrait" />
          </Form.Item>
          <Form.Item
            label="排序值"
            name="sort_order"
            rules={[{ required: true, type: 'integer', min: 0, max: 99999 }]}
            extra={
              <Text type="secondary" style={{ fontSize: 12 }}>
                数值小的排前面。建议留 gap（10、20、30…）以便后续插入
              </Text>
            }
          >
            <InputNumber min={0} max={99999} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
        {editing && editing.inspiration_count !== undefined && editing.inspiration_count > 0 && (
          <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
            该分类当前下挂 <Text strong>{editing.inspiration_count}</Text> 条灵感，本次编辑不会动这些灵感的关联。
          </Paragraph>
        )}
      </Modal>
    </Card>
  )
}
