import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { streamChat, type ChatStreamEvent, type ChatCitation } from '../services/api';
import { useConfig } from '../contexts/ConfigContext';

/**
 * 右下角 RAG 问答悬浮窗。
 *
 * 设计取舍：
 * - 收起态：圆形按钮，文字"提问"
 * - 展开态：固定宽 380px，高 520px（移动端全屏）
 * - 消息显示：用户右对齐，AI 左对齐；流式 delta 实时追加 currentAnswer
 * - 引用文档：每条 AI 回复结束后追加，title 链到 /d/:slug
 * - session_id 用 sessionStorage 持久化，刷新页面保留同一会话
 * - rag_disabled / chat_allow_guest=false 时不挂载（AppShell 控制）
 *   但实际进入提问后仍可能 401（游客限制），错误一并显示在对话流里
 *
 * 不引依赖：自己实现简单的滚动到底 / 文本输入 / 流式状态管理。
 */

type ChatMsg = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 助手回复的引用文档；用户消息为 undefined */
  citations?: ChatCitation[];
  /** 是否还在流式生成（用于显示"思考中"光标） */
  pending?: boolean;
  /** 错误消息：失败的 AI 回复显示红色提示 */
  error?: string;
};

const SESSION_KEY = 'docs.chatSession';

function genSessionId(): string {
  // 优先 crypto.randomUUID，老浏览器兜底
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateSessionId(): string {
  try {
    const cached = sessionStorage.getItem(SESSION_KEY);
    if (cached) return cached;
    const id = genSessionId();
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // 隐私模式 / sessionStorage 被禁
    return genSessionId();
  }
}

export default function ChatWidget() {
  const config = useConfig();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string>(getOrCreateSessionId());

  // 自动滚到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // 卸载时中断流（切路由不会卸载，因为挂在 AppShell；但 rag 关闭会卸载）
  useEffect(() => () => { abortRef.current?.(); }, []);

  const handleSend = () => {
    const q = input.trim();
    if (!q || streaming) return;

    const userMsg: ChatMsg = { id: `u_${Date.now()}`, role: 'user', content: q };
    const aiId = `a_${Date.now()}`;
    const aiMsg: ChatMsg = { id: aiId, role: 'assistant', content: '', pending: true };

    setMessages((m) => [...m, userMsg, aiMsg]);
    setInput('');
    setStreaming(true);

    const onEvent = (e: ChatStreamEvent) => {
      setMessages((prev) => prev.map((m) => {
        if (m.id !== aiId) return m;
        if (e.kind === 'delta')      return { ...m, content: m.content + e.delta };
        if (e.kind === 'citations')  return { ...m, citations: e.citations };
        if (e.kind === 'done')       return { ...m, pending: false };
        if (e.kind === 'error')      return { ...m, pending: false, error: e.message || e.code };
        return m;
      }));
      if (e.kind === 'done') {
        setStreaming(false);
        abortRef.current = null;
      }
    };

    abortRef.current = streamChat(
      { query: q, session_id: sessionIdRef.current },
      onEvent,
      (err) => {
        setMessages((prev) => prev.map((m) =>
          m.id === aiId ? { ...m, pending: false, error: err.message || '请求失败' } : m
        ));
        setStreaming(false);
        abortRef.current = null;
      },
    );
  };

  const handleStop = () => {
    abortRef.current?.();
    abortRef.current = null;
    setStreaming(false);
    // 把最后一条 pending 的 AI 标记为已停止
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant' || !last.pending) return prev;
      return prev.map((m) => m === last ? { ...m, pending: false, error: '已停止' } : m);
    });
  };

  const handleClear = () => {
    if (streaming) {
      abortRef.current?.();
      abortRef.current = null;
      setStreaming(false);
    }
    setMessages([]);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送；Shift+Enter 换行（与主流 IM 一致）
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!open) {
    return (
      <button className="chat-fab" onClick={() => setOpen(true)} aria-label="打开问答">
        <span className="chat-fab-icon">问</span>
        <span className="chat-fab-text">问答助手</span>
      </button>
    );
  }

  return (
    <div className="chat-panel" role="dialog" aria-label="问答助手">
      <header className="chat-header">
        <span className="chat-title">{config.site_title || '文档'}问答</span>
        <div className="chat-header-actions">
          <button onClick={handleClear} disabled={streaming} title="清空对话">清空</button>
          <button onClick={() => setOpen(false)} aria-label="关闭">×</button>
        </div>
      </header>

      <div className="chat-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-greet">
            <p style={{ marginTop: 0 }}>你好，我可以根据文档回答你的问题。</p>
            <p style={{ color: '#666' }}>例如："怎么开通 VIP？" "如何接入 API？"</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            <div className="chat-bubble">
              {m.content || (m.pending ? <span className="chat-typing">思考中</span> : '')}
              {m.pending && m.content && <span className="chat-cursor" />}
              {m.error && <div className="chat-error">{m.error}</div>}
            </div>
            {m.role === 'assistant' && m.citations && m.citations.length > 0 && (
              <div className="chat-citations">
                <span className="chat-citations-label">参考：</span>
                {m.citations.map((c) => (
                  <Link
                    key={c.doc_id}
                    to={`/d/${c.slug || c.doc_id}`}
                    className="chat-citation"
                    onClick={() => setOpen(false)}
                  >
                    {c.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="chat-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={streaming ? '生成中...' : '输入问题，Enter 发送'}
          disabled={streaming}
          rows={2}
        />
        {streaming ? (
          <button className="chat-stop" onClick={handleStop}>停止</button>
        ) : (
          <button className="chat-send" onClick={handleSend} disabled={!input.trim()}>发送</button>
        )}
      </div>
    </div>
  );
}
