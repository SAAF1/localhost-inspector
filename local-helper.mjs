import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const stateArgument = process.argv[2]
const root = stateArgument && resolve(stateArgument)
const [mode, ...args] = process.argv.slice(3)
if (!root || !['bind', 'status', 'serve'].includes(mode)) throw Error('Usage: local-helper.mjs <state-dir> bind <port> <repo-dir> | status | serve')
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
const colors = new Set(['color','background-color','border-color'])
function validValue(property, value) {
  if (typeof value !== 'string' || value.length > 100) return false
  if (property === 'width' && ['100%', 'fit-content'].includes(value)) return true
  if (pixelProperties.has(property)) return /^-?\d+(\.\d+)?px$/.test(value)
  if (property === 'font-weight') return /^(normal|bold|[1-9]00)$/.test(value)
  if (colors.has(property)) return /^(#[0-9a-f]{3,8}|rgba?\([\d.,% /]+\)|[a-z]{3,20})$/i.test(value)
  return Object.hasOwn(keywords, property) && keywords[property].includes(value)
}
function editFrom(record) {
  const target = record?.target
  if (!record || !/^[a-f0-9-]{36}$/.test(record.id) || typeof record.route !== 'string' ||
      !record.route.startsWith('/') || record.route.length > 2048 || !validValue(record.property, record.requested) ||
      !validValue(record.property, record.observed) || typeof record.before !== 'string' || record.before.length > 100 ||
      !['unique', 'ambiguous'].includes(record.restore) || !target || !/^[a-z][a-z0-9-]*$/.test(target.tag) ||
      [target.id, target.slot, target.text].some(value => value !== null && (typeof value !== 'string' || value.length > 120))) {
    throw Error('Invalid edit record')
  }
  const { id, route, property, requested, observed, before, restore } = record
  const { width, height } = record.viewport ?? {}
  const viewport = Number.isInteger(width) && Number.isInteger(height) ? { width, height } : undefined
  return { id, route, property, requested, observed, before, restore, target, viewport, intent: 'selected occurrence only' }
}
async function handle(message) {
  if (message.type === 'ping') return true
  const bindings = await read(configPath, {})
  const binding = Object.hasOwn(bindings, message.origin) ? bindings[message.origin] : null
  if (!binding) throw Error('No saved project connection for this origin')
  await verify(binding)
  if (message.type === 'check') return { id: binding.id }
  const file = join(root, binding.id + '-changes.json')
  const journal = await read(file, { version: 1, revision: 0, binding, edits: [] })
  if (journal.binding.id !== binding.id || journal.binding.source !== binding.source) throw Error('Journal binding mismatch')
  if (message.type === 'load') return journal.edits
  if (message.type === 'save') {
    const edit = editFrom(message.record)
    if (journal.edits.some(e => e.id === edit.id)) return { file, revision: journal.revision }
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
  } catch (error) { reply(409, { error: error.message }) }
}).listen(5188, '127.0.0.1', () => console.log('Local inspector helper listening on 127.0.0.1:5188'))
