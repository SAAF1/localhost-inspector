import { helperHost, helperPort } from './helper-port.mjs'
import { constants } from 'node:fs'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { discoverVariablesCatalog } from './variables-catalog.mjs'
import { completeHandoff } from './complete-handoff.mjs'
import { declaresVariable, journalTarget, textStyleProperties, validRoute, variableName } from './journal-values.mjs'
import { journalValidators } from './journal-records.mjs'
import { applyJournalOperation, journalSnapshot, requireRevision } from './journal-operations.mjs'
import { buildSourceHandoff } from './source-handoff.mjs'
import { assertAuthoredReady, authoredResult, authoredTransactions, guardAuthoredJournalOperation, requireAuthoredCandidate } from './authored-transactions.mjs'
import { addVisualEvidence, maxEvidenceLength, removeVisualEvidence, saveVisualEvidence } from './visual-evidence.mjs'

const exec = promisify(execFile)
const stateArgument = process.argv[2]
const root = stateArgument && resolve(stateArgument)
const [mode, ...args] = process.argv.slice(3)
const catalogKinds = new Map([
  ['register-colors', 'colors'],
  ['register-spacing', 'spacing'],
  ['register-font-families', 'font-families'],
  ['register-text-styles', 'text-styles'],
])
if (!root || (!['bind', 'status', 'handoff', 'proposal-readiness', 'complete', 'serve', 'register-button-size', 'copy-registrations', 'visual-evidence', 'authorize-authored-use'].includes(mode) && !catalogKinds.has(mode))) {
  throw Error('Usage: local-helper.mjs <state-dir> bind <port> <repo-dir> | register-colors/register-spacing/register-font-families/register-text-styles <port> <relative.css> <name>... | register-button-size <port> <target-key> <relative-source> | copy-registrations <original-port> <proposal-port> | status | handoff <port> | complete <port> <report.json> | visual-evidence <port> on|off | serve')
}
if (!['handoff', 'proposal-readiness', 'complete'].includes(mode)) await mkdir(root, { recursive: true, mode: 0o700 })
const configPath = join(root, 'bindings.json')
const keyPath = join(root, 'pairing-key')
const read = async (file, fallback) => readFile(file, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return fallback
  throw error
})
async function atomic(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp'
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true })
  await rename(temp, file)
}
function printJson(value) {
  return new Promise((resolve, reject) => {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n', error => error ? reject(error) : resolve())
  })
}
function originFor(port) {
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || Number(port) === helperPort) {
    throw Error('Expected a local development port')
  }
  return 'http://127.0.0.1:' + port
}
async function verify(binding) {
  const port = new URL(binding.origin).port
  const listener = await exec('/usr/sbin/lsof', ['-nP', '-iTCP:' + port, '-sTCP:LISTEN', '-t'], { timeout: 1500 })
    .catch(() => { throw Error('No verified development server on this port') })
  const pids = [...new Set(listener.stdout.trim().split(/\s+/))]
  if (pids.length !== 1 || !/^\d+$/.test(pids[0])) throw Error('Multiple or unknown listeners')
  const proc = await exec('/usr/sbin/lsof', ['-a', '-p', pids[0], '-d', 'cwd', '-Fn'], { timeout: 1500 })
  const path = proc.stdout.split('\n').find(line => line.startsWith('n'))?.slice(1)
  if (!path || await realpath(path) !== binding.source) throw Error('This port is serving a different working copy')
}
if (mode === 'bind') {
  const [port, path] = args
  const origin = originFor(port)
  const source = await realpath(path)
  const bindings = await read(configPath, {})
  const existing = bindings[origin]
  if (existing && existing.source !== source) throw Error('This port is already paired to a different working copy')
  const binding = existing ?? { id: randomUUID(), origin, source }
  await verify(binding)
  bindings[origin] = binding
  await atomic(configPath, bindings)
  console.log(JSON.stringify(binding))
  process.exit(0)
}

if (mode === 'authorize-authored-use') {
  if (args.length !== 2) throw Error('Expected a candidate port and proposal directory')
  const origin = originFor(args[0])
  const directory = await realpath(args[1])
  const bindings = await read(configPath, {})
  const binding = bindings[origin]
  if (!binding) throw Error('No saved project connection for this origin')
  const { basis } = requireAuthoredCandidate(binding, directory)
  await verify(binding)
  binding.authoredUse = { directory, basis }
  await atomic(configPath, bindings)
  await printJson({ authoredUse: true })
  process.exit(0)
}

