import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Empty, Form, Image, Input, message, Modal, Pagination,
  Select, Space, Spin, Tag, Tooltip,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { agentApi, agentHubApi } from '../services/api';

interface HubAgent {
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
  hub_category?: { id: number; name: string; slug?: string };
  report_count: number;
  download_count?: number;
  reported_by_me?: boolean;
  created_at: string;
}

interface HubCategory { id: number; name: string; slug?: string; }
interface LocalCategory { id: number; name: string; sort_order?: number; }

type HubMe = {
  ready?: boolean;
  reason?: string;
  me?: {
    site_name?: string;
    domain?: string;
    is_reviewer?: boolean;
    approve_threshold?: number;
    reject_threshold?: number;
    report_threshold?: number;
  };
};

const REPORT_REASONS = [
  { code: 'invalid_image', label: '形象图失效 / 无法加载' },
  { code: 'inappropriate', label: '内容不当 / 违规' },
  { code: 'duplicate', label: '重复内容' },
  { code: 'copyright', label: '侵犯版权' },
  { code: 'other', label: '其他' },
];

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

const getHubCategoryName = (item: HubAgent) => item.category_name || item.hub_category?.name || '';
const toolName = (id: string) => BUILTIN_TOOL_NAMES[id] || id;

export default function AgentHubBrowse() {
  const [hubMe, setHubMe] = useState<HubMe | null>(null);
  const [hubMeLoading, setHubMeLoading] = useState(true);
  const [items, setItems] = useState<HubAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 24, total: 0 });
  const [hubCategories, setHubCategories] = useState<HubCategory[]>([]);
  const [localCategories, setLocalCategories] = useState<LocalCategory[]>([]);
  const [filterCategoryId, setFilterCategoryId] = useState<number | undefined>();
  const [searchText, setSearchText] = useState('');
  const [sort, setSort] = useState<'recent' | 'popular'>('recent');
  const [detailItem, setDetailItem] = useState<HubAgent | null>(null);
  const [pullItem, setPullItem] = useState<HubAgent | null>(null);
  const [pullSubmitting, setPullSubmitting] = useState(false);
  const [pullForm] = Form.useForm<{ local_category_id?: number }>();
  const [reportItem, setReportItem] = useState<HubAgent | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportForm] = Form.useForm<{ reason_code: string; reason_note?: string }>();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchPullOpen, setBatchPullOpen] = useState(false);
  const [batchPullSubmitting, setBatchPullSubmitting] = useState(false);
  const [batchPullForm] = Form.useForm<{ local_category_id?: number }>();

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

  const loadHubCategories = useCallback(async () => {
    try {
      const res = await agentHubApi.categories();
      const arr = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.items || []);
      setHubCategories(arr);
    } catch {}
  }, []);

  const loadLocalCategories = useCallback(async () => {
    try {
      const res = await agentApi.listCategories();
      setLocalCategories(res.data.data || []);
    } catch {}
  }, []);

  const loadItems = useCallback(async (page = 1, pageSize = 24) => {
    if (!hubMe?.ready) return;
    setSelectedIds(new Set());
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: pageSize, sort, exclude_self: 1, exclude_pulled: 1 };
      if (filterCategoryId) params.category_id = filterCategoryId;
      if (searchText) params.search = searchText;
      const res = await agentHubApi.list(params);
      setItems(res.data?.items || []);
      setPagination({ current: page, pageSize, total: res.data?.total || 0 });
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载数字员工共享市场失败');
    }
    setLoading(false);
  }, [hubMe?.ready, sort, filterCategoryId, searchText]);

  useEffect(() => { loadHubMe(); loadLocalCategories(); }, [loadHubMe, loadLocalCategories]);
  useEffect(() => {
    if (hubMe?.ready) {
      loadHubCategories();
    }
  }, [hubMe?.ready]);

  useEffect(() => {
    if (hubMe?.ready) {
      loadItems(1, pagination.pageSize);
    }
  }, [hubMe?.ready, filterCategoryId, searchText, sort]);

  const openPullModal = (item: HubAgent) => {
    setPullItem(item);
    pullForm.resetFields();
    const categoryName = getHubCategoryName(item);
    if (categoryName) {
      const matched = localCategories.find(c => c.name === categoryName);
      if (matched) pullForm.setFieldValue('local_category_id', matched.id);
    }
  };

  const handlePullSubmit = async () => {
    if (!pullItem) return;
    const values = await pullForm.validateFields();
    setPullSubmitting(true);
    const targetId = pullItem.id;
    try {
      const res = await agentHubApi.adminPullToLocal(targetId, { local_category_id: values.local_category_id });
      message.success(`已拉到本地（local_id=${res.data?.local_id}）`);
      setPullItem(null);
      setItems(prev => prev.filter(it => it.id !== targetId));
    } catch (e: any) {
      const err = e?.response?.data?.error;
      const msg = e?.response?.data?.message;
      if (err === 'already_pulled') {
        message.warning('该数字员工已被本站拉取过，请勿重复');
        setItems(prev => prev.filter(it => it.id !== targetId));
      } else {
        message.error(msg || err || '拉取失败');
      }
    } finally {
      setPullSubmitting(false);
    }
  };

  const openReportModal = (item: HubAgent) => {
    setReportItem(item);
    reportForm.resetFields();
    reportForm.setFieldValue('reason_code', 'inappropriate');
  };

  const handleReportSubmit = async () => {
    if (!reportItem) return;
    const values = await reportForm.validateFields();
    setReportSubmitting(true);
    const targetId = reportItem.id;
    try {
      await agentHubApi.report(targetId, values);
      message.success('已举报，谢谢反馈');
      setReportItem(null);
      setItems(prev => prev.map(it => it.id === targetId ? { ...it, reported_by_me: true, report_count: (it.report_count || 0) + 1 } : it));
    } catch (e: any) {
      const err = e?.response?.data?.error;
      if (err === 'already_reported') {
        message.warning('本站已举报过该数字员工');
        setReportItem(null);
        setItems(prev => prev.map(it => it.id === targetId ? { ...it, reported_by_me: true } : it));
      } else {
        message.error(e?.response?.data?.message || err || '举报失败');
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds(selectedIds.size === items.length ? new Set() : new Set(items.map(it => it.id)));
  };

  const handleBatchPullSubmit = async () => {
    const values = await batchPullForm.validateFields();
    const ids = Array.from(selectedIds);
    setBatchPullSubmitting(true);
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    for (const hubId of ids) {
      try {
        await agentHubApi.adminPullToLocal(hubId, { local_category_id: values.local_category_id });
        successCount++;
        setItems(prev => prev.filter(it => it.id !== hubId));
      } catch (e: any) {
        if (e?.response?.data?.error === 'already_pulled') {
          skipCount++;
          setItems(prev => prev.filter(it => it.id !== hubId));
        } else {
          failCount++;
        }
      }
    }
    setBatchPullSubmitting(false);
    setBatchPullOpen(false);
    setSelectedIds(new Set());
    const parts: string[] = [];
    if (successCount > 0) parts.push(`${successCount} 条成功`);
    if (skipCount > 0) parts.push(`${skipCount} 条已拉过`);
    if (failCount > 0) parts.push(`${failCount} 条失败`);
    message[failCount > 0 ? 'warning' : 'success'](`批量拉取完成：${parts.join('，')}`);
  };

  if (hubMeLoading) return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;

  if (!hubMe?.ready) {
    return (
      <Alert
        type="warning"
        showIcon
        message="数字员工共享市场暂不可用"
        description={<div><div style={{ marginBottom: 8 }}>请确认本站 Origin 已在 agent-build 后台授权，或联系管理员。</div><Link to="/settings">前往系统设置查看状态 →</Link></div>}
      />
    );
  }

  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap split={<span style={{ color: '#e0e0e0' }}>|</span>}>
          <span><b>本站点：</b>{hubMe?.me?.site_name || '—'}</span>
          <span><b>授权域名：</b><code style={{ fontSize: 12 }}>{hubMe?.me?.domain || '—'}</code></span>
          <span><b>审核员：</b>{hubMe?.me?.is_reviewer ? <Tag color="green">是</Tag> : <Tag>否</Tag>}{hubMe?.me?.is_reviewer && <Link to="/agent-hub/pending" style={{ marginLeft: 8 }}>去共享审核 →</Link>}</span>
          {typeof hubMe?.me?.approve_threshold === 'number' && <span style={{ color: '#888', fontSize: 12 }}>通过阈值 {hubMe.me.approve_threshold} · 拒绝阈值 {hubMe.me.reject_threshold} · 举报阈值 {hubMe.me.report_threshold}</span>}
        </Space>
      </Card>

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select allowClear placeholder="按 Hub 分类筛选" style={{ width: 180 }} value={filterCategoryId} onChange={setFilterCategoryId} options={hubCategories.map(c => ({ label: c.name, value: c.id }))} />
        <Input.Search placeholder="搜索名称/描述/提示词" style={{ width: 260 }} onSearch={setSearchText} enterButton={<SearchOutlined />} allowClear />
        <Select value={sort} onChange={setSort} style={{ width: 140 }} options={[{ value: 'recent', label: '最新发布' }, { value: 'popular', label: '最多下载' }]} />
        <Button icon={<ReloadOutlined />} onClick={() => loadItems(pagination.current, pagination.pageSize)}>刷新</Button>
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>共 {pagination.total} 条</span>
      </div>

      {items.length > 0 && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Checkbox checked={items.length > 0 && selectedIds.size === items.length} indeterminate={selectedIds.size > 0 && selectedIds.size < items.length} onChange={toggleSelectAll}>全选当前页</Checkbox>
          <span style={{ color: '#888', fontSize: 12 }}>已选 <b style={{ color: '#1677ff' }}>{selectedIds.size}</b> / {items.length}</span>
          <Button type="primary" size="small" disabled={selectedIds.size === 0} onClick={() => { batchPullForm.resetFields(); setBatchPullOpen(true); }}>批量拉到本地</Button>
          {selectedIds.size > 0 && <Button size="small" onClick={() => setSelectedIds(new Set())}>清空选择</Button>}
        </div>
      )}

      <Spin spinning={loading}>
        {items.length === 0 && !loading ? <Empty description="数字员工共享市场暂无内容" style={{ padding: 40 }} /> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
            {items.map(item => {
              const checked = selectedIds.has(item.id);
              return (
                <Card key={item.id} size="small" hoverable style={checked ? { borderColor: '#1677ff', boxShadow: '0 0 0 1px #1677ff' } : undefined} cover={(
                  <div style={{ height: 220, overflow: 'hidden', background: '#f5f5f5', position: 'relative' }}>
                    {item.avatar ? <img src={item.avatar} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc' }}>无形象</div>}
                    <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(255,255,255,0.92)', borderRadius: 4, padding: '2px 6px', lineHeight: 1 }}><Checkbox checked={checked} onChange={() => toggleSelect(item.id)} /></div>
                  </div>
                )} bodyStyle={{ padding: 12 }}>
                  <Tooltip title={item.name}><div style={{ fontWeight: 500, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div></Tooltip>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>来自 <Tag color="blue" style={{ marginInlineEnd: 0 }}>{item.source_site_name || '未知'}</Tag></div>
                  <Space size={4} wrap style={{ marginBottom: 8 }}>
                    {getHubCategoryName(item) && <Tag>{getHubCategoryName(item)}</Tag>}
                    {item.tool_skill_ids?.length ? <Tag color="blue">工具 {item.tool_skill_ids.length} 个</Tag> : null}
                    {item.enable_image_gen ? <Tag color="purple">生图</Tag> : null}
                    {item.tags?.slice(0, 2).map(t => <Tag key={t} color="cyan">{t}</Tag>)}
                  </Space>
                  <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>热度 {item.download_count ?? 0}</span><span>·</span><span style={{ color: item.report_count > 0 ? '#fa8c16' : '#aaa' }}>举报 {item.report_count}</span>{item.reported_by_me && <Tag color="orange" style={{ marginLeft: 'auto' }}>已举报</Tag>}
                  </div>
                  <Space size={4} wrap style={{ width: '100%', justifyContent: 'flex-end', rowGap: 4 }}>
                    <Button size="small" onClick={() => setDetailItem(item)}>详情</Button>
                    <Button size="small" onClick={() => openReportModal(item)} disabled={!!item.reported_by_me}>{item.reported_by_me ? '已举报' : '举报'}</Button>
                    <Button size="small" type="primary" onClick={() => openPullModal(item)}>拉到本地</Button>
                  </Space>
                </Card>
              );
            })}
          </div>
        )}
      </Spin>

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Pagination current={pagination.current} pageSize={pagination.pageSize} total={pagination.total} showSizeChanger pageSizeOptions={[12, 24, 48, 96]} onChange={(p, s) => loadItems(p, s)} />
      </div>

      <Modal title="共享数字员工详情" open={!!detailItem} onCancel={() => setDetailItem(null)} footer={<Button onClick={() => setDetailItem(null)}>关闭</Button>} width={760} destroyOnClose mask={false}>
        {detailItem && <div>
          <Space align="start" style={{ marginBottom: 12 }}>
            {detailItem.avatar && <Image src={detailItem.avatar} width={120} height={180} style={{ objectFit: 'cover', borderRadius: 6 }} />}
            <div>
              <h3 style={{ marginTop: 0 }}>{detailItem.name}</h3>
              <Space wrap style={{ marginBottom: 8 }}>
                <Tag color="blue">{detailItem.source_site_name || '未知来源'}</Tag>
                {getHubCategoryName(detailItem) && <Tag>{getHubCategoryName(detailItem)}</Tag>}
                {detailItem.tool_approval && <Tag color="geekblue">{APPROVAL_LABEL[detailItem.tool_approval] || detailItem.tool_approval}</Tag>}
                {detailItem.enable_image_gen && <Tag color="purple">生图能力</Tag>}
              </Space>
              {detailItem.tags?.length ? <div><Space size={4} wrap>{detailItem.tags.map(t => <Tag key={t} color="cyan">{t}</Tag>)}</Space></div> : null}
            </div>
          </Space>
          {detailItem.description && <Card size="small" title="描述" style={{ marginBottom: 12 }}><div style={{ whiteSpace: 'pre-wrap' }}>{detailItem.description}</div></Card>}
          {detailItem.system_prompt && <Card size="small" title="系统提示词" style={{ marginBottom: 12 }}><div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{detailItem.system_prompt}</div></Card>}
          {!!detailItem.tool_skill_ids?.length && <Card size="small" title={`绑定小工具（${detailItem.tool_skill_ids.length}）`}><Space wrap>{detailItem.tool_skill_ids.map(id => <Tag key={id}>{toolName(id)}</Tag>)}</Space></Card>}
        </div>}
      </Modal>

      <Modal title={pullItem ? `拉取到本地：${pullItem.name}` : '拉取到本地'} open={!!pullItem} onCancel={() => setPullItem(null)} onOk={handlePullSubmit} okText="拉取" confirmLoading={pullSubmitting} destroyOnClose mask={false}>
        <Form form={pullForm} layout="vertical" preserve={false}>
          <Form.Item name="local_category_id" label="本地分类（可选）" extra="不选则拉取后归为「未分类」，可稍后在数字员工列表中修改"><Select allowClear placeholder="选择本地数字员工分类" options={localCategories.map(c => ({ label: c.name, value: c.id }))} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={reportItem ? `举报数字员工：${reportItem.name}` : '举报数字员工'} open={!!reportItem} onCancel={() => setReportItem(null)} onOk={handleReportSubmit} okText="提交举报" confirmLoading={reportSubmitting} destroyOnClose mask={false}>
        <Form form={reportForm} layout="vertical" preserve={false}>
          <Form.Item name="reason_code" label="举报理由" rules={[{ required: true }]}><Select options={REPORT_REASONS.map(r => ({ label: r.label, value: r.code }))} /></Form.Item>
          <Form.Item name="reason_note" label="补充说明"><Input.TextArea rows={3} maxLength={255} showCount /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`批量拉取 ${selectedIds.size} 个数字员工`} open={batchPullOpen} onCancel={() => setBatchPullOpen(false)} onOk={handleBatchPullSubmit} okText="开始拉取" confirmLoading={batchPullSubmitting} destroyOnClose mask={false}>
        <Form form={batchPullForm} layout="vertical" preserve={false}>
          <Form.Item name="local_category_id" label="本地分类（可选）" extra="不选则拉取后归为「未分类」"><Select allowClear placeholder="选择本地数字员工分类" options={localCategories.map(c => ({ label: c.name, value: c.id }))} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
