import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { host, canvas, port, editor } from './hosts.mjs'
const root = await mkdtemp(join(tmpdir(), 'inspector-fidelity-')),
  app = join(root, 'app'),
  map = join(root, 'canvas'),
  manifest = join(root, 'manifest.json')
await mkdir(app)
await canvas(map)
await symlink(join(resolve(process.argv[2]), 'node_modules'), join(app, 'node_modules'))
await writeFile(join(app, 'package.json'), '{"type":"module"}')
await writeFile(join(app, 'index.html'), '<div id="root"></div><script type="module" src="/App.jsx"></script>')
const opening = '<div className="card gap-2 w-20">'
await writeFile(
  join(app, 'App.jsx'),
  "import React from 'react';import {createRoot} from 'react-dom/client';import './app.css';function App(){return <main>" +
    opening +
    "<span>Text</span><b>More</b></div></main>}createRoot(document.querySelector('#root')).render(<App/>)",
)
await writeFile(
  join(app, 'app.css'),
  '@layer utilities {.gap-2{gap:8px}.w-20{width:80px}}main{width:400px}.card{display:flex;box-sizing:border-box;transition:width .14s linear}.card.gap-2{gap:12px}',
)
await writeFile(
  manifest,
  JSON.stringify({
    namespace: 'fidelity',
    sites: [
      {
        id: 'card',
        file: 'App.jsx',
        owner: 'App',
        opening,
        styles: [
          ['gap', 'gap-2', '8px'],
          ['width', 'w-20', '80px'],
        ].map(([property, literal, fallback]) => ({
          property,
          literal,
          attribute: 'className',
          utility: { fallback },
        })),
      },
    ],
  }),
)
const b = await chromium.launch(),
  servers = []
try {
  const results = []
  for (const clean of [true, false]) {
    const s = await host(app, map, manifest, await port(), clean)
    servers.push(s)
    const p = await b.newPage()
    await p.goto(s.origin)
    const card = p.locator('.card')
    results.push(await card.evaluate((n) => [n.className, getComputedStyle(n).gap, getComputedStyle(n).width]))
    if (clean) continue
    const ui = await editor(p)
    const select = async () => {
      await card.locator('span').click({ modifiers: ['Meta'] })
      await ui.panel.locator('#parent').click()
    }
    const mode = async (name) => {
      await select()
      await ui.panel.getByRole('button', { name: 'Width resizing' }).click()
      await ui.panel.getByText(name, { exact: true }).click()
      await ui.panel.locator('[aria-busy=true]').waitFor({ state: 'hidden' })
    }
    for (const name of ['Fill container', 'Fill container', 'Hug contents', 'Hug contents']) {
      await mode(name)
      const width = await card.evaluate((n) => n.getBoundingClientRect().width)
      if (name === 'Fill container') assert.equal(width, 400)
      else assert.ok(width > 0 && width < 80)
      console.log(
        name,
        await card.evaluate((n) => [getComputedStyle(n).width, String(n.computedStyleMap().get('width'))]),
        (await ui.snapshot()).edits.length,
      )
    }
    await select()
    await ui.panel.locator('#control-width').fill('149')
    await ui.panel.locator('#control-width').press('Enter')
    await ui.panel.locator('[aria-busy=true]').waitFor({ state: 'hidden' })
    console.log(
      'Baseline comparison',
      results,
      'transition width',
      await card.evaluate((n) => getComputedStyle(n).width),
    )
    assert.deepEqual(results[1], results[0])
    assert.equal((await ui.snapshot()).edits.length, 5)
    assert.equal(await card.evaluate((n) => getComputedStyle(n).width), '149px')
  }
} finally {
  await b.close()
  for (const s of servers) await s.close()
}
