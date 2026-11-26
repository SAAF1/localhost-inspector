// Run with an installed React/Vite project as the dependency provider.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { prepareProject } from '../../../scripts/flow/prepare-project.mjs'
import { cssFields } from '../../../scripts/flow/prepared-css.mjs'
import { canvas, host, port } from './hosts.mjs'

const root = await realpath(await mkdtemp(join(tmpdir(), 'module-qualification-')))
const app = join(root, 'app'), map = join(root, 'canvas'), manifest = join(root, 'manifest.json')
await mkdir(join(app, 'src'), { recursive: true })
await canvas(map)
await symlink(join(resolve(process.argv[2]), 'node_modules'), join(app, 'node_modules'))
const write = (file, source) => writeFile(join(app, file), source)
await write('package.json', '{"type":"module"}')
await write('index.html', '<main></main><script type="module" src="/src/main.jsx"></script>')
await write('src/one.module.css', '.tile { border-radius: 5px }')
await write('src/two.module.css', '.tile { border-radius: 9px }')
await write('src/Hidden.jsx', `import React from 'react';import classes from './one.module.css';
export function Hidden({classes}) {return <div id="shadow" className={classes.tile} />}`)
const source = `import React from 'react';import {createRoot} from 'react-dom/client';
import one from './one.module.css';import two from './two.module.css';import {Hidden} from './Hidden';
function App(){const key='tile';return <><div id="chosen" className={one['tile']}/><div id="peer" className={one.tile}/>
<div id="other" className={two.tile}/><div id="dynamic" className={one[key]}/><Hidden classes={one}/></>}
createRoot(document.querySelector('main')).render(<App/>);`
await write('src/main.jsx', source)
let classified = 0
const partial = await prepareProject(app, manifest, 'module-test', 'src', undefined, {
  panelBindings: true, classifyCSS(decl) {
    if (++classified === 2) throw Error('Injected classification failure after first module')
    return cssFields(decl)
  },
})
assert.equal(partial.preparation.preparedStyles, 'unavailable')
assert.ok(!partial.sites.some(site => site.moduleClass))
await prepareProject(app, manifest, 'module-test', 'src', undefined, { panelBindings: true })
const browser = await chromium.launch()
const server = await host(app, map, manifest, await port())
try {
  const page = await browser.newPage()
  await page.goto(server.origin)
  const chosen = page.locator('#chosen')
  await chosen.waitFor({ state: 'attached' })
  const revision = await chosen.getAttribute('data-li-revision')
  assert.ok(revision)
  assert.notEqual(await page.locator('#peer').getAttribute('data-li-revision'), revision)
  for (const id of ['dynamic','shadow']) assert.equal(await page.locator('#'+id).getAttribute('data-li-contract'), null)
  const values = () => page.locator('main div').evaluateAll(nodes => nodes.map(n=>getComputedStyle(n).borderRadius))
  assert.deepEqual(await values(), ['5px','5px','9px','5px','5px'])
  // Exercise the exact registered site input as written by normal journal projection.
  await page.addStyleTag({content:'[data-li-revision="'+revision+'"]{--li-'+revision.slice(0,20)+'-border-radius:17px}'})
  assert.deepEqual(await values(), ['17px','5px','9px','5px','5px'])
  await write('src/one.module.css', '.tile { border-radius: 7px }')
  await page.waitForFunction(old => {const r=document.querySelector('#chosen')?.dataset.liRevision;return r && r!==old}, revision)
  assert.deepEqual(await values(), ['7px','7px','9px','7px','7px'])
  await write('src/main.jsx',source.replace("one['tile']", "two['tile']"))
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('#chosen')).borderRadius==='9px')
  assert.deepEqual(await values(), ['9px','7px','9px','7px','7px'])
  console.log('PASS namespace, quote and dot, distinct uses, dynamic and shadow refusal, CSS revision and import/member transfer')
} finally { await browser.close();await server.close() }