const catalogPath = (binding, kind) => join(root, binding.id + '-' + kind + '.json')
const catalogUnavailable = message => Object.assign(Error(message), { code: 'CATALOG_UNAVAILABLE' })

async function verifyCatalog(binding, catalog, kind) {
  const { source, names } = catalog
  if (typeof source !== 'string' || !source.endsWith('.css') || source.length > 400 || isAbsolute(source)) {
    throw Error('Expected one relative CSS source')
  }
  const file = await realpath(resolve(binding.source, source))
  const child = relative(binding.source, file)
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
    throw Error('Variable source must be inside the connected working copy')
  }
  const info = await stat(file)
  if (!info.isFile()) throw Error('Expected a CSS file')
  if (info.size > 1024 * 1024) throw catalogUnavailable('Catalog CSS exceeds 1 MB')
  if (!Array.isArray(names) || (kind !== 'text-styles' && !names.length) || names.length > 100 ||
      names.some(name => typeof name !== 'string' || !variableName.test(name))) {
    throw catalogUnavailable('Catalog needs supported CSS variable names and no more than 100 entries')
  }
  const css = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = kind === 'text-styles'
    ? names.flatMap(name => textStyleProperties.map(property => name + '-' + property))
    : names
  for (const name of declarations) {
    if (!declaresVariable(css, name)) throw catalogUnavailable('Variable source does not declare ' + name)
  }
  return { source: child, names: [...new Set(names)], file, css }
}

async function readCatalog(binding, kind = 'colors') {
  const catalog = await read(catalogPath(binding, kind), null)
  return catalog && verifyCatalog(binding, catalog, kind)
}

async function verifyPublishedDefinitions(binding, edits, projectStyles = []) {
  for (const [kind, property, command] of [
    ['colors', 'pendingColor', 'register-colors'],
    ['text-styles', 'pendingTextStyle', 'register-text-styles'],
  ]) {
    const definitions = edits.flatMap(edit => edit[property] ? [edit[property]] : [])
    if (property === 'pendingTextStyle' && projectStyles.length) {
      const references = new Set(edits.map(edit => edit.pendingTextStyleName))
      definitions.push(...projectStyles.filter(style => references.has(style.name)))
    }
    if (!definitions.length) continue
    const catalog = await readCatalog(binding, kind)
    for (const { name, source } of definitions) {
      if (catalog?.source !== source || !catalog.names.includes(name)) {
        throw Error('Add ' + name + ' to the registered ' + kind + ' catalog with ' + command +
          ' before completing this handoff. Keep the previously registered names.')
      }
    }
  }
}

if (catalogKinds.has(mode)) {
  const optional = args[0] === '--if-supported'
  const [port, source, ...names] = optional ? args.slice(1) : args
  const origin = originFor(port)
  const bindings = await read(configPath, {})
  const binding = bindings[origin]
  if (!binding) throw Error('No saved project connection for this origin')
  await verify(binding)
  const kind = catalogKinds.get(mode)
  const verified = await verifyCatalog(binding, { source, names }, kind).catch(error => {
    if (!optional || error.code !== 'CATALOG_UNAVAILABLE') throw error
    return { unavailable: error.message }
  })
  if (verified.unavailable) {
    await printJson(verified)
    process.exit(0)
  }
  const catalog = { source: verified.source, names: verified.names }
  await atomic(catalogPath(binding, kind), catalog)
  console.log(JSON.stringify(catalog))
  process.exit(0)
}

const buttonSizePath = binding => join(root, binding.id + '-button-size.json')

async function verifiedButtonSize(binding, key, source) {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9:_-]{1,120}$/.test(key) ||
      typeof source !== 'string' || source.length > 400 || isAbsolute(source) || !/\.[jt]sx$/.test(source)) {
    throw Error('Expected a stable Button key and one relative JSX or TSX source')
  }
  const file = await realpath(resolve(binding.source, source))
  const child = relative(binding.source, file)
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child) || !(await stat(file)).isFile()) {
    throw Error('Button source must be a file inside the connected working copy')
  }
  return { key, source: child }
}

async function readButtonSize(binding) {
  const registration = await read(buttonSizePath(binding), null)
  return registration && verifiedButtonSize(binding, registration.key, registration.source)
}

