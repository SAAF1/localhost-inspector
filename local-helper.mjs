import { constants } from 'node:fs'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { access, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const stateArgument = process.argv[2]
const root = stateArgument && resolve(stateArgument)
const [mode, ...args] = process.argv.slice(3)
const catalogKinds = new Map([
  ['register-colors', 'colors'],
  ['register-spacing', 'spacing'],
  ['register-text-styles', 'text-styles'],
])
if (!root || (!['bind', 'status', 'serve', 'register-button-size'].includes(mode) && !catalogKinds.has(mode))) {
  throw Error('Usage: local-helper.mjs <state-dir> bind <port> <repo-dir> | register-colors/register-spacing/register-text-styles <port> <relative.css> <name>... | register-button-size <port> <target-key> <relative-source> | status | serve')
}
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
const textStyleProperties = ['font-family', 'font-weight', 'font-size', 'line-height', 'letter-spacing']

function declaresVariable(css, name) {
  return new RegExp('(?:^|[;{])\\s*' + name + '\\s*:').test(css)
}

async function verifyCatalog(binding, catalog, kind) {
  const { source, names } = catalog
  if (typeof source !== 'string' || !source.endsWith('.css') || source.length > 400 || isAbsolute(source) ||
      !Array.isArray(names) || (kind !== 'text-styles' && !names.length) || names.length > 100 ||
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
  const declarations = kind === 'text-styles'
    ? names.flatMap(name => textStyleProperties.map(property => name + '-' + property))
    : names
  for (const name of declarations) {
    if (!declaresVariable(css, name)) throw Error('Variable source does not declare ' + name)
  }
  return { source: child, names: [...new Set(names)], file, css }
}

async function readCatalog(binding, kind = 'colors') {
  const catalog = await read(catalogPath(binding, kind), null)
  return catalog && verifyCatalog(binding, catalog, kind)
}

if (catalogKinds.has(mode)) {
  const [port, source, ...names] = args
  const origin = originFor(port)
  const bindings = await read(configPath, {})
  const binding = bindings[origin]
  if (!binding) throw Error('No saved project connection for this origin')
  await verify(binding)
  const kind = catalogKinds.get(mode)
  const { source: verifiedSource, names: verifiedNames } = await verifyCatalog(binding, { source, names }, kind)
  const catalog = { source: verifiedSource, names: verifiedNames }
  await atomic(catalogPath(binding, kind), catalog)
  console.log(JSON.stringify(catalog))
  process.exit(0)
}

const buttonSizes = ['default', 'sm', 'lg', 'icon']
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
const maxRequestLength = 64_000
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
function validTextStyleValue(property, value) {
  if (typeof value !== 'string' || !value || value.length > 100) return false
  if (property === 'font-family') {
    // CSSOM family lists contain names and quoted names, not CSS functions.
    const family = /(?:"[^"\r\n\\{};]+"|'[^'\r\n\\{};]+'|[\p{L}\p{N}_-]+(?: +[\p{L}\p{N}_-]+)*)/u
    return new RegExp('^' + family.source + '(?: *, *' + family.source + ')*$', 'u').test(value)
  }
  if (property === 'font-weight') return /^\d+(?:\.\d+)?$/.test(value) && Number(value) >= 1 && Number(value) <= 1000
  if (property === 'line-height' || property === 'letter-spacing') {
    if (value === 'normal') return true
  }
  return /^-?\d+(?:\.\d+)?px$/.test(value) && (property === 'letter-spacing' || !value.startsWith('-'))
}
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
function validRoute(route) {
  return typeof route === 'string' && route.startsWith('/') && route.length <= 2048
}
function journalTarget({ tag, id, slot, key, textFingerprint }) {
  return { tag, id, slot, key, textFingerprint }
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
function editFrom(record, catalog, group, pendingTextStyle) {
  const textStyle = record?.textStyleToken
  const token = record?.colorToken
  const spacing = record?.spacingToken
  const pending = record?.pendingColor
  const reference = token ?? spacing
  const validTextStyleRequest = group && !reference && !pending &&
    textStyleProperties.includes(record?.property) && (
      pendingTextStyle
        ? !Object.hasOwn(record, 'textStyleToken') &&
          record.requested === 'var(' + pendingTextStyle.name + '-' + record.property + ', ' + pendingTextStyle.values[record.property] + ')' &&
          record.observed === pendingTextStyle.values[record.property]
        : Object.hasOwn(record, 'textStyleToken')
          ? textStyle && catalog && textStyle.source === catalog.source && catalog.names.includes(textStyle.name) &&
            record.requested === 'var(' + textStyle.name + '-' + record.property + ')'
          : validTextStyleValue(record.property, record.requested)
    )
  const validRequest = group ? validTextStyleRequest : reference
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
  if (!record || !/^[a-f0-9-]{36}$/.test(record.id) || !validRoute(record.route) || !validRequest || !validPending ||
      Object.hasOwn(record, 'group') || (!group && Object.hasOwn(record, 'textStyleToken')) ||
      ((Object.hasOwn(record, 'pendingTextStyle') || Object.hasOwn(record, 'pendingTextStyleName')) && !pendingTextStyle) ||
      !(group ? validTextStyleValue(record.property, record.observed) : validValue(record.property, record.observed)) ||
      typeof record.before !== 'string' || record.before.length > 100 ||
      !['unique', 'ambiguous'].includes(record.restore) || !target || !/^[a-z][a-z0-9-]*$/.test(target.tag) ||
      !validTargetKey(target.key) || [target.id, target.slot].some(value => value !== null && (typeof value !== 'string' || value.length > 120)) ||
      (target.textFingerprint !== undefined && !/^[a-f0-9]{64}$/.test(target.textFingerprint))) {
    throw Error('Invalid edit record')
  }
  const { id, route, property, requested, observed, before, restore } = record
  const { width, height } = record.viewport ?? {}
  const viewport = Number.isInteger(width) && Number.isInteger(height) ? { width, height } : undefined
  const colorToken = token ? { source: token.source, name: token.name } : undefined
  const spacingToken = spacing ? { source: spacing.source, name: spacing.name } : undefined
  const pendingColor = pending ? { source: pending.source, name: pending.name, label: pending.label, value: pending.value } : undefined
  const textStyleToken = textStyle ? { source: textStyle.source, name: textStyle.name } : undefined
  return { id, route: journalRoute(route), property, requested, observed, before, restore, target: journalTarget(target), viewport, colorToken, pendingColor, spacingToken, textStyleToken, group, intent: 'selected occurrence only' }
}
async function pendingTextStyleFrom(records, catalog, journal) {
  const pending = records[0]?.pendingTextStyle
  if (!pending) return null
  const { name, label, description, source, values } = pending
  if (!catalog || source !== catalog.source ||
      typeof label !== 'string' || !/^[a-z][a-z0-9 -]{0,69}$/i.test(label) || label !== label.trim() ||
      name !== '--text-' + label.toLowerCase().replace(/ +/g, '-') ||
      typeof description !== 'string' || description.length > 240 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description) ||
      !values || textStyleProperties.some(property => !validTextStyleValue(property, values[property]) ||
        (values[property].endsWith('px') && Math.abs(parseFloat(values[property])) > 2000))) {
    throw Error('Invalid new text style')
  }
  await access(catalog.file, constants.W_OK).catch(() => { throw Error('The text style source is read-only.') })
  if (catalog.names.includes(name) || declaresVariable(catalog.css, name) ||
      textStyleProperties.some(property => declaresVariable(catalog.css, name + '-' + property)) ||
      journal.edits.some(edit => edit.pendingTextStyle?.name === name)) {
    throw Error('That style name is already in use.')
  }
  return { name, label, description, source, values: Object.fromEntries(textStyleProperties.map(property => [property, values[property]])) }
}
async function textStyleEdits(records, catalog, journal) {
  if (!Array.isArray(records) || !records.length || records.length > 50 || !records[0]?.id) {
    throw Error('Expected 1 to 50 text style edits')
  }
  if (records.slice(1).some(record => record && (Object.hasOwn(record, 'pendingTextStyle') || Object.hasOwn(record, 'pendingTextStyleName')))) {
    throw Error('Expected one text style definition per edit group')
  }
  const [record] = records
  const reference = record.pendingTextStyleName
  if (reference !== undefined && (typeof reference !== 'string' || !validRoute(record.route) || record.pendingTextStyle)) {
    throw Error('Invalid pending text style reference')
  }
  const pending = reference === undefined ? await pendingTextStyleFrom(records, catalog, journal)
    : journal.edits.find(edit => edit.route === journalRoute(record.route) && edit.pendingTextStyle?.name === reference)?.pendingTextStyle
  if (reference !== undefined && (!pending || pending.source !== catalog?.source || catalog.names.includes(reference))) {
    throw Error('This pending text style is unavailable.')
  }
  const edits = records.map(record => editFrom(record, catalog, records[0].id, pending))
  const [first] = edits
  const ids = new Set(edits.map(edit => edit.id))
  if (ids.size !== edits.length || journal.edits.some(edit => ids.has(edit.id)) ||
      edits.some(edit => edit.route !== first.route || edit.textStyleToken?.name !== first.textStyleToken?.name)) {
    throw Error('Text style edits must use unique IDs, one route and one style')
  }
  if (pending) {
    if ((reference === undefined && (edits.length !== textStyleProperties.length || edits.some(edit => edit.before !== edit.observed))) ||
        new Set(edits.map(edit => edit.property)).size !== edits.length ||
        edits.some(edit => JSON.stringify(edit.target) !== JSON.stringify(first.target) || edit.restore !== first.restore)) {
      throw Error('Expected one complete new style on one text layer')
    }
    if (reference === undefined) first.pendingTextStyle = pending
    else first.pendingTextStyleName = reference
  }
  return edits
}
function buttonSizeEdit(record, registration) {
  if (!registration || !record || !/^[a-f0-9-]{36}$/.test(record.id) || !validRoute(record.route) ||
      record.target?.key !== registration.key || !buttonSizes.includes(record.before) ||
      !buttonSizes.includes(record.requested) || record.requested === record.before) {
    throw Error('Invalid Button Size edit')
  }
  return {
    id: record.id, route: journalRoute(record.route), property: 'button-size',
    target: { tag: 'button', id: null, slot: 'button', key: registration.key },
    before: record.before, requested: record.requested, observed: record.requested,
    restore: 'session', component: { name: 'Button', prop: 'size', source: registration.source },
    intent: 'selected occurrence only',
  }
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
  if (message.type === 'textStyleCatalog') {
    const catalog = await readCatalog(binding, 'text-styles')
    if (!catalog) return null
    const canCreate = await access(catalog.file, constants.W_OK).then(() => true, () => false)
    return { source: catalog.source, names: catalog.names, canCreate }
  }
  if (message.type === 'check') return { id: binding.id }
  const file = join(root, binding.id + '-changes.json')
  const journal = await read(file, { version: 2, revision: 0, binding, edits: [] })
  if (journal.binding.id !== binding.id || journal.binding.source !== binding.source) throw Error('Journal binding mismatch')
  if (journal.version === 1) {
    migrateJournal(journal)
    await atomic(file, journal)
  }
  if (journal.version !== 2) throw Error('Unknown journal version')
  if (message.type === 'load') {
    if (!validRoute(message.route)) throw Error('Expected a route')
    const route = journalRoute(message.route)
    const buttonSize = await readButtonSize(binding).catch(() => null)
    return { revision: journal.revision, route, edits: journal.edits.filter(edit => edit.route === route), buttonSizeKey: buttonSize?.key }
  }
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
        journal.edits.some(entry => entry.pendingColor?.name === name)) {
        throw Error('That variable name is already in use.')
      }
    }
    journal.edits.push(edit)
  } else if (message.type === 'saveButtonSize') {
    const edit = buttonSizeEdit(message.record, await readButtonSize(binding))
    if (journal.edits.some(entry => entry.id === edit.id)) return { file, revision: journal.revision }
    journal.edits.push(edit)
  } else if (message.type === 'saveTextStyle') {
    const first = message.records?.[0]
    const catalog = first?.textStyleToken || first?.pendingTextStyle || first?.pendingTextStyleName ? await readCatalog(binding, 'text-styles') : null
    journal.edits.push(...await textStyleEdits(message.records, catalog, journal))
  } else if (message.type === 'undo') {
    const edit = journal.edits.find(e => e.id === message.id)
    if (!edit) throw Error('Edit was not found')
    journal.edits = journal.edits.filter(member => member !== edit && !(edit.group && member.group === edit.group))
  } else if (message.type === 'reset') {
    if (!validRoute(message.route)) throw Error('Expected a route')
    const route = journalRoute(message.route)
    journal.edits = journal.edits.filter(edit => edit.route !== route)
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
      if (body.length > maxRequestLength) throw Error('Request too large')
    }
    const message = JSON.parse(body)
    const task = tail.then(() => handle(message))
    tail = task.catch(() => {})
    reply(200, { value: await task })
  } catch (error) { reply(409, { error: error.message, code: error.code ?? 'WRITE_REJECTED' }) }
}).listen(5188, '127.0.0.1', () => console.log('Local inspector helper listening on 127.0.0.1:5188'))
