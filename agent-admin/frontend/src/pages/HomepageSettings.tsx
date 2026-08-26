import { useEffect, useMemo, useState } from 'react';
import {
  Card, Form, Input, Button, message, Spin, Alert, Upload, Popconfirm, Tag, Switch,
  Modal, Radio, Empty, InputNumber, Divider, Tooltip,
} from 'antd';
import {
  SaveOutlined, ReloadOutlined, UploadOutlined, DeleteOutlined,
  EditOutlined, ThunderboltOutlined, PlusOutlined,
} from '@ant-design/icons';
import {
  homepageApi, homepagePhrasePackApi,
  type PhrasePack, type PhrasePackInput,
} from '../services/api';

// 文本字段：所有 key 来自后端 TEXT_KEYS 白名单，前端不再硬编码每个字段名
type TextSettings = Record<string, string>;

interface PositionMeta {
  position: string;
  label: string;
  desc: string;
  ratio: string;
  size: string;
  image_url: string | null;
  filename: string | null;
  width: number | null;
  height: number | null;
}

const TEMPLATE_LABELS: Record<string, string> = {
  default: '默认模板',
  minimal: '极简模板',
  workspace: '浅色工作台',
}

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  default: '历史版本叙事，对应 public/home/index.html',
  minimal: '简洁专业的桌面 AI 工作站叙事，对应 public/home-minimal/index.html',
  workspace: '浅色纸感 + 墨绿点缀，对齐桌面端工作台改版，对应 public/home-workspace/index.html',
}

// 字段定义（按 section 分组），用于 minimal 模板专属内容编辑面板与话术包编辑表单
interface FieldDef { key: string; label: string; max?: number; rows?: number }
interface FieldGroup { title: string; fields: FieldDef[] }

const MINIMAL_FIELD_GROUPS: FieldGroup[] = [
  {
    title: 'Section 1：创作能力',
    fields: [
      { key: 'minimal_section_create_badge', label: '徽章文字', max: 30 },
      { key: 'minimal_section_create_title', label: '标题', max: 80 },
      { key: 'minimal_section_create_desc', label: '描述', max: 240, rows: 2 },
    ],
  },
  {
    title: 'Section 2：对话能力',
    fields: [
      { key: 'minimal_section_chat_badge', label: '徽章文字', max: 30 },
      { key: 'minimal_section_chat_title', label: '标题', max: 80 },
      { key: 'minimal_section_chat_desc', label: '描述', max: 240, rows: 2 },
    ],
  },
  {
    title: 'Section 3：双特性卡',
    fields: [
      { key: 'minimal_feat_kb_title', label: '本地知识库 - 标题', max: 60 },
      { key: 'minimal_feat_kb_desc', label: '本地知识库 - 描述', max: 240, rows: 2 },
      { key: 'minimal_feat_memory_title', label: '持续记忆 - 标题', max: 60 },
      { key: 'minimal_feat_memory_desc', label: '持续记忆 - 描述', max: 240, rows: 2 },
    ],
  },
  {
    title: 'Section 4：六宫格能力',
    fields: [
      { key: 'minimal_grid_1_title', label: '能力 1 - 标题', max: 60 },
      { key: 'minimal_grid_1_desc', label: '能力 1 - 描述', max: 120 },
      { key: 'minimal_grid_2_title', label: '能力 2 - 标题', max: 60 },
      { key: 'minimal_grid_2_desc', label: '能力 2 - 描述', max: 120 },
      { key: 'minimal_grid_3_title', label: '能力 3 - 标题', max: 60 },
      { key: 'minimal_grid_3_desc', label: '能力 3 - 描述', max: 120 },
      { key: 'minimal_grid_4_title', label: '能力 4 - 标题', max: 60 },
      { key: 'minimal_grid_4_desc', label: '能力 4 - 描述', max: 120 },
      { key: 'minimal_grid_5_title', label: '能力 5 - 标题', max: 60 },
      { key: 'minimal_grid_5_desc', label: '能力 5 - 描述', max: 120 },
      { key: 'minimal_grid_6_title', label: '能力 6 - 标题', max: 60 },
      { key: 'minimal_grid_6_desc', label: '能力 6 - 描述', max: 120 },
    ],
  },
  {
    title: 'Section 5：双 CTA',
    fields: [
      { key: 'minimal_cta_left_title', label: '左侧 - 标题', max: 60 },
      { key: 'minimal_cta_left_desc', label: '左侧 - 描述', max: 120 },
      { key: 'minimal_cta_left_link', label: '左侧 - 链接', max: 500 },
      { key: 'minimal_cta_right_title', label: '右侧 - 标题', max: 60 },
      { key: 'minimal_cta_right_desc', label: '右侧 - 描述', max: 120 },
      { key: 'minimal_cta_right_link', label: '右侧 - 链接', max: 500 },
    ],
  },
];

