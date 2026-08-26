import { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Space, Input, Select, Modal, Form, Switch, message, Tag,
  Tooltip, Popconfirm, Upload, Progress, Alert,
} from 'antd';
import type { TableProps } from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, EyeInvisibleOutlined,
  EyeOutlined, ImportOutlined, SearchOutlined, ThunderboltOutlined, DownloadOutlined,
} from '@ant-design/icons';
import { docApi } from '../services/api';
import DocRichEditor from '../components/DocRichEditor';

/** axios blob 响应触发浏览器下载（含从 Content-Disposition 解析 filename）。 */
function downloadBlobResponse(res: { data: Blob; headers: Record<string, string> }, fallbackName: string) {
  const cd = res.headers['content-disposition'] || res.headers['Content-Disposition'] || '';
  let filename = fallbackName;
  // RFC 5987: filename*=UTF-8''xxx  优先；其次 plain filename="xxx"
  const star = cd.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  const plain = cd.match(/filename\s*=\s*"?([^";]+)"?/i);
  if (star && star[1]) {
    try { filename = decodeURIComponent(star[1]); } catch { /* keep */ }
  } else if (plain && plain[1]) {
    filename = plain[1];
  }
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 文档管理页：列表 + 批量操作 + 编辑弹窗（含富文本编辑器）+ 导入 .md/.docx
 *
 * 设计取舍：
 * - 列表只拉元信息（不含 content_html），编辑时再单独 GET /admin/docs/{id} 拿全量
 * - 编辑/新增统一用一个 Modal，size=large；富文本编辑器内嵌在 Modal 里
 *   关闭 Modal 时确认未保存内容（dirty 检测：表单或 contentHtml 与初始值不同）
 * - 「保存」分两种语义：仅保存 / 保存并重建索引（后者调 update + reindex）
 * - reindex 按钮放在行操作，对单文档生效；全量重建在「文档设置」页
 */

type DocItem = {
  id: number;
  title: string;
  subtitle?: string;
  slug?: string;
  category_id?: number | null;
  category?: { id: number; name: string; slug?: string } | null;
  sort_order: number;
  is_visible: boolean;
  view_count: number;
  import_source?: string;
  chunks_count: number;
  indexed_chunk_count: number;
  created_at: string;
  updated_at: string;
};

type Category = { id: number; name: string; slug: string };

