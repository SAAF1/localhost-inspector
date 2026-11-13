import { constants } from 'node:fs'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const stateArgument = process.argv[2]
const root = stateArgument && resolve(stateArgument)
const [mode, ...args] = process.argv.slice(3)
if (!root || !['bind', 'register-colors', 'register-spacing', 'status', 'serve'].includes(mode)) throw Error('Usage: local-helper.mjs <state-dir> bind <port> <repo-dir> | register-colors <port> <relative.css> <name>... | register-spacing <port> <relative.css> <name>... | status | serve')
await mkdir(root, { recursive: true, mode: 0o700 })
const configPath = join(root, 'bindings.json')
const keyPath = join(root, 'pairing-key')
const read = async (file, fallback) => readFile(file, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return fallback
  throw error
})
async function atomic(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp'
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await rename(temp, file)
}
function originFor(port) {
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || port === '5188') {
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

const variableName = /^--[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/
const catalogPath = (binding, kind) => join(root, binding.id + '-' + kind + '.json')

function declaresVariable(css, name) {
  return new RegExp('(?:^|[;{])\\s*' + name + '\\s*:').test(css)
}

async function verifyCatalog(binding, catalog) {
  const { source, names } = catalog
  if (typeof source !== 'string' || !source.endsWith('.css') || source.length > 400 || isAbsolute(source) ||
      !Array.isArray(names) || !names.length || names.length > 100 ||
      names.some(name => typeof name !== 'string' || !variableName.test(name))) {
    throw Error('Expected one relative CSS source and a list of CSS variable names')
  }
  const file = await realpath(resolve(binding.source, source))
  const child = relative(binding.source, file)
  if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) {
    throw Error('Variable source must be inside the connected working copy')
  }
  const info = await stat(file)
  if (!info.isFile() || info.size > 1024 * 1024) throw Error('Expected a CSS file under 1 MB')
  const css = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  for (const name of names) {
    if (!declaresVariable(css, name)) {
      throw Error('Variable source does not declare ' + name)
    }
  }
  return { source: child, names: [...new Set(names)], file, css }
}

async function readCatalog(binding, kind = 'colors') {
  const catalog = await read(catalogPath(binding, kind), null)
  return catalog && verifyCatalog(binding, catalog)
}

if (mode === 'register-colors' || mode === 'register-spacing') {
  const [port, source, ...names] = args
  const origin = originFor(port)
  const bindings = await read(configPath, {})
  const binding = bindings[origin]
  if (!binding) throw Error('No saved project connection for this origin')
  await verify(binding)
  const { source: verifiedSource, names: verifiedNames } = await verifyCatalog(binding, { source, names })
  const catalog = { source: verifiedSource, names: verifiedNames }
  await atomic(catalogPath(binding, mode === 'register-spacing' ? 'spacing' : 'colors'), catalog)
  console.log(JSON.stringify(catalog))
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

try { await writeFile(keyPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }) }
catch (error) { if (error.code !== 'EEXIST') throw error }
const key = (await readFile(keyPath, 'utf8')).trim()
let tail = Promise.resolve()
const pixelProperties = new Set(['font-size','line-height','letter-spacing','gap','width','height','min-width','max-width',
  'min-height','max-height','padding','padding-top','padding-right','padding-bottom','padding-left','border-radius','border-width'])
const keywords = {
  'flex-direction': ['row','column','row-reverse','column-reverse'],
  'justify-content': ['normal','start','center','end','space-between','space-around','space-evenly','stretch','flex-start','flex-end'],
  'align-items': ['normal','start','center','end','stretch','baseline','flex-start','flex-end'],
  'justify-items': ['normal','start','center','end','stretch'],
  'text-align': ['start','center','end','left','right','justify'],
}
// Chromium's serialized solid colors, including values used when detaching a token.
const modernColor = /^(?:oklch|oklab|lch|lab|color)\((?:[a-z][a-z0-9-]* )?[-\d.%e+ /]+\)$/i
const colors = new Set(['color','background-color','border-color'])
function validValue(property, value) {
  if (typeof value !== 'string' || value.length > 100) return false
  if (property === 'width' && ['100%', 'fit-content'].includes(value)) return true
  if (['min-width', 'min-height'].includes(property) && value === 'auto') return true
  if (['max-width', 'max-height'].includes(property) && value === 'none') return true
  if (pixelProperties.has(property)) return /^-?\d+(\.\d+)?px$/.test(value)
  if (property === 'font-weight') return /^(normal|bold|[1-9]00)$/.test(value)
  if (colors.has(property) && modernColor.test(value)) return true
  if (colors.has(property)) return /^(#[0-9a-f]{3,8}|rgba?\([\d.,% /]+\)|[a-z]{3,20})$/i.test(value)
  return Object.hasOwn(keywords, property) && keywords[property].includes(value)
}
function validTargetKey(key) {
  return key == null || (typeof key === 'string' && key.length <= 120 && key.trim().length > 0)
}
function editFrom(record, catalog) {
  const token = record?.colorToken
  const spacing = record?.spacingToken
  const pending = record?.pendingColor
  const reference = token ?? spacing
  const validRequest = reference
    ? !(token && spacing) && catalog && (spacing ? /^(gap|padding-(top|right|bottom|left))$/.test(record.property) : colors.has(record.property)) &&
      reference.source === catalog.source && catalog.names.includes(reference.name) &&
      record.requested === 'var(' + reference.name + ')' &&
      (!spacing || /^(?:\d+\.?\d*|\.\d+)px$/.test(record.observed) && Number.parseFloat(record.observed) <= 2000)
    : validValue(record?.property, record?.requested)
  const validPending = !pending || (!reference && catalog && record.property === 'background-color' &&
    typeof pending.label === 'string' && /^[a-z][a-z0-9 -]{0,79}$/i.test(pending.label) &&
    typeof pending.name === 'string' && variableName.test(pending.name) &&
    pending.name === '--' + pending.label.toLowerCase().replace(/ +/g, '-') &&
    pending.source === catalog.source && pending.value === record.requested && pending.value === record.observed &&
    /^(?:rgba?\(|(?:oklch|oklab|lch|lab|color)\()/i.test(pending.value))
  const target = record?.target
  if (!record || !/^[a-f0-9-]{36}$/.test(record.id) || typeof record.route !== 'string' ||
      !record.route.startsWith('/') || record.route.length > 2048 || !validRequest || !validPending ||
      !validValue(record.property, record.observed) || typeof record.before !== 'string' || record.before.length > 100 ||
      !['unique', 'ambiguous'].includes(record.restore) || !target || !/^[a-z][a-z0-9-]*$/.test(target.tag) ||
      !validTargetKey(target.key) || [target.id, target.slot, target.text].some(value => value !== null && (typeof value !== 'string' || value.length > 120))) {
    throw Error('Invalid edit record')
  }
  const { id, route, property, requested, observed, before, restore } = record
  const { width, height } = record.viewport ?? {}
  const viewport = Number.isInteger(width) && Number.isInteger(height) ? { width, height } : undefined
  const colorToken = token ? { source: token.source, name: token.name } : undefined
  const spacingToken = spacing ? { source: spacing.source, name: spacing.name } : undefined
  const pendingColor = pending ? { source: pending.source, name: pending.name, label: pending.label, value: pending.value } : undefined
  return { id, route, property, requested, observed, before, restore, target, viewport, colorToken, pendingColor, spacingToken, intent: 'selected occurrence only' }
}
async function handle(message) {
  if (message.type === 'ping') return true
  const bindings = await read(configPath, {})
  const binding = Object.hasOwn(bindings, message.origin) ? bindings[message.origin] : null
  if (!binding) throw Error('No saved project connection for this origin')
  await verify(binding)
  if (message.type === 'colorCatalog') {
    const catalog = await readCatalog(binding)
    if (!catalog) return null
    const { source, names, file } = catalog
    const canCreate = await access(file, constants.W_OK).then(() => true, () => false)
    return { source, names, canCreate }
  }
  if (message.type === 'spacingCatalog') {
    const catalog = await readCatalog(binding, 'spacing')
    return catalog && { source: catalog.source, names: catalog.names }
  }
  if (message.type === 'check') return { id: binding.id }
  const file = join(root, binding.id + '-changes.json')
  const journal = await read(file, { version: 1, revision: 0, binding, edits: [] })
  if (journal.binding.id !== binding.id || journal.binding.source !== binding.source) throw Error('Journal binding mismatch')
  if (message.type === 'load') return { revision: journal.revision, edits: journal.edits }
  if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision !== journal.revision) {
    const error = Error('Saved previews changed in another tab. Reload the page and try again.')
    error.code = 'STALE_JOURNAL'
    throw error
  }
  if (message.type === 'save') {
    const catalog = message.record?.spacingToken ? await readCatalog(binding, 'spacing') :
      message.record?.colorToken || message.record?.pendingColor ? await readCatalog(binding) : null
    const edit = editFrom(message.record, catalog)
    if (journal.edits.some(e => e.id === edit.id)) return { file, revision: journal.revision }
    if (edit.pendingColor) {
      const { name } = edit.pendingColor
      await access(catalog.file, constants.W_OK).catch(() => { throw Error('The color source is read-only.') })
      if (declaresVariable(catalog.css, name) ||
        journal.edits.some(entry => !entry.undone && entry.pendingColor?.name === name)) {
        throw Error('That variable name is already in use.')
      }
    }
    journal.edits.push(edit)
  } else if (message.type === 'undo') {
    const edit = journal.edits.find(e => e.id === message.id)
    if (!edit) throw Error('Edit was not found')
    if (edit.undone) return { file, revision: journal.revision }
    edit.undone = true
  } else if (message.type === 'reset') {
    if (typeof message.route !== 'string' || !message.route.startsWith('/')) throw Error('Expected a route')
    for (const edit of journal.edits) if (edit.route === message.route) edit.undone = true
  } else throw Error('Unknown operation')
  journal.revision++
  await atomic(file, journal)
  return { file, revision: journal.revision }
}
createServer(async (req, res) => {
  const authorization = Buffer.from(req.headers.authorization ?? '')
  const expected = Buffer.from('Bearer ' + key)
  const reply = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
  if (req.method !== 'POST' || req.url !== '/inspector' || req.headers.host !== '127.0.0.1:5188' ||
      authorization.length !== expected.length || !timingSafeEqual(authorization, expected)) {
    reply(403, { error: 'Pairing required' })
    return
  }
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 16000) throw Error('Request too large')
    }
    const message = JSON.parse(body)
    const task = tail.then(() => handle(message))
    tail = task.catch(() => {})
    reply(200, { value: await task })
  } catch (error) { reply(409, { error: error.message, code: error.code ?? 'WRITE_REJECTED' }) }
}).listen(5188, '127.0.0.1', () => console.log('Local inspector helper listening on 127.0.0.1:5188'))
