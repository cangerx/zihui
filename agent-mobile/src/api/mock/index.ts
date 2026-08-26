/**
 * mock 路由：按 path 命中则返回 mock 响应，未命中返回 null 走真实网络。
 * 这样已联调的接口无需改代码即可逐个切真。
 */
import type { ApiResponse } from '../types'
import {
  appCategories,
  captchaMock,
  getAppDetailMock,
  loginMock,
  makeTemplates,
  queryWorkflowMock,
  runWorkflowMock,
} from './data'

type Handler = (argument?: Record<string, unknown>) => unknown

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const handlers: Record<string, Handler> = {
  'POST /auth/email/Login': () => loginMock,
  'POST /auth/email/Register': () => loginMock,
  'POST /auth/email/SedRegisterEmail': () => ({}),
  'GET /system/captcha/GetImageCaptcha': () => captchaMock,
  'POST /auth/wechat/Login': () => loginMock,

  'GET /ai/app/GetAppListByCategory': () => appCategories,
  'GET /ai/app/GetApp': (argument) => getAppDetailMock(String(argument?.uuid || '')),
  'POST /ai/app/worker/Run': () => runWorkflowMock(),
  'GET /ai/app/worker/Query': (argument) => queryWorkflowMock(String(argument?.task_uuid || '')),
  'POST /ai/app/worker/OptimizeTextToText': (argument) => ({
    text: `${String(argument?.text || '')}，画面干净通透，商业摄影质感，柔和自然光，突出商品质地与卖点`,
  }),
  'POST /ai/app/worker/OptimizeImageToText': () => ({
    text: '浅色纯净背景，商品居中，柔和顶光，轻微投影，商业电商主图风格',
  }),

  /* 以下为原型有、后端文档暂无的接口，前端先按预期契约 mock */
  'GET /template/GetTemplateList': (argument) => {
    const page = Number(argument?.page || 1)
    const list = makeTemplates(page, 20, {
      keyword: argument?.keyword ? String(argument.keyword) : undefined,
      tab: argument?.tab ? String(argument.tab) : undefined,
      sort: argument?.sort ? String(argument.sort) : undefined,
    })
    return { list, page, has_more: page < 5 }
  },
}

/** 返回 null 表示未 mock，交给真实网络 */
export async function resolveMock<T>(
  path: string,
  method: string,
  argument?: Record<string, unknown>,
): Promise<ApiResponse<T> | null> {
  const handler = handlers[`${method.toUpperCase()} ${path}`]
  if (!handler) return null
  await delay(200)
  return { code: 200, data: handler(argument) as T, message: 'ok' }
}
