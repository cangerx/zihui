import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'

export interface PromptCategory {
  id: string
  type: string
  name: string
  sort_order: number
  created_at: string
}

export interface PromptPreset {
  id: string
  category_id: string
  type: string
  label: string
  content: string
  is_builtin: number
  hidden: number
  sort_order: number
  created_at: string
}

// === Categories ===

export function listCategories(type?: string): PromptCategory[] {
  const db = getDatabase()
  if (type) {
    return db
      .prepare('SELECT * FROM prompt_categories WHERE type = ? ORDER BY sort_order, created_at')
      .all(type) as PromptCategory[]
  }
  return db
    .prepare('SELECT * FROM prompt_categories ORDER BY type, sort_order, created_at')
    .all() as PromptCategory[]
}

export function getCategory(id: string): PromptCategory | null {
  const db = getDatabase()
  return (
    (db.prepare('SELECT * FROM prompt_categories WHERE id = ?').get(id) as PromptCategory) || null
  )
}

export function createCategory(data: { type: string; name: string }): PromptCategory {
  const db = getDatabase()
  const id = uuid()
  const maxOrder = (
    db
      .prepare('SELECT MAX(sort_order) as m FROM prompt_categories WHERE type = ?')
      .get(data.type) as any
  )?.m || 0
  db.prepare(
    'INSERT INTO prompt_categories (id, type, name, sort_order) VALUES (?, ?, ?, ?)'
  ).run(id, data.type, data.name, maxOrder + 1)
  return getCategory(id)!
}

export function updateCategory(
  id: string,
  data: Partial<{ name: string; sort_order: number }>
): PromptCategory | null {
  const db = getDatabase()
  const existing = getCategory(id)
  if (!existing) return null
  const name = data.name ?? existing.name
  const sort_order = data.sort_order ?? existing.sort_order
  db.prepare('UPDATE prompt_categories SET name=?, sort_order=? WHERE id=?').run(
    name,
    sort_order,
    id
  )
  return getCategory(id)
}

export function deleteCategory(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM prompt_categories WHERE id = ?').run(id)
  return result.changes > 0
}

// === Presets ===

export function listPresets(type?: string): PromptPreset[] {
  const db = getDatabase()
  if (type) {
    return db
      .prepare('SELECT * FROM prompt_presets WHERE type = ? ORDER BY sort_order, created_at')
      .all(type) as PromptPreset[]
  }
  return db
    .prepare('SELECT * FROM prompt_presets ORDER BY type, sort_order, created_at')
    .all() as PromptPreset[]
}

export function listPresetsByCategory(categoryId: string): PromptPreset[] {
  const db = getDatabase()
  return db
    .prepare(
      'SELECT * FROM prompt_presets WHERE category_id = ? ORDER BY sort_order, created_at'
    )
    .all(categoryId) as PromptPreset[]
}

export function getPreset(id: string): PromptPreset | null {
  const db = getDatabase()
  return (
    (db.prepare('SELECT * FROM prompt_presets WHERE id = ?').get(id) as PromptPreset) || null
  )
}

