import { cp, link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile, lstat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const marker = 'canvas-project.json'
const captureFile = /^(map\.json|audit\.json|previews\.json|frame-\d+(?:\.png|-(desktop|tablet|phone)(-hug)?(-2x)?\.webp))$/
const validId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const missing = error => { if (error.code !== 'ENOENT') throw error }

async function projectBinding(project) {
  const source = await realpath(project)
  const id = createHash('sha256').update(source).digest('hex')
  return join(process.env.INSPECTOR_CANVAS_HOME || join(homedir(), '.localhost-inspector', 'canvases'), id + '.json')
}

export async function linkedCanvas(project) {
  const record = await json(await projectBinding(project)).catch(missing)
  if (record && !(await canvasProject(record.directory))) throw Error('Saved canvas directory is unavailable: ' + record.directory)
  return record?.directory
}

export async function canvasProject(directory) {
  if (!directory) return null
  const record = await json(join(directory, marker)).catch(missing)
  if (record && record.version !== 1) throw Error('Unsupported canvas version')
  return record
}

async function initCanvas(directory, map, project) {
  const target = resolve(directory)
  const root = await realpath(map)
  const parsed = await json(join(root, 'map.json'))
  if (!Array.isArray(parsed.frames)) throw Error('Expected a captured canvas map')
  await mkdir(dirname(target), { recursive: true })
  const parent = await realpath(dirname(target))
  if (parent === root || parent.startsWith(root + sep)) throw Error('Choose a canvas directory outside the capture')
  // Tests and disposable evaluations may explicitly use temporary locations.
  if (project) {
    const transient = await Promise.all([tmpdir(), '/tmp'].map(path => realpath(path).catch(missing)))
    if (transient.some(path => path && (parent === path || parent.startsWith(path + sep)))) throw Error('Choose a permanent directory for a linked project')
  }
  const stage = await mkdtemp(join(parent, '.canvas-import-'))
  try {
    for (const name of await readdir(root)) {
      if (captureFile.test(name)) await cp(join(root, name), join(stage, name))
    }
    await mkdir(join(stage, 'variants'))
    await writeFile(join(stage, marker), JSON.stringify({ version: 1 }))
    await rename(stage, target)
  } finally { await rm(stage, { recursive: true, force: true }) }
  if (project) await bindCanvas(target, project)
}

async function bindCanvas(directory, project) {
  if (!(await canvasProject(directory))) throw Error('Expected an initialized canvas')
  const path = await projectBinding(project)
  await mkdir(dirname(path), { recursive: true })
  await register(path, { directory: await realpath(directory) })
}

async function register(path, record) {
  const staging = path + '.' + randomUUID()
  try {
    await writeFile(staging, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    try { await link(staging, path) } catch (error) {
      if (error.code !== 'EEXIST' || JSON.stringify(await json(path)) !== JSON.stringify(record)) throw error
    }
  } finally { await rm(staging, { force: true }) }
}

async function add(directory, id, anchor, label, preview, route, source, section, note) {
  if (!(await canvasProject(directory))) throw Error('Expected an initialized canvas')
  if (!validId.test(id) || !label.trim() || !route.startsWith('/') || new URL(route, 'http://localhost').origin !== 'http://localhost') throw Error('Invalid variant ID, label or route')
  const map = await json(join(directory, 'map.json'))
  if (!map.frames.some(frame => frame.id === anchor)) throw Error('Unknown anchor frame')
  const root = await realpath(preview)
  const variants = await realpath(join(directory, 'variants'))
  if (variants === root || variants.startsWith(root + sep)) throw Error('Choose a built preview directory outside the canvas')
  if (!(await stat(join(root, 'index.html'))).isFile()) throw Error('Expected a built preview with index.html')
  const stage = await mkdtemp(join(variants, '.adding-'))
  try {
    await cp(root, join(stage, 'preview'), { recursive: true, filter: async source => {
      const item = await lstat(source)
      if (!item.isDirectory() && !item.isFile()) throw Error('Preview contains a link or special file: ' + basename(source))
      return true
    } })
    if (source) await register(join(stage, 'source.json'), { path: relative(await realpath(directory), await realpath(source)) })
    await writeFile(join(stage, 'frame.json'), JSON.stringify({ id, anchor, label, route, section, note, created: Date.now() }))
    await rename(stage, join(variants, id))
  } finally { await rm(stage, { recursive: true, force: true }) }
}

async function attachSource(directory, id, source) {
  if (!validId.test(id) || !(await canvasProject(directory))) throw Error('Expected a saved canvas frame')
  const frame = join(directory, 'variants', id)
  if ((await json(join(frame, 'frame.json'))).id !== id) throw Error('Unknown saved frame')
  await register(join(frame, 'source.json'), { path: relative(await realpath(directory), await realpath(source)) })
}

export async function canvasVariants(directory) {
  const names = await readdir(join(directory, 'variants'), { withFileTypes: true })
  const frames = await Promise.all(names.filter(item => item.isDirectory() && validId.test(item.name)).map(async item => {
    const frame = await json(join(directory, 'variants', item.name, 'frame.json'))
    if (frame.id !== item.name) throw Error('Mismatched saved frame ID')
    return frame
  }))
  return frames.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'components' && args.length === 3) {
    const { lookupComponents } = await import('./component-lookup.mjs')
    const { authoringGuidance } = await import('./authoring-guidance.mjs')
    console.log(JSON.stringify({ ...await lookupComponents(...args), authoringGuidance }, null, 2))
  }
  else if ((command === 'export' && (args.length === 3 || args.length === 4)) || (command === 'import' && args.length === 2)) {
    execFileSync('python3', [fileURLToPath(new URL('./canvas-archive.py', import.meta.url)), command, ...args], { stdio: 'inherit' })
  }
  else if (command === 'init' && (args.length === 2 || args.length === 3)) await initCanvas(...args)
  else if (command === 'bind' && args.length === 2) await bindCanvas(...args)
  else if (command === 'attach-source' && args.length === 3) await attachSource(...args)
  else if (command === 'add') {
    const options = new Map()
    while (args.at(-2) === '--section' || args.at(-2) === '--note') {
      const value = args.pop().trim()
      const flag = args.pop()
      if (!value || options.has(flag)) throw Error('Expected one value for ' + flag)
      options.set(flag, value)
    }
    if (args.length !== 6 && args.length !== 7) throw Error('Expected ID, anchor, label, preview and route')
    await add(...args.slice(0, 6), args[6], options.get('--section'), options.get('--note'))
  }
  else throw Error('Usage: canvas.mjs components PROJECT (--used-in SOURCE_FILE | --find COMPONENT_NAME) | export CANVAS ZIP BUILT_ORIGINAL [PORTABLE_INSPECTOR_STATE_JSON] | import ZIP NEW_CANVAS | init CANVAS MAP [APP_DIRECTORY] | bind CANVAS APP_DIRECTORY | attach-source CANVAS ID EDITABLE_SOURCE | add CANVAS ID ANCHOR LABEL BUILT_PREVIEW ROUTE [EDITABLE_SOURCE] [--section NAME] [--note TEXT]')
}
