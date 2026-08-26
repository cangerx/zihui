/** 爆款复刻工程：拆解台分镜表 + 成片状态。 */

export const CLONE_DOC_KIND = 'haohuoban-clone' as const
export const CLONE_DOC_VERSION = 1

export type CloneGenerateStrategy = 'quick' | 'shots'
export type CloneShotStatus = 'idle' | 'running' | 'done' | 'error'

export interface CloneShot {
  id: string
  t0: number
  t1: number
  visual_prompt: string
  vo_text: string
  camera: string
  overlay: string
  /** 会话内缩略图，工程文件可不带 */
  thumbnail?: string
  task_id?: string
  status?: CloneShotStatus
  error?: string
  local_path?: string
}

export interface CloneProject {
  kind: typeof CLONE_DOC_KIND
  version: number
  source: {
    path: string
    name: string
    duration: number
    width: number
    height: number
    transcript?: string
    url?: string
  }
  shots: CloneShot[]
  product: { image_paths: string[] }
  generate: {
    strategy: CloneGenerateStrategy | ''
    protocol: string
    model: string
    sku_key: string
    mode: string
    resolution: string
    ratio: string
    duration_seconds: number
    per_shot_task_ids: string[]
    tts_enabled?: boolean
    tts_voice?: string
  }
  output: { local_path: string }
  updated_at: string
}

export function newShotId(): string {
  return `shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function createEmptyProject(): CloneProject {
  return {
    kind: CLONE_DOC_KIND,
    version: CLONE_DOC_VERSION,
    source: { path: '', name: '', duration: 0, width: 0, height: 0 },
    shots: [],
    product: { image_paths: [] },
    generate: {
      strategy: '',
      protocol: '',
      model: '',
      sku_key: '',
      mode: '',
      resolution: '',
      ratio: '',
      duration_seconds: 0,
      per_shot_task_ids: []
    },
    output: { local_path: '' },
    updated_at: new Date().toISOString()
  }
}

export function isCloneProject(value: unknown): value is CloneProject {
  if (!value || typeof value !== 'object') return false
  const doc = value as CloneProject
  return doc.kind === CLONE_DOC_KIND && Array.isArray(doc.shots)
}

export function formatTimecode(sec: number): string {
  const n = Number.isFinite(sec) ? Math.max(0, sec) : 0
  const m = Math.floor(n / 60)
  const r = n - m * 60
  return `${String(m).padStart(2, '0')}:${r.toFixed(1).padStart(4, '0')}`
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export function alignTranscriptToShots(shots: CloneShot[], segments: TranscriptSegment[]): CloneShot[] {
  if (!shots.length) return shots
  if (!segments.length) return shots
  return shots.map((shot) => {
    const parts = segments
      .filter((seg) => seg.end > shot.t0 && seg.start < shot.t1)
      .map((seg) => String(seg.text || '').trim())
      .filter(Boolean)
    return { ...shot, vo_text: parts.join(' ').trim() || shot.vo_text }
  })
}