export function createPreset(data: {
  category_id: string
  type: string
  label: string
  content: string
}): PromptPreset {
  const db = getDatabase()
  const id = uuid()
  const maxOrder = (
    db
      .prepare('SELECT MAX(sort_order) as m FROM prompt_presets WHERE category_id = ?')
      .get(data.category_id) as any
  )?.m || 0
  db.prepare(
    'INSERT INTO prompt_presets (id, category_id, type, label, content, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, data.category_id, data.type, data.label, data.content, maxOrder + 1)
  return getPreset(id)!
}

export function updatePreset(
  id: string,
  data: Partial<{ label: string; content: string; category_id: string; hidden: number; sort_order: number }>
): PromptPreset | null {
  const db = getDatabase()
  const existing = getPreset(id)
  if (!existing) return null
  const label = data.label ?? existing.label
  const content = data.content ?? existing.content
  const category_id = data.category_id ?? existing.category_id
  const hidden = data.hidden ?? existing.hidden
  const sort_order = data.sort_order ?? existing.sort_order
  db.prepare(
    'UPDATE prompt_presets SET label=?, content=?, category_id=?, hidden=?, sort_order=? WHERE id=?'
  ).run(label, content, category_id, hidden, sort_order, id)
  return getPreset(id)
}

export function deletePreset(id: string): boolean {
  const db = getDatabase()
  // Don't allow deleting builtin presets
  const preset = getPreset(id)
  if (preset?.is_builtin) return false
  const result = db.prepare('DELETE FROM prompt_presets WHERE id = ?').run(id)
  return result.changes > 0
}

// === Seed builtin image_gen presets ===

const BUILTIN_IMAGE_PRESETS = [
  {
    category: '修复',
    items: [
      { label: '老照片修复', content: '将这张老照片恢复为高清质量：修复色彩褪化和细节损失，保留原始面部特征，输出自然、清晰的现代照片效果' },
      { label: '模糊照片修复', content: '增强这张模糊照片的清晰度，恢复细节和锐度，保持自然观感，输出高分辨率清晰图像' }
    ]
  },
  {
    category: '人像',
    items: [
      { label: '人像精修', content: '对人像进行专业级精修：均匀肤色、去除瑕疵、增强五官立体感，保持自然真实，避免过度磨皮' },
      { label: '证件照优化', content: '将照片优化为专业证件照效果：端正构图、均匀光线、干净背景、自然肤色' }
    ]
  },
  {
    category: '产品',
    items: [
      { label: '产品精修', content: '将产品照片提升为商业级品质：增强材质质感和光影层次，背景干净简洁，突出产品细节' },
      { label: '电商白底图', content: '将产品置于纯白背景上，光线均匀柔和，突出产品轮廓和材质细节，适合电商展示' }
    ]
  },
  {
    category: '风景',
    items: [
      { label: '风景增强', content: '增强风景照片的视觉表现：优化色彩饱和度和对比度，增强天空和光影层次，保持自然真实感' },
      { label: 'HDR效果', content: '将照片处理为HDR高动态范围效果：增强暗部细节和高光层次，色彩丰富但自然' }
    ]
  },
  {
    category: '风格化',
    items: [
      { label: '电影色调', content: '将照片调整为电影感色调：增加质感颗粒、调整色温和对比度，营造cinematic氛围' },
      { label: '黑白艺术', content: '将照片转为高质量黑白艺术风格：强调光影对比和层次感，突出主体轮廓和纹理' }
    ]
  },
  {
    category: '通用增强',
    items: [
      { label: '画质提升', content: '全面提升图片画质：增强清晰度和细节，优化色彩和对比度，去除噪点，输出高分辨率效果' },
      { label: '光线优化', content: '优化照片光线：校正曝光不足或过曝区域，平衡高光和阴影，使整体光线自然均匀' }
    ]
  }
]

export function seedBuiltinPresets(): void {
  try {
    const db = getDatabase()
    const existing = db
      .prepare("SELECT COUNT(*) as c FROM prompt_presets WHERE type = 'image_gen' AND is_builtin = 1")
      .get() as any
    if (existing?.c > 0) return

    let catOrder = 0
    for (const cat of BUILTIN_IMAGE_PRESETS) {
      const catId = uuid()
      db.prepare(
        'INSERT INTO prompt_categories (id, type, name, sort_order) VALUES (?, ?, ?, ?)'
      ).run(catId, 'image_gen', cat.category, catOrder++)

      let itemOrder = 0
      for (const item of cat.items) {
        db.prepare(
          'INSERT INTO prompt_presets (id, category_id, type, label, content, is_builtin, sort_order) VALUES (?, ?, ?, ?, ?, 1, ?)'
        ).run(uuid(), catId, 'image_gen', item.label, item.content, itemOrder++)
      }
    }
  } catch (e) {
    console.error('Failed to seed builtin presets:', e)
  }
}
