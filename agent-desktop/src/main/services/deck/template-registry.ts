import type { SlideTemplate, TemplateManifestEntry } from './types'
import { coverTemplate } from './templates/cover'
import { agendaTemplate } from './templates/agenda'
import { sectionTemplate } from './templates/section'
import { bulletsTemplate } from './templates/bullets'
import { twoColumnTemplate } from './templates/two-column'
import { kpiTemplate } from './templates/kpi'

// app 内置基础受控模板集(D12: 内置 3-5 套保离线; 此处 6 套覆盖核心版式)。
// 其余 217 套走按需云缓存(template-manager + 云控端 pptdemo 资产), 不打进 app。
export const BASE_TEMPLATES: SlideTemplate[] = [
  coverTemplate,
  agendaTemplate,
  sectionTemplate,
  bulletsTemplate,
  twoColumnTemplate,
  kpiTemplate
]

const BY_ID: Map<string, SlideTemplate> = new Map(BASE_TEMPLATES.map((t) => [t.id, t]))

export function getTemplate(id: string): SlideTemplate | undefined {
  return BY_ID.get(id)
}

/** 供 LLM 选型 / 云端 manifest 的轻量元数据(不含 render 函数) */
export function listManifest(): TemplateManifestEntry[] {
  return BASE_TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    description: t.description,
    schema: t.schema
  }))
}
