// 主进程内部事件总线：跨模块低耦合通知（不碰 IPC/渲染层）。
// 当前唯一事件：会话新增 assistant 消息——ClawBot 桥据此做「事件驱动」的补发，
// 替代纯轮询 watcher 猜窗口（生图等 fire-and-forget 后台任务完成时刻精确可知）。

import { EventEmitter } from 'events'

const bus = new EventEmitter()
bus.setMaxListeners(50)

export const EVT_ASSISTANT_APPENDED = 'chat:assistant-appended'

/** 会话新增一条 assistant 消息（core-tools 后台任务落库后发出；payload=conversationId） */
export function emitAssistantAppended(conversationId: string): void {
  try {
    bus.emit(EVT_ASSISTANT_APPENDED, conversationId)
  } catch {
    /* 监听器异常不影响主流程 */
  }
}

/** 订阅「会话新增 assistant 消息」；返回退订函数（桥停止时必须退订防泄漏） */
export function onAssistantAppended(fn: (conversationId: string) => void): () => void {
  bus.on(EVT_ASSISTANT_APPENDED, fn)
  return () => {
    try {
      bus.off(EVT_ASSISTANT_APPENDED, fn)
    } catch {
      /* ignore */
    }
  }
}
