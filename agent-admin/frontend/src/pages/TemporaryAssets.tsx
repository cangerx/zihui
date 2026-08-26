import { useEffect, useState } from 'react';
import {
  Button, Card, Col, Empty, Form, Image, Input, message, Popconfirm,
  Row, Select, Space, Statistic, Table, Tag, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClearOutlined, FileImageOutlined, LinkOutlined, PictureOutlined,
  ReloadOutlined, SoundOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { videoApi } from '../services/api';
import BatchDeleteButton from '../components/BatchDeleteButton';

interface RefAsset {
  id: number;
  user_id: number;
  user?: { id: number; username: string; nickname?: string | null } | null;
  video_task_id: string | null;
  asset_type: 'image' | 'video' | 'audio';
  source: 'upload' | 'url';
  storage_driver?: string | null;
  url: string;
  original_url: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  status: string;
  is_expired: boolean;
  expires_at: string | null;
  created_at: string;
}

interface RefAssetStats {
  total: number;
  expired: number;
  bound: number;
  unbound: number;
  total_size: number;
  by_type: { image: number; video: number; audio: number };
  by_source: { upload: number; url: number };
  by_storage?: { local: number; cos: number; oss: number; external: number; unknown: number };
}

const TYPE_META: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  image: { color: 'blue',   label: '图片', icon: <FileImageOutlined /> },
  video: { color: 'purple', label: '视频', icon: <VideoCameraOutlined /> },
  audio: { color: 'cyan',   label: '音频', icon: <SoundOutlined /> },
};

// 存储位置（storage_driver）→ 标签样式；为空 / 未知由渲染兜底为「未知」
const STORAGE_META: Record<string, { color: string; label: string }> = {
  local:    { color: 'default', label: '本地' },
  cos:      { color: 'blue',    label: '腾讯云' },
  oss:      { color: 'orange',  label: '阿里云' },
  external: { color: 'purple',  label: '外链' },
};

