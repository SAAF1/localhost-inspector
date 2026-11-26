// Run a durable, isolated copy of a local app. The original checkout is read
// only. Each design uses the normal Inspector, helper and proposal source tree.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import {
  existsSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  copyFileSync,
  renameSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createProposal } from './proposal.mjs'
import { helperResult, sessionFile } from './proposal-journal.mjs'
import { prepareProject } from './flow/prepare-project.mjs'
import { forkableEdits, forkPrepared } from './fork-prepared.mjs'

const [directory, sourceArg, mapArg] = process.argv.slice(2)
if (!directory)
  throw Error('Usage: npm run preview:studio -- SESSION_DIRECTORY [INSTALLED_SHADCN_APP MAP_DIRECTORY]')
const root = resolve(directory),
  file = join(root, 'studio.json'),
  state = join(root, 'helper')
const repo = fileURLToPath(new URL('../', import.meta.url))
const children = new Set()
const startup = performance.now()
async function freePort() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((ok) => server.close(ok))
  return port
}
function write(path, value) {
  const temp = path + '.' + process.pid + '.tmp'
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
  renameSync(temp, path)
}
async function start(args, cwd, env, ready, onFork) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: onFork ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  if (onFork)
    child.on('message', async (message) => {
      if (message?.type !== 'fork-studio') return
      let reply
      try {
        reply = { origin: await onFork() }
      } catch (error) {
        reply = { error: error.message }
      }
      if (child.connected) child.send({ id: message.id, ...reply })
    })
  let log = ''
  child.stderr.on('data', (data) => {
    log = (log + data).slice(-3000)
  })
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      child.kill()
      fail(Error('Startup timeout ' + log))
    }, 30000)
    child.once('error', (e) => {
      clearTimeout(timer)
      fail(e)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      children.delete(child)
      fail(Error('Process exited ' + code + ' ' + log))
    })
    child.stdout.on('data', (data) => {
      log = (log + data).slice(-3000)
      if (log.includes(ready)) {
        clearTimeout(timer)
        ok()
      }
    })
  })
  return child
}
function stop() {
  for (const child of children) child.kill()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  let studio
  if (existsSync(file)) {
    studio = JSON.parse(readFileSync(file, 'utf8'))
    if (sourceArg && realpathSync(sourceArg) !== studio.source)
      throw Error('This studio belongs to a different app.')
  } else {
    if (!sourceArg) throw Error('A new studio needs an installed app checkout and its captured flow map.')
    mkdirSync(root, { recursive: false, mode: 0o700 })
    const source = realpathSync(sourceArg),
      map = mapArg ? realpathSync(mapArg) : join(root, 'entry-canvas')
    if (!mapArg) {
      mkdirSync(map)
      write(join(map, 'map.json'), {
        viewport: { width: 1440, height: 900 },
        frames: [{ id: 'frame-1', route: '/', label: 'Home', steps: [], checkpoint: [] }],
        connections: [],
        gaps: [],
      })
    }
    const namespace = 'local-studio'
    const versions = []
    for (const [id, label] of [
      ['original', 'Original'],
      ['a', 'Design A'],
      ['b', 'Design B'],
    ]) {
      const dir = join(root, id),
        parent = id === 'original' ? source : versions[0].app
      const { appRoot: app, basis } = createProposal(parent, dir)
      const port = await freePort(),
        origin = 'http://127.0.0.1:' + port
      versions.push({ id, label, port, origin, app, basis, directory: dir })
    }
    studio = {
      version: 1,
      authoredUses: process.env.INSPECTOR_AUTHORED_USE === '1',
      authoredUseSchema: process.env.INSPECTOR_AUTHORED_USE === '1' ? 2 : 0,
      source,
      map,
      namespace,
      boundary: process.env.INSPECTOR_SOURCE_BOUNDARY || 'src',
      helperPort: await freePort(),
      versions,
    }
    write(file, studio)
  }
  process.env.INSPECTOR_HELPER_PORT = String(studio.helperPort)
  await start([join(repo, 'local-helper.mjs'), state, 'serve'], repo, {}, 'helper listening')
  let forking = false
  let ready = false
  async function forkVersion(parent) {
    if (!ready || forking || studio.versions.length >= 8)
      throw Error('Studio is starting, copying another design, or at its eight-design limit.')
    forking = true
    try {
      const handoff = helperResult(state, 'handoff', String(parent.port))
      const revision = handoff.revision
      await forkableEdits(state, handoff, revision)
      const id = 'design-' + randomUUID().slice(0, 8),
        directory = join(root, id)
      const { appRoot: app, basis } = createProposal(parent.app, directory)
      const port = await freePort(),
        origin = 'http://127.0.0.1:' + port
      const version = {
        id,
        directory,
        app,
        basis,
        port,
        origin,
        label: 'Design ' + String.fromCharCode(64 + studio.versions.length),
        parent: parent.id,
      }
      await startVersion(version, revision)
      studio.versions.push(version)
      write(file, studio)
      for (const item of studio.versions) {
        const path = join(item.directory, 'canvas/map.json'),
          map = JSON.parse(readFileSync(path, 'utf8'))
        write(path, { ...map, designVersions: studio.versions.map(({ label, origin }) => ({ label, origin })) })
      }
      return origin
    } finally {
      forking = false
    }
  }
  async function startVersion(version, atRevision) {
    const { app, directory: dir, port, origin, id } = version
    const modules = join(app, 'node_modules')
    if (lstatSync(modules).isSymbolicLink()) {
      const installed = realpathSync(modules)
      unlinkSync(modules)
      mkdirSync(modules)
      for (const name of readdirSync(installed))
        if (!name.startsWith('.') || name === '.bin') symlinkSync(join(installed, name), join(modules, name))
    }
    const map = join(dir, 'canvas'),
      manifest = join(dir, 'prepared.json')
    mkdirSync(join(map, 'variants'), { recursive: true })
    if (!existsSync(join(map, 'canvas-project.json'))) write(join(map, 'canvas-project.json'), { version: 1 })
    const capturedMap = existsSync(join(studio.map, 'map.json'))
      ? studio.map
      : join(studio.versions[0].directory, 'canvas')
    const capture = JSON.parse(readFileSync(join(capturedMap, 'map.json'), 'utf8'))
    const designVersions = studio.versions.map(({ label, origin }) => ({ label, origin }))
    const original = studio.versions[0]
    const authoredBaseline = studio.authoredUses && id !== 'original'
      ? { origin: original.origin, basis: original.basis } : null
    write(join(map, 'map.json'), { ...capture, origin, designVersions, authoredBaseline })
    for (const name of readdirSync(capturedMap)) {
      if (
        !/^(?:(?:previews|audit)\.json|frame-\d+(?:\.png|-(?:desktop|tablet|phone)(?:-hug)?(?:-2x)?\.webp))$/.test(
          name,
        )
      )
        continue
      if (!existsSync(join(map, name)) && existsSync(join(capturedMap, name)))
        copyFileSync(join(capturedMap, name), join(map, name))
    }
    const inventory = await prepareProject(app, manifest, studio.namespace, studio.boundary)
    if (inventory.preparation?.preparedStyles === 'unavailable')
      console.warn('Shared stylesheet controls unavailable for ' + id + '. See diagnostics in ' + manifest)
    const child = await start(
      [join(repo, 'scripts/flow/serve.mjs'), '--source', app, String(port), map],
      app,
      {
        INSPECTOR_CANVAS_HELPER_STATE: state,
        INSPECTOR_PREPARED_SITES: studio.authoredUses && id === 'original' ? '' : manifest,
        INSPECTOR_AUTHORED_USE: authoredBaseline ? '1' : '0',
        INSPECTOR_AUTHORED_USE_SCHEMA: authoredBaseline ? String(studio.authoredUseSchema ?? 1) : '0',
        INSPECTOR_ORIGINAL_BASIS: studio.authoredUses && id === 'original' ? original.basis : '',
        INSPECTOR_VITE_CACHE: join(dir, 'vite-cache'),
      },
      'project preview listening',
      () => forkVersion(version),
    )
    try {
      const binding = helperResult(state, 'bind', String(port), app)
      if (authoredBaseline) helperResult(state, 'authorize-authored-use', String(port), dir)
      if (id === 'original') {
        const register = (kind, source, names) => {
          const result = helperResult(state, 'register-' + kind, '--if-supported', String(port), source, ...names)
          if (result.unavailable) console.warn('Optional ' + kind + ' catalog unavailable for ' + source + ': ' + result.unavailable)
        }
        const themes = inventory.variableSources.filter(({ names }) => names.some(name =>
          name === '--primary' || /^--space-[\w-]+$/.test(name)))
        const theme = themes.length === 1 ? themes[0] : null
        const spacing = theme?.names.filter(name => /^--space-[\w-]+$/.test(name)) ?? []
        if (!spacing.length && inventory.spacingSources?.length === 1) {
          const source = inventory.spacingSources[0]
          register('spacing', source.file, source.names)
        }
        if (spacing.length) register('spacing', theme.file, spacing)
        const colors = ['--primary', '--secondary', '--foreground', '--muted-foreground'].filter((name) =>
          theme?.names.includes(name),
        )
        if (colors.length) register('colors', theme.file, colors)
      } else if (!existsSync(sessionFile(dir))) {
        const parent = studio.versions.find((v) => v.id === (version.parent ?? 'original'))
        helperResult(state, 'copy-registrations', String(parent.port), String(port))
        const revision = atRevision ?? helperResult(state, 'handoff', String(parent.port)).revision
        await forkPrepared(state, parent.port, port, dir, revision)
        write(sessionFile(dir), { state, port: String(port), binding: binding.id })
      }
    } catch (error) {
      child.kill()
      throw error
    }
    console.log(
      id,
      inventory.sites.length + ' candidate sites',
      origin + '/__inspector-flow/?page=' + encodeURIComponent(capture.frames[0]?.route || '/'),
    )
  }
  for (const version of studio.versions) await startVersion(version)
  ready = true
  console.log('Studio ready', file, 'in', Math.round(performance.now() - startup), 'ms')
  while (children.size) await delay(1000)
} finally {
  stop()
}
