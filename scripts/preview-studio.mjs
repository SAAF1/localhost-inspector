// Run a durable, isolated copy of a local app. The original checkout is read
// only. Each design uses the normal Inspector, helper and proposal source tree.
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  copyFileSync,
  renameSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createProposal } from './proposal.mjs'
import { helperResult, sessionFile } from './proposal-journal.mjs'
import { prepareProject } from './flow/prepare-project.mjs'
import { forkPrepared } from './fork-prepared.mjs'

const [directory, sourceArg, mapArg] = process.argv.slice(2)
if (!directory)
  throw Error('Usage: npm run preview:studio -- SESSION_DIRECTORY [INSTALLED_SHADCN_APP MAP_DIRECTORY]')
const root = resolve(directory),
  file = join(root, 'studio.json'),
  state = join(root, 'helper')
const repo = fileURLToPath(new URL('../', import.meta.url))
const children = new Set()
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
async function start(args, cwd, env, ready) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  let log = ''
  child.stderr.on('data', (data) => {
    log = (log + data).slice(-3000)
  })
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(Error('Startup timeout ' + log)), 30000)
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
    if (!sourceArg || !mapArg)
      throw Error('A new studio needs an installed app checkout and its captured flow map.')
    mkdirSync(root, { recursive: false, mode: 0o700 })
    const source = realpathSync(sourceArg),
      map = realpathSync(mapArg)
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
    studio = { version: 1, source, map, namespace, helperPort: await freePort(), versions }
    write(file, studio)
  }
  process.env.INSPECTOR_HELPER_PORT = String(studio.helperPort)
  await start([join(repo, 'local-helper.mjs'), state, 'serve'], repo, {}, 'helper listening')
  for (const version of studio.versions) {
    const { app, directory: dir, port, origin, id } = version
    const map = join(dir, 'canvas'),
      manifest = join(dir, 'prepared.json')
    mkdirSync(join(map, 'variants'), { recursive: true })
    if (!existsSync(join(map, 'canvas-project.json'))) write(join(map, 'canvas-project.json'), { version: 1 })
    const capture = JSON.parse(readFileSync(join(studio.map, 'map.json'), 'utf8'))
    const designVersions = studio.versions.map(({ label, origin }) => ({ label, origin }))
    write(join(map, 'map.json'), { ...capture, origin, designVersions })
    for (const name of readdirSync(studio.map)) {
      if (
        !/^(?:(?:previews|audit)\.json|frame-\d+(?:\.png|-(?:desktop|tablet|phone)(?:-hug)?(?:-2x)?\.webp))$/.test(
          name,
        )
      )
        continue
      if (!existsSync(join(map, name)) && existsSync(join(studio.map, name)))
        copyFileSync(join(studio.map, name), join(map, name))
    }
    const inventory = prepareProject(app, manifest, studio.namespace)
    await start(
      [join(repo, 'scripts/flow/serve.mjs'), '--source', app, String(port), map],
      app,
      {
        INSPECTOR_CANVAS_HELPER_STATE: state,
        INSPECTOR_PREPARED_SITES: manifest,
        INSPECTOR_VITE_CACHE: join(dir, 'vite-cache'),
      },
      'project preview listening',
    )
    const binding = helperResult(state, 'bind', String(port), app)
    if (id === 'original') {
      const theme = 'src/styles/theme.css'
      const css = readFileSync(join(app, theme), 'utf8')
      const spacing = [...new Set([...css.matchAll(/(--space-[\w-]+)\s*:/g)].map((m) => m[1]))]
      if (spacing.length) helperResult(state, 'register-spacing', String(port), theme, ...spacing)
      const colors = ['--primary', '--secondary', '--foreground', '--muted-foreground'].filter((name) =>
        css.includes(name + ':'),
      )
      if (colors.length) helperResult(state, 'register-colors', String(port), theme, ...colors)
    } else if (!existsSync(sessionFile(dir))) {
      const parent = studio.versions[0]
      helperResult(state, 'copy-registrations', String(parent.port), String(port))
      const revision = helperResult(state, 'handoff', String(parent.port)).revision
      await forkPrepared(state, parent.port, port, dir, revision)
      write(sessionFile(dir), { state, port: String(port), binding: binding.id })
    }
    console.log(id, inventory.sites.length + ' candidate sites', origin + '/__inspector-flow/?page=/tasks')
  }
  console.log('Studio ready', file)
  while (children.size) await delay(1000)
} finally {
  stop()
}
