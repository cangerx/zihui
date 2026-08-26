/**
 * OpenAI 兼容服务商 API 地址规范化（main + renderer 共享）。
 *
 * 规则：
 *   1. 去前后空格 + 去尾部多余 /
 *   2. 若 URL 已含 `/v1` `/v2` `/v4` `/v1beta` 等任意版本号段 → 保持原样
 *   3. 否则自动追加 `/v1`（95% 的 OpenAI 兼容服务都需要 /v1）
 *
 * 保持与云控端 agent-admin/backend/app/Support/ApiBase.php 一致。
 * 任何一端修改规则，另一端必须同步。
 *
 * 典型对照：
 *   https://api.openai.com             → https://api.openai.com/v1
 *   https://api.openai.com/v1          → https://api.openai.com/v1
 *   https://api.openai.com/v1/         → https://api.openai.com/v1
 *   https://open.bigmodel.cn/api/paas/v4 → 原样（识别到 /v4）
 *   https://generativelanguage.googleapis.com/v1beta → 原样（识别到 /v1beta）
 *   http://localhost:11434             → http://localhost:11434/v1
 */
export function normalizeApiBase(url: string | null | undefined): string {
  const stripped = String(url ?? '').trim().replace(/\/+$/, '')
  if (!stripped) return ''
  // 已含任意版本号段（/v1 /v2 /v4 /v1beta 等）→ 原样返回
  if (/\/v\d+[a-z]*(\/|$)/i.test(stripped)) return stripped
  return stripped + '/v1'
}
