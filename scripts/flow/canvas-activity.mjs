import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const activityFile = 'variant-activity.sqlite'

export function canvasActivity(directory, variants) {
  const answers = new Map()
  const file = join(directory, activityFile)
  if (existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      db.exec('PRAGMA busy_timeout = 2000')
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'responses'").get()) {
        for (const { id, at } of db.prepare('SELECT id, at FROM responses').all()) answers.set(id, at)
      }
    } finally { db.close() }
  }
  return variants.map(({ id, anchor, label, section, note, created, respondedAt }) => ({
    id, anchor, label, section, note,
    created: Number.isSafeInteger(created) ? created : 0,
    respondedAt: answers.get(id) ?? (Number.isSafeInteger(respondedAt) ? respondedAt : null),
  }))
}

export function recordResponse(directory, activity, ids) {
  const byId = new Map(activity.map(item => [item.id, item]))
  if (!ids.length || ids.some(id => !byId.has(id))) throw Error('Supply exact saved variant IDs from canvas activity.')
  const pending = [...new Set(ids)].filter(id => byId.get(id).respondedAt === null)
  if (!pending.length) return
  const db = new DatabaseSync(join(directory, activityFile))
  try {
    db.exec('PRAGMA busy_timeout = 2000; BEGIN IMMEDIATE')
    db.exec('CREATE TABLE IF NOT EXISTS responses (id TEXT PRIMARY KEY, at INTEGER NOT NULL)')
    const insert = db.prepare('INSERT OR IGNORE INTO responses (id, at) VALUES (?, ?)')
    const at = Date.now()
    for (const id of pending) insert.run(id, at)
    db.exec('COMMIT')
  } finally { db.close() }
}
