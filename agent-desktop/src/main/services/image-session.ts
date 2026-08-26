import { getDatabase } from '../database'
import { v4 as uuid } from 'uuid'

export interface ImageSession {
  id: string
  title: string
  model_provider_id: string | null
  model_id: string
  created_at: string
  updated_at: string
}

export function listImageSessions(): ImageSession[] {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM image_sessions ORDER BY updated_at DESC')
    .all() as ImageSession[]
}

export function getImageSession(id: string): ImageSession | null {
  const db = getDatabase()
  return (
    (db.prepare('SELECT * FROM image_sessions WHERE id = ?').get(id) as ImageSession) || null
  )
}

export function createImageSession(data?: {
  title?: string
  model_provider_id?: string
  model_id?: string
}): ImageSession {
  const db = getDatabase()
  const id = uuid()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO image_sessions (id, title, model_provider_id, model_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data?.title || 'New Image',
    data?.model_provider_id || null,
    data?.model_id || '',
    now,
    now
  )
  return getImageSession(id)!
}

export function updateImageSession(
  id: string,
  data: Partial<{ title: string; model_provider_id: string; model_id: string }>
): ImageSession | null {
  const db = getDatabase()
  const existing = getImageSession(id)
  if (!existing) return null

  const title = data.title ?? existing.title
  const model_provider_id = data.model_provider_id ?? existing.model_provider_id
  const model_id = data.model_id ?? existing.model_id
  const now = new Date().toISOString()

  db.prepare(
    'UPDATE image_sessions SET title=?, model_provider_id=?, model_id=?, updated_at=? WHERE id=?'
  ).run(title, model_provider_id, model_id, now, id)
  return getImageSession(id)
}

export function deleteImageSession(id: string): boolean {
  const db = getDatabase()
  const result = db.prepare('DELETE FROM image_sessions WHERE id = ?').run(id)
  return result.changes > 0
}