export default function Docs() {
  const [items, setItems] = useState<DocItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [loading, setLoading] = useState(false);

  const [categories, setCategories] = useState<Category[]>([]);
  const [filters, setFilters] = useState({ keyword: '', categoryId: undefined as number | undefined, isVisible: undefined as boolean | undefined });
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // 编辑/新增弹窗
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<DocItem | null>(null);
  const [contentHtml, setContentHtml] = useState('');
  const [saving, setSaving] = useState(false);
  const [reindexAfterSave, setReindexAfterSave] = useState(true);
  const [form] = Form.useForm();

  // 导入弹窗（支持多文件）
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importCategory, setImportCategory] = useState<number | undefined>();
  // 导入结果明细：成功/失败按文件展示；为 null 时表示「未提交」状态显示拖拽区
  type ImportResult = { filename: string; status: 'ok' | 'failed'; doc_id?: number; title?: string; error?: string };
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);

  // 导出 loading（单条 id Set + 批量 bool）
  const [exportingIds, setExportingIds] = useState<Set<number>>(new Set());
  const [batchExporting, setBatchExporting] = useState(false);

  // 单行重建索引 loading（id → bool）
  const [reindexingIds, setReindexingIds] = useState<Set<number>>(new Set());

  useEffect(() => { void loadCategories(); }, []);
  useEffect(() => { void loadList(); }, [page, perPage, filters.categoryId, filters.isVisible]);

  const loadList = async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, per_page: perPage };
      if (filters.keyword) params.keyword = filters.keyword;
      if (filters.categoryId !== undefined) params.category_id = filters.categoryId;
      if (filters.isVisible !== undefined) params.is_visible = filters.isVisible;
      const res = await docApi.list(params);
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载文档列表失败');
    } finally {
      setLoading(false);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await docApi.listCategories();
      // 后端返回 { data: [...] } 包装，需解包
      const list = Array.isArray(res.data) ? res.data : (res.data?.data || []);
      setCategories(list);
    } catch {
      // 静默；分类未配置不影响列表
    }
  };

  // 打开新增 modal
  const handleAdd = () => {
    setEditing(null);
    setContentHtml('');
    form.resetFields();
    form.setFieldsValue({ is_visible: true, sort_order: 0 });
    setEditorOpen(true);
  };

  // 打开编辑 modal：单独拉一次 detail 拿 content_html
  const handleEdit = async (id: number) => {
    try {
      const res = await docApi.get(id);
      const doc = res.data;
      setEditing(doc);
      setContentHtml(doc.content_html || '');
      form.setFieldsValue({
        title:      doc.title,
        subtitle:   doc.subtitle || '',
        slug:       doc.slug || '',
        category_id: doc.category_id || null,
        sort_order: doc.sort_order || 0,
        is_visible: !!doc.is_visible,
      });
      setEditorOpen(true);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '加载文档失败');
    }
  };

  const handleSave = async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!contentHtml || contentHtml === '<br>') {
      message.warning('文档内容不能为空');
      return;
    }

    setSaving(true);
    try {
      let docId: number;
      if (editing) {
        const res = await docApi.update(editing.id, { ...values, content_html: contentHtml });
        docId = res.data.id;
        message.success('文档已更新');
      } else {
        const res = await docApi.create({ ...values, content_html: contentHtml });
        docId = res.data.id;
        message.success('文档已创建');
      }
      setEditorOpen(false);
      await loadList();

      if (reindexAfterSave) {
        // 异步触发重建索引，不阻塞 modal 关闭
        void reindexOne(docId, true);
      }
    } catch (e: any) {
      const details = e?.response?.data?.details;
      if (details) {
        const firstError = Object.values(details)[0] as string[];
        message.error(firstError?.[0] || '保存失败');
      } else {
        message.error(e?.response?.data?.message || '保存失败');
      }
    } finally {
      setSaving(false);
    }
  };

  const reindexOne = async (id: number, silent = false) => {
    setReindexingIds((prev) => new Set(prev).add(id));
    try {
      const res = await docApi.reindexOne(id);
      if (!silent) message.success(`重建完成：${res.data.chunks} chunks / ${res.data.indexed} 已索引`);
      await loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '重建索引失败');
    } finally {
      setReindexingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await docApi.delete(id);
      message.success('已删除');
      await loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedIds.length === 0) return;
    Modal.confirm({
      title: `确定删除 ${selectedIds.length} 篇文档？`,
      content: '关联的切片 / 向量索引会一并清理，操作不可恢复',
      okType: 'danger',
      onOk: async () => {
        try {
          await docApi.batchDelete(selectedIds);
          message.success(`已删除 ${selectedIds.length} 篇`);
          setSelectedIds([]);
          await loadList();
        } catch (e: any) {
          message.error(e?.response?.data?.message || '批量删除失败');
        }
      },
    });
  };

  const handleBatchVisibility = async (isVisible: boolean) => {
    if (selectedIds.length === 0) return;
    try {
      await docApi.batchSetVisibility(selectedIds, isVisible);
      message.success(`已${isVisible ? '显示' : '隐藏'} ${selectedIds.length} 篇`);
      setSelectedIds([]);
      await loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '批量更新失败');
    }
  };

  const handleToggleVisibility = async (item: DocItem) => {
    try {
      await docApi.setVisibility(item.id, !item.is_visible);
      message.success(item.is_visible ? '已隐藏' : '已显示');
      await loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  /**
   * 批量导入：用户在拖拽区选/拖入多个文件后触发；后端单次最多 50 个、总 100MB。
   * 完成后清空 importResults 进入「结果视图」，用户可关闭或继续追加新一批。
   */
  const handleBatchImport = async (files: File[]) => {
    if (files.length === 0) return;
    if (!importCategory) {
      message.warning('请先选择目标分类');
      return;
    }
    setImporting(true);
    try {
      const res = await docApi.batchImport(files, importCategory, true);
      const d = res.data;
      setImportResults(d.details || []);
      if (d.failed === 0) {
        message.success(`全部导入成功：${d.success} 篇`);
      } else if (d.success === 0) {
        message.error(`全部导入失败：${d.failed} 篇，请查看明细`);
      } else {
        message.warning(`部分导入：成功 ${d.success}，失败 ${d.failed}`);
      }
      await loadList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '批量导入失败');
    } finally {
      setImporting(false);
    }
  };

  const resetImportModal = () => {
    setImportOpen(false);
    setImportResults(null);
    setImportCategory(undefined);
  };

  /** 单文档导出为 .md。 */
  const handleExportOne = async (id: number, title: string) => {
    setExportingIds((prev) => {
      const next = new Set(prev); next.add(id); return next;
    });
    try {
      const res = await docApi.exportOne(id);
      downloadBlobResponse(res as any, `${title || 'doc-' + id}.md`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '导出失败');
    } finally {
      setExportingIds((prev) => {
        const next = new Set(prev); next.delete(id); return next;
      });
    }
  };

  /** 批量导出为 zip。 */
  const handleExportBatch = async () => {
    if (selectedIds.length === 0) {
      message.info('请先勾选要导出的文档');
      return;
    }
    if (selectedIds.length > 200) {
      message.warning('单次最多导出 200 篇文档，请分批操作');
      return;
    }
    setBatchExporting(true);
    try {
      const res = await docApi.exportBatch(selectedIds);
      downloadBlobResponse(res as any, `docs-export-${new Date().toISOString().slice(0, 10)}.zip`);
      message.success(`已开始下载 ${selectedIds.length} 篇文档`);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '批量导出失败');
    } finally {
      setBatchExporting(false);
    }
  };

  const columns: TableProps<DocItem>['columns'] = useMemo(() => [
    {
      title: '标题', dataIndex: 'title', key: 'title', ellipsis: true,
      render: (text: string, record) => (
        <Space direction="vertical" size={0}>
          <a onClick={() => handleEdit(record.id)} style={{ fontWeight: 500 }}>{text}</a>
          {record.subtitle && <span style={{ color: '#999', fontSize: 12 }}>{record.subtitle}</span>}
        </Space>
      ),
    },
    {
      title: '分类', dataIndex: ['category', 'name'], key: 'category', width: 120,
      render: (_: any, record) => record.category ? <Tag>{record.category.name}</Tag> : <span style={{ color: '#ccc' }}>未分类</span>,
    },
    {
      title: '索引状态', key: 'index_status', width: 140,
      render: (_: any, record) => {
        const total = record.chunks_count || 0;
        const indexed = record.indexed_chunk_count || 0;
        if (total === 0) return <Tag color="default">未索引</Tag>;
        if (indexed === total) return <Tag color="success">{indexed} chunks</Tag>;
        return (
          <Tooltip title={`已索引 ${indexed} / ${total} chunks，部分失败需重建`}>
            <Progress percent={Math.round(indexed / total * 100)} size="small" status="exception" />
          </Tooltip>
        );
      },
    },
    {
      title: '可见性', dataIndex: 'is_visible', key: 'is_visible', width: 80,
      render: (visible: boolean) => visible
        ? <Tag color="success">显示</Tag>
        : <Tag color="default">隐藏</Tag>,
    },
    {
      title: '浏览量', dataIndex: 'view_count', key: 'view_count', width: 80, align: 'right' as const,
    },
    {
      title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 160,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-',
    },
    {
      title: '操作', key: 'action', width: 230, fixed: 'right' as const,
      render: (_: any, record) => (
        <Space size={0}>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record.id)} />
          </Tooltip>
          <Tooltip title="重建索引">
            <Button
              type="text" size="small" icon={<ThunderboltOutlined />}
              loading={reindexingIds.has(record.id)}
              onClick={() => reindexOne(record.id)}
            />
          </Tooltip>
          <Tooltip title="导出为 .md">
            <Button
              type="text" size="small" icon={<DownloadOutlined />}
              loading={exportingIds.has(record.id)}
              onClick={() => handleExportOne(record.id, record.title)}
            />
          </Tooltip>
          <Tooltip title={record.is_visible ? '隐藏' : '显示'}>
            <Button
              type="text" size="small"
              icon={record.is_visible ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={() => handleToggleVisibility(record)}
            />
          </Tooltip>
          <Popconfirm
            title={`确定删除《${record.title}》？`}
            description="关联的切片和向量索引会一并删除"
            okType="danger"
            onConfirm={() => handleDelete(record.id)}
          >
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ], [reindexingIds, exportingIds]);

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <Input.Search
            placeholder="搜索标题 / 副标题 / 内容"
            allowClear
            style={{ width: 280 }}
            prefix={<SearchOutlined />}
            value={filters.keyword}
            onChange={(e) => setFilters((s) => ({ ...s, keyword: e.target.value }))}
            onSearch={() => { setPage(1); void loadList(); }}
          />
          <Select
            placeholder="全部分类"
            allowClear
            style={{ width: 160 }}
            value={filters.categoryId}
            onChange={(v) => { setFilters((s) => ({ ...s, categoryId: v })); setPage(1); }}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          <Select
            placeholder="全部状态"
            allowClear
            style={{ width: 120 }}
            value={filters.isVisible}
            onChange={(v) => { setFilters((s) => ({ ...s, isVisible: v })); setPage(1); }}
            options={[{ value: true, label: '显示' }, { value: false, label: '隐藏' }]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadList()}>刷新</Button>
        </Space>
        <Space>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入文档</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增文档</Button>
        </Space>
      </div>

      {selectedIds.length > 0 && (
        <div style={{ marginBottom: 8, padding: '8px 12px', background: '#fafafa', borderRadius: 6 }}>
          <Space>
            <span>已选 {selectedIds.length} 项</span>
            <Button size="small" onClick={() => handleBatchVisibility(true)}>批量显示</Button>
            <Button size="small" onClick={() => handleBatchVisibility(false)}>批量隐藏</Button>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              loading={batchExporting}
              onClick={handleExportBatch}
            >批量导出 zip</Button>
            <Button size="small" danger onClick={handleBatchDelete}>批量删除</Button>
            <Button size="small" type="link" onClick={() => setSelectedIds([])}>取消选择</Button>
          </Space>
        </div>
      )}

      <Table<DocItem>
        rowKey="id"
        loading={loading}
        dataSource={items}
        columns={columns}
        scroll={{ x: 900 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as number[]),
        }}
        pagination={{
          current: page,
          pageSize: perPage,
          total,
          showSizeChanger: true,
          showTotal: (t) => `共 ${t} 篇`,
          onChange: (p, s) => { setPage(p); setPerPage(s); },
        }}
      />

      {/* 编辑 / 新增 弹窗 */}
      <Modal
        open={editorOpen}
        title={editing ? `编辑：${editing.title}` : '新增文档'}
        width={Math.min(1200, window.innerWidth - 80)}
        onCancel={() => setEditorOpen(false)}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(100vh - 200px)', overflow: 'auto' } }}
        footer={
          <Space>
            <Switch
              checked={reindexAfterSave}
              onChange={setReindexAfterSave}
              checkedChildren="保存后重建索引"
              unCheckedChildren="不重建索引"
            />
            <Button onClick={() => setEditorOpen(false)}>取消</Button>
            <Button type="primary" loading={saving} onClick={handleSave}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" preserve={false}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }, { max: 255 }]}>
              <Input placeholder="文档标题" />
            </Form.Item>
            <Form.Item name="slug" label="URL 标识" tooltip="可选；留空自动生成">
              <Input placeholder="例如 quickstart" />
            </Form.Item>
            <Form.Item name="category_id" label="分类">
              <Select
                allowClear
                placeholder="选择分类（可不选）"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr', gap: 12 }}>
            <Form.Item name="subtitle" label="副标题" tooltip="可选；列表卡片小字 / 文档详情页副标题">
              <Input placeholder="可选" />
            </Form.Item>
            <Form.Item name="sort_order" label="排序" tooltip="越大越靠前">
              <Input type="number" />
            </Form.Item>
            <Form.Item name="is_visible" label="可见性" valuePropName="checked">
              <Switch checkedChildren="显示" unCheckedChildren="隐藏" />
            </Form.Item>
          </div>
          <Form.Item label="正文" required>
            <DocRichEditor value={contentHtml} onChange={setContentHtml} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入弹窗（支持多文件 + 结果明细） */}
      <Modal
        open={importOpen}
        title="导入文档"
        width={640}
        onCancel={resetImportModal}
        footer={
          importResults ? (
            <Space>
              <Button onClick={() => { setImportResults(null); }}>继续导入</Button>
              <Button type="primary" onClick={resetImportModal}>完成</Button>
            </Space>
          ) : null
        }
        destroyOnClose
      >
        {/* 上传前：拖拽区 + 分类选择 */}
        {!importResults && (
          <>
            <p style={{ color: '#666', marginBottom: 12 }}>
              支持 <Tag>Markdown (.md)</Tag> 和 <Tag>Word (.docx)</Tag>。单次最多 50 个文件，单文件 20MB、总 100MB。
              每个文件独立处理，失败的不影响其他。
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 4 }}>
                归类到分类 <span style={{ color: '#ff4d4f' }}>*</span>
              </label>
              <Select
                placeholder="请选择分类"
                style={{ width: '100%' }}
                value={importCategory}
                onChange={setImportCategory}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <Upload.Dragger
              accept=".md,.markdown,.docx"
              showUploadList={false}
              multiple
              disabled={importing}
              // 用 beforeUpload 收集文件批次：antd 会按选中顺序对每个文件分别调用一次，
              // 这里用一次性 wait microtask 聚合再统一调 batchImport，避免 N 个文件 → N 次请求。
              beforeUpload={(file, fileList) => {
                // fileList 是本次批选的所有文件；只在最后一个 file 触发时统一处理
                if (file === fileList[fileList.length - 1]) {
                  void handleBatchImport(fileList as unknown as File[]);
                }
                return false; // 阻止 antd 自动上传
              }}
            >
              <p className="ant-upload-drag-icon"><ImportOutlined style={{ fontSize: 28 }} /></p>
              <p className="ant-upload-text">{importing ? '正在导入...' : '点击或拖入文件（可多选）'}</p>
              <p className="ant-upload-hint">.md / .docx，单文件不超过 20MB</p>
            </Upload.Dragger>
          </>
        )}

        {/* 上传后：结果明细 */}
        {importResults && (
          <>
            {(() => {
              const ok = importResults.filter((r) => r.status === 'ok').length;
              const fail = importResults.length - ok;
              const variant: 'success' | 'warning' | 'error' = fail === 0 ? 'success' : ok === 0 ? 'error' : 'warning';
              return (
                <Alert
                  type={variant}
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={`成功 ${ok} 篇 · 失败 ${fail} 篇`}
                  description={fail > 0 ? '失败原因见下方明细，可以重新选文件再传一次（成功的不会被重复导入）。' : undefined}
                />
              );
            })()}
            <Table<ImportResult>
              size="small"
              rowKey={(r) => `${r.filename}-${r.doc_id ?? r.error ?? ''}`}
              dataSource={importResults}
              pagination={false}
              scroll={{ y: 320 }}
              columns={[
                {
                  title: '文件', dataIndex: 'filename', key: 'filename', ellipsis: true,
                },
                {
                  title: '状态', dataIndex: 'status', key: 'status', width: 80,
                  render: (s: 'ok' | 'failed') => s === 'ok'
                    ? <Tag color="success">成功</Tag>
                    : <Tag color="error">失败</Tag>,
                },
                {
                  title: '说明', key: 'info', ellipsis: true,
                  render: (_: any, r) => r.status === 'ok'
                    ? <span style={{ color: '#666' }}>{r.title || `已导入 (id: ${r.doc_id})`}</span>
                    : <span style={{ color: '#ff4d4f' }}>{r.error || '导入失败'}</span>,
                },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
