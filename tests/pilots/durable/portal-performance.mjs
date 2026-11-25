// One portal process per sample. Each gets private optimizer/browser caches.
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readdir, realpath, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'
import { prepareProject } from '../../../scripts/flow/prepare-project.mjs'
import { canvas, port } from './hosts.mjs'
const source = resolve(process.argv[2])
const serve = fileURLToPath(new URL('../../../scripts/flow/serve.mjs', import.meta.url))
const ms = (t) => Math.round(performance.now() - t)
for (const prepared of [false, true, true, false, false, true]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'portal-cost-'))),
    app = join(root, 'app'),
    manifest = join(root, 'manifest.json'),
    map = join(root, 'map')
  await mkdir(app)
  for (const file of await readdir(source))
    if (file === 'src' || file === 'index.html' || /^(?:package.*\.json|(?:vite|tsconfig).*)$/.test(file))
      await cp(join(source, file), join(app, file), { recursive: true })
  await mkdir(join(app, 'node_modules'))
  for (const name of await readdir(join(source, 'node_modules')))
    if (!name.startsWith('.')) await symlink(join(source, 'node_modules', name), join(app, 'node_modules', name))
  await canvas(map)
  let t = performance.now()
  if (prepared) await prepareProject(app, manifest, 'timing')
  const prepare = prepared ? ms(t) : 0,
    number = await port(),
    origin = 'http://127.0.0.1:' + number
  t = performance.now()
  const args = prepared
    ? [serve, '--source', app, String(number), map]
    : [join(app, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(number), '--strictPort']
  const child = spawn(process.execPath, args, {
    cwd: app,
    env: { ...process.env, DEBUG: 'vite:transform', INSPECTOR_PREPARED_SITES: manifest },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => (log += data))
  let b
  try {
    for (
      let i = 0;
      i < 450 && !(prepared ? log.includes('project preview listening') : log.includes('Local:'));
      i++
    ) {
      if (child.exitCode !== null) throw Error(log)
      await delay(10)
    }
    const startup = ms(t)
    t = performance.now()
    b = await chromium.launch()
    const p = await b.newPage()
    const browser = ms(t),
      nav = []
    for (let navigation = 0; navigation < 2; navigation++) {
      t = performance.now()
      await p.goto(origin)
      await p.getByRole('button', { name: 'Next', exact: true }).waitFor()
      nav.push(ms(t))
    }
    const transforms = log
      .split('\n')
      .filter((l) => l.includes('vite:transform') && /src\/(?:App\.tsx|index\.css)/.test(l))
      .map((l) =>
        l
          .replace(/\u001b\[[0-9;]*m/g, '')
          .split('vite:transform ')
          .at(-1),
      )
    console.log(JSON.stringify({ prepared, prepare, startup, browser, nav, transforms }))
  } finally {
    await b?.close()
    const end = once(child, 'exit')
    child.kill()
    await end
  }
}
