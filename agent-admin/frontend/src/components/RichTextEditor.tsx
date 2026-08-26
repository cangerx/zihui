import { useEffect, useRef, useState } from 'react';
import { Button, message, Space, Tooltip } from 'antd';
import {
  BoldOutlined, ItalicOutlined, UnderlineOutlined, LinkOutlined,
  OrderedListOutlined, UnorderedListOutlined, ClearOutlined, PictureOutlined,
} from '@ant-design/icons';
import { announcementApi } from '../services/api';

/**
 * 极简 contenteditable 富文本编辑器。
 *
 * 设计取舍：
 * - 不引入 react-quill / tiptap 等第三方库，保持管理端依赖最小。
 * - document.execCommand 虽已标记废弃，但所有现代浏览器仍稳定支持；
 *   用它实现粗体 / 斜体 / 下划线 / 链接 / 图片 / 列表 / 清除格式 足够覆盖「公告」场景。
 * - value 是 HTML 字符串，持久化到后端 longtext。渲染侧（桌面端）用 v-html，
 *   内容源可信（admin 后台可控），无用户侧自由输入 → 不做白名单过滤。
 * - 通过 ref 同步初始值，避免每次 re-render 都 innerHTML 覆盖造成光标跳回开头。
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder = '请输入公告内容…',
  minHeight = 200,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 上传中标记：防止连续点插图按钮重复弹文件选择器；粘贴路径同样检查，避免并发粘贴错位
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  // 卸载标志：上传是异步的，上传完成时弹窗可能已关闭（destroyOnHidden 卸载编辑器），
  // 此时不得再 execCommand——否则 insertImage 会打到页面其它位置造成脏节点
  const unmountedRef = useRef(false);
  // 上传前记录选区：文件选择器弹出会导致编辑器失焦、选区丢失，
  // 上传完成回来插入时恢复原选区，保证图插在用户点按钮时的光标处
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    // mount 时显式复位：StrictMode 双调用场景下 cleanup 会误置 true（当前未开 StrictMode，防御写法）
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);

  // 仅在 value 与 editor 内部 HTML 不一致时才写入，避免打字过程中光标被重置
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (el.innerHTML !== (value || '')) {
      el.innerHTML = value || '';
    }
  }, [value]);

  const exec = (cmd: string, arg?: string) => {
    // 执行前必须 focus，否则 execCommand 对某些浏览器会失效
    editorRef.current?.focus();
    document.execCommand(cmd, false, arg);
    // 同步变更
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  /** 保存当前选区（用于文件选择器弹出失焦后恢复） */
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  /** 恢复选区并把光标置于编辑器内 */
  const restoreSelection = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    // 记录的选区容器必须仍在编辑器内——上传期间用户可能删掉了选区所在文本，
    // 把已脱离文档树的 Range addRange 回去会让图片插进 detached 子树静默丢失
    const saved = savedRange.current;
    if (saved && el.contains(saved.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(saved);
    } else {
      // 无有效记录：把光标放到末尾兜底
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  /** 上传图片并插入到当前选区（toolbar 按钮与粘贴共用） */
  const insertUploadedUrl = (url: string) => {
    restoreSelection();
    exec('insertImage', url);
  };

  const uploadAndInsert = async (file: File) => {
    setUploading(true);
    uploadingRef.current = true;
    try {
      const { data } = await announcementApi.uploadImage(file);
      if (unmountedRef.current || !editorRef.current) {
        // 编辑器已卸载（弹窗在上传期间被关闭）：放弃插入，避免脏节点进页面
        if (data?.url) message.warning('编辑器已关闭，图片未插入');
        return;
      }
      if (data?.url) {
        insertUploadedUrl(data.url);
      } else {
        message.error('图片上传失败：未返回地址');
      }
    } catch (e: any) {
      const detail = e?.response?.data?.details?.image?.[0] || e?.response?.data?.error;
      if (!unmountedRef.current) message.error(detail || '图片上传失败');
    } finally {
      setUploading(false);
      uploadingRef.current = false;
    }
  };

  const handlePickImage = () => {
    if (uploading) return;
    saveSelection();
    // 点击前清空 input，保证选同一张图也能触发 change
    if (fileInputRef.current) fileInputRef.current.value = '';
    fileInputRef.current?.click();
  };

  const handleLink = () => {
    const url = window.prompt('请输入链接 URL（以 https:// 开头）：', 'https://');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      // 主动给个提示，但仍允许执行（有些场景可能是相对路径）
      if (!window.confirm('链接未以 http(s):// 开头，确定继续吗？')) return;
    }
    exec('createLink', url);
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  // 粘贴：图片文件走上传插图；其余剥 style / class / script 只留纯文本
  // （避免粘贴 Word 等外部富文本带脏样式）
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.clipboardData.files || []);
    const imageFile = files.find((f) => /^image\//.test(f.type));
    if (imageFile) {
      // 上传中拒绝第二次粘贴插图：并发上传会恢复到同一旧选区插入，位置重叠/顺序颠倒
      if (uploadingRef.current) {
        message.warning('图片上传中，请稍候');
        return;
      }
      uploadAndInsert(imageFile);
      return;
    }
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
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
          <Tooltip title="有序列表">
            <Button size="small" type="text" icon={<OrderedListOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList'); }} />
          </Tooltip>
          <Tooltip title="无序列表">
            <Button size="small" type="text" icon={<UnorderedListOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }} />
          </Tooltip>
          <span style={{ width: 1, height: 16, background: '#e0e0e0', margin: '0 2px' }} />
          <Tooltip title="插入链接">
            <Button size="small" type="text" icon={<LinkOutlined />} onMouseDown={(e) => { e.preventDefault(); handleLink(); }} />
          </Tooltip>
          <Tooltip title="插入图片（PNG/JPG/WebP/GIF，≤5MB）">
            <Button size="small" type="text" icon={<PictureOutlined />} loading={uploading} onMouseDown={(e) => { e.preventDefault(); handlePickImage(); }} />
          </Tooltip>
          <Tooltip title="清除格式">
            <Button size="small" type="text" icon={<ClearOutlined />} onMouseDown={(e) => { e.preventDefault(); exec('removeFormat'); }} />
          </Tooltip>
        </Space>
        {/* 隐藏文件选择器：accept 与后端 mimetypes 白名单一致 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadAndInsert(f);
          }}
        />
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onBlur={handleInput}
        onPaste={handlePaste}
        onMouseUp={saveSelection}
        onKeyUp={saveSelection}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className="rich-text-editor-content"
        style={{
          minHeight,
          padding: 12,
          outline: 'none',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      />
      <style>{`
        .rich-text-editor-content:empty::before {
          content: attr(data-placeholder);
          color: #bfbfbf;
          pointer-events: none;
        }
        .rich-text-editor-content a { color: #1677ff; text-decoration: underline; }
        .rich-text-editor-content ul, .rich-text-editor-content ol { padding-left: 24px; margin: 4px 0; }
        .rich-text-editor-content p { margin: 4px 0; }
        /* 编辑区内的图片按容器等比缩放，与桌面端弹窗样式保持一致的视觉预期 */
        .rich-text-editor-content img { max-width: 100%; border-radius: 6px; }
      `}</style>
    </div>
  );
}
