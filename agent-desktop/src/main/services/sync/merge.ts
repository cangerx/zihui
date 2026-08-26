import { ENTITY_MAP } from './registry'
import { stableStringify, TIME_COLS } from './serializer'
import type { ConflictRecord, EntityPayload } from './types'

// 三路合并（base = 上次同步基线，local = 本机当前，remote = 云端当前）。
//   - 仅一方相对 base 改动 → 取该方
//   - 双方都改且不同 → 集合字段做集合并集；标量按 updated_ms LWW，并登记冲突（不静默丢数据）
// append-only 实体（messages）同一 uid 内容不可变，取较新即可。

function eq(a: any, b: any): boolean {
  return stableStringify(a ?? null) === stableStringify(b ?? null)
}

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : []
}

/** 集合三路合并：保留双方各自的增删意图。 */
function mergeSet(base: any, local: any, remote: any): any[] {
  const B = asArray(base)
  const L = asArray(local)
  const R = asArray(remote)
  const bset = new Set(B.map((x) => stableStringify(x)))
  const lset = new Set(L.map((x) => stableStringify(x)))
  const rset = new Set(R.map((x) => stableStringify(x)))

  const removed = new Set<string>()
  for (const k of bset) {
    if (!lset.has(k)) removed.add(k) // local 删
    if (!rset.has(k)) removed.add(k) // remote 删
  }

  const result: any[] = []
  const seen = new Set<string>()
  const pushUnique = (items: any[]) => {
    for (const it of items) {
      const key = stableStringify(it)
      if (removed.has(key) || seen.has(key)) continue
      seen.add(key)
      result.push(it)
    }
  }
  // 顺序：base 保留项 → local 新增 → remote 新增
  pushUnique(B)
  pushUnique(L.filter((x) => !bset.has(stableStringify(x))))
  pushUnique(R.filter((x) => !bset.has(stableStringify(x))))
  return result
}

export interface MergeResult {
  merged: EntityPayload
  conflicts: ConflictRecord[]
}

export function mergeEntity(
  base: EntityPayload | null,
  local: EntityPayload,
  remote: EntityPayload,
): MergeResult {
  const def = ENTITY_MAP[local.entity]
  const conflicts: ConflictRecord[] = []
  const now = Date.now()

  // append-only（如 messages）：同一 uid 内容本应一致；若两端确有差异（如分别编辑过同一条消息），
  // 取较新者并记录冲突，避免静默丢弃。
  if (def?.appendOnly) {
    const merged = remote.updated_ms >= local.updated_ms ? remote : local
    if (stableStringify(local.fields) !== stableStringify(remote.fields)) {
      conflicts.push({
        entity: local.entity,
        uid: local.uid,
        field: '(record)',
        localValue: stableStringify(local.fields),
        remoteValue: stableStringify(remote.fields),
        resolution: remote.updated_ms >= local.updated_ms ? 'remote' : 'local',
        ts_ms: now,
      })
    }
    return { merged, conflicts }
  }

  const setFields = new Set(def?.setFields || [])
  const secretFields = new Set(def?.secretFields || [])
  const baseFields = base?.fields || {}
  const fields: Record<string, any> = {}
  const keys = new Set([
    ...Object.keys(baseFields),
    ...Object.keys(local.fields),
    ...Object.keys(remote.fields),
  ])
  const remoteNewer = remote.updated_ms >= local.updated_ms

  for (const k of keys) {
    const bv = baseFields[k]
    const lv = local.fields[k]
    const rv = remote.fields[k]

    if (TIME_COLS.has(k)) {
      // 时间列任何一方编辑都会变，按 LWW 取胜者即可，不算业务冲突
      // （否则双端各改不同字段时每次合并都会产生一条 updated_at 伪冲突）
      fields[k] = remoteNewer ? (rv ?? lv ?? bv) : (lv ?? rv ?? bv)
      continue
    }

    const lc = !eq(lv, bv)
    const rc = !eq(rv, bv)

    if (!lc && !rc) {
      fields[k] = base ? bv : lv
    } else if (lc && !rc) {
      fields[k] = lv
    } else if (rc && !lc) {
      fields[k] = rv
    } else {
      // 双改
      if (eq(lv, rv)) {
        fields[k] = lv
      } else if (setFields.has(k)) {
        fields[k] = mergeSet(bv, lv, rv)
      } else {
        // 标量真冲突：LWW，记录被舍弃方（敏感字段只留掩码，不在冲突表存明文）
        const winner = remoteNewer ? rv : lv
        fields[k] = winner
        const masked = secretFields.has(k)
        conflicts.push({
          entity: local.entity,
          uid: local.uid,
          field: k,
          localValue: masked ? '«secret»' : stableStringify(lv),
          remoteValue: masked ? '«secret»' : stableStringify(rv),
          resolution: remoteNewer ? 'remote' : 'local',
          ts_ms: now,
        })
      }
    }
  }

  // 清除值为 undefined 的键：一方 payload 缺列时 LWW 可能选中 undefined，
  // 落库会被序列化为显式 NULL，撞 NOT NULL 约束（如 image_sessions.model_id）
  for (const k of Object.keys(fields)) {
    if (fields[k] === undefined) delete fields[k]
  }

  // blob 引用并集（未被引用的会在 apply/GC 阶段被忽略/回收）
  const blobMap = new Map<string, any>()
  for (const b of [...local.blobs, ...remote.blobs]) if (!blobMap.has(b.sha256)) blobMap.set(b.sha256, b)

  const merged: EntityPayload = {
    entity: local.entity,
    uid: local.uid,
    fields,
    blobs: [...blobMap.values()],
    updated_ms: Math.max(local.updated_ms, remote.updated_ms),
  }
  return { merged, conflicts }
}