// Seed an isolated proposal with the original project's explicit design controls.
if (mode === 'copy-registrations') {
  const bindings = await read(configPath, {})
  const [original, proposal] = args.map(port => bindings[originFor(port)])
  if (!original || !proposal || original.id === proposal.id || args.length !== 2) throw Error('Expected two distinct bound apps')
  await Promise.all([verify(original), verify(proposal)])
  const skipped = []
  for (const kind of [...catalogKinds.values(), 'button-size']) {
    const path = binding => kind === 'button-size' ? buttonSizePath(binding) : catalogPath(binding, kind)
    const registration = await read(path(original), null)
    if (!registration || await read(path(proposal), null)) continue
    try {
      if (kind === 'button-size') await verifiedButtonSize(proposal, registration.key, registration.source)
      else await verifyCatalog(proposal, registration, kind)
    } catch (error) {
      skipped.push({ kind, reason: error.message })
      continue
    }
    await atomic(path(proposal), registration)
  }
  await printJson({ skipped })
  process.exit(0)
}

if (mode === 'register-button-size') {
  const [port, key, source] = args
  const bindings = await read(configPath, {})
  const binding = bindings[originFor(port)]
  if (!binding) throw Error('No saved project connection for this origin')
  await verify(binding)
  const registration = await verifiedButtonSize(binding, key, source)
  await atomic(buttonSizePath(binding), registration)
  console.log(JSON.stringify(registration))
  process.exit(0)
}

if (mode === 'visual-evidence') {
  const [port, state] = args
  if (!['on', 'off'].includes(state) || args.length !== 2) throw Error('Expected a port and on or off')
  const origin = originFor(port)
  const bindings = await read(configPath, {})
  const binding = bindings[origin]
  if (!binding) throw Error('No saved project connection for this origin')
  binding.visualEvidence = state === 'on'
  await atomic(configPath, bindings)
  console.log('Visual evidence ' + state + ' for ' + origin)
  process.exit(0)
}

if (mode === 'status') {
  const bindings = await read(configPath, {})
  for (const binding of Object.values(bindings)) {
    const file = join(root, binding.id + '-changes.json')
    const journal = await read(file, null)
    const connection = await verify(binding).then(() => 'verified', error => error.message)
    console.log(JSON.stringify({ ...binding, connection, journal: file, revision: journal?.revision ?? 0 }))
  }
  process.exit(0)
}

if (mode === 'handoff' || mode === 'proposal-readiness') {
  const origin = originFor(args[0])
  const bindings = await read(configPath, {})
  const binding = bindings[origin]
  if (!binding) throw Error('No saved project connection for this origin')
  // A retained proposal can be closed. Its saved journal still belongs to the
  // original binding, independent of which process now owns the old port.
  if (mode === 'handoff') await verify(binding)
  else if (binding.id !== args[1] || binding.source !== await realpath(args[2])) throw Error('This journal belongs to a different proposal.')
  const file = join(root, binding.id + '-changes.json')
  const journal = await read(file, { version: 2, revision: 0, binding, edits: [] })
  assertJournalBinding(journal, binding)
  if (journal.version !== 2) throw Error('Open Inspector to migrate this journal before exporting a handoff')
  await assertAuthoredReady(binding, file, journal, read)
  const handoff = buildSourceHandoff(binding, journal)
  for (const op of handoff.operations.filter(op=>op.scope === 'selected-use')) {
    const { verifySelectedUse } = await import('./scripts/flow/selected-use.mjs')
    try { verifySelectedUse(binding.source, op.changes[0].selectedUse) }
    catch { op.status='blocked'; op.reason='selected-source-changed' }
  }
  if (journal.textStyleDefinitions?.length) {
    const catalog = await readCatalog(binding, 'text-styles')
    const pending = journal.textStyleDefinitions.filter(style =>
      catalog?.source !== style.source || !catalog.names.includes(style.name))
    if (pending.length) {
      handoff.textStyleDefinitions = pending
      handoff.instructions = [...handoff.instructions,
        'Publish textStyleDefinitions as reusable styles in their recorded source and register their names. Create no element bindings unless an operation calls for one.']
    }
  }
  if (mode === 'proposal-readiness') {
    await printJson({ revision: journal.revision, pending: handoff.operations.length + (handoff.textStyleDefinitions?.length || 0) })
    process.exit(0)
  }
  await addVisualEvidence(root, binding, handoff)
  await printJson(handoff)
  process.exit(0)
}

if (mode === 'complete') {
  const [port, reportPath] = args
  if (args.length !== 2) throw Error('Expected a port and a completion report path')
  const origin = originFor(port)
  const report = await readFile(reportPath, 'utf8').then(JSON.parse)
  const pairingKey = (await readFile(keyPath, 'utf8')).trim()
  const response = await fetch('http://' + helperHost + '/inspector', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + pairingKey },
    body: JSON.stringify({ type: 'complete', origin, expectedRevision: report?.revision, report }),
    signal: AbortSignal.timeout(10_000),
  })
  const result = await response.json()
  if (!response.ok) {
    throw Error(result.code === 'STALE_JOURNAL'
      ? 'This handoff is stale. Export a fresh handoff and recheck the verified operations.' : result.error)
  }
  await printJson(result.value)
  process.exit(0)
}

