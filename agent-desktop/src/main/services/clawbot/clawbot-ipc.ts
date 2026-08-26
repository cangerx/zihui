// clawbot:* IPC handlers。由 ipc/index.ts 的 registerIpcHandlers 传入（已 wrapWithEpoch）的 ipcMain 注册。
// 凭据脱敏在本层完成：bot_token 密文/明文永不下发渲染层（Summary 视图不含密文）。
// 使用权限（allow_clawbot，默认拒绝）在本层对「变更类」handler 强制执行；
// 只读 handler（getState/listPeers/listLogs 等）不拦截，保证页面可浏览但不可用。

import * as bridge from './clawbot-bridge'
import * as login from './clawbot-login'
import { getAllowClawbot } from '../cloud-token'

interface IpcLike {
  handle(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any
  ): void
}

/** 使用权限守卫：无 allow_clawbot 权限时变更类操作一律拒绝（默认拒绝，含老云控端不下发该键的场景） */
function assertClawbotAllowed(): void {
  if (!getAllowClawbot()) {
    throw new Error('当前账号未开通「微信 ClawBot」使用权限，请联系管理员开通')
  }
}

export function registerClawbotIpc(ipcMain: IpcLike): void {
  // 连接状态机 + 登录状态机 + 统计（主视图轮询/订阅刷新用）
  ipcMain.handle('clawbot:getState', () => bridge.getClawbotState())

  // ===== 扫码登录 =====
  // 状态推进（qr_ready/scaned/need_verifycode/confirmed/error）经 clawbot:status 广播
  ipcMain.handle('clawbot:startLogin', () => {
    assertClawbotAllowed()
    bridge.startLoginFlow().catch((e) => console.error('[clawbot] login flow failed:', e))
    return { ok: true }
  })
  ipcMain.handle('clawbot:cancelLogin', () => {
    bridge.cancelLoginFlow()
    return { ok: true }
  })
  ipcMain.handle('clawbot:submitVerifyCode', (_, code: string) => {
    assertClawbotAllowed()
    bridge.submitVerifyCode(String(code || ''))
    return { ok: true }
  })
  ipcMain.handle('clawbot:logout', () => {
    // 登出/解绑属清理动作，不卡权限（无权场景下也应允许清掉残留绑定）
    bridge.logoutClawbot()
    return { ok: true }
  })

  // ===== 智能体绑定 =====
  ipcMain.handle('clawbot:bindBot', (_, botId: string) => {
    assertClawbotAllowed()
    bridge.bindBot(String(botId || ''))
    return { ok: true }
  })
  ipcMain.handle('clawbot:createDefaultBot', () => {
    assertClawbotAllowed()
    return bridge.createDefaultBotAndBind()
  })

  // ===== 开关与管理 =====
  ipcMain.handle('clawbot:setEnabled', (_, enabled: boolean) => {
    assertClawbotAllowed()
    bridge.setBridgeEnabled(!!enabled)
    return { ok: true }
  })
  ipcMain.handle('clawbot:listPeers', () => bridge.listPeerSummaries())
  ipcMain.handle('clawbot:resetPeerConversation', (_, peerRowId: string) => {
    assertClawbotAllowed()
    bridge.resetPeerConversation(String(peerRowId || ''))
    return { ok: true }
  })
  ipcMain.handle('clawbot:listLogs', (_, before?: string, limit?: number) =>
    bridge.listBridgeLogs(before || undefined, limit || undefined)
  )

  // ===== 审批白名单 =====
  ipcMain.handle('clawbot:getApprovalPolicy', () => bridge.getApprovalPolicy())
  ipcMain.handle('clawbot:setApprovalPolicy', (_, patch: Partial<bridge.ApprovalPolicy>) => {
    assertClawbotAllowed()
    return bridge.setApprovalPolicy(patch || {})
  })
  ipcMain.handle('clawbot:getImageDefaults', () => bridge.getClawbotImageDefaults())
  ipcMain.handle('clawbot:setImageDefaults', (_, input: Partial<bridge.ClawbotImageDefaults>) => {
    assertClawbotAllowed()
    return bridge.setClawbotImageDefaults(input || {})
  })

  // 登录状态机只读快照（进入页面时恢复二维码/配对码界面用）
  ipcMain.handle('clawbot:getLoginState', () => login.getLoginState())
}
