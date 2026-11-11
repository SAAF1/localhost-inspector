import { createServer } from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { fixture } from '../tests/browser/fixture.mjs'

const exec = promisify(execFile)
const project = fileURLToPath(new URL('..', import.meta.url))
const executablePath = process.env.INSPECTOR_BROWSER || chromium.executablePath()
if (process.platform !== 'darwin') throw Error('The helper currently requires macOS and lsof.')
await Promise.all([
  access(executablePath), access('/usr/sbin/lsof'),
  access(join(project, 'extension/manifest.json')),
  access(join(project, 'extension/assets/inter-latin.woff2')),
])
if (process.argv.includes('--check')) {
  console.log('Development prerequisites available: macOS, Chromium, lsof and extension assets.')
} else {
  await run()
}

async function run() {
  const temporary = await mkdtemp(join(tmpdir(), 'localhost-inspector-dev-'))
  const state = join(temporary, 'state')
  let browser, helper, server
  try {
    server = createServer((_, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      response.end(fixture)
    })
    const port = Number(process.env.PORT || 5181)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    const origin = 'http://127.0.0.1:' + server.address().port
    await exec(process.execPath, ['local-helper.mjs', state, 'bind', String(server.address().port), project], { cwd: project })
    helper = spawn(process.execPath, ['local-helper.mjs', state, 'serve'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] })
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Local helper did not start. Port 5188 must be free.')), 5000)
      helper.once('error', reject)
      helper.once('exit', () => { clearTimeout(timeout); reject(Error('Local helper exited. Port 5188 must be free.')) })
      helper.stdout.on('data', data => {
        if (data.toString().includes('listening')) { clearTimeout(timeout); resolve() }
      })
    })
    browser = await chromium.launchPersistentContext(join(temporary, 'profile'), {
      executablePath, headless: false, viewport: { width: 1100, height: 900 },
      args: ['--disable-extensions-except=' + join(project, 'extension'), '--load-extension=' + join(project, 'extension')],
    })
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker', { timeout: 15000 })
    const extensionId = new URL(worker.url()).host
    const settings = await browser.newPage()
    await settings.goto('chrome-extension://' + extensionId + '/settings.html')
    await settings.locator('#key').fill((await readFile(join(state, 'pairing-key'), 'utf8')).trim())
    await settings.locator('#connect').click()
    await settings.locator('#result').filter({ hasText: 'Connected' }).waitFor()
    await settings.close()
    const page = await browser.newPage()
    await page.goto(origin)
    await worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: origin + '/*' })
      await attach(tab.id, origin)
    }, origin)
    const host = page.locator('#localhost-inspector')
    await host.locator('#entry').click()
    await page.locator('body > #target').click({ modifiers: ['Meta'], position: { x: 5, y: 5 } })
    await host.locator('.li-layout-section').waitFor({ state: 'visible', timeout: 5000 })
    await page.bringToFront()
    console.log('Inspector development fixture: ' + origin)
    console.log('Use the Chrome for Testing window for the inspector. Command-click selects; edits are temporary. Stop or close Chrome to clean up.')
    await new Promise(resolve => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
      browser.once('close', resolve)
      helper.once('exit', resolve)
    })
  } finally {
    await browser?.close()
    if (helper && helper.exitCode === null && helper.signalCode === null) {
      const exited = new Promise(resolve => helper.once('exit', resolve))
      helper.kill('SIGTERM')
      await exited
    }
    if (server?.listening) await new Promise(resolve => server.close(resolve))
    await rm(temporary, { recursive: true, force: true })
  }
}
