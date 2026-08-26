import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Button, Card, Form, Image, Input, message, Modal, Popconfirm,
  Space, Spin, Table, Tag, Tooltip,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, EyeOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { inspirationHubApi } from '../services/api';

/**
 * 共享灵感库 · 待审池（审核员视角）。
 *
 * 仅当本站点是 hub 审核员（VerifyDomainBinding 校验 is_reviewer=true）时可投票。
 *  - GET /admin/inspiration-hub/pending-list 拉待审灵感
 *  - POST /admin/inspiration-hub/{hubId}/review 投票（action=approve|reject）
 *
 * 票数达 hub 阈值后由 hub 端自动 promote 到 approved；这里只是投自己一票。
 */

interface PendingItem {
  id: number;
  title: string;
  cover_image: string;
  ref_images?: string[];
  generation_size?: string | null;
  prompt_cn: string;
  prompt_en: string;
  source_site_name: string;
  hub_category_id: number;
  hub_category?: { id: number; name: string };
  approve_count: number;
  reject_count: number;
  report_count: number;
  // 后端 Hub/InspirationHubController::pendingList 实际返回此字段名，统一沿用避免再回传一次别名
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

export default function InspirationHubPending() {
  const [hubMe, setHubMe] = useState<HubMe | null>(null);
  const [hubMeLoading, setHubMeLoading] = useState(true);

  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });

  // 详情 Modal
  const [detailItem, setDetailItem] = useState<PendingItem | null>(null);

  // 拒绝 Modal（带理由输入）
  const [rejectItem, setRejectItem] = useState<PendingItem | null>(null);
  const [rejectSubmitting, setRejectSubmitting] = useState(false);
  const [rejectForm] = Form.useForm<{ reason: string }>();

  // 投票 loading 状态：按行 ID 标记，避免按下「通过」时整页都 loading
  const [votingIds, setVotingIds] = useState<Set<number>>(new Set());

  // 多选 + 批量操作
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [batchRejectOpen, setBatchRejectOpen] = useState(false);
  const [batchRejectForm] = Form.useForm<{ reason: string }>();

  const loadHubMe = useCallback(async () => {
    setHubMeLoading(true);
    try {
      const res = await inspirationHubApi.me();
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
      const res = await inspirationHubApi.adminPendingList({ page, page_size: pageSize });
      setItems(res.data?.items || []);
      setPagination({ current: page, pageSize, total: res.data?.total || 0 });
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载共享审核失败');
    }
    setLoading(false);
  }, [hubMe?.ready, hubMe?.me?.is_reviewer]);

  useEffect(() => { loadHubMe(); }, [loadHubMe]);
  useEffect(() => {
    if (hubMe?.ready && hubMe?.me?.is_reviewer) {
      loadItems(1, pagination.pageSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubMe?.ready, hubMe?.me?.is_reviewer]);

  // ===== Actions =====

  // 投票成功后立即把本行 my_review_action / approve_count 写回本地 state，按钮在网络回来那一帧就 disabled。
  // 之后再触发 reload 拿新数据（如：其他审核员同步投票后导致状态结算）。
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

  const handleApprove = async (item: PendingItem) => {
    setVotingIds(prev => new Set(prev).add(item.id));
    try {
      await inspirationHubApi.adminReview(item.id, { action: 'approve' });
      message.success('已投通过票');
      patchVoted(item.id, 'approve');
      // 重 load 一次：可能已达 approve 阈值被结算移出 pending 池，列表会刷掉这条
      loadItems(pagination.current, pagination.pageSize);
    } catch (e: any) {
      const err = e?.response?.data?.error;
      if (err === 'already_voted') {
        message.warning('本站已对该灵感投过票');
        // 后端报 already_voted 说明 row 在 hub 上已有投票记录但本地 my_review_action 为 null；
        // 本地按 approve 兜底标记，同步 reload 后由后端真值修正（reject 可能性极小，已投票的人自己复投而已）
        patchVoted(item.id, 'approve');
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

  const openRejectModal = (item: PendingItem) => {
    setRejectItem(item);
    rejectForm.resetFields();
  };

  const handleRejectSubmit = async () => {
    if (!rejectItem) return;
    const values = await rejectForm.validateFields();
    setRejectSubmitting(true);
    const targetId = rejectItem.id;
    try {
      await inspirationHubApi.adminReview(targetId, {
        action: 'reject',
        reason: values.reason,
      });
      message.success('已投拒绝票');
      setRejectItem(null);
      patchVoted(targetId, 'reject');
      loadItems(pagination.current, pagination.pageSize);
    } catch (e: any) {
      const err = e?.response?.data?.error;
      if (err === 'already_voted') {
        message.warning('本站已对该灵感投过票');
        setRejectItem(null);
        loadItems(pagination.current, pagination.pageSize);
      } else {
        message.error(e?.response?.data?.message || err || '投票失败');
      }
    } finally {
      setRejectSubmitting(false);
    }
  };

  // ===== 批量操作 =====
  // 待审池里只对「我未投过票」的行有意义；批量执行时跳过已投行，结束时汇总成功/跳过/失败。

  const handleBatchApprove = async () => {
    const targets = items.filter(it => selectedIds.includes(it.id) && !it.my_review_action);
    if (targets.length === 0) { message.warning('所选灵感均已投过票'); return; }
    setBatchSubmitting(true);
    let okCount = 0, skipCount = 0, failCount = 0;
    for (const it of targets) {
      try {
        await inspirationHubApi.adminReview(it.id, { action: 'approve' });
        okCount++;
        patchVoted(it.id, 'approve');
      } catch (e: any) {
        const err = e?.response?.data?.error;
        if (err === 'already_voted') { skipCount++; patchVoted(it.id, 'approve'); }
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
    if (targets.length === 0) { message.warning('所选灵感均已投过票'); return; }
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
        await inspirationHubApi.adminReview(it.id, { action: 'reject', reason: values.reason });
        okCount++;
        patchVoted(it.id, 'reject');
      } catch (e: any) {
        const err = e?.response?.data?.error;
        if (err === 'already_voted') { skipCount++; patchVoted(it.id, 'reject'); }
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

  // ===== Render: 未就绪 / 非审核员兜底 =====

  if (hubMeLoading) {
    return <div style={{ padding: 40, textAlign: 'center' }}><Spin /></div>;
  }

  if (!hubMe?.ready) {
    return (
      <Alert
        type="warning"
        showIcon
        message="灵感共享市场未配置"
        description={
          <div>
            <div style={{ marginBottom: 8 }}>请先在系统设置中开启并配置灵感共享市场。</div>
            <Link to="/settings">前往「系统设置 · 灵感共享市场」配置 →</Link>
          </div>
        }
      />
    );
  }

  if (!hubMe?.me?.is_reviewer) {
    return (
      <Alert
        type="info"
        showIcon
        message="本站点非审核员"
        description={
          <div>
            <div style={{ marginBottom: 8 }}>
              当前站点（{hubMe?.me?.site_name || hubMe?.me?.domain || '—'}）未被 hub 平台指派为审核员，
              无法查看共享审核或投票。如需成为审核员，请联系共享市场管理员。
            </div>
            <Link to="/inspiration-hub/browse">去浏览灵感共享市场 →</Link>
          </div>
        }
      />
    );
  }

  // ===== Render: 主视图 =====

  const columns = [
    {
      title: '封面',
      dataIndex: 'cover_image',
      width: 80,
      render: (url: string) => url
        ? <Image src={url} width={50} height={50} style={{ objectFit: 'cover', borderRadius: 4 }} />
        : '-',
    },
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string, r: PendingItem) => (
        <div>
          <div style={{ fontWeight: 500 }}>{v}</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
            来自 <Tag color="blue" style={{ marginInlineEnd: 0 }}>{r.source_site_name || '未知'}</Tag>
            {r.hub_category?.name && <Tag style={{ marginInlineStart: 4 }}>{r.hub_category.name}</Tag>}
            {r.ref_images?.length ? <Tag color="cyan" style={{ marginInlineStart: 4 }}>参考图 {r.ref_images.length} 张</Tag> : null}
            {r.generation_size ? <Tag style={{ marginInlineStart: 4 }}>尺寸 {r.generation_size}</Tag> : null}
          </div>
        </div>
      ),
    },
    {
      title: '票数',
      width: 200,
      render: (_: any, r: PendingItem) => (
        <Space size={4} wrap>
          <Tooltip title={`通过阈值：${hubMe?.me?.approve_threshold ?? '—'}`}>
            <Tag color={r.approve_count >= (hubMe?.me?.approve_threshold ?? 999) ? 'green' : 'default'}>
              通过 {r.approve_count}
            </Tag>
          </Tooltip>
          <Tooltip title={`拒绝阈值：${hubMe?.me?.reject_threshold ?? '—'}`}>
            <Tag color={r.reject_count >= (hubMe?.me?.reject_threshold ?? 999) ? 'red' : 'default'}>
              拒绝 {r.reject_count}
            </Tag>
          </Tooltip>
          {r.report_count > 0 && <Tag color="volcano">举报 {r.report_count}</Tag>}
        </Space>
      ),
    },
    {
      title: '我已投',
      dataIndex: 'my_review_action',
      width: 90,
      render: (v: 'approve' | 'reject' | null | undefined) => {
        if (v === 'approve') return <Tag color="green">已通过</Tag>;
        if (v === 'reject') return <Tag color="red">已拒绝</Tag>;
        return <span style={{ color: '#bbb', fontSize: 12 }}>未投</span>;
      },
    },
    {
      title: '提交时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => <span style={{ color: '#888', fontSize: 12 }}>{v}</span>,
    },
    {
      title: '操作',
      width: 240,
      fixed: 'right' as const,
      render: (_: any, record: PendingItem) => {
        const myAction = record.my_review_action;
        const voted = !!myAction;
        const voting = votingIds.has(record.id);
        return (
          <Space size="small" wrap>
            <Button size="small" icon={<EyeOutlined />} onClick={() => setDetailItem(record)}>详情</Button>
            {/* 已投通过：按钮变 ghost + 禁用 + 文案改为「已通过」；已投拒绝：通过按钮 disable */}
            <Popconfirm
              title="投通过票？"
              description={`本站将作为审核员投通过票。达到 ${hubMe?.me?.approve_threshold ?? '?'} 票后 Hub 自动 promote 到公开池。`}
              onConfirm={() => handleApprove(record)}
              okText="通过"
              disabled={voted}
            >
              <Button
                size="small"
                type={myAction === 'approve' ? 'default' : 'primary'}
                icon={<CheckOutlined />}
                disabled={voted}
                loading={voting && !rejectItem}
              >
                {myAction === 'approve' ? '已通过' : '通过'}
              </Button>
            </Popconfirm>
            <Button
              size="small"
              danger={myAction !== 'reject'}
              icon={<CloseOutlined />}
              disabled={voted}
              onClick={() => openRejectModal(record)}
            >
              {myAction === 'reject' ? '已拒绝' : '拒绝'}
            </Button>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      {/* 顶部信息条 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap split={<span style={{ color: '#e0e0e0' }}>|</span>}>
          <span><b>本站点：</b>{hubMe?.me?.site_name || '—'}</span>
          <Tag color="green">已是审核员</Tag>
          {typeof hubMe?.me?.approve_threshold === 'number' && (
            <span style={{ color: '#888', fontSize: 12 }}>
              通过阈值 {hubMe.me.approve_threshold} · 拒绝阈值 {hubMe.me.reject_threshold}
            </span>
          )}
          <Link to="/inspiration-hub/browse">去共享市场 →</Link>
        </Space>
      </Card>

      <Alert
        type="info"
        showIcon
        message="审核员说明"
        description="本站作为灵感共享市场的审核员，对待审灵感投一票。一个站点对每条灵感只能投一次，投后不可改。达到共享市场阈值后自动公开或拒绝。"
        style={{ marginBottom: 12 }}
      />

      <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button icon={<ReloadOutlined />} onClick={() => loadItems(pagination.current, pagination.pageSize)}>
          刷新
        </Button>
        <Popconfirm
          title={`批量投通过票（${selectedIds.length} 条）`}
          description="将对所选灵感统一投通过票；已投过票的会自动跳过。"
          onConfirm={handleBatchApprove}
          okText="确认通过"
          disabled={selectedIds.length === 0 || batchSubmitting}
        >
          <Button
            type="primary"
            disabled={selectedIds.length === 0}
            loading={batchSubmitting && !batchRejectOpen}
          >
            批量通过
          </Button>
        </Popconfirm>
        <Button
          danger
          disabled={selectedIds.length === 0}
          onClick={openBatchRejectModal}
        >
          批量拒绝
        </Button>
        {selectedIds.length > 0 && (
          <>
            <span style={{ color: '#888', fontSize: 12 }}>
              已选 <b style={{ color: '#1677ff' }}>{selectedIds.length}</b> 条
            </span>
            <Button size="small" onClick={() => setSelectedIds([])}>清空选择</Button>
          </>
        )}
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>
          共 {pagination.total} 条待审
        </span>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={loading}
        size="small"
        scroll={{ x: 1000 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as number[]),
          // 仅未投票的行可选；已投过的禁用勾选框，避免误操作
          getCheckboxProps: (record) => ({ disabled: !!record.my_review_action }),
        }}
        pagination={{
          ...pagination,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          onChange: (page, size) => loadItems(page, size),
        }}
      />

      {/* 详情 Modal */}
      <Modal
        title="待审灵感详情"
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
              <Image src={detailItem.cover_image}
                style={{ maxHeight: 320, marginBottom: 16, borderRadius: 4 }} />
            )}
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{detailItem.title}</div>
            <Space wrap style={{ marginBottom: 12 }}>
              <Tag color="blue">{detailItem.source_site_name || '未知来源'}</Tag>
              {detailItem.hub_category?.name && <Tag>{detailItem.hub_category.name}</Tag>}
              {detailItem.generation_size && <Tag>尺寸 {detailItem.generation_size}</Tag>}
              <span style={{ fontSize: 12, color: '#888' }}>
                通过 {detailItem.approve_count} · 拒绝 {detailItem.reject_count} · 举报 {detailItem.report_count}
              </span>
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

      {/* 拒绝 Modal */}
      <Modal
        title="投拒绝票"
        open={!!rejectItem}
        onOk={handleRejectSubmit}
        onCancel={() => setRejectItem(null)}
        confirmLoading={rejectSubmitting}
        okText="确认拒绝"
        okButtonProps={{ danger: true }}
        width={520}
        destroyOnClose
        maskStyle={{ display: 'none' }}
      >
        {rejectItem && (
          <>
            <Card size="small" style={{ marginBottom: 12, background: '#fafafa' }}>
              <Space>
                {rejectItem.cover_image && (
                  <Image src={rejectItem.cover_image} width={48} height={48}
                    style={{ objectFit: 'cover', borderRadius: 4 }} preview={false} />
                )}
                <div>
                  <div style={{ fontWeight: 500 }}>{rejectItem.title}</div>
                  <div style={{ color: '#888', fontSize: 12 }}>
                    来自 {rejectItem.source_site_name}
                  </div>
                </div>
              </Space>
            </Card>
            <Form form={rejectForm} layout="vertical">
              <Form.Item
                name="reason"
                label="拒绝理由"
                extra="可选，但建议填写。理由会被记录到 hub 端，达到拒绝阈值时显示给原作者"
                rules={[{ max: 255, message: '最多 255 字' }]}
              >
                <Input.TextArea rows={3} maxLength={255} showCount
                  placeholder="如：低质量 / 重复内容 / 违反平台规范..." />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      {/* 批量拒绝 Modal：所选若干条共用同一拒绝理由 */}
      <Modal
        title={`批量投拒绝票（${selectedIds.length} 条）`}
        open={batchRejectOpen}
        onOk={handleBatchRejectSubmit}
        onCancel={() => setBatchRejectOpen(false)}
        confirmLoading={batchSubmitting}
        okText="确认批量拒绝"
        okButtonProps={{ danger: true }}
        width={520}
        destroyOnClose
        maskStyle={{ display: 'none' }}
      >
        <Form form={batchRejectForm} layout="vertical">
          <Form.Item
            name="reason"
            label="统一拒绝理由"
            extra="所有勾选的灵感都会用同一条理由提交；已投过票的会自动跳过"
            rules={[{ max: 255, message: '最多 255 字' }]}
          >
            <Input.TextArea rows={3} maxLength={255} showCount
              placeholder="如：低质量 / 重复内容 / 违反平台规范..." />
          </Form.Item>
          <div style={{ color: '#888', fontSize: 12, lineHeight: 1.7 }}>
            <div>· 单条失败不会中断整批，结束后汇总成功/跳过/失败数量</div>
            <div>· 批量拒绝依次调用单条接口，请耐心等待，期间请勿关闭弹窗</div>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
