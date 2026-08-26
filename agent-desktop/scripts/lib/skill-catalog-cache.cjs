'use strict'

const fs = require('fs')
const path = require('path')

function cachePath(root) {
  return path.join(root, 'cloud-skill-catalog.json')
}

function readCatalogCache(root) {
  const p = cachePath(root)
  if (!fs.existsSync(p)) return { cursor: '', items: [], keys: [], fetchedAt: null }
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'))
    return {
      cursor: String(parsed.cursor || ''),
      items: Array.isArray(parsed.items) ? parsed.items : [],
      keys: Array.isArray(parsed.keys) ? parsed.keys : [],
      fetchedAt: parsed.fetchedAt || null,
    }
  } catch {
    return { cursor: '', items: [], keys: [], fetchedAt: null }
  }
}

function writeCatalogCache(root, payload) {
  fs.mkdirSync(root, { recursive: true })
  const next = {
    cursor: String(payload.cursor || ''),
    items: Array.isArray(payload.items) ? payload.items : [],
    keys: Array.isArray(payload.keys) ? payload.keys : [],
    fetchedAt: payload.fetchedAt || new Date().toISOString(),
  }
  fs.writeFileSync(cachePath(root), JSON.stringify(next, null, 2))
  return next
}

function mergeInstalledOrigin(cacheItems, installedMeta) {
  return (cacheItems || []).map((item) => {
    const meta = installedMeta && (installedMeta[item.skill_id] || installedMeta[item.dir_name])
    if (!meta) return { ...item, installed: false, origin: 'cloud', reviewed: true }
    return { ...item, installed: true, origin: 'cloud', reviewed: true, dirName: meta.dirName || meta.dir_name }
  })
}

module.exports = { cachePath, readCatalogCache, writeCatalogCache, mergeInstalledOrigin }
