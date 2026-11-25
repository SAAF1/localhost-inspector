import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
const serve = fileURLToPath(new URL('../../../scripts/flow/serve.mjs', import.meta.url))
export async function port() {
  const probe = createServer().listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const value = probe.address().port
  await new Promise((resolve) => probe.close(resolve))
  return value
}
export async function host(app, map, manifest, number, clean = false, state = '') {
  const origin = 'http://127.0.0.1:' + number
  const args = clean
    ? [join(app, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--strictPort', '--port', String(number)]
    : [serve, '--source', app, String(number), map]
  const child = spawn(process.execPath, args, {
    cwd: app,
    env: {
      ...process.env,
      INSPECTOR_PREPARED_SITES: manifest,
      INSPECTOR_CANVAS_HELPER_STATE: state,
      INSPECTOR_CANVAS_HOME: map,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (data) => {
      log = (log + data).slice(-10000)
    })
  async function close() {
    if (child.exitCode !== null || child.signalCode) return
    const done = once(child, 'exit')
    child.kill()
    await done
  }
  try {
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null) throw Error(log)
      if (
        await fetch(origin)
          .then((r) => r.ok)
          .catch(() => false)
      )
        return { origin, close, logs: () => log }
      await delay(100)
    }
    throw Error('Host startup timeout: ' + log)
  } catch (error) {
    await close()
    throw error
  }
}
export async function canvas(path) {
  await mkdir(join(path, 'variants'), { recursive: true })
  await writeFile(join(path, 'canvas-project.json'), JSON.stringify({ version: 1 }))
  await writeFile(
    join(path, 'inspector-state.json'),
    JSON.stringify({
      version: 1,
      revision: 0,
      edits: [],
      registrations: { spacing: { source: 'theme.css', names: ['--space-roomy'] } },
    }),
  )
}
export async function editor(page) {
  // Expose only the Inspector shadow root for Playwright's control locators.
  await page.evaluate(async () => {
    const attach = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (opts) {
      return attach.call(this, this.id === 'localhost-inspector' ? { ...opts, mode: 'open' } : opts)
    }
    const { requestInspector } = await import('/__inspector-flow/inspector-request.mjs')
    window.localhostInspectorFontURL = '/__inspector-flow/inter-latin.woff2'
    window.phaseABridge = (message) => requestInspector('/__inspector-flow/workspace-inspector', message)
    await import('/__inspector-flow/variant-runtime.mjs')
    await window.phaseAInspectorReady
  })
  const panel = page.locator('#localhost-inspector')
  await panel.locator('#entry').click()
  const snapshot = () => page.evaluate(() => window.phaseABridge({ type: 'load', route: location.pathname }))
  const select = async (locator) => {
    if (await panel.locator('#close-inspector').isVisible()) await panel.locator('#close-inspector').click()
    const target = locator.first()
    await target.scrollIntoViewIfNeeded()
    const depth = await target.evaluate((node) => {
      const r = node.getBoundingClientRect()
      const hit = window.LocalhostInspector.pointedElement(
        document,
        { x: r.left + 2, y: r.top + 2 },
        document.getElementById('localhost-inspector'),
      )
      let levels = 0
      for (let n = hit; n; n = n.parentElement, levels++) if (n === node) return levels
      return 0
    })
    await target.click({ modifiers: ['Meta'], position: { x: 2, y: 2 } })
    for (let i = 0; i < depth; i++) await panel.locator('#parent').click()
  }
  const settle = async () => {
    await panel.locator('#inspector-panel[aria-busy="true"]').waitFor({ state: 'hidden' })
  }
  return {
    panel,
    snapshot,
    select,
    async gap(locator, n) {
      await select(locator)
      const field = panel.getByRole('spinbutton', { name: 'Gap', exact: true })
      await field.fill(String(n))
      await field.press('Enter')
      await settle()
    },
    async choice(locator, field, value) {
      await select(locator)
      await panel.getByRole('button', { name: field, exact: true }).click()
      await panel.getByRole('menuitemradio', { name: value, exact: true }).click()
      await settle()
    },
    async action(name) {
      await panel.locator('#edits-tab').click()
      await panel.getByRole('button', { name, exact: true }).click()
      await settle()
      await panel.locator('#design-tab').click()
    },
  }
}
