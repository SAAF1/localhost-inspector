import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { journalValidators } from '../../journal-records.mjs'
import { applyJournalOperation, journalSnapshot, requireRevision } from '../../journal-operations.mjs'
import { validRoute } from '../../journal-values.mjs'
import { variantCatalogs } from './variant-catalogs.mjs'

// Separate preview instances use separate stores. Conditional database updates
// also protect a canvas opened from two independent server processes.
function useDatabase(file, action) {
  const db = new DatabaseSync(file)
  try {
    db.exec('PRAGMA busy_timeout = 2000; CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, body TEXT NOT NULL)')
    return action(db)
  } finally { db.close() }
}

export function variantJournal(directory, id, { seed = 'edits.json', catalogs = variantCatalogs(directory), onEdit } = {}) {
  const file = join(directory, 'edits.sqlite')
  const routeKey = route => route.split('#').map(part => {
    const i = part.indexOf('?')
    if (i < 0) return part
    return part.slice(0, i) + '?~' + createHash('sha256').update(id + '\0' + part.slice(i + 1)).digest('hex')
  }).join('#')
  const validators = journalValidators(routeKey)

  async function read() {
    let data
    if (existsSync(file)) data = useDatabase(file, db => db.prepare('SELECT body FROM journal WHERE id = 1').get()?.body)
    if (!data) {
      try { data = await readFile(join(directory, seed), 'utf8') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    const journal = data ? JSON.parse(data) : { version: 1, revision: 0, edits: [] }
    if (journal.version !== 1 || !Number.isSafeInteger(journal.revision) || !Array.isArray(journal.edits)) throw Error('Unknown saved variant journal')
    return journal
  }

  return {
    async status() {
      const journal = await read()
      const hasEdits = Boolean(journal.edits.length || journal.textStyleDefinitions?.length)
      const fingerprint = hasEdits || journal.revision
        ? createHash('sha256').update(JSON.stringify(journal)).digest('hex') : null
      return { hasEdits, revision: journal.revision, fingerprint }
    },
    async hasEdits() {
      const journal = await read()
      return Boolean(journal.edits.length || journal.textStyleDefinitions?.length)
    },
    async handle(message) {
      if (!message || typeof message.type !== 'string') throw Error('Expected an Inspector operation')
      if (message.type === 'ping') return true
      if (message.type === 'check') return { id, visualEvidence: false }
      if (message.type.endsWith('Catalog')) return catalogs.get(message.type)
      const journal = await read()
      if (message.type === 'load') {
        if (!validRoute(message.route)) throw Error('Expected a route')
        return journalSnapshot(message, journal, routeKey, await catalogs.button())
      }
      requireRevision(message, journal)
      const baseline = JSON.stringify(journal)
      const { changed, value } = await applyJournalOperation(message, journal, { validators, journalRoute: routeKey,
        readCatalog: catalogs.read, readButtonSize: catalogs.button })
      if (changed) useDatabase(file, db => {
        db.prepare('INSERT OR IGNORE INTO journal VALUES (1, ?, ?)').run(message.expectedRevision, baseline)
        const result = db.prepare('UPDATE journal SET revision = ?, body = ? WHERE id = 1 AND revision = ?')
          .run(journal.revision, JSON.stringify(journal), message.expectedRevision)
        if (!result.changes) throw Object.assign(Error('Saved previews changed in another tab. Reload the page and try again.'), { code: 'STALE_JOURNAL' })
      })
      if (changed) onEdit?.()
      return value
    },
  }
}

export async function handleVariantInspector(request, response, address, journal) {
  function reply(status, body) {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    response.end(JSON.stringify(body))
  }
  if (request.method !== 'POST' || request.headers.origin !== address.origin ||
      request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    reply(403, { ok: false, error: 'Expected a same-origin Inspector request' })
    return
  }
  try {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 64000) { reply(413, { ok: false, error: 'Edit request too large' }); return }
      chunks.push(chunk)
    }
    const value = await journal.handle(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    reply(200, { ok: true, value })
  } catch (error) {
    reply(409, { ok: false, error: error.message, code: error.code === 'STALE_JOURNAL' ? error.code : 'WRITE_REJECTED' })
  }
}
