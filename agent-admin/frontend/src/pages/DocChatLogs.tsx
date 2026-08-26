import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Input, Select, Tag, Modal, Descriptions, message, Tooltip,
} from 'antd';
import type { TableProps } from 'antd';
import { ReloadOutlined, SearchOutlined, EyeOutlined } from '@ant-design/icons';
import { docApi } from '../services/api';

/**
 * 问答审计日志：查看每次 RAG 问答的 query / 回答 / 命中文档 / 状态 / 用时。
 *
 * 设计取舍：
 * - 列表只展示元信息（query 截断 + 状态 + 用时），点行打开 Modal 看完整回答
 * - 游客提问 user_id=null，列表显示「游客 (session)」便于追踪同一会话
 * - status: success / failed / no_match 三种 Tag 颜色区分；failed 时悬停看 error 字段
 * - 列表自动 30s 轮询？暂不做（admin 偶尔看，按手动刷新即可）
 */

type ChatLog = {
  id: number;
  user_id: number | null;
  user_username?: string | null;
  user_nickname?: string | null;
  session_id: string;
  query: string;
  answer: string | null;
  cited_doc_ids: number[];
  latency_ms: number;
  total_tokens: number;
  status: 'success' | 'failed' | 'no_match';
  error: string | null;
  created_at: string;
};

const STATUS_META: Record<string, { color: string; text: string }> = {
  success:  { color: 'success', text: '成功' },
  failed:   { color: 'error',   text: '失败' },
  no_match: { color: 'warning', text: '无匹配' },
};

export default function DocChatLogs() {
  const [items, setItems] = useState<ChatLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [loading, setLoading] = useState(false);

  const [filters, setFilters] = useState({ keyword: '', status: undefined as string | undefined });
  const [detail, setDetail] = useState<ChatLog | null>(null);

  useEffect(() => { void loadList(); }, [page, perPage, filters.status]);

  const loadList = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage };
      if (filters.keyword) params.keyword = filters.keyword;
      if (filters.status) params.status = filters.status;
      const res = await docApi.chatLogs(params);
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载日志失败');
    } finally {
      setLoading(false);
    }
  };

  const renderUser = (item: ChatLog) => {
    if (item.user_id) {
      return (
        <Tooltip title={`user_id=${item.user_id} / session=${item.session_id}`}>
          <span>{item.user_nickname || item.user_username || `#${item.user_id}`}</span>
        </Tooltip>
      );
    }
    return (
      <Tooltip title={`游客；session=${item.session_id}`}>
        <Tag>游客</Tag>
      </Tooltip>
    );
  };

  const columns: TableProps<ChatLog>['columns'] = [
    {
      title: '时间', dataIndex: 'created_at', key: 'created_at', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-',
    },
    {
      title: '用户', key: 'user', width: 120,
      render: (_: any, record) => renderUser(record),
    },
    {
      title: '问题', dataIndex: 'query', key: 'query', ellipsis: true,
      render: (q: string, record) => (
        <a onClick={() => setDetail(record)} title={q}>{q}</a>
      ),
    },
    {
      title: '命中文档', key: 'cited', width: 100, align: 'center' as const,
      render: (_: any, record) => (
        <Tag color={record.cited_doc_ids?.length ? 'blue' : 'default'}>
          {record.cited_doc_ids?.length || 0}
        </Tag>
      ),
    },
    {
      title: '用时', dataIndex: 'latency_ms', key: 'latency_ms', width: 80, align: 'right' as const,
      render: (n: number) => `${n}ms`,
    },
    {
      title: 'tokens', dataIndex: 'total_tokens', key: 'total_tokens', width: 80, align: 'right' as const,
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (s: string, record) => {
        const meta = STATUS_META[s] || { color: 'default', text: s };
        if (s === 'failed' && record.error) {
          return <Tooltip title={record.error}><Tag color={meta.color as any}>{meta.text}</Tag></Tooltip>;
        }
        return <Tag color={meta.color as any}>{meta.text}</Tag>;
      },
    },
    {
      title: '操作', key: 'action', width: 80, fixed: 'right' as const,
      render: (_: any, record) => (
        <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setDetail(record)}>详情</Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <Input.Search
            placeholder="搜索问题 / session_id"
            allowClear
            style={{ width: 280 }}
            prefix={<SearchOutlined />}
            value={filters.keyword}
            onChange={(e) => setFilters((s) => ({ ...s, keyword: e.target.value }))}
            onSearch={() => { setPage(1); void loadList(); }}
          />
          <Select
            placeholder="全部状态"
            allowClear
            style={{ width: 140 }}
            value={filters.status}
            onChange={(v) => { setFilters((s) => ({ ...s, status: v })); setPage(1); }}
            options={[
              { value: 'success', label: '成功' },
              { value: 'failed', label: '失败' },
              { value: 'no_match', label: '无匹配' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadList()}>刷新</Button>
        </Space>
      </div>

      <Table<ChatLog>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          pageSize: perPage,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => { setPage(p); setPerPage(s); },
        }}
      />

      <Modal
        open={!!detail}
        title="问答详情"
        width={Math.min(900, window.innerWidth - 80)}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
        onCancel={() => setDetail(null)}
        destroyOnClose
      >
        {detail && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="时间" span={2}>
              {new Date(detail.created_at).toLocaleString('zh-CN', { hour12: false })}
            </Descriptions.Item>
            <Descriptions.Item label="用户">{renderUser(detail)}</Descriptions.Item>
            <Descriptions.Item label="Session ID">
              <code style={{ fontSize: 12 }}>{detail.session_id}</code>
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <Tag color={STATUS_META[detail.status]?.color as any}>
                {STATUS_META[detail.status]?.text || detail.status}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="命中文档">
              {detail.cited_doc_ids?.length
                ? detail.cited_doc_ids.map((id) => <Tag key={id}>doc {id}</Tag>)
                : <span style={{ color: '#999' }}>无</span>}
            </Descriptions.Item>
            <Descriptions.Item label="用时">{detail.latency_ms} ms</Descriptions.Item>
            <Descriptions.Item label="Tokens">{detail.total_tokens}</Descriptions.Item>
            <Descriptions.Item label="问题" span={2}>
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13,
              }}>{detail.query}</pre>
            </Descriptions.Item>
            <Descriptions.Item label="回答" span={2}>
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 13,
                maxHeight: 360, overflow: 'auto',
              }}>{detail.answer || <span style={{ color: '#999' }}>（无回答）</span>}</pre>
            </Descriptions.Item>
            {detail.error && (
              <Descriptions.Item label="错误" span={2}>
                <pre style={{
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
                  color: '#f5222d', fontSize: 12,
                }}>{detail.error}</pre>
              </Descriptions.Item>
            )}
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
