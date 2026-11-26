import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { readProposal } from './scripts/proposal.mjs'
import { authoredModulePath } from './scripts/flow/authored-module-route.mjs'
import { parseAuthoredJsx } from './scripts/flow/authored-forwarding.mjs'

export const authoredError = message => Object.assign(Error(message), { code: 'AUTHORED_SOURCE_REJECTED' })
export const conflict = message => Object.assign(Error(message), { code: 'AUTHORED_SOURCE_CONFLICT' })
export const revision = text => createHash('sha256').update(text).digest('hex')
export const absent = error => {
  if (error.code !== 'ENOENT') throw error
  return null
}

export function requireAuthoredCandidate(binding, directory = binding.authoredUse?.directory) {
  if (!directory) throw authoredError('Source edits require an authorized candidate.')
  const draft = readProposal(directory)
  if (draft.status !== 'draft' || draft.appRoot !== binding.source ||
      (binding.authoredUse && binding.authoredUse.basis !== draft.basis)) {
    throw conflict('This source is no longer an authorized candidate.')
  }
  return draft
}

export async function requireWritableCandidate(binding) {
  const draft = requireAuthoredCandidate(binding)
  const closing = await lstat(join(binding.authoredUse.directory, '.accepting')).catch(absent)
  if (closing) throw conflict('Wait for the candidate source review to finish.')
  return draft
}

export function patchText(text, { start, before, after }) {
  if (!Number.isSafeInteger(start) || start < 0 || text.slice(start, start + before.length) !== before) {
    throw conflict('The authored source patch no longer matches its original text.')
  }
  return text.slice(0, start) + after + text.slice(start + before.length)
}

export async function source(root, file) {
  if (typeof file !== 'string' || !/\.[jt]sx$/.test(file) || isAbsolute(file) ||
      file.split(/[\\/]/).some(part => !part || ['.', '..', '.git', 'node_modules'].includes(part))) {
    throw authoredError('Expected one candidate JSX or TSX file.')
  }
  const path = resolve(root, file)
  const canonical = await realpath(path)
  if (canonical !== path || relative(root, canonical).startsWith('..' + sep)) {
    throw conflict('The authored source path changed.')
  }
  const stat = await lstat(path)
  if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw authoredError('Expected an ordinary source file under 2 MB.')
  return { path, stat, text: await readFile(path, 'utf8') }
}

export async function replaceSource(binding, patch, forward) {
  const { path, stat, text } = await source(binding.source, patch.file)
  const beforeRevision = forward ? patch.beforeRevision : patch.afterRevision
  const afterRevision = forward ? patch.afterRevision : patch.beforeRevision
  if (revision(text) !== beforeRevision) throw conflict('The candidate source changed during this operation.')
  const change = forward ? patch.patch : { start: patch.patch.start, before: patch.patch.after, after: patch.patch.before }
  const next = patchText(text, change)
  if (revision(next) !== afterRevision) throw authoredError('The authored source receipt is inconsistent.')
  const temp = path + '.inspector-' + randomUUID() + '.tmp'
  await writeFile(temp, next, { flag: 'wx', mode: stat.mode & 0o777, flush: true })
  try {
    await requireWritableCandidate(binding)
    const current = await source(binding.source, patch.file)
    if (current.stat.ino !== stat.ino || current.stat.dev !== stat.dev || current.text !== text) {
      throw conflict('The candidate source changed during this operation.')
    }
    await rename(temp, path)
  } finally { await unlink(temp).catch(absent) }
}

function hasCompiledBinding(code, edit) {
  // In V2 the operation chooses an action independently from the use marker.
  // Match the exact emitted descriptor, without the receipt-only action field.
  const { family, ...use } = edit
  if (edit.schema === 2 && !edit.actions?.includes(family)) return false
  const expected = JSON.stringify(edit.schema === 2 ? use : edit)
  const attribute = 'data-li-authored-use'
  const nodes = [parseAuthoredJsx(code).program]
  while (nodes.length) {
    const node = nodes.pop()
    if (node.type === 'ObjectProperty' && !node.computed && node.key.value === attribute &&
        node.value.type === 'StringLiteral' && node.value.value === expected) return true
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) nodes.push(...value.filter(child => child?.type))
      else if (value?.type) nodes.push(value)
    }
  }
  return false
}

export async function compile(binding, edit, expectedRevision, afterWrite = false) {
  const url = new URL(authoredModulePath(edit.file), binding.origin)
  const signal = AbortSignal.timeout(3500)
  const stillOwned = async () => {
    if (revision((await source(binding.source, edit.file)).text) !== expectedRevision) {
      throw conflict('The candidate source changed before compilation finished.')
    }
  }
  // The watcher can invalidate Vite's old compiled module after the source
  // rename completes. Retry a stale module only while our source is present.
  for (const wait of afterWrite ? [0, 25, 45, 80, 120] : [0]) {
    if (wait) await delay(wait, undefined, { signal })
    await stillOwned()
    url.searchParams.set('t', String(Date.now()))
    const response = await fetch(url, { signal, redirect: 'error' })
    const javascript = /(?:java|ecma)script/i.test(response.headers.get('content-type') ?? '')
    if (!response.ok || !javascript) {
      await response.body?.cancel()
      throw authoredError('Vite did not serve a compiled module for the candidate edit.')
    }
    const body = await response.text()
    if (hasCompiledBinding(body, edit)) {
      await stillOwned()
      return
    }
  }
  throw authoredError('The compiled candidate module did not carry the expected authored use.')
}
