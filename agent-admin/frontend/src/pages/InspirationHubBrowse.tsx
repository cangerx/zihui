import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Checkbox, Empty, Form, Image, Input, message, Modal, Pagination,
  Radio, Select, Space, Spin, Tag, Tooltip,
} from 'antd';
import { ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { inspirationApi, inspirationHubApi } from '../services/api';

/**
 * 共享灵感库浏览页（管理员视角）。
 *
 * 功能：
 *  - 网格瀑布展示 hub 公开池（status=approved + is_visible=true）
 *  - 筛选：分类、搜索、排序
 *  - 卡片操作：详情查看、拉取到本地
 *  - 拉取到本地：选本地分类后提交；hub 端不变，本地新建一条 inspirations 记录
 *
 * 区别于桌面端「浏览自家灵感库」：这里是 hub 的统一公开池，跨所有云控端共享。
 */

interface HubInspiration {
  id: number;
  title: string;
  cover_image: string;
  ref_images?: string[];
  generation_size?: string | null;
  prompt_cn: string;
  prompt_en: string;
  source_site_name: string;
  hub_category_id: number;
  hub_category?: { id: number; name: string; slug?: string };
  // hub /list 公开池只暴露已 approved + visible 的灵感，approve/reject_count 对浏览者无意义，
  // 只保留社区健康度信号：被举报次数 + 下载热度，以及当前 client 是否已举报过
  report_count: number;
  download_count?: number;
  reported_by_me?: boolean;
  created_at: string;
}

// 举报理由（与 hub 后端 REASON_CODES 对齐）
const REPORT_REASONS: { code: string; label: string }[] = [
  { code: 'invalid_image',  label: '图片失效 / 无法加载' },
  { code: 'inappropriate', label: '内容不当 / 违规' },
  { code: 'duplicate',     label: '重复内容' },
  { code: 'copyright',     label: '侵犯版权' },
  { code: 'other',         label: '其他' },
];

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

export default function InspirationHubBrowse() {
  const [hubMe, setHubMe] = useState<HubMe | null>(null);
  const [hubMeLoading, setHubMeLoading] = useState(true);

  const [items, setItems] = useState<HubInspiration[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 24, total: 0 });

  const [hubCategories, setHubCategories] = useState<HubCategory[]>([]);
  const [localCategories, setLocalCategories] = useState<LocalCategory[]>([]);

  const [filterCategoryId, setFilterCategoryId] = useState<number | undefined>();
  const [searchText, setSearchText] = useState('');
  const [sort, setSort] = useState<'recent' | 'popular'>('recent');

  // 详情 Modal
  const [detailItem, setDetailItem] = useState<HubInspiration | null>(null);

  // 拉取 Modal
  const [pullItem, setPullItem] = useState<HubInspiration | null>(null);
  const [pullSubmitting, setPullSubmitting] = useState(false);
  const [pullForm] = Form.useForm<{ local_category_id: number }>();

  // 举报 Modal
  const [reportItem, setReportItem] = useState<HubInspiration | null>(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportForm] = Form.useForm<{ reason_code: string; reason_note?: string }>();

  // 多选 + 批量拉取
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchPullOpen, setBatchPullOpen] = useState(false);
  const [batchPullSubmitting, setBatchPullSubmitting] = useState(false);
  const [batchPullForm] = Form.useForm<{ local_category_id: number }>();

  // ===== Data loading =====

  const loadHubMe = useCallback(async () => {
    setHubMeLoading(true);
    try {
      const res = await inspirationHubApi.me();
      setHubMe(res.data);
    } catch (e: any) {
      // 503 = 未启用，依旧把结果存下来便于上方 Alert 显示原因
      setHubMe(e?.response?.data || { ready: false, reason: 'unknown' });
    } finally {
      setHubMeLoading(false);
    }
  }, []);

  const loadHubCategories = useCallback(async () => {
    try {
      const res = await inspirationHubApi.categories();
      const arr = Array.isArray(res.data) ? res.data : (res.data?.data || res.data?.items || []);
      setHubCategories(arr);
    } catch {/* hub 未配置时静默 */}
  }, []);

  const loadLocalCategories = useCallback(async () => {
    try {
      const res = await inspirationApi.listCategories();
      setLocalCategories(res.data.data || []);
    } catch {/* ignore */}
  }, []);

  const loadItems = useCallback(async (page = 1, pageSize = 24) => {
    if (!hubMe?.ready) return;
    setSelectedIds(new Set());
    setLoading(true);
    try {
      // exclude_self=1：让 hub 端过滤掉本站自己分享的（避免在浏览页又看到自己刚分享的）
      // exclude_pulled=1：让 agent-admin 代理层根据本地 from_hub_inspiration_id 过滤掉已拉过的
      //   两者均为「不显示」，避免管理员重复看到无意义的卡片
      const params: Record<string, any> = {
        page,
        page_size: pageSize,
        sort,
        exclude_self: 1,
        exclude_pulled: 1,
      };
      if (filterCategoryId) params.category_id = filterCategoryId;
      if (searchText) params.search = searchText;
      const res = await inspirationHubApi.list(params);
      setItems(res.data?.items || []);
      setPagination({
        current: page,
        pageSize,
        total: res.data?.total || 0,
      });
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载灵感共享市场失败');
    }
    setLoading(false);
  }, [hubMe?.ready, sort, filterCategoryId, searchText]);

  useEffect(() => {
    loadHubMe();
    loadLocalCategories();
  }, [loadHubMe, loadLocalCategories]);

  useEffect(() => {
    if (hubMe?.ready) {
      loadHubCategories();
      loadItems(1, pagination.pageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubMe?.ready]);

  // ===== Actions =====

  const openPullModal = (item: HubInspiration) => {
    setPullItem(item);
    pullForm.resetFields();
    // 预选：按 hub 分类名匹配同名本地分类
    if (item.hub_category?.name) {
      const matched = localCategories.find(c => c.name === item.hub_category!.name);
      if (matched) pullForm.setFieldValue('local_category_id', matched.id);
    }
  };

  const handlePullSubmit = async () => {
    if (!pullItem) return;
    const values = await pullForm.validateFields();
    setPullSubmitting(true);
    const targetId = pullItem.id;
    try {
      const res = await inspirationHubApi.adminPullToLocal(targetId, {
        local_category_id: values.local_category_id,
      });
      message.success(`已拉到本地（local_id=${res.data?.local_id}）`);
      setPullItem(null);
      // 后端代理层会按 from_hub_inspiration_id 过滤已拉呢，本地立即 setItems 隐藏这张卡，避免下次 reload 前的闪烁
      setItems(prev => prev.filter(it => it.id !== targetId));
    } catch (e: any) {
      const err = e?.response?.data?.error;
      const msg = e?.response?.data?.message;
      if (err === 'already_pulled') {
        message.warning('该灵感已被本站拉取过，请勿重复');
        // 已拉过但仍出现在列表里说明代理层过滤不生效（可能 reload 赶上之前），高阶出现；本地隐藏一下
        setItems(prev => prev.filter(it => it.id !== targetId));
      } else if (err === 'not_pullable') {
        message.warning(msg || '该灵感不可拉取（仅 approved + visible 可拉）');
      } else {
        message.error(msg || err || '拉取失败');
      }
    } finally {
      setPullSubmitting(false);
    }
  };

  // 打开举报 Modal
  const openReportModal = (item: HubInspiration) => {
    setReportItem(item);
    reportForm.resetFields();
    reportForm.setFieldValue('reason_code', 'inappropriate');
  };

  // 提交举报。提交后本地立即 patch reported_by_me=true + report_count+1，不重 load（避免闪烁）。
  // 后台该灯会在 report_count 达 report_threshold 后自动 is_visible=false，下次 reload 会从公开池消失。
  const handleReportSubmit = async () => {
    if (!reportItem) return;
    const values = await reportForm.validateFields();
    setReportSubmitting(true);
    const targetId = reportItem.id;
    try {
      await inspirationHubApi.report(targetId, {
        reason_code: values.reason_code,
        reason_note: values.reason_note,
      });
      message.success('已举报，谢谢反馈');
      setReportItem(null);
      setItems(prev => prev.map(it => it.id === targetId
        ? { ...it, reported_by_me: true, report_count: (it.report_count || 0) + 1 }
        : it));
    } catch (e: any) {
      const err = e?.response?.data?.error;
      if (err === 'already_reported') {
        message.warning('本站已举报过该灵感');
        setReportItem(null);
        setItems(prev => prev.map(it => it.id === targetId ? { ...it, reported_by_me: true } : it));
      } else {
        message.error(e?.response?.data?.message || err || '举报失败');
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  // ===== 多选操作 =====

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map(it => it.id)));
    }
  };

  const openBatchPullModal = () => {
    if (selectedIds.size === 0) { message.warning('请先勾选要拉取的灵感'); return; }
    batchPullForm.resetFields();
    setBatchPullOpen(true);
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
        await inspirationHubApi.adminPullToLocal(hubId, { local_category_id: values.local_category_id });
        successCount++;
        setItems(prev => prev.filter(it => it.id !== hubId));
      } catch (e: any) {
        const err = e?.response?.data?.error;
        if (err === 'already_pulled') { skipCount++; setItems(prev => prev.filter(it => it.id !== hubId)); }
        else failCount++;
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

  // ===== Render: 未就绪兜底 =====

  if (hubMeLoading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  }

  if (!hubMe?.ready) {
    // 共享库已并入云打包配置，endpoint/origin 由后端自动推导，普通管理员不必动手；
    // 大概率剩余的失败原因是：本站 Origin 未在 agent-build 后台授权，或上游暂时不可达。
    return (
      <Alert
        type="warning"
        showIcon
        message="灵感共享市场暂不可用"
        description={
          <div>
            <div style={{ marginBottom: 8 }}>
              {hubMe?.reason === 'endpoint_empty' && '云打包 base_url 未配置，请联系运维检查服务器 .env'}
              {hubMe?.reason === 'origin_empty' && '无法推导本站 Origin，请检查 APP_URL'}
              {hubMe?.reason === 'inspiration_hub_unreachable' && '无法连通 agent-build，请稍后重试'}
              {(!hubMe?.reason || !['endpoint_empty', 'origin_empty', 'inspiration_hub_unreachable'].includes(hubMe.reason))
                && '请确认本站 Origin 已在 agent-build 后台授权，或联系管理员'}
            </div>
            <Link to="/settings">前往「系统设置 · 灵感共享市场」查看状态 →</Link>
          </div>
        }
      />
    );
  }

  // ===== Render: 主视图 =====

  return (
    <div>
      {/* 顶部信息条 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap split={<span style={{ color: '#e0e0e0' }}>|</span>}>
          <span><b>本站点：</b>{hubMe?.me?.site_name || '—'}</span>
          <span><b>授权域名：</b><code style={{ fontSize: 12 }}>{hubMe?.me?.domain || '—'}</code></span>
          <span>
            <b>审核员：</b>
            {hubMe?.me?.is_reviewer
              ? <Tag color="green">是</Tag>
              : <Tag>否</Tag>}
            {hubMe?.me?.is_reviewer && (
              <Link to="/inspiration-hub/pending" style={{ marginLeft: 8 }}>去共享审核 →</Link>
            )}
          </span>
          {typeof hubMe?.me?.approve_threshold === 'number' && (
            <span style={{ color: '#888', fontSize: 12 }}>
              通过阈值 {hubMe.me.approve_threshold} · 拒绝阈值 {hubMe.me.reject_threshold} · 举报阈值 {hubMe.me.report_threshold}
            </span>
          )}
        </Space>
      </Card>

      {/* 筛选条 */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Select
          allowClear
          placeholder="按 Hub 分类筛选"
          style={{ width: 180 }}
          value={filterCategoryId}
          onChange={v => { setFilterCategoryId(v); loadItems(1, pagination.pageSize); }}
          options={hubCategories.map(c => ({ label: c.name, value: c.id }))}
        />
        <Input.Search
          placeholder="搜索标题/提示词"
          style={{ width: 260 }}
          onSearch={v => { setSearchText(v); loadItems(1, pagination.pageSize); }}
          enterButton={<SearchOutlined />}
          allowClear
        />
        <Select
          value={sort}
          onChange={v => { setSort(v); loadItems(1, pagination.pageSize); }}
          style={{ width: 140 }}
          options={[
            { value: 'recent', label: '最新发布' },
            { value: 'popular', label: '最多通过' },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={() => loadItems(pagination.current, pagination.pageSize)}>
          刷新
        </Button>
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>
          共 {pagination.total} 条
        </span>
      </div>

      {/* 批量操作条：仅在有勾选时出现 */}
      {items.length > 0 && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', background: '#fafafa',
          border: '1px solid #f0f0f0', borderRadius: 4,
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <Checkbox
            checked={items.length > 0 && selectedIds.size === items.length}
            indeterminate={selectedIds.size > 0 && selectedIds.size < items.length}
            onChange={toggleSelectAll}
          >
            全选当前页
          </Checkbox>
          <span style={{ color: '#888', fontSize: 12 }}>
            已选 <b style={{ color: '#1677ff' }}>{selectedIds.size}</b> / {items.length}
          </span>
          <Button
            type="primary"
            size="small"
            disabled={selectedIds.size === 0}
            onClick={openBatchPullModal}
          >
            批量拉到本地
          </Button>
          {selectedIds.size > 0 && (
            <Button size="small" onClick={() => setSelectedIds(new Set())}>清空选择</Button>
          )}
        </div>
      )}

      {/* 网格 */}
      <Spin spinning={loading}>
        {items.length === 0 && !loading ? (
          <Empty description="灵感共享市场暂无内容" style={{ padding: 40 }} />
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 12,
          }}>
            {items.map(item => {
              const checked = selectedIds.has(item.id);
              return (
              <Card
                key={item.id}
                size="small"
                hoverable
                style={checked ? { borderColor: '#1677ff', boxShadow: '0 0 0 1px #1677ff' } : undefined}
                cover={item.cover_image ? (
                  <div style={{ height: 160, overflow: 'hidden', background: '#f5f5f5', position: 'relative' }}>
                    <img
                      src={item.cover_image}
                      alt={item.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    {/* 浮层只负责定位和背景，点击逻辑全部交给内部 Checkbox 的 onChange，
                        避免 div onClick + Checkbox onChange 双触发导致 toggle 两次抵消（看似点击无效） */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute', top: 8, left: 8,
                        background: 'rgba(255,255,255,0.92)', borderRadius: 4,
                        padding: '2px 6px', lineHeight: 1,
                      }}
                    >
                      <Checkbox checked={checked} onChange={() => toggleSelect(item.id)} />
                    </div>
                  </div>
                ) : (
                  <div style={{ height: 160, background: '#fafafa', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', color: '#ccc', position: 'relative' }}>
                    无封面
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{ position: 'absolute', top: 8, left: 8, lineHeight: 1 }}
                    >
                      <Checkbox checked={checked} onChange={() => toggleSelect(item.id)} />
                    </div>
                  </div>
                )}
                bodyStyle={{ padding: 12 }}
              >
                <Tooltip title={item.title}>
                  <div style={{ fontWeight: 500, marginBottom: 4, overflow: 'hidden',
                    textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.title}
                  </div>
                </Tooltip>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                  来自 <Tag color="blue" style={{ marginInlineEnd: 0 }}>{item.source_site_name || '未知'}</Tag>
                </div>
                <Space size={4} wrap style={{ marginBottom: 8 }}>
                  {item.ref_images?.length ? <Tag color="cyan">参考图 {item.ref_images.length} 张</Tag> : null}
                  {item.generation_size ? <Tag>尺寸 {item.generation_size}</Tag> : null}
                </Space>
                {/* 公开池卡片只显示社区信号：下载热度 + 被举报次数 + 已举报 tag。
                    approve/reject_count 在 hub /list 接口不返回，不适用于已公开的灵感。 */}
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>热度 {item.download_count ?? 0}</span>
                  <span>·</span>
                  <span style={{ color: item.report_count > 0 ? '#fa8c16' : '#aaa' }}>举报 {item.report_count}</span>
                  {item.reported_by_me && <Tag color="orange" style={{ marginLeft: 'auto' }}>已举报</Tag>}
                </div>
                <Space size={4} wrap style={{ width: '100%', justifyContent: 'flex-end', rowGap: 4 }}>
                  <Button size="small" onClick={() => setDetailItem(item)}>详情</Button>
                  <Tooltip title={item.reported_by_me ? '本站已举报过，不可重复' : '举报这条灵感'}>
                    <Button
                      size="small"
                      onClick={() => openReportModal(item)}
                      disabled={!!item.reported_by_me}
                    >
                      {item.reported_by_me ? '已举报' : '举报'}
                    </Button>
                  </Tooltip>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => openPullModal(item)}
                  >
                    拉到本地
                  </Button>
                </Space>
              </Card>
              );
            })}
          </div>
        )}
      </Spin>

      {/* 分页 */}
      {pagination.total > 0 && (
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Pagination
            current={pagination.current}
            pageSize={pagination.pageSize}
            total={pagination.total}
            showSizeChanger
            pageSizeOptions={[12, 24, 48, 96]}
            onChange={(page, size) => loadItems(page, size)}
          />
        </div>
      )}

      {/* 详情 Modal */}
      <Modal
        title="共享灵感详情"
        open={!!detailItem}
        onCancel={() => setDetailItem(null)}
        footer={<Button onClick={() => setDetailItem(null)}>关闭</Button>}
        width={680}
        destroyOnClose
        maskStyle={{ display: 'none' }}
      >
        {detailItem && (
          <div>
            {detailItem.cover_image && (
              <Image
                src={detailItem.cover_image}
                style={{ maxHeight: 320, marginBottom: 16, borderRadius: 4 }}
              />
            )}
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{detailItem.title}</div>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">{detailItem.source_site_name || '未知来源'}</Tag>
              {detailItem.hub_category?.name && <Tag>{detailItem.hub_category.name}</Tag>}
              {detailItem.generation_size && <Tag>尺寸 {detailItem.generation_size}</Tag>}
              <span style={{ fontSize: 12, color: '#888' }}>
                热度 {detailItem.download_count ?? 0}
                {' · '}
                <span style={{ color: detailItem.report_count > 0 ? '#fa8c16' : 'inherit' }}>举报 {detailItem.report_count}</span>
              </span>
              {detailItem.reported_by_me && <Tag color="orange">已举报</Tag>}
              <span style={{ fontSize: 12, color: '#aaa' }}>{detailItem.created_at}</span>
            </Space>
            {!!detailItem.ref_images?.length && (
              <Card size="small" title={`参考图（${detailItem.ref_images.length}）`} style={{ marginBottom: 12 }}>
                <Image.PreviewGroup>
                  <Space size={8} wrap>
                    {detailItem.ref_images.map((url, index) => (
                      <Image key={`${url}-${index}`} src={url} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </Card>
            )}
            {detailItem.prompt_cn && (
              <Card size="small" title="中文提示词" style={{ marginBottom: 12 }}>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{detailItem.prompt_cn}</div>
              </Card>
            )}
            {detailItem.prompt_en && (
              <Card size="small" title="英文提示词" style={{ marginBottom: 12 }}>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{detailItem.prompt_en}</div>
              </Card>
            )}
          </div>
        )}
      </Modal>

      {/* 举报 Modal：5 个 reason_code 以 Radio 呈现（选项少不需 Select），reason_note 选填（据 hub 后端：max 255）。
          提交后后台 UNIQUE 兼底防刷量；同一 client 对同一灵感举报过会 409 already_reported，前端走 patch 分支 */}
      <Modal
        title="举报共享灵感"
        open={!!reportItem}
        onOk={handleReportSubmit}
        onCancel={() => setReportItem(null)}
        confirmLoading={reportSubmitting}
        okText="提交举报"
        okButtonProps={{ danger: true }}
        width={520}
        destroyOnClose
        maskStyle={{ display: 'none' }}
      >
        {reportItem && (
          <>
            <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
              <Space>
                {reportItem.cover_image && (
                  <Image src={reportItem.cover_image} width={56} height={56}
                    style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
                )}
                <div>
                  <div style={{ fontWeight: 500 }}>{reportItem.title}</div>
                  <div style={{ color: '#888', fontSize: 12 }}>
                    来自 {reportItem.source_site_name}
                  </div>
                </div>
              </Space>
            </Card>
            <Form form={reportForm} layout="vertical">
              <Form.Item
                name="reason_code"
                label="举报理由"
                rules={[{ required: true, message: '请选择举报理由' }]}
                initialValue="inappropriate"
              >
                <Radio.Group>
                  <Space direction="vertical">
                    {REPORT_REASONS.map(r => (
                      <Radio key={r.code} value={r.code}>{r.label}</Radio>
                    ))}
                  </Space>
                </Radio.Group>
              </Form.Item>
              <Form.Item
                name="reason_note"
                label="补充说明"
                extra="可选，最多 255 字；举报会传到 hub 后台，达阈后灵感会被自动下架"
                rules={[{ max: 255, message: '最多 255 字' }]}
              >
                <Input.TextArea rows={3} maxLength={255} showCount
                  placeholder="如：图片包含不宜内容 / 与 XX 站点同名重复" />
              </Form.Item>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.7 }}>
                <div>· 同一站点对同一灵感只能举报一次，提交后不可撤销</div>
                <div>· 被举报达到阈值后灵感自动下架，hub 管理员可人工复审</div>
              </div>
            </Form>
          </>
        )}
      </Modal>

      {/* 拉取 Modal */}
      <Modal
        title="拉取到本地灵感库"
        open={!!pullItem}
        onOk={handlePullSubmit}
        onCancel={() => setPullItem(null)}
        confirmLoading={pullSubmitting}
        width={520}
        destroyOnClose
        maskStyle={{ display: 'none' }}
      >
        {pullItem && (
          <>
            <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
              <Space>
                {pullItem.cover_image && (
                  <Image src={pullItem.cover_image} width={56} height={56}
                    style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
                )}
                <div>
                  <div style={{ fontWeight: 500 }}>{pullItem.title}</div>
                  <div style={{ color: '#888', fontSize: 12 }}>
                    Hub 分类：{pullItem.hub_category?.name || '—'} · 来自 {pullItem.source_site_name}
                  </div>
                  <Space size={4} wrap style={{ marginTop: 4 }}>
                    {pullItem.ref_images?.length ? <Tag color="cyan">参考图 {pullItem.ref_images.length} 张</Tag> : null}
                    {pullItem.generation_size ? <Tag>尺寸 {pullItem.generation_size}</Tag> : null}
                  </Space>
                </div>
              </Space>
            </Card>
            <Form form={pullForm} layout="vertical">
              <Form.Item
                name="local_category_id"
                label="存放到本地分类"
                rules={[{ required: true, message: '请选择本地分类' }]}
                extra="拉取后会在本地 inspirations 表新建一条 status=approved + 可见的记录"
              >
                <Select
                  placeholder="选择本地分类"
                  showSearch
                  optionFilterProp="label"
                  options={localCategories.map(c => ({ label: c.name, value: c.id }))}
                  notFoundContent="本地暂无分类，请先到「灵感数据」页面新建"
                />
              </Form.Item>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.7 }}>
                <div>· 封面图片和参考图会尝试复制到本站存储，失败时保留原 URL</div>
                <div>· 拉取的灵感会标记「来自 Hub」，不可再次分享回 hub（避免内容回环）</div>
                <div>· 同一条 Hub 灵感本站只能拉取一次（按 hub_id 去重）</div>
              </div>
            </Form>
          </>
        )}
      </Modal>

      {/* 批量拉取 Modal */}
      <Modal
        title={`批量拉到本地灵感库（${selectedIds.size} 条）`}
        open={batchPullOpen}
        onOk={handleBatchPullSubmit}
        onCancel={() => setBatchPullOpen(false)}
        confirmLoading={batchPullSubmitting}
        okText="开始批量拉取"
        width={520}
        destroyOnClose
        maskStyle={{ display: 'none' }}
      >
        <Form form={batchPullForm} layout="vertical">
          <Form.Item
            name="local_category_id"
            label="统一存放到本地分类"
            rules={[{ required: true, message: '请选择本地分类' }]}
            extra="所有勾选的灵感会拉到该分类下；后续可在「灵感数据」页面单独调整"
          >
            <Select
              placeholder="选择本地分类"
              showSearch
              optionFilterProp="label"
              options={localCategories.map(c => ({ label: c.name, value: c.id }))}
              notFoundContent="本地暂无分类，请先到「灵感数据」页面新建"
            />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 12, lineHeight: 1.7 }}>
            <div>· 已拉过的灵感会自动跳过，不会重复创建</div>
            <div>· 单条失败不会中断整批，结束后汇总成功/跳过/失败数量</div>
            <div>· 批量拉取依次调用单条接口，请耐心等待，期间请勿关闭弹窗</div>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
