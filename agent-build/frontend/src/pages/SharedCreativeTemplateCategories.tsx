import { useState } from 'react'
import { Alert, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, Tag, Typography, message } from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AxiosError } from 'axios'
import {
  sharedCreativeTemplateCategoriesApi,
  type CreativeTemplateCategoryPayload,
  type SharedCreativeTemplateCategory,
} from '@/api/sharedCreativeTemplateHub'
import type { ApiErrorBody } from '@/types'

const { Title, Text } = Typography

export function SharedCreativeTemplateCategoriesPage() {
  const qc = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<SharedCreativeTemplateCategory | null>(null)
  const [form] = Form.useForm<CreativeTemplateCategoryPayload>()

  const { data, isFetching } = useQuery({
    queryKey: ['creativeTemplateHub', 'categories'],
    queryFn: sharedCreativeTemplateCategoriesApi.list,
  })

  const createMut = useMutation({
    mutationFn: sharedCreativeTemplateCategoriesApi.create,
    onSuccess: () => {
      message.success('已新建分类')
      setModalOpen(false)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['creativeTemplateHub', 'categories'] })
    },
  })

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<CreativeTemplateCategoryPayload> }) => sharedCreativeTemplateCategoriesApi.update(id, payload),
    onSuccess: () => {
      message.success('已保存')
      setModalOpen(false)
      setEditing(null)
      form.resetFields()
      qc.invalidateQueries({ queryKey: ['creativeTemplateHub', 'categories'] })
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: number) => sharedCreativeTemplateCategoriesApi.remove(id),
    onSuccess: () => {
      message.success('已删除')
      qc.invalidateQueries({ queryKey: ['creativeTemplateHub', 'categories'] })
    },
    onError: (err: AxiosError<ApiErrorBody>) => {
      const body = err.response?.data
      if (body?.error === 'category_in_use') {
        const count = Number(body.template_count || 0)
        message.error(`该分类下还有 ${count} 个模板，请先迁移或删除这些模板`)
      }
    },
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    const maxSort = (data || []).reduce((max, item) => Math.max(max, item.sort_order), 0)
    form.setFieldsValue({ sort_order: maxSort + 10 })
    setModalOpen(true)
  }

  const openEdit = (record: SharedCreativeTemplateCategory) => {
    setEditing(record)
    form.setFieldsValue({ name: record.name, slug: record.slug, sort_order: record.sort_order })
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
        <Title level={5} style={{ margin: 0, marginRight: 16 }}>共享创意模板库 · 分类管理</Title>
        <Button type="primary" onClick={openCreate}>新建分类</Button>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="slug 是云控端分类映射的稳定标识符；建议只在初始化或确有必要时调整。"
      />

      <Table<SharedCreativeTemplateCategory>
        rowKey="id"
        size="middle"
        loading={isFetching}
        dataSource={data || []}
        pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 60 },
          { title: '中文名', dataIndex: 'name', width: 180 },
          { title: 'Slug', dataIndex: 'slug', width: 240, render: (v: string) => <Text code>{v}</Text> },
          { title: '排序', dataIndex: 'sort_order', width: 90, sorter: (a, b) => a.sort_order - b.sort_order, defaultSortOrder: 'ascend' },
          { title: '已用模板数', dataIndex: 'template_count', width: 120, align: 'center' as const, render: (v: number | undefined) => <Tag color={(v || 0) > 0 ? 'blue' : 'default'}>{v ?? 0}</Tag>, sorter: (a, b) => (a.template_count ?? 0) - (b.template_count ?? 0) },
          { title: '更新时间', dataIndex: 'updated_at', width: 170, render: (v: string) => <Text type="secondary">{v}</Text> },
          {
            title: '操作',
            width: 130,
            render: (_, r) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => openEdit(r)}>编辑</Button>
                <Popconfirm title="删除该分类？" description={(r.template_count ?? 0) > 0 ? `当前下还有 ${r.template_count} 个模板，删除会被后端拒绝` : '确认无误后将永久删除该分类'} onConfirm={() => removeMut.mutate(r.id)}>
                  <Button size="small" type="link" danger disabled={(r.template_count ?? 0) > 0}>删除</Button>
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
        onCancel={() => { setModalOpen(false); setEditing(null); form.resetFields() }}
        confirmLoading={createMut.isPending || updateMut.isPending}
        width={460}
        maskStyle={{ display: 'none' }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" requiredMark={false} preserve={false}>
          <Form.Item label="中文名" name="name" rules={[{ required: true, max: 50, message: '请输入 1-50 字' }]}>
            <Input placeholder="例如：商品海报" />
          </Form.Item>
          <Form.Item
            label="Slug"
            name="slug"
            rules={[{ required: true, max: 50 }, { pattern: /^[a-z0-9][a-z0-9-]*$/, message: '只能用小写字母、数字、连字符；不可以连字符开头' }]}
          >
            <Input placeholder="例如：product-poster" />
          </Form.Item>
          <Form.Item label="排序值" name="sort_order" rules={[{ required: true, type: 'integer', min: 0, max: 99999 }]}>
            <InputNumber min={0} max={99999} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