// 文件加载失败（多为已过期被清理）时的灰底占位图
const FALLBACK_IMG =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#f0f0f0"/><text x="24" y="28" font-size="10" fill="#bbb" text-anchor="middle">失效</text></svg>'
  );

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function TemporaryAssetsPage() {
  // ===== 统计 =====
  const [stats, setStats] = useState<RefAssetStats | null>(null);
  const loadStats = async () => {
    try {
      const res = await videoApi.referenceAssetStats();
      setStats(res.data);
    } catch (e: any) {
      message.error('加载统计失败：' + (e?.response?.data?.error || e?.message));
    }
  };

  // ===== 列表 =====
  const [list, setList] = useState<{ data: RefAsset[]; total: number }>({ data: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [params, setParams] = useState<Record<string, any>>({ page: 1, per_page: 20 });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const loadList = async () => {
    setLoading(true);
    try {
      const res = await videoApi.referenceAssets(params);
      setList(res.data);
    } catch (e: any) {
      message.error('加载素材失败：' + (e?.response?.data?.error || e?.message));
    } finally { setLoading(false); }
  };

  useEffect(() => { loadStats(); }, []);
  useEffect(() => { loadList(); /* eslint-disable-next-line */ }, [params]);

  const refreshAll = () => { loadStats(); loadList(); };

  // ===== 操作 =====
  const [cleaning, setCleaning] = useState(false);
  const doCleanup = async () => {
    setCleaning(true);
    try {
      const res = await videoApi.cleanupExpiredReferenceAssets();
      message.success(`已清理 ${res.data?.deleted ?? 0} 个过期素材`);
      refreshAll();
    } catch (e: any) {
      message.error('清理失败：' + (e?.response?.data?.error || e?.message));
    } finally { setCleaning(false); }
  };

  const doDelete = async (id: number) => {
    try {
      await videoApi.deleteReferenceAsset(id);
      message.success('已删除');
      refreshAll();
    } catch (e: any) {
      message.error('删除失败：' + (e?.response?.data?.error || e?.message));
    }
  };

  const renderPreview = (r: RefAsset) => {
    if (r.asset_type === 'image') {
      return (
        <Image
          src={r.url}
          width={48}
          height={48}
          style={{ objectFit: 'cover', borderRadius: 4 }}
          fallback={FALLBACK_IMG}
          preview={{ src: r.url }}
        />
      );
    }
    const meta = TYPE_META[r.asset_type] || TYPE_META.image;
    return (
      <Tooltip title="点击在新标签打开">
        <a href={r.url} target="_blank" rel="noreferrer"
          style={{ fontSize: 22, color: '#8c8c8c' }}>
          {meta.icon}
        </a>
      </Tooltip>
    );
  };

  const columns: ColumnsType<RefAsset> = [
    { title: '预览', width: 70, render: (_, r) => renderPreview(r) },
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '类型', dataIndex: 'asset_type', width: 80, render: (v: string) => {
      const m = TYPE_META[v] || TYPE_META.image;
      return <Tag color={m.color}>{m.icon} {m.label}</Tag>;
    }},
    { title: '来源', dataIndex: 'source', width: 80, render: (v: string) => (
      <Tag color={v === 'upload' ? 'green' : 'orange'}>{v === 'upload' ? '上传' : 'URL'}</Tag>
    )},
    { title: '存储位置', dataIndex: 'storage_driver', width: 90, render: (v: string) => {
      const m = STORAGE_META[v];
      return m ? <Tag color={m.color}>{m.label}</Tag> : <Tag>未知</Tag>;
    }},
    { title: '文件名', dataIndex: 'original_name', ellipsis: true, render: (v: string, r) => (
      <Tooltip title={v || r.url}><span>{v || <span style={{ color: '#bbb' }}>—</span>}</span></Tooltip>
    )},
    { title: '大小', dataIndex: 'file_size', width: 90, render: (v: number) => formatBytes(v) },
    { title: '用户', width: 130, render: (_, r) => (
      <Tooltip title={`用户 ID: ${r.user_id}`}>
        {r.user?.nickname || r.user?.username || `#${r.user_id}`}
      </Tooltip>
    )},
    { title: '绑定任务', dataIndex: 'video_task_id', width: 120, render: (v: string | null) => (
      v
        ? <Tooltip title={v}><Tag color="blue"><LinkOutlined /> {v.slice(0, 8)}…</Tag></Tooltip>
        : <Tag>未绑定</Tag>
    )},
    { title: '状态', width: 100, render: (_, r) => (
      r.is_expired
        ? <Tag color="error">已过期</Tag>
        : <Tag color="success">有效</Tag>
    )},
    { title: '过期时间', dataIndex: 'expires_at', width: 160,
      render: (v: string | null) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm') },
    { title: '操作', width: 80, fixed: 'right', render: (_, r) => (
      <Popconfirm title="确认删除该素材？" description="将同时删除存储文件，不可恢复"
        okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
        onConfirm={() => doDelete(r.id)}>
        <Button size="small" type="link" danger>删除</Button>
      </Popconfirm>
    )},
  ];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>
        <PictureOutlined /> 临时素材
      </h2>
      <p style={{ color: '#888', marginTop: -8 }}>
        桌面端 AI 视频功能上传的参考图 / 视频 / 音频，默认 24 小时后过期。系统每小时自动清理过期素材（连同存储文件），此处也可手动筛选与清理。
      </p>

      {/* 统计概览 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="素材总数" value={stats?.total ?? 0} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="已过期" value={stats?.expired ?? 0}
              valueStyle={{ color: (stats?.expired ?? 0) > 0 ? '#ff4d4f' : undefined }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="已绑定任务" value={stats?.bound ?? 0} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="未绑定" value={stats?.unbound ?? 0} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small"><Statistic title="占用空间" value={formatBytes(stats?.total_size ?? 0)} /></Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="图/视/音"
              value={`${stats?.by_type.image ?? 0}/${stats?.by_type.video ?? 0}/${stats?.by_type.audio ?? 0}`} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={4}>
          <Card size="small">
            <Statistic title="本地/腾讯/阿里"
              value={`${stats?.by_storage?.local ?? 0}/${stats?.by_storage?.cos ?? 0}/${stats?.by_storage?.oss ?? 0}`} />
          </Card>
        </Col>
      </Row>

      {/* 过滤栏 */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Form layout="inline" onFinish={(v: any) => setParams({ ...params, ...v, page: 1 })}>
          <Form.Item name="keyword">
            <Input.Search placeholder="URL / 任务 ID" allowClear style={{ width: 220 }} />
          </Form.Item>
          <Form.Item name="user_id">
            <Input placeholder="用户 ID" type="number" style={{ width: 110 }} />
          </Form.Item>
          <Form.Item name="asset_type">
            <Select placeholder="类型" allowClear style={{ width: 100 }}
              options={[
                { value: 'image', label: '图片' },
                { value: 'video', label: '视频' },
                { value: 'audio', label: '音频' },
              ]} />
          </Form.Item>
          <Form.Item name="source">
            <Select placeholder="来源" allowClear style={{ width: 100 }}
              options={[{ value: 'upload', label: '上传' }, { value: 'url', label: 'URL' }]} />
          </Form.Item>
          <Form.Item name="storage_driver">
            <Select placeholder="存储位置" allowClear style={{ width: 110 }}
              options={[
                { value: 'local', label: '本地' },
                { value: 'cos', label: '腾讯云' },
                { value: 'oss', label: '阿里云' },
                { value: 'external', label: '外链' },
              ]} />
          </Form.Item>
          <Form.Item name="expired">
            <Select placeholder="状态" allowClear style={{ width: 110 }}
              options={[{ value: '0', label: '有效' }, { value: '1', label: '已过期' }]} />
          </Form.Item>
          <Form.Item name="bound">
            <Select placeholder="绑定" allowClear style={{ width: 110 }}
              options={[{ value: '1', label: '已绑定' }, { value: '0', label: '未绑定' }]} />
          </Form.Item>
          <Form.Item>
            <Button htmlType="submit" type="primary">筛选</Button>
          </Form.Item>
          <Form.Item>
            <Button icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 操作栏 */}
      <Space style={{ marginBottom: 12 }}>
        <BatchDeleteButton
          selectedKeys={selectedIds}
          onClear={() => setSelectedIds([])}
          batchDelete={(ids) => videoApi.batchDeleteReferenceAssets(ids as number[])}
          onDone={refreshAll}
          itemName="素材"
        />
        <Popconfirm
          title="清理所有已过期素材？"
          description="将删除全部过期记录及其存储文件，不可恢复"
          okText="清理" cancelText="取消" okButtonProps={{ danger: true }}
          onConfirm={doCleanup}
        >
          <Button danger icon={<ClearOutlined />} loading={cleaning}
            disabled={!stats?.expired}>
            清理过期 ({stats?.expired ?? 0})
          </Button>
        </Popconfirm>
      </Space>

      <Table<RefAsset>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={list.data || []}
        columns={columns}
        scroll={{ x: 1300 }}
        locale={{ emptyText: <Empty description="暂无临时素材" /> }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as number[]),
        }}
        pagination={{
          current: params.page,
          pageSize: params.per_page,
          total: list.total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, ps) => setParams({ ...params, page: p, per_page: ps }),
        }}
      />
    </div>
  );
}
