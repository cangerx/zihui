import { useEffect, useRef, useState } from 'react';
import { Button, Space, Tooltip, message, Upload } from 'antd';
import {
  BoldOutlined, ItalicOutlined, UnderlineOutlined, LinkOutlined,
  OrderedListOutlined, UnorderedListOutlined, ClearOutlined,
  PictureOutlined, CodeOutlined, FontSizeOutlined,
} from '@ant-design/icons';
import { docApi } from '../services/api';

/**
 * 文档专用富文本编辑器。
 *
 * 与公告页 RichTextEditor 的差异：
 * - 多了标题（H2/H3）、引用、代码块、图片插入 4 个块级按钮
 * - 图片走 docApi.uploadImage 上传到对象存储 / 公共目录，返回 URL 后插入 img 标签
 * - 粘贴时若有 image/* 项也走同一个上传通道，避免 base64 内联污染数据库
 *
 * 用 contenteditable + execCommand 保持依赖最小。execCommand 虽已 deprecated，
 * 但所有现代浏览器仍稳定支持，足够覆盖文档场景。
 */
export default function DocRichEditor({
  value,
  onChange,
  placeholder = '请输入文档内容…',
  minHeight = 360,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== (value || '')) {
      el.innerHTML = value || '';
    }
  }, [value]);

  /** execCommand 包装：执行前必须 focus，否则部分浏览器无效 */
  const exec = (cmd: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  /** 把当前选区块包成指定标签（h2 / h3 / blockquote / pre） */
  const formatBlock = (tag: string) => exec('formatBlock', `<${tag}>`);

  /** 插入链接：弹 prompt 拿 URL → createLink */
  const handleLink = () => {
    const url = window.prompt('请输入链接 URL（以 https:// 开头）：', 'https://');
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !window.confirm('链接未以 http(s):// 开头，确定继续吗？')) return;
    exec('createLink', url);
  };

  /** 在当前光标位置插入 img 标签 */
  const insertImage = (url: string) => {
    editorRef.current?.focus();
    // execCommand insertImage 在某些浏览器下不可用，用 insertHTML 兜底
    const html = `<p><img src="${url}" alt="" style="max-width:100%;height:auto" /></p>`;
    document.execCommand('insertHTML', false, html);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  /** 通过 antd Upload 的 customRequest 钩子上传单张图片 */
  const handleUploadImage = async (file: File): Promise<boolean> => {
    if (!file.type.startsWith('image/')) {
      message.error('只能上传图片');
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      message.error('图片大小不能超过 10MB');
      return false;
    }
    setUploading(true);
    try {
      const res = await docApi.uploadImage(file);
      const url = (res.data as any)?.url;
      if (!url) throw new Error('返回数据缺少 url');
      insertImage(url);
      message.success('图片已插入');
      return true;
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || '图片上传失败');
      return false;
    } finally {
      setUploading(false);
    }
  };

  const handleInput = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  /**
   * 粘贴处理：
   *   1. clipboard 含 image/*（截图 / 复制图片）→ 走 uploadImage
   *   2. 仅文本：保留原内容，剥 style/class 避免污染。HTML 片段保留段落 / 列表 / 链接 / 标题
   *      （比 RichTextEditor 的纯 text 粘贴宽松，方便从浏览器复制段落到文档）
   */
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageItem = items.find((it) => it.type.startsWith('image/'));
    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (file) handleUploadImage(file);
      return;
    }
    // 文本粘贴：清洗 style / class / on* 属性 / script
    const html = e.clipboardData.getData('text/html');
    if (html) {
      e.preventDefault();
      const cleaned = cleanPastedHtml(html);
      document.execCommand('insertHTML', false, cleaned);
      if (editorRef.current) onChange(editorRef.current.innerHTML);
      return;
    }
    // 无 html 时让浏览器默认处理 text
  };

  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 6, overflow: 'hidden' }}>
      <div style={{ padding: 6, borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
        <Space size={4} wrap>
          <Tooltip title="粗体">
            <Button size="small" type="text" icon={<BoldOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} />
          </Tooltip>
          <Tooltip title="斜体">
            <Button size="small" type="text" icon={<ItalicOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} />
          </Tooltip>
          <Tooltip title="下划线">
            <Button size="small" type="text" icon={<UnderlineOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} />
          </Tooltip>
          <span style={{ width: 1, height: 16, background: '#e0e0e0', margin: '0 2px' }} />
          <Tooltip title="二级标题">
            <Button size="small" type="text" onMouseDown={(e) => { e.preventDefault(); formatBlock('h2'); }}>
              <FontSizeOutlined /> H2
            </Button>
          </Tooltip>
          <Tooltip title="三级标题">
            <Button size="small" type="text" onMouseDown={(e) => { e.preventDefault(); formatBlock('h3'); }}>
              H3
            </Button>
          </Tooltip>
          <Tooltip title="正文">
            <Button size="small" type="text" onMouseDown={(e) => { e.preventDefault(); formatBlock('p'); }}>P</Button>
          </Tooltip>
          <span style={{ width: 1, height: 16, background: '#e0e0e0', margin: '0 2px' }} />
          <Tooltip title="有序列表">
            <Button size="small" type="text" icon={<OrderedListOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }} />
          </Tooltip>
          <Tooltip title="无序列表">
            <Button size="small" type="text" icon={<UnorderedListOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }} />
          </Tooltip>
          <Tooltip title="引用">
            <Button size="small" type="text" onMouseDown={(e) => { e.preventDefault(); formatBlock('blockquote'); }}>“”</Button>
          </Tooltip>
          <Tooltip title="代码块">
            <Button size="small" type="text" icon={<CodeOutlined />} onMouseDown={(e) => { e.preventDefault(); formatBlock('pre'); }} />
          </Tooltip>
          <span style={{ width: 1, height: 16, background: '#e0e0e0', margin: '0 2px' }} />
          <Tooltip title="插入链接">
            <Button size="small" type="text" icon={<LinkOutlined />} onMouseDown={(e) => { e.preventDefault(); handleLink(); }} />
          </Tooltip>
          <Upload
            accept="image/*"
            showUploadList={false}
            beforeUpload={(file) => { handleUploadImage(file as File); return false; }}
          >
            <Tooltip title="插入图片">
              <Button size="small" type="text" icon={<PictureOutlined />} loading={uploading} />
            </Tooltip>
          </Upload>
          <Tooltip title="清除格式">
            <Button size="small" type="text" icon={<ClearOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} />
          </Tooltip>
        </Space>
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onBlur={handleInput}
        onPaste={handlePaste}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className="doc-rich-editor-content"
        style={{
          minHeight,
          padding: 16,
          outline: 'none',
          fontSize: 14,
          lineHeight: 1.7,
          maxHeight: 'calc(100vh - 360px)',
          overflowY: 'auto',
        }}
      />
      <style>{`
        .doc-rich-editor-content:empty::before {
          content: attr(data-placeholder);
          color: #bfbfbf;
          pointer-events: none;
        }
        .doc-rich-editor-content a { color: #1677ff; text-decoration: underline; }
        .doc-rich-editor-content ul, .doc-rich-editor-content ol { padding-left: 28px; margin: 8px 0; }
        .doc-rich-editor-content p { margin: 8px 0; }
        .doc-rich-editor-content h2 { font-size: 20px; font-weight: 600; margin: 16px 0 8px; }
        .doc-rich-editor-content h3 { font-size: 16px; font-weight: 600; margin: 12px 0 6px; }
        .doc-rich-editor-content blockquote {
          border-left: 4px solid #d9d9d9; padding: 6px 12px; margin: 8px 0;
          color: #595959; background: #fafafa;
        }
        .doc-rich-editor-content pre {
          background: #1f1f1f; color: #f5f5f5; padding: 12px; border-radius: 6px;
          font-family: 'Menlo','Monaco','Consolas',monospace; font-size: 13px;
          overflow-x: auto; margin: 8px 0;
        }
        .doc-rich-editor-content img { max-width: 100%; height: auto; border-radius: 4px; }
        .doc-rich-editor-content table { border-collapse: collapse; margin: 8px 0; }
        .doc-rich-editor-content th, .doc-rich-editor-content td { border: 1px solid #d9d9d9; padding: 4px 8px; }
      `}</style>
    </div>
  );
}

