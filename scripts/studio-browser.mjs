import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export async function openStudio(
  directory,
  { id = 'a', headless = false, profile = join(directory, 'browser-profile') } = {},
) {
  const studio = JSON.parse(await readFile(join(directory, 'studio.json'), 'utf8'))
  const version = studio.versions.find((item) => item.id === id)
  if (!version) throw Error('Unknown studio version')
  const extension = fileURLToPath(new URL('../extension', import.meta.url))
  const context = await chromium.launchPersistentContext(profile, {
    headless,
    channel: 'chromium',
    viewport: { width: 1480, height: 1024 },
    args: [
      '--disable-extensions-except=' + extension,
      '--load-extension=' + extension,
      '--enable-unsafe-extension-debugging',
      '--use-mock-keychain',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    const extensionId = new URL(worker.url()).host
    const settings = await context.newPage()
    await settings.goto('chrome-extension://' + extensionId + '/settings.html')
    await settings.locator('#port').fill(String(studio.helperPort))
    await settings.locator('#key').fill((await readFile(join(directory, 'helper', 'pairing-key'), 'utf8')).trim())
    await settings.locator('#connect').click()
    await settings.locator('#result').filter({ hasText: 'Connected' }).waitFor({ timeout: 7000 })
    await settings.close()
    const page = await context.newPage()
    await page.goto(version.origin + '/__inspector-flow/?page=/tasks&editor=extension')
    const cdp = await context.browser().newBrowserCDPSession()
    try {
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })
      const tab = targetInfos.find((target) => target.url === page.url())
      await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId })
    } finally {
      await cdp.detach()
    }
    await page.waitForFunction(() => document.querySelector('#app-preview')?.dataset.inspectorDocument)
    return { context, page, worker, version }
  } catch (error) {
    await context.close()
    throw error
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await openStudio(resolve(process.argv[2]), { id: process.argv[3] || 'a' })
}
