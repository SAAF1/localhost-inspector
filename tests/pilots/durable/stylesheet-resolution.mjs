import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rename, symlink, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { prepareProject } from '../../../scripts/flow/prepare-project.mjs'
import { cssReady } from '../../../scripts/flow/prepared-css.mjs'
import { canvas, host, port } from './hosts.mjs'
const root = await realpath(await mkdtemp(join(tmpdir(), 'served-css-'))),
  app = join(root, 'app'),
  manifest = join(root, 'manifest.json'),
  map = join(root, 'canvas')
await mkdir(join(app, 'src'), { recursive: true })
await canvas(map)
await symlink(join(resolve(process.argv[2]), 'node_modules'), join(app, 'node_modules'))
const write = (name, code) => writeFile(join(app, name), code)
await write('package.json', '{"type":"module"}')
await write(
  'vite.config.js',
  `import {fileURLToPath} from 'node:url';export default {resolve:{alias:{'@css':fileURLToPath(new URL('./src',import.meta.url))}}}`,
)
await write('index.html', '<main></main><script type="module" src="/src/main.jsx"></script>')
await write(
  'src/main.jsx',
  `import React from 'react';import {createRoot} from 'react-dom/client';import '@css/entry.css';function Home(){return <div className="example">hello</div>}createRoot(document.querySelector('main')).render(<Home/>);window.show=()=>import('./lazy.jsx');`,
)
await write(
  'src/lazy.jsx',
  `import React from 'react';import './lazy.css';export function Late(){return <div className="later">late</div>}`,
)
await write('src/entry.css', "@import '@css/inside.css';")
await write('src/inside.css', '.example {display:grid;gap:var(--space-x)} :root {--space-x:13px}')
await write('src/dead.css', '.example {gap:99px} :root{--space-dead:1px}')
await write('src/lazy.css', '.later {gap:18px}')
const browser = await chromium.launch()
try {
  for (const name of ['inside', 'moved']) {
    if (name === 'moved') {
      await rename(join(app, 'src/inside.css'), join(app, 'src/moved.css'))
      await write('src/entry.css', "@import '@css/moved.css';")
    }
    const result = await prepareProject(app, manifest, 'pipeline')
    const s = result.sites.find((s) => s.owner === 'Home').styles[0],
      late = result.sites.find((s) => s.owner === 'Late').styles[0]
    assert.deepEqual(s.css.served, ['src/entry.css'])
    assert.equal(s.css.file, 'src/' + name + '.css')
    assert.ok(result.stylesheetGraph.sheets.find((s) => s.file === 'src/lazy.css').lazy)
    assert.ok(!JSON.stringify(result.sites).includes('dead.css'))
    assert.deepEqual(result.spacingSources, [{ file: 'src/' + name + '.css', names: ['--space-x'] }])
    const server = await host(app, map, manifest, await port())
    const p = await browser.newPage()
    try {
      p.on('pageerror', (e) => console.error(e.message))
      p.on('console', (m) => {
        if (m.type() === 'error') console.error(m.text())
      })
      await p.goto(server.origin)
      const check = (selector, key) =>
        p.locator(selector).evaluate((n, k) => getComputedStyle(n).getPropertyValue(k).trim(), key)
      assert.equal(await check('.example', 'gap'), '13px')
      assert.equal(await check('.example', cssReady(s)), '1')
      await p.evaluate(() => {
        const n = document.createElement('div')
        n.className = 'later'
        document.body.append(n)
      })
      assert.equal(await check('.later', cssReady(late)), '')
      await p.evaluate(() => window.show())
      assert.equal(await check('.later', cssReady(late)), '1')
      console.log('PASS emitted inlined CSS, alias, inactive/activated lazy style, dead duplicate, ' + name)
    } finally {
      await p.close()
      await server.close()
    }
  }
} finally {
  await browser.close()
}