/**
 * 清洗粘贴的 HTML：
 *   - 剥除 style / class / on* 属性（防 XSS + 防外部样式污染）
 *   - 剥除 <script> / <style> / <link> / <meta>
 *   - 保留语义化标签（h2-h6 / p / ul / ol / li / strong / em / u / a / img / blockquote / pre / code）
 * 不引入 DOMPurify 等库；用 DOMParser + 白名单遍历，体量小。
 */
function cleanPastedHtml(html: string): string {
  const allowedTags = new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'a', 'img',
    'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
  ]);
  const allowedAttrs: Record<string, string[]> = {
    a:   ['href', 'title', 'target'],
    img: ['src', 'alt', 'title', 'width', 'height'],
  };

  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';

  const walk = (node: Element) => {
    // 递归先处理子节点（用 from-end 因为可能 remove）
    Array.from(node.children).forEach((child) => walk(child as Element));

    const tag = node.tagName.toLowerCase();
    if (!allowedTags.has(tag)) {
      // 不允许的标签：解构提取子节点 / 文本
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      return;
    }

    // 清属性
    const allowed = allowedAttrs[tag] || [];
    Array.from(node.attributes).forEach((attr) => {
      if (!allowed.includes(attr.name.toLowerCase())) {
        node.removeAttribute(attr.name);
      }
    });
  };
  walk(root);
  return root.innerHTML;
}
