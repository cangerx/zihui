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
  Upload,
  Switch,
  message,
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UploadFile } from 'antd/es/upload/interface'
import dayjs from 'dayjs'
import { siteUpdatesApi, type SiteUpdateRelease } from '@/api/siteUpdates'

const { Title, Text } = Typography

export function SiteUpdatesPage() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [fileList, setFileList] = useState<UploadFile[]>([])

  const { data: items, isFetching } = useQuery({
    queryKey: ['site-update-releases'],
    queryFn: () => siteUpdatesApi.list('admin'),
  })

  const createMut = useMutation({
    mutationFn: (fd: FormData) => siteUpdatesApi.create(fd),
    onSuccess: () => {
      message.success('已发布')
      setOpen(false)
      form.resetFields()
      setFileList([])
      qc.invalidateQueries({ queryKey: ['site-update-releases'] })
    },
  })

  const currentMut = useMutation({
    mutationFn: (id: number) => siteUpdatesApi.setCurrent(id),
    onSuccess: () => {
      message.success('已设为当前')
      qc.invalidateQueries({ queryKey: ['site-update-releases'] })
    },
  })

  const removeMut = useMutation({
    mutationFn: (id: number) => siteUpdatesApi.remove(id),
    onSuccess: () => {
      message.success('已删除')
      qc.invalidateQueries({ queryKey: ['site-update-releases'] })
    },
  })

  const submit = async () => {
    const values = await form.validateFields()
    const fd = new FormData()
    fd.append('channel', 'admin')
    fd.append('version', values.version)
    fd.append('changelog', values.changelog || '')
    if (values.min_upgradable_from) fd.append('min_upgradable_from', values.min_upgradable_from)
    fd.append('breaking', values.breaking ? '1' : '0')
    fd.append('activate', values.activate ? '1' : '0')
    if (values.zip_url) fd.append('zip_url', values.zip_url)
    if (values.sha256) fd.append('sha256', values.sha256)
    const raw = fileList[0]?.originFileObj
    if (raw) fd.append('zip', raw)
    if (!raw && !values.zip_url) {
      message.error('请上传 zip，或填写 COS 地址（zip_url）')
      return
    }
    if (!raw && values.zip_url && !values.sha256) {
      message.error('使用 COS / 外链时请填写 sha256')
      return
    }
    createMut.mutate(fd)
  }

  return (
    <Card>
      <Space style={{ marginBottom: 12 }} align="start" direction="vertical" size={4}>
        <Title level={5} style={{ margin: 0 }}>
          云控网站更新
        </Title>
        <Text type="secondary">
          短期 zip 存在本机；以后把 zip 传到 COS，发布时只填 COS 地址即可。云控「在线更新」检查地址指向本站
          /api/updates/admin/version.json
        </Text>
      </Space>
      <Button
        type="primary"
        style={{ marginBottom: 16 }}
        onClick={async () => {
          form.resetFields()
          setFileList([])
          setOpen(true)
          try {
            const draft = await siteUpdatesApi.draft()
            if (draft?.version) {
              form.setFieldsValue({
                version: draft.version,
                changelog: draft.changelog,
                activate: true,
              })
            }
          } catch {
            /* 无草稿时保持空表单 */
          }
        }}
      >
        发布新版本
      </Button>
      <Table<SiteUpdateRelease>
        rowKey="id"
        loading={isFetching}
        dataSource={items || []}
        pagination={false}
        columns={[
          {
            title: '版本',
            dataIndex: 'version',
            width: 120,
            render: (v: string, r) => (
              <Space>
                <Text strong>{v}</Text>
                {r.is_current ? <Tag color="green">当前</Tag> : null}
              </Space>
            ),
          },
          {
            title: '说明',
            dataIndex: 'changelog',
            ellipsis: true,
            render: (v: string | null) => v || <Text type="secondary">—</Text>,
          },
          {
            title: '包',
            width: 120,
            render: (_, r) => (r.zip_url ? 'COS/外链' : r.zip_path ? `${Math.round((r.size || 0) / 1024 / 1024)} MB` : '—'),
          },
          {
            title: '时间',
            dataIndex: 'released_at',
            width: 170,
            render: (v: string | null) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '—'),
          },
          {
            title: '操作',
            width: 180,
            render: (_, r) => (
              <Space size={4}>
                {!r.is_current && (
                  <Popconfirm title={`激活 ${r.version}？`} onConfirm={() => currentMut.mutate(r.id)}>
                    <Button size="small" type="link">
                      设为当前
                    </Button>
                  </Popconfirm>
                )}
                {!r.is_current && (
                  <Popconfirm title="删除？" onConfirm={() => removeMut.mutate(r.id)}>
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
        title="发布云控更新"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={createMut.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ activate: true }}>
          <Form.Item name="version" label="版本号（默认带入本地云控 version.php / CHANGELOG）" rules={[{ required: true, message: '如 1.6.43' }]}>
            <Input placeholder="1.6.43" />
          </Form.Item>
          <Form.Item name="changelog" label="更新说明（每行一条，会显示在云控在线更新）">
            <Input.TextArea rows={6} placeholder={'修复 Windows 云打包大图\n提示词右键复制粘贴'} />
          </Form.Item>
          <Form.Item name="min_upgradable_from" label="最低可升级版本">
            <Input placeholder="可空" />
          </Form.Item>
          <Form.Item name="zip_url" label="COS / 外链 zip（短期可空，改传本地 zip）">
            <Input placeholder="https://xxx.cos.../agent-admin-1.6.43.zip" />
          </Form.Item>
          <Form.Item name="sha256" label="sha256（本地 zip 会自动计算；只填 COS 时必填）">
            <Input placeholder="64 位十六进制" />
          </Form.Item>
          <Form.Item label="本地 zip">
            <Upload
              maxCount={1}
              accept=".zip"
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: next }) => setFileList(next)}
            >
              <Button>选择 zip</Button>
            </Upload>
          </Form.Item>
          <Form.Item name="activate" label="立即作为当前版本" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