try { await writeFile(keyPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
catch (error) { if (error.code !== 'EEXIST') throw error }
const key = (await readFile(keyPath, 'utf8')).trim()
let tail = Promise.resolve()
const maxRequestLength = 64_000
const maxEvidenceRequestLength = maxEvidenceLength + 4096
function journalRoute(route) {
  // Keep routes with different query values isolated without saving the values.
  // A hash router can have its own query as well as the document query.
  const hashIndex = route.indexOf('#')
  const parts = hashIndex < 0 ? [route] : [route.slice(0, hashIndex), route.slice(hashIndex + 1)]
  return parts.map(part => {
    const index = part.indexOf('?')
    if (index < 0) return part
    const digest = createHmac('sha256', key).update(part.slice(index + 1)).digest('hex')
    return part.slice(0, index) + '?~' + digest
  }).join('#')
}
function assertJournalBinding(journal, binding) {
  if (journal.binding?.id !== binding.id || journal.binding.source !== binding.source ||
      journal.binding.origin !== binding.origin) throw Error('Journal binding mismatch')
}
function migrateJournal(journal) {
  journal.edits = journal.edits.filter(edit => !edit.undone).map(edit => {
    const target = journalTarget(edit.target)
    if (!target.key && target.id && edit.target.text) {
      target.textFingerprint = createHash('sha256').update(edit.target.text).digest('hex')
    }
    return { ...edit, route: journalRoute(edit.route), target }
  })
  journal.version = 2
  journal.revision++
}
const validators = journalValidators(journalRoute)

// Catalogs are independent source reads. Requests arriving during the same
// listener check can share its result; later reads and all writes verify anew.
const startupCatalogs = new Set(['colorCatalog', 'fontFamilyCatalog', 'spacingCatalog', 'textStyleCatalog'])
const pendingVerifications = new Map()
function verifyRead(binding) {
  const key = JSON.stringify([binding.origin, binding.id, binding.source])
  if (!pendingVerifications.has(key)) {
    pendingVerifications.set(key, verify(binding).finally(() => pendingVerifications.delete(key)))
  }
  return pendingVerifications.get(key)
}

async function handle(message) {
  if (message.type === 'ping') return true
  const bindings = await read(configPath, {})
  const binding = Object.hasOwn(bindings, message.origin) ? bindings[message.origin] : null
  if (!binding) throw Error('No saved project connection for this origin')
  if (message.expectedBindingId && message.expectedBindingId !== binding.id) throw Error('Canvas helper binding changed')
  if (startupCatalogs.has(message.type) || message.type === 'load') await verifyRead(binding)
  else await verify(binding)
  if (message.type === 'variablesCatalog') {
    const [colorCatalog, spacingCatalog, textStyleCatalog] = await Promise.all([
      readCatalog(binding), readCatalog(binding, 'spacing'), readCatalog(binding, 'text-styles'),
    ])
    return discoverVariablesCatalog(binding.source, { colorCatalog, spacingCatalog, textStyleCatalog })
  }
  if (message.type === 'colorCatalog') {
    const catalog = await readCatalog(binding)
    if (!catalog) return null
    const { source, names, file } = catalog
    const canCreate = await access(file, constants.W_OK).then(() => true, () => false)
    return { source, names, canCreate }
  }
  if (message.type === 'fontFamilyCatalog') {
    const catalog = await readCatalog(binding, 'font-families')
    if (!catalog) return []
    return catalog.names.map(name => {
      // An inlined theme token may disappear from the served CSS. Only use
      // its source fallback when all declarations agree on the same value.
      const declaration = new RegExp('(?:^|[;{])\\s*' + name + '\\s*:\\s*([^;{}]+)', 'g')
      const values = new Set(Array.from(catalog.css.matchAll(declaration), match => match[1].trim()))
      return { name, fallback: values.size === 1 ? [...values][0] : null }
    })
  }
  if (message.type === 'spacingCatalog') {
    const catalog = await readCatalog(binding, 'spacing')
    return catalog && { source: catalog.source, names: catalog.names }
  }
  if (message.type === 'textStyleCatalog') {
    const catalog = await readCatalog(binding, 'text-styles')
    if (!catalog) return null
    const canCreate = await access(catalog.file, constants.W_OK).then(() => true, () => false)
    return { source: catalog.source, names: catalog.names, canCreate, canCreateDefinition: canCreate }
  }
  if (message.type === 'check') return { id: binding.id, visualEvidence: binding.visualEvidence === true }
  const file = join(root, binding.id + '-changes.json')
  const journal = await read(file, { version: 2, revision: 0, binding, edits: [] })
  assertJournalBinding(journal, binding)
  if (journal.version === 1) {
    migrateJournal(journal)
    await atomic(file, journal)
  }
  if (journal.version !== 2) throw Error('Unknown journal version')
  const authored = authoredTransactions({ binding, file, read, atomic, validators, readCatalog: kind => readCatalog(binding, kind) })
  if (binding.authoredUse) await authored.recover(journal)
  if (message.type === 'load') {
    if (binding.authoredUse) await authored.reportConflicts(journal)
    return journalSnapshot(message, journal, journalRoute, await readButtonSize(binding).catch(() => null), Boolean(binding.authoredUse))
  }
  if (message.type === 'saveEvidence') {
    if (!validRoute(message.route)) return false
    return saveVisualEvidence(root, binding, journal, message.id, journalRoute(message.route), message.image)
  }
  // Verification can already have rolled back the staged edit. Its retry
  // acknowledges the current snapshot without writing through a stale revision.
  if (binding.authoredUse && message.type === 'rejectAuthoredUse' && !journal.edits.some(edit =>
    edit.id === message.id && ['compiled', 'undoing'].includes(edit.sourceState))) {
    return authoredResult(journal)
  }
  requireRevision(message, journal)
  const nativeResult = await authored.handle(message, journal)
  if (nativeResult) return nativeResult
  guardAuthoredJournalOperation(message, journal)
  if (message.type === 'complete') {
    const originalEdits = journal.edits
    const { completed, retired } = completeHandoff(binding, journal, message.report, new Date().toISOString())
    const retiredIds = new Set(retired)
    await verifyPublishedDefinitions(binding, originalEdits.filter(edit => retiredIds.has(edit.id)), journal.textStyleDefinitions)
    journal.revision++
    await atomic(file, journal)
    const imageCleanupFailed = await removeVisualEvidence(root, binding, retired)
    return { revision: journal.revision, completed, imageCleanupFailed, reloadInspector: true }
  }
  if (message.type === 'save' && message.record?.selectedUse !== undefined) {
    if (!binding.authoredUse) throw Error('Selected source preview requires opt-in.')
    const { verifySelectedUse } = await import('./scripts/flow/selected-use.mjs')
    verifySelectedUse(binding.source,message.record.selectedUse)
  }
  if (message.type === 'save' && message.record?.recordScope !== undefined) {
    if (!binding.authoredUse) throw Error('Selected-record source preview requires opt-in.')
    const { verifyRecordSource } = await import('./scripts/flow/record-scope.mjs')
    verifyRecordSource(binding.source, message.record.recordScope)
  }
  const { changed, removed, value } = await applyJournalOperation(message, journal, { validators, journalRoute,
    readCatalog: kind => readCatalog(binding, kind), readButtonSize: () => readButtonSize(binding) })
  if (!changed) return { file, ...value }
  await atomic(file, journal)
  if (removed.length) await removeVisualEvidence(root, binding, removed.map(edit => edit.id))
  return { file, ...value,
    ...(binding.visualEvidence === true && ['save', 'saveTextStyle', 'saveSharedPadding', 'savePairedPadding'].includes(message.type) ? { visualEvidence: true } : {}),
  }
}
createServer(async (req, res) => {
  const authorization = Buffer.from(req.headers.authorization ?? '')
  const expected = Buffer.from('Bearer ' + key)
  const reply = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
  if (req.method !== 'POST' || req.url !== '/inspector' || req.headers.host !== helperHost ||
      authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
    reply(403, { error: 'Pairing required' })
    return
  }
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > maxEvidenceRequestLength) throw Error('Request too large')
    }
    const message = JSON.parse(body)
    if (body.length > maxRequestLength && message?.type !== 'saveEvidence') throw Error('Request too large')
    if (startupCatalogs.has(message.type)) {
      reply(200, { value: await handle(message) })
      return
    }
    const task = tail.then(() => handle(message))
    tail = task.catch(() => {})
    reply(200, { value: await task })
  } catch (error) { reply(409, { error: error.message, code: error.code ?? 'WRITE_REJECTED' }) }
}).listen(helperPort, '127.0.0.1', () => console.log('Local inspector helper listening on ' + helperHost))
