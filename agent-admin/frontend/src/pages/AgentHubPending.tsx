import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Form, Image, Input, message, Modal, Popconfirm,
  Space, Spin, Table, Tag, Tooltip,
} from 'antd';
import { CheckOutlined, CloseOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { agentHubApi } from '../services/api';

interface PendingAgent {
  id: number;
  name: string;
  description?: string;
  avatar: string;
  system_prompt?: string;
  tool_skill_ids?: string[];
  tool_approval?: string;
  enable_image_gen?: boolean;
  tags?: string[];
  source_site_name: string;
  category_id?: number;
  category_name?: string;
  category_slug?: string;
  hub_category_id?: number;
  hub_category?: { id: number; name: string };
  approve_count: number;
  reject_count: number;
  report_count: number;
  my_review_action?: 'approve' | 'reject' | null;
  created_at: string;
}

type HubMe = {
  ready?: boolean;
  reason?: string;
  me?: {
    site_name?: string;
    domain?: string;
    is_reviewer?: boolean;
    approve_threshold?: number;
    reject_threshold?: number;
  };
};

const APPROVAL_LABEL: Record<string, string> = {
  off: '工具免确认',
  destructive: '破坏性需确认',
  all: '全部需确认',
};

const BUILTIN_TOOL_NAMES: Record<string, string> = {
  builtin_current_time: '当前时间',
  builtin_calculator: '数学计算器',
  builtin_fetch_webpage: '网页获取',
  builtin_json_tool: 'JSON 处理',
  builtin_text_tool: '文本处理',
  builtin_random_generator: '随机生成器',
};

const getHubCategoryName = (item: PendingAgent) => item.category_name || item.hub_category?.name || '';
const toolName = (id: string) => BUILTIN_TOOL_NAMES[id] || id;

export default function AgentHubPending() {
  const [hubMe, setHubMe] = useState<HubMe | null>(null);
  const [hubMeLoading, setHubMeLoading] = useState(true);
  const [items, setItems] = useState<PendingAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [detailItem, setDetailItem] = useState<PendingAgent | null>(null);
  const [rejectItem, setRejectItem] = useState<PendingAgent | null>(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectForm] = Form.useForm<{ reason: string }>();
  const [votingIds, setVotingIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchRejectOpen, setBatchRejectOpen] = useState(false);
  const [batchRejectForm] = Form.useForm<{ reason: string }>();

  const loadHubMe = useCallback(async () => {
    setHubMeLoading(true);
    try {
      const res = await agentHubApi.me();
      setHubMe(res.data);
    } catch (e: any) {
      setHubMe(e?.response?.data || { ready: false, reason: 'unknown' });
    } finally {
      setHubMeLoading(false);
    }
  }, []);

  const loadItems = useCallback(async (page = 1, pageSize = 20) => {
    if (!hubMe?.ready || !hubMe?.me?.is_reviewer) return;
    setSelectedIds([]);
    setLoading(true);
    try {
      const res = await agentHubApi.adminPendingList({ page, page_size: pageSize });
      setItems(res.data?.items || []);
      setPagination({ current: page, pageSize, total: res.data?.total || 0 });
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载共享审核失败');
    }
    setLoading(false);
  }, [hubMe?.ready, hubMe?.me?.is_reviewer]);

  useEffect(() => { loadHubMe(); }, [loadHubMe]);
  useEffect(() => {
    if (hubMe?.ready && hubMe?.me?.is_reviewer) loadItems(1, pagination.pageSize);
  }, [hubMe?.ready, hubMe?.me?.is_reviewer]);

  const patchVoted = (id: number, action: 'approve' | 'reject') => {
    setItems(prev => prev.map(it => it.id === id
      ? {
          ...it,
          my_review_action: action,
          approve_count: it.approve_count + (action === 'approve' ? 1 : 0),
          reject_count: it.reject_count + (action === 'reject' ? 1 : 0),
        }
      : it));
  };

  const handleApprove = async (item: PendingAgent) => {
    setVotingIds(prev => new Set(prev).add(item.id));
    try {
      await agentHubApi.adminReview(item.id, { action: 'approve' });
      message.success('已投通过票');
      patchVoted(item.id, 'approve');
      loadItems(pagination.current, pagination.pageSize);
    } catch (e: any) {
      const err = e?.response?.data?.error;
      if (err === 'already_voted') {
        message.warning('本站已对该数字员工投过票');
        loadItems(pagination.current, pagination.pageSize);
      } else {
        message.error(e?.response?.data?.message || err || '投票失败');
      }
    } finally {
      setVotingIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const openRejectModal = (item: PendingAgent) => {
    setRejectItem(item);
    rejectForm.resetFields();
  };

  const handleRejectSubmit = async () => {
    if (!rejectItem) return;
    const values = await rejectForm.validateFields();
    setRejectSubmitting(true);
    const targetId = rejectItem.id;
    try {
      await agentHubApi.adminReview(targetId, { action: 'reject', reason: values.reason });
      message.success('已投拒绝票');
      setRejectItem(null);
      patchVoted(targetId, 'reject');
      loadItems(pagination.current, pagination.pageSize);
    } catch (e: any) {
      const err = e?.response?.data?.error;
      if (err === 'already_voted') {
        message.warning('本站已对该数字员工投过票');
        setRejectItem(null);
        loadItems(pagination.current, pagination.pageSize);
      } else {
        message.error(e?.response?.data?.message || err || '投票失败');
      }
    } finally {
      setRejectSubmitting(false);
    }
  };

  const handleBatchApprove = async () => {
    const targets = items.filter(it => selectedIds.includes(it.id) && !it.my_review_action);
    if (targets.length === 0) { message.warning('所选数字员工均已投过票'); return; }
    setBatchSubmitting(true);
    let okCount = 0, skipCount = 0, failCount = 0;
    for (const it of targets) {
      try {
        await agentHubApi.adminReview(it.id, { action: 'approve' });
        okCount++;
        patchVoted(it.id, 'approve');
      } catch (e: any) {
        if (e?.response?.data?.error === 'already_voted') skipCount++;
        else failCount++;
      }
    }
    setBatchSubmitting(false);
    setSelectedIds([]);
    const parts: string[] = [];
    if (okCount > 0) parts.push(`${okCount} 条已通过`);
    if (skipCount > 0) parts.push(`${skipCount} 条已投过`);
    if (failCount > 0) parts.push(`${failCount} 条失败`);
    message[failCount > 0 ? 'warning' : 'success'](`批量通过完成：${parts.join('，')}`);
    loadItems(pagination.current, pagination.pageSize);
  };

  const openBatchRejectModal = () => {
    const targets = items.filter(it => selectedIds.includes(it.id) && !it.my_review_action);
    if (targets.length === 0) { message.warning('所选数字员工均已投过票'); return; }
    batchRejectForm.resetFields();
    setBatchRejectOpen(true);
  };

  const handleBatchRejectSubmit = async () => {
    const values = await batchRejectForm.validateFields();
    const targets = items.filter(it => selectedIds.includes(it.id) && !it.my_review_action);
    setBatchSubmitting(true);
    let okCount = 0, skipCount = 0, failCount = 0;
    for (const it of targets) {
      try {
        await agentHubApi.adminReview(it.id, { action: 'reject', reason: values.reason });
        okCount++;
        patchVoted(it.id, 'reject');
      } catch (e: any) {
        if (e?.response?.data?.error === 'already_voted') skipCount++;
        else failCount++;
      }
    }
    setBatchSubmitting(false);
    setBatchRejectOpen(false);
    setSelectedIds([]);
    const parts: string[] = [];
    if (okCount > 0) parts.push(`${okCount} 条已拒绝`);
    if (skipCount > 0) parts.push(`${skipCount} 条已投过`);
    if (failCount > 0) parts.push(`${failCount} 条失败`);
    message[failCount > 0 ? 'warning' : 'success'](`批量拒绝完成：${parts.join('，')}`);
    loadItems(pagination.current, pagination.pageSize);
  };

  if (hubMeLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  if (!hubMe?.ready) {
    return <Alert type="warning" showIcon message="数字员工共享市场未配置" description={<div><div style={{ marginBottom: 8 }}>请确认本站 Origin 已在 agent-build 后台授权，或联系管理员。</div><Link to="/settings">前往系统设置查看状态 →</Link></div>} />;
  }

  if (!hubMe?.me?.is_reviewer) {
    return <Alert type="info" showIcon message="本站点非审核员" description={<div><div style={{ marginBottom: 8 }}>当前站点（{hubMe?.me?.site_name || hubMe?.me?.domain || '—'}）未被共享市场指派为审核员，无法查看共享审核或投票。</div><Link to="/agent-hub/browse">去浏览数字员工共享市场 →</Link></div>} />;
  }

  const columns = [
    { title: '形象', dataIndex: 'avatar', width: 70, render: (url: string) => url ? <Image src={url} width={40} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} /> : '-' },
    {
      title: '数字员工', dataIndex: 'name', render: (v: string, r: PendingAgent) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            来自 <Tag color="blue" style={{ marginInlineEnd: 0 }}>{r.source_site_name || '未知'}</Tag>
            {getHubCategoryName(r) && <Tag style={{ marginInlineStart: 4 }}>{getHubCategoryName(r)}</Tag>}
            {r.tool_skill_ids?.length ? <Tag color="blue" style={{ marginInlineStart: 4 }}>工具 {r.tool_skill_ids.length} 个</Tag> : null}
            {r.enable_image_gen ? <Tag color="purple" style={{ marginInlineStart: 4 }}>生图</Tag> : null}
            {r.tags?.slice(0, 2).map(t => <Tag key={t} color="cyan" style={{ marginInlineStart: 4 }}>{t}</Tag>)}
          </div>
        </div>
      ),
    },
    { title: '票数', width: 200, render: (_: any, r: PendingAgent) => <Space size={4} wrap><Tooltip title={`通过阈值：${hubMe?.me?.approve_threshold ?? '—'}`}><Tag color={r.approve_count >= (hubMe?.me?.approve_threshold ?? 999) ? 'green' : 'default'}>通过 {r.approve_count}</Tag></Tooltip><Tooltip title={`拒绝阈值：${hubMe?.me?.reject_threshold ?? '—'}`}><Tag color={r.reject_count >= (hubMe?.me?.reject_threshold ?? 999) ? 'red' : 'default'}>拒绝 {r.reject_count}</Tag></Tooltip>{r.report_count > 0 && <Tag color="volcano">举报 {r.report_count}</Tag>}</Space> },
    { title: '我已投', dataIndex: 'my_review_action', width: 90, render: (v: 'approve' | 'reject' | null | undefined) => v === 'approve' ? <Tag color="green">已通过</Tag> : v === 'reject' ? <Tag color="red">已拒绝</Tag> : <span style={{ color: '#bbb', fontSize: 12 }}>未投</span> },
    { title: '提交时间', dataIndex: 'created_at', width: 160, render: (v: string) => <span style={{ color: '#888', fontSize: 12 }}>{v}</span> },
    {
      title: '操作', width: 240, fixed: 'right' as const, render: (_: any, record: PendingAgent) => {
        const myAction = record.my_review_action;
        const voted = !!myAction;
        const voting = votingIds.has(record.id);
        return <Space size="small" wrap><Button size="small" icon={<EyeOutlined />} onClick={() => setDetailItem(record)}>详情</Button><Popconfirm title="投通过票？" description={`本站将作为审核员投通过票。达到 ${hubMe?.me?.approve_threshold ?? '?'} 票后 Hub 自动进入公开池。`} onConfirm={() => handleApprove(record)} okText="通过" disabled={voted}><Button size="small" type={myAction === 'approve' ? 'default' : 'primary'} icon={<CheckOutlined />} disabled={voted} loading={voting && !rejectItem}>{myAction === 'approve' ? '已通过' : '通过'}</Button></Popconfirm><Button size="small" danger={myAction !== 'reject'} icon={<CloseOutlined />} disabled={voted} onClick={() => openRejectModal(record)}>{myAction === 'reject' ? '已拒绝' : '拒绝'}</Button></Space>;
      },
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap split={<span style={{ color: '#e0e0e0' }}>|</span>}><span><b>本站点：</b>{hubMe?.me?.site_name || '—'}</span><Tag color="green">已是审核员</Tag>{typeof hubMe?.me?.approve_threshold === 'number' && <span style={{ color: '#888', fontSize: 12 }}>通过阈值 {hubMe.me.approve_threshold} · 拒绝阈值 {hubMe.me.reject_threshold}</span>}<Link to="/agent-hub/browse">去共享市场 →</Link></Space>
      </Card>
      <Alert type="info" showIcon message="共享审核说明" description="本站作为数字员工共享市场的审核员，对待审数字员工投一票。一个站点对每个数字员工只能投一次，投后不可改。达到共享市场阈值后自动公开或拒绝。" style={{ marginBottom: 12 }} />
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button icon={<ReloadOutlined />} onClick={() => loadItems(pagination.current, pagination.pageSize)}>刷新</Button>
        <Popconfirm title={`批量投通过票（${selectedIds.length} 条）`} description="将对所选数字员工统一投通过票；已投过票的会自动跳过。" onConfirm={handleBatchApprove} okText="确认通过" disabled={selectedIds.length === 0 || batchSubmitting}><Button type="primary" disabled={selectedIds.length === 0} loading={batchSubmitting && !batchRejectOpen}>批量通过</Button></Popconfirm>
        <Button danger disabled={selectedIds.length === 0} onClick={openBatchRejectModal}>批量拒绝</Button>
        {selectedIds.length > 0 && <><span style={{ color: '#888', fontSize: 12 }}>已选 <b style={{ color: '#1677ff' }}>{selectedIds.length}</b> 条</span><Button size="small" onClick={() => setSelectedIds([])}>清空选择</Button></>}
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>共 {pagination.total} 条待审</span>
      </div>
      <Table rowKey="id" columns={columns} dataSource={items} loading={loading} size="small" scroll={{ x: 1000 }} rowSelection={{ selectedRowKeys: selectedIds, onChange: keys => setSelectedIds(keys as number[]), getCheckboxProps: record => ({ disabled: !!record.my_review_action }) }} pagination={{ ...pagination, showSizeChanger: true, pageSizeOptions: [10, 20, 50, 100], onChange: (page, size) => loadItems(page, size) }} />

      <Modal title="待审数字员工详情" open={!!detailItem} onCancel={() => setDetailItem(null)} footer={<Button onClick={() => setDetailItem(null)}>关闭</Button>} width={720} destroyOnClose mask={false}>
        {detailItem && <div>
          <Space align="start" style={{ marginBottom: 16 }}>
            {detailItem.avatar && <Image src={detailItem.avatar} width={120} height={180} style={{ objectFit: 'cover', borderRadius: 6 }} />}
            <div>
              <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{detailItem.name}</div>
              <Space wrap style={{ marginBottom: 8 }}>
                <Tag color="blue">{detailItem.source_site_name || '未知来源'}</Tag>
                {getHubCategoryName(detailItem) && <Tag>{getHubCategoryName(detailItem)}</Tag>}
                {detailItem.tool_approval && <Tag color="geekblue">{APPROVAL_LABEL[detailItem.tool_approval] || detailItem.tool_approval}</Tag>}
                {detailItem.enable_image_gen && <Tag color="purple">生图能力</Tag>}
              </Space>
              {detailItem.tags?.length ? <div style={{ marginBottom: 8 }}><Space size={4} wrap>{detailItem.tags.map(t => <Tag key={t} color="cyan">{t}</Tag>)}</Space></div> : null}
              <span style={{ fontSize: 12, color: '#888' }}>通过 {detailItem.approve_count} · 拒绝 {detailItem.reject_count} · 举报 {detailItem.report_count}</span>
            </div>
          </Space>
          {detailItem.description && <Card size="small" title="描述" style={{ marginBottom: 12 }}><div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{detailItem.description}</div></Card>}
          {detailItem.system_prompt && <Card size="small" title="系统提示词" style={{ marginBottom: 12 }}><div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{detailItem.system_prompt}</div></Card>}
          {!!detailItem.tool_skill_ids?.length && <Card size="small" title={`绑定小工具（${detailItem.tool_skill_ids.length}）`}><Space wrap>{detailItem.tool_skill_ids.map(id => <Tag key={id}>{toolName(id)}</Tag>)}</Space></Card>}
        </div>}
      </Modal>

      <Modal title={rejectItem ? `拒绝数字员工：${rejectItem.name}` : '拒绝数字员工'} open={!!rejectItem} onCancel={() => setRejectItem(null)} onOk={handleRejectSubmit} okText="投拒绝票" okButtonProps={{ danger: true }} confirmLoading={rejectSubmitting} destroyOnClose mask={false}>
        <Form form={rejectForm} layout="vertical" preserve={false}><Form.Item name="reason" label="拒绝理由" rules={[{ required: true, min: 2, max: 255, message: '请输入 2-255 字拒绝理由' }]}><Input.TextArea rows={3} maxLength={255} showCount /></Form.Item></Form>
      </Modal>

      <Modal title={`批量拒绝 ${selectedIds.length} 个数字员工`} open={batchRejectOpen} onCancel={() => setBatchRejectOpen(false)} onOk={handleBatchRejectSubmit} okText="批量拒绝" okButtonProps={{ danger: true }} confirmLoading={batchSubmitting && batchRejectOpen} destroyOnClose mask={false}>
        <Form form={batchRejectForm} layout="vertical" preserve={false}><Form.Item name="reason" label="拒绝理由" rules={[{ required: true, min: 2, max: 255, message: '请输入 2-255 字拒绝理由' }]}><Input.TextArea rows={3} maxLength={255} showCount /></Form.Item></Form>
      </Modal>
    </div>
  );
}
