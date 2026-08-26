import axios from 'axios';

/**
 * docs-frontend API client。
 *
 * 所有请求都打到 /api/public/docs/*（无鉴权）。
 * baseURL 用相对路径让 dev 走 vite proxy，prod 走同域反代。
 *
 * timeout：常规请求 15s；chat 用 fetch + ReadableStream 读 SSE，不走 axios。
 */
const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

export type DocsConfig = {
  enabled: boolean;
  guest_access: boolean;
  site_title: string;
  rag_enabled: boolean;
  chat_allow_guest: boolean;
};

export type DocCategory = {
  id: number;
  name: string;
  slug: string | null;
  sort_order: number;
  docs_count: number;
};

export type DocListItem = {
  id: number;
  category_id: number;
  title: string;
  subtitle: string | null;
  slug: string | null;
  is_visible: boolean;
  sort_order: number;
  view_count: number;
  excerpt: string;
  created_at: string;
  updated_at: string;
  category?: { id: number; name: string; slug: string | null };
};

export type DocDetail = DocListItem & {
  content_html: string;
  content_plain?: string;
};

export type DocListResp = {
  items: DocListItem[];
  total: number;
  page: number;
  per_page: number;
  keyword?: string;
};

export const docsApi = {
  getConfig: () => api.get<DocsConfig>('/public/docs/config'),
  listCategories: () => api.get<{ data: DocCategory[] }>('/public/docs/categories'),
  list: (params?: {
    category_id?: number;
    category_slug?: string;
    keyword?: string;
    page?: number;
    per_page?: number;
  }) => api.get<DocListResp>('/public/docs/list', { params }),
  show: (idOrSlug: string | number) => api.get<DocDetail>(`/public/docs/${idOrSlug}`),
};

/**
 * RAG 流式问答：fetch + ReadableStream 读 SSE。
 *
 * 后端协议（统一简化格式，无 type 字段，按 payload 中存在哪个键判断事件类型）：
 *   data: {"citations":[{"index":1,"doc_id":12,"title":"...","slug":"..."}, ...]}  // 头部一次
 *   data: {"delta":"某段文本"}                                                   // 流过程多次
 *   data: {"done":true}                                                        // 末尾一次
 *   data: {"error":"code","message":"..."}                                     // 错误时先发
 *
 * 调用方传 onEvent 收到解析后的 typed event；返回 abort 函数。
 */
export type ChatCitation = {
  index: number;
  doc_id: number;
  title: string;
  slug: string | null;
};

export type ChatStreamEvent =
  | { kind: 'citations'; citations: ChatCitation[] }
  | { kind: 'delta'; delta: string }
  | { kind: 'done' }
  | { kind: 'error'; code: string; message: string };

/** 把后端原始 JSON payload 翻译成 typed event；不识别的 payload 返回 null */
function parseEvent(raw: unknown): ChatStreamEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.error === 'string') {
    return { kind: 'error', code: o.error, message: typeof o.message === 'string' ? o.message : '' };
  }
  if (Array.isArray(o.citations)) {
    return { kind: 'citations', citations: o.citations as ChatCitation[] };
  }
  if (typeof o.delta === 'string') {
    return { kind: 'delta', delta: o.delta };
  }
  if (o.done === true) {
    return { kind: 'done' };
  }
  return null;
}

export function streamChat(
  body: { query: string; session_id?: string },
  onEvent: (e: ChatStreamEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  const ctrl = new AbortController();

  // 自闭合 IIFE 用 fetch + ReadableStream 接 SSE
  (async () => {
    try {
      const resp = await fetch('/api/public/docs/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        onEvent({ kind: 'error', code: 'http_error', message: text || `HTTP ${resp.status}` });
        onEvent({ kind: 'done' });
        return;
      }
      if (!resp.body) {
        onEvent({ kind: 'error', code: 'no_stream', message: '当前环境不支持流式响应' });
        onEvent({ kind: 'done' });
        return;
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE：以 \n\n 分隔 event；每个 event 多行 "data: ..."，拼接 data 后 JSON.parse
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const dataLines = chunk.split('\n').filter((l) => l.startsWith('data:'));
          if (dataLines.length === 0) continue;
          const dataStr = dataLines.map((l) => l.slice(5).trimStart()).join('\n');
          if (!dataStr) continue;
          try {
            const obj = JSON.parse(dataStr);
            const ev = parseEvent(obj);
            if (ev) onEvent(ev);
          } catch (e) {
            console.warn('[docs] bad SSE chunk', dataStr, e);
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return; // 用户主动中断不报错
      onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  })();

  return () => ctrl.abort();
}