// 各模板的专属字段分组（话术包编辑表单按当前 template 取对应分组渲染）
// default 模板没有专属字段，话术包应基于 minimal 模板使用
const TEMPLATE_FIELD_GROUPS: Record<string, FieldGroup[]> = {
  default: [],
  minimal: MINIMAL_FIELD_GROUPS,
  workspace: [],
};

export default function HomepageSettingsPage() {
  const [form] = Form.useForm<TextSettings>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [positions, setPositions] = useState<PositionMeta[]>([]);
  const [uploadingPos, setUploadingPos] = useState<string>('');
  const [enabled, setEnabled] = useState(true);
  const [toggling, setToggling] = useState(false);
  // 「文档作为首页」开关：docsEnabled 控制是否可点（未启用文档时开了也无效，路由层会回落到官网）
  const [useDocsAsIndex, setUseDocsAsIndex] = useState(false);
  const [togglingDocs, setTogglingDocs] = useState(false);
  const [docsEnabled, setDocsEnabled] = useState(false);

  // ========== 模板选择 state ==========
  const [template, setTemplate] = useState<string>('default');
  const [availableTemplates, setAvailableTemplates] = useState<string[]>(['default', 'minimal', 'workspace']);
  const [switchingTemplate, setSwitchingTemplate] = useState(false);

  // ========== 行业话术包 state ==========
  const [packs, setPacks] = useState<PhrasePack[]>([]);
  const [activePack, setActivePack] = useState<{ default: string; minimal: string }>({ default: '', minimal: '' });
  const [packsLoading, setPacksLoading] = useState(false);
  const [editPackOpen, setEditPackOpen] = useState(false);
  const [editPackTarget, setEditPackTarget] = useState<PhrasePack | null>(null);
  const [savingPack, setSavingPack] = useState(false);
  const [editPackForm] = Form.useForm();
  const watchedPackTemplate = Form.useWatch('template', editPackForm);

  // 当前模板下可见的图位
  // default：原 12 个位；minimal：minimal_ 前缀专属位；workspace：仅导航 Logo + 首屏截图
  const visiblePositions = useMemo(() => {
    if (template === 'minimal') {
      return positions.filter((p) => p.position.startsWith('minimal_'));
    }
    if (template === 'workspace') {
      return positions.filter((p) => p.position === 'nav_logo' || p.position === 'hero_main');
    }
    return positions.filter((p) => !p.position.startsWith('minimal_'));
  }, [positions, template]);

  // 当前模板下的话术包列表 + 当前激活 slug
  const visiblePacks = useMemo(
    () => packs.filter((p) => p.template === template),
    [packs, template],
  );
  const currentActiveSlug = activePack[template as 'default' | 'minimal'] || '';

  const load = async () => {
    setLoading(true);
    try {
      const res = await homepageApi.getSettings();
      setEnabled(res.data.homepage_enabled !== false);
      setUseDocsAsIndex(!!res.data.homepage_use_docs_as_index);
      setDocsEnabled(!!res.data.docs_enabled);
      setTemplate((res.data.homepage_template as string) || 'default');
      setAvailableTemplates((res.data.available_templates as string[]) || ['default', 'minimal', 'workspace']);
      setActivePack({
        default: (res.data.homepage_active_phrase_pack_default as string) || '',
        minimal: (res.data.homepage_active_phrase_pack_minimal as string) || '',
      });
      const texts = (res.data.texts as Record<string, string>) || {};
      form.setFieldsValue(texts);
      const posMap = res.data.positions || {};
      setPositions(Object.values(posMap));
    } catch {
      message.error('加载失败');
    }
    setLoading(false);
  };

  const loadPacks = async () => {
    setPacksLoading(true);
    try {
      const res = await homepagePhrasePackApi.list();
      setPacks((res.data.items as PhrasePack[]) || []);
      if (res.data.active) {
        setActivePack({
          default: res.data.active.default || '',
          minimal: res.data.active.minimal || '',
        });
      }
    } catch {
      message.error('话术包加载失败');
    }
    setPacksLoading(false);
  };

  useEffect(() => {
    load();
    loadPacks();
  }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await homepageApi.updateSettings(values);
      message.success('已保存');
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
    setSaving(false);
  };

  const handleUpload = async (position: string, file: File) => {
    // 基础校验
    if (file.size > 5 * 1024 * 1024) {
      message.error('图片不能超过 5MB');
      return false;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      message.error('仅支持 PNG / JPEG / WebP');
      return false;
    }
    setUploadingPos(position);
    try {
      await homepageApi.uploadImage(position, file);
      message.success('上传成功');
      await load();
    } catch (err: any) {
      message.error(err.response?.data?.error || '上传失败');
    }
    setUploadingPos('');
    return false; // 阻止 antd 自动上传
  };

  const handleDelete = async (position: string) => {
    try {
      await homepageApi.deleteImage(position);
      message.success('已清除');
      await load();
    } catch {
      message.error('清除失败');
    }
  };

  // ========== 模板切换 ==========
  // 写入 homepage_template 后立即刷新（path 候选 + 字段分组都依赖 template）
  const handleSwitchTemplate = async (newTpl: string) => {
    if (newTpl === template) return;
    setSwitchingTemplate(true);
    try {
      await homepageApi.updateSettings({ homepage_template: newTpl });
      setTemplate(newTpl);
      message.success(`已切换到「${TEMPLATE_LABELS[newTpl] || newTpl}」`);
    } catch (err: any) {
      message.error(err.response?.data?.error || '切换失败');
    }
    setSwitchingTemplate(false);
  };

  // ========== 话术包：应用 / 删除 ==========
  // apply 后会改写多个 SystemSetting 字段，重新拉 load() 让 form 显示新内容
  const handleApplyPack = async (pack: PhrasePack) => {
    try {
      await homepagePhrasePackApi.apply(pack.id);
      message.success(`已应用「${pack.name}」`);
      await load();
      await loadPacks();
    } catch (err: any) {
      message.error(err.response?.data?.error || '应用失败');
    }
  };

  const handleDeletePack = async (pack: PhrasePack) => {
    try {
      await homepagePhrasePackApi.remove(pack.id);
      message.success('已删除');
      await loadPacks();
    } catch (err: any) {
      message.error(err.response?.data?.error || '删除失败');
    }
  };

  // ========== 话术包：编辑 Modal ==========
  // 打开编辑 Modal：传 null 表示新建，否则编辑现有 pack
  const openEditPack = (pack: PhrasePack | null) => {
    setEditPackTarget(pack);
    setEditPackOpen(true);
    if (pack) {
      // 编辑：把 payload 字段铺平到 form 顶层（与 template/slug/name 等同级）
      editPackForm.setFieldsValue({
        template: pack.template,
        slug: pack.slug,
        name: pack.name,
        description: pack.description || '',
        sort_order: pack.sort_order,
        ...pack.payload,
      });
    } else {
      // 新建：默认归属到当前模板
      editPackForm.resetFields();
      editPackForm.setFieldsValue({
        template,
        slug: '',
        name: '',
        description: '',
        sort_order: 100,
      });
    }
  };

  // 保存话术包（新建 / 编辑共用）
  // payload 仅保留属于所选 template 的专属字段（按前缀过滤），避免污染其他字段
  const handleSavePack = async () => {
    let values: any;
    try {
      values = await editPackForm.validateFields();
    } catch {
      return;
    }
    const tpl = values.template || template;
    const groups = TEMPLATE_FIELD_GROUPS[tpl] || [];
    const allowedKeys = new Set<string>();
    for (const g of groups) {
      for (const f of g.fields) allowedKeys.add(f.key);
    }
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (allowedKeys.has(k) && typeof v === 'string') {
        payload[k] = v;
      }
    }
    const data: PhrasePackInput = {
      template: tpl,
      slug: values.slug,
      name: values.name,
      description: values.description || '',
      payload,
      sort_order: typeof values.sort_order === 'number' ? values.sort_order : 100,
    };

    setSavingPack(true);
    try {
      if (editPackTarget) {
        // 系统预置不允许改 template/slug；后端会忽略，前端也不发
        const patch: PhrasePackInput = editPackTarget.is_builtin
          ? { name: data.name, description: data.description, payload: data.payload, sort_order: data.sort_order }
          : data;
        await homepagePhrasePackApi.update(editPackTarget.id, patch);
        message.success('已保存');
      } else {
        await homepagePhrasePackApi.create(data);
        message.success('已创建');
      }
      setEditPackOpen(false);
      await loadPacks();
    } catch (err: any) {
      message.error(err.response?.data?.error || '保存失败');
    }
    setSavingPack(false);
  };

  // 计算图片预览容器的 aspect-ratio CSS
  const parseRatio = (ratio: string): string => {
    const m = ratio.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
    if (!m) return '16 / 9';
    return `${m[1]} / ${m[2]}`;
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>官网设置</h3>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#595959' }}>
            <Switch
              checked={enabled}
              loading={toggling}
              onChange={async (checked) => {
                setToggling(true);
                try {
                  const res = await homepageApi.updateSettings({ homepage_enabled: checked });
                  setEnabled(res.data.homepage_enabled !== false);
                  message.success(checked ? '官网已开启' : '官网已关闭');
                } catch {
                  message.error('操作失败');
                }
                setToggling(false);
              }}
            />
            <span>官网开关</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#595959' }}>
            <Switch
              checked={useDocsAsIndex}
              loading={togglingDocs}
              disabled={!enabled || !docsEnabled}
              onChange={async (checked) => {
                setTogglingDocs(true);
                try {
                  const res = await homepageApi.updateSettings({ homepage_use_docs_as_index: checked });
                  setUseDocsAsIndex(!!res.data.homepage_use_docs_as_index);
                  message.success(checked ? '首页已改为文档站' : '首页已恢复为官网');
                } catch {
                  message.error('操作失败');
                }
                setTogglingDocs(false);
              }}
            />
            <span>文档作为首页</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<ReloadOutlined />} onClick={load} disabled={loading}>刷新</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存文本</Button>
        </div>
      </div>

      {!enabled && (
        <Alert
          type="warning"
          showIcon
          message="官网已关闭，访问根域名时将跳转到管理后台登录页。"
          style={{ marginBottom: 16 }}
        />
      )}
      {enabled && useDocsAsIndex && docsEnabled && (
        <Alert
          type="success"
          showIcon
          message="已启用「文档作为首页」：访问根域名会重定向到 /docs/。需要原官网页面可直接访问 /home/index.html（不常用）。"
          style={{ marginBottom: 16 }}
        />
      )}
      {enabled && !docsEnabled && (
        <Alert
          type="info"
          showIcon
          message="「文档作为首页」开关需先启用文档功能。请到「内容运营 → 文档站设置」打开「文档站点」后返回本页。"
          style={{ marginBottom: 16 }}
        />
      )}

      <Alert
        type="info"
        showIcon
        message={
          template === 'workspace'
            ? '当前使用「浅色工作台」模板（public/home-workspace/index.html）。图片上传即时生效，文本需点击右上角「保存文本」。'
            : template === 'minimal'
              ? '当前使用「极简模板」（public/home-minimal/index.html）。图片上传即时生效，文本需点击右上角「保存文本」。'
              : '当前使用「默认模板」（public/home/index.html）。图片上传即时生效，文本需点击右上角「保存文本」。'
        }
        style={{ marginBottom: 16 }}
      />

      {/* ===== 模板选择 ===== */}
      <Card
        title="官网模板"
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <Tooltip title="切换模板会改变根域名 / 加载的 HTML 文件，文本与图片数据按模板独立存储">
            <span style={{ color: '#8c8c8c', fontSize: 12, cursor: 'help' }}>说明</span>
          </Tooltip>
        }
      >
        <Radio.Group
          value={template}
          onChange={(e) => handleSwitchTemplate(e.target.value)}
          disabled={switchingTemplate || !enabled || (useDocsAsIndex && docsEnabled)}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {availableTemplates.map((tpl) => (
            <Radio key={tpl} value={tpl}>
              <span style={{ fontWeight: 600 }}>{TEMPLATE_LABELS[tpl] || tpl}</span>
              <span style={{ marginLeft: 8, color: '#8c8c8c', fontSize: 12 }}>
                {TEMPLATE_DESCRIPTIONS[tpl] || ''}
              </span>
            </Radio>
          ))}
        </Radio.Group>
        {(useDocsAsIndex && docsEnabled) && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 12 }}
            message="已启用「文档作为首页」，模板切换暂时不影响根域名展示。需关闭该开关才能让模板生效。"
          />
        )}
      </Card>

      {/* ===== 行业话术包 ===== */}
      <Card
        title={
          <span>
            行业话术包
            <span style={{ marginLeft: 8, color: '#8c8c8c', fontSize: 12, fontWeight: 'normal' }}>
              {TEMPLATE_LABELS[template] || template} · 共 {visiblePacks.length} 个
            </span>
          </span>
        }
        size="small"
        style={{ marginBottom: 16 }}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button icon={<ReloadOutlined />} size="small" onClick={loadPacks} disabled={packsLoading}>
              刷新
            </Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              size="small"
              onClick={() => openEditPack(null)}
              disabled={(TEMPLATE_FIELD_GROUPS[template] || []).length === 0}
            >
              新建话术包
            </Button>
          </div>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="话术包是「批量预设填充」工具：点击「应用」会一次性写入这套行业文案到当前模板的专属字段；不影响通用字段（站点标题、下载链接、页脚）；切换话术包前会清空当前模板的专属字段，避免残留。"
        />
        <Spin spinning={packsLoading}>
          {visiblePacks.length === 0 ? (
            <Empty
              description={
                (TEMPLATE_FIELD_GROUPS[template] || []).length === 0
                  ? `${TEMPLATE_LABELS[template] || template} 没有专属字段，无需话术包`
                  : '尚无话术包'
              }
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visiblePacks.map((pack) => {
                const isActive = pack.slug === currentActiveSlug;
                return (
                  <div
                    key={pack.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      border: '1px solid ' + (isActive ? '#1677ff' : '#f0f0f0'),
                      borderRadius: 8,
                      background: isActive ? '#f0f8ff' : '#fff',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{pack.name}</span>
                        {isActive && <Tag color="blue" style={{ margin: 0 }}>使用中</Tag>}
                        {pack.is_builtin && <Tag style={{ margin: 0 }}>系统预置</Tag>}
                        <Tag color="default" style={{ margin: 0, fontFamily: 'monospace', fontSize: 11 }}>
                          {pack.slug}
                        </Tag>
                      </div>
                      {pack.description && (
                        <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4, lineHeight: 1.5 }}>
                          {pack.description}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <Button
                        type={isActive ? 'default' : 'primary'}
                        icon={<ThunderboltOutlined />}
                        size="small"
                        onClick={() => handleApplyPack(pack)}
                        disabled={isActive}
                      >
                        {isActive ? '使用中' : '应用'}
                      </Button>
                      <Button
                        icon={<EditOutlined />}
                        size="small"
                        onClick={() => openEditPack(pack)}
                      >
                        编辑
                      </Button>
                      {!pack.is_builtin && (
                        <Popconfirm
                          title="删除这个话术包？"
                          description="此操作不可恢复"
                          onConfirm={() => handleDeletePack(pack)}
                        >
                          <Button icon={<DeleteOutlined />} size="small" danger />
                        </Popconfirm>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Spin>
      </Card>

      <Spin spinning={loading}>
        <Form form={form} layout="vertical">
          {/* 站点标题 + 导航 */}
          <Card title="站点标题与导航" size="small" style={{ marginBottom: 16 }}>
            <div style={{ maxWidth: 820 }}>
              <Form.Item
                name="homepage_page_title"
                label="浏览器标签页标题"
                tooltip="浏览器 tab / 收藏夹显示的标题。留空时回退到「应用名 / 站点标题」"
                rules={[{ max: 80 }]}
              >
                <Input maxLength={80} placeholder="留空时使用默认（应用名或站点标题）" />
              </Form.Item>

              <Form.Item
                name="homepage_nav_title"
                label="左上角标题"
                tooltip="导航栏左侧 logo 旁边显示的文字。留空时回退到「应用名 / 站点标题」"
                rules={[{ max: 60 }]}
              >
                <Input maxLength={60} placeholder="留空时使用默认（应用名或站点标题）" />
              </Form.Item>
            </div>
            <Alert
              type="info"
              showIcon
              message="左上角 logo 图片在下方「官网截图」区的「左上角 Logo」位置上传。未上传时显示默认的字母缩写圆角块。"
            />
          </Card>

          {/* 首屏文案 + 下载链接 */}
          <Card title="首屏文案与下载链接" size="small" style={{ marginBottom: 16 }}>
            <div style={{ maxWidth: 820 }}>
              <Form.Item
                name="homepage_hero_title"
                label="首屏大标题"
                tooltip="Hero 区域的主标题，例如：你的本地 AI 工作站"
                rules={[{ max: 100 }]}
              >
                <Input maxLength={100} placeholder="你的本地 AI 工作站" />
              </Form.Item>

              <Form.Item
                name="homepage_hero_desc"
                label="首屏副标题"
                tooltip="主标题下方的描述文字，支持一段或多句话"
                rules={[{ max: 500 }]}
              >
                <Input.TextArea
                  rows={3}
                  maxLength={500}
                  placeholder="对话即操作 -- AI 自主读写文件、执行命令、生成图片、检索知识库。数据全量本地存储..."
                />
              </Form.Item>

              <Form.Item
                name="homepage_version_text"
                label="下载按钮下方说明文字"
                tooltip="原文案：免费使用 / 数据本地存储"
                rules={[{ max: 100 }]}
              >
                <Input maxLength={100} placeholder="免费使用 / 数据本地存储" />
              </Form.Item>

              <Form.Item
                name="homepage_download_windows"
                label="Windows 下载链接"
                tooltip="点击官网「Windows」按钮跳转到的 URL（.exe 安装包地址）"
                rules={[{ max: 500 }]}
              >
                <Input maxLength={500} placeholder="https://agent.haohuoban.com/updates/haohuoban-1.1.9-setup.exe" />
              </Form.Item>

              <Form.Item
                name="homepage_download_mac"
                label="Mac 下载链接（Intel）"
                tooltip="点击官网「Mac Intel」按钮跳转到的 URL（.zip 安装包地址）"
                rules={[{ max: 500 }]}
              >
                <Input maxLength={500} placeholder="https://agent.haohuoban.com/updates/haohuoban-1.1.9-x64-mac.zip" />
              </Form.Item>

              <Form.Item
                name="homepage_download_mac_arm"
                label="Mac 下载链接（Apple Silicon）"
                tooltip="点击官网「Mac M 系列」按钮跳转到的 URL（M 芯片 ARM 包）"
                rules={[{ max: 500 }]}
              >
                <Input maxLength={500} placeholder="https://agent.haohuoban.com/updates/haohuoban-1.1.9-arm64-mac.zip" />
              </Form.Item>
            </div>
          </Card>

          {/* Footer 版权 + 联系方式 + 备案号 */}
          <Card title="页脚信息" size="small" style={{ marginBottom: 16 }}>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="页脚会以「公司 · 版权年份©应用名 · 联系方式 · 备案号」指令拼接，留空的字段越过。公司名留空时页脚只显示「年份©应用名」。"
            />
            <div style={{ maxWidth: 820 }}>
              <Form.Item
                name="homepage_footer_company"
                label="公司名称"
                tooltip="页脚首位显示的主体，例：某某科技有限公司。留空不显示"
                rules={[{ max: 120 }]}
              >
                <Input maxLength={120} placeholder="某某科技有限公司" />
              </Form.Item>

              <Form.Item
                name="homepage_footer_contact"
                label="联系方式"
                tooltip="例：联系电话 400-xxx-xxxx · service@example.com。留空不显示"
                rules={[{ max: 120 }]}
              >
                <Input maxLength={120} placeholder="联系电话 400-xxx-xxxx" />
              </Form.Item>

              <Form.Item
                name="homepage_footer_beian"
                label="备案号"
                tooltip="例：京ICP备12345678号（中国大陆上线的站点必填）。留空不显示"
                rules={[{ max: 120 }]}
              >
                <Input maxLength={120} placeholder="京ICP备12345678号" />
              </Form.Item>
            </div>
          </Card>

          {/* ===== 模板专属内容（仅当前模板有专属字段时显示） ===== */}
          {(TEMPLATE_FIELD_GROUPS[template] || []).length > 0 && (
            <Card
              title={`${TEMPLATE_LABELS[template] || template} 专属内容`}
              size="small"
              style={{ marginBottom: 16 }}
              extra={
                currentActiveSlug && (
                  <Tag color="blue" style={{ margin: 0 }}>
                    话术包：{visiblePacks.find((p) => p.slug === currentActiveSlug)?.name || currentActiveSlug}
                  </Tag>
                )
              }
            >
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="以下字段仅在当前模板下生效。可手动编辑，也可通过上方「行业话术包」批量替换。手动编辑会覆盖话术包的预设值。"
              />
              {(TEMPLATE_FIELD_GROUPS[template] || []).map((group) => (
                <div key={group.title} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 8 }}>
                    {group.title}
                  </div>
                  <div style={{ maxWidth: 820, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '0 16px' }}>
                    {group.fields.map((f) => (
                      <Form.Item
                        key={f.key}
                        name={f.key}
                        label={f.label}
                        rules={[{ max: f.max || 240 }]}
                        style={{ marginBottom: 12 }}
                      >
                        {f.rows && f.rows > 1 ? (
                          <Input.TextArea rows={f.rows} maxLength={f.max} />
                        ) : (
                          <Input maxLength={f.max} />
                        )}
                      </Form.Item>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </Form>

        {/* 截图管理 */}
        <Card title="官网截图" size="small">
          <Alert
            type="info"
            showIcon
            message="每个位置对应首页的一处图片。支持 PNG / JPEG / WebP，单张最大 5MB。请按「建议尺寸」和「比例」上传，避免拉伸变形。"
            style={{ marginBottom: 16 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
            {visiblePositions.length === 0 && (
              <Empty description={`${TEMPLATE_LABELS[template] || template} 暂无可上传图位`} />
            )}
            {visiblePositions.map((p) => (
              <div
                key={p.position}
                style={{
                  border: '1px solid #f0f0f0',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{p.label}</div>
                    <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4, lineHeight: 1.5 }}>{p.desc}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
                  <Tag style={{ margin: 0 }}>比例 {p.ratio}</Tag>
                  <Tag style={{ margin: 0 }}>{p.size}</Tag>
                  <Tag color="blue" style={{ margin: 0, fontFamily: 'monospace', fontSize: 11 }}>
                    {p.position}
                  </Tag>
                </div>

                <div
                  style={{
                    aspectRatio: parseRatio(p.ratio),
                    width: '100%',
                    background: '#fafafa',
                    border: '1px dashed #d9d9d9',
                    borderRadius: 6,
                    marginBottom: 12,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  {p.image_url ? (
                    <img
                      src={p.image_url}
                      alt={p.label}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: 12, color: '#bfbfbf' }}>未上传</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <Upload
                    accept="image/png,image/jpeg,image/webp"
                    showUploadList={false}
                    beforeUpload={(file) => handleUpload(p.position, file)}
                    disabled={uploadingPos === p.position}
                  >
                    <Button
                      icon={<UploadOutlined />}
                      size="small"
                      loading={uploadingPos === p.position}
                    >
                      {p.image_url ? '替换' : '上传'}
                    </Button>
                  </Upload>
                  {p.image_url && (
                    <Popconfirm
                      title="清除这张图片？"
                      description="首页会恢复显示占位状态"
                      onConfirm={() => handleDelete(p.position)}
                    >
                      <Button icon={<DeleteOutlined />} size="small" danger>清除</Button>
                    </Popconfirm>
                  )}
                  {p.width && p.height && (
                    <span style={{ fontSize: 11, color: '#bfbfbf', alignSelf: 'center', marginLeft: 'auto' }}>
                      {p.width} × {p.height}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Spin>

      {/* ===== 话术包 编辑/新建 Modal ===== */}
      <Modal
        title={editPackTarget ? `编辑话术包：${editPackTarget.name}` : '新建话术包'}
        open={editPackOpen}
        onCancel={() => setEditPackOpen(false)}
        onOk={handleSavePack}
        confirmLoading={savingPack}
        width={820}
        destroyOnClose
        okText={editPackTarget ? '保存' : '创建'}
      >
        <Form form={editPackForm} layout="vertical">
          {editPackTarget?.is_builtin && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="此为系统预置话术包：模板代号、slug 不可修改；可编辑文案与排序。删除按钮已禁用。"
            />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
            <Form.Item name="template" label="归属模板" rules={[{ required: true }]}>
              <Radio.Group disabled={!!editPackTarget?.is_builtin}>
                {(['default', 'minimal'] as const).map((tpl) => (
                  <Radio.Button key={tpl} value={tpl}>
                    {TEMPLATE_LABELS[tpl] || tpl}
                  </Radio.Button>
                ))}
              </Radio.Group>
            </Form.Item>
            <Form.Item
              name="slug"
              label="标识符 (slug)"
              tooltip="英文小写、数字、下划线、连字符。用于程序识别此话术包，创建后不建议修改"
              rules={[
                { required: true, message: '必填' },
                { max: 80 },
                { pattern: /^[a-z0-9_-]+$/, message: '只允许英文小写、数字、_ 和 -' },
              ]}
            >
              <Input placeholder="general / advertising / ecommerce" disabled={!!editPackTarget?.is_builtin} />
            </Form.Item>
            <Form.Item name="name" label="显示名称" rules={[{ required: true, message: '必填' }, { max: 120 }]}>
              <Input placeholder="通用版 / 广告/营销版" />
            </Form.Item>
            <Form.Item name="sort_order" label="排序" tooltip="数字越小越靠前。系统预置默认 0~10">
              <InputNumber min={0} max={9999} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item name="description" label="简短描述（可选）" rules={[{ max: 500 }]}>
            <Input.TextArea rows={2} maxLength={500} placeholder="说明此话术包面向的行业 / 适用场景" />
          </Form.Item>

          <Divider style={{ margin: '12px 0 16px' }}>文案字段</Divider>

          {(() => {
            // Modal 用 Form.useWatch 读 template 来动态渲染字段集
            const tpl = editPackTarget?.template || watchedPackTemplate || template;
            const groups = TEMPLATE_FIELD_GROUPS[tpl] || [];
            if (groups.length === 0) {
              return (
                <Empty description={`${TEMPLATE_LABELS[tpl] || tpl} 没有专属字段，可仅用基础信息`} />
              );
            }
            return groups.map((group) => (
              <div key={group.title} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 8 }}>
                  {group.title}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '0 16px' }}>
                  {group.fields.map((f) => (
                    <Form.Item
                      key={f.key}
                      name={f.key}
                      label={f.label}
                      rules={[{ max: f.max || 240 }]}
                      style={{ marginBottom: 12 }}
                    >
                      {f.rows && f.rows > 1 ? (
                        <Input.TextArea rows={f.rows} maxLength={f.max} placeholder="留空则该字段沿用模板默认" />
                      ) : (
                        <Input maxLength={f.max} placeholder="留空则该字段沿用模板默认" />
                      )}
                    </Form.Item>
                  ))}
                </div>
              </div>
            ));
          })()}
        </Form>
      </Modal>
    </div>
  );
}
