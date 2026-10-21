// Persistent order for native UI lists (settings nav), kept apart from settings truth.
import fs from 'node:fs'

const MAX_LISTS = 64
const MAX_KEYS = 500

export function sanitizeLists(value) {
  const out = {}
  if (!value || typeof value !== 'object') return out
  let lists = 0
  for (const [id, keys] of Object.entries(value)) {
    if (lists >= MAX_LISTS) break
    const rid = String(id == null ? '' : id).trim()
    if (!rid || !Array.isArray(keys)) continue
    const clean = []
    for (const k of keys) {
      if (clean.length >= MAX_KEYS) break
      const s = String(k == null ? '' : k).trim()
      if (s) clean.push(s)
    }
    out[rid] = clean
    lists++
  }
  return out
}

export function readLists(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    return sanitizeLists(parsed && parsed.lists ? parsed.lists : parsed)
  } catch {
    return {}
  }
}

export function writeLists(file, lists) {
  const clean = sanitizeLists(lists)
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify({ version: 1, lists: clean }, null, 2), 'utf8')
  fs.renameSync(tmp, file)
  return clean
}
