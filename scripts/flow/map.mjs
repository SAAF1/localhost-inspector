import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, resolve, join } from 'node:path'
import { chromium } from 'playwright'
import { locateTrigger, observePage, repoRoutes } from './discover.mjs'
import { captureContext, capturePreviews } from './capture-previews.mjs'
import { flowRoute } from './page-state.mjs'
import { createAuditCapture, writeAudit } from './capture-variables.mjs'

const [repo, url, destination, stateRoute, stateLabel] = process.argv.slice(2)
if (!repo || !url || !destination || Boolean(stateRoute) !== Boolean(stateLabel)) {
  throw Error('Usage: node scripts/flow/map.mjs REPO DISPOSABLE_LOCALHOST_URL OUTPUT_DIRECTORY [STATE_ROUTE STATE_LABEL]')
}
const start = new URL(url)
if (start.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(start.hostname) ||
    start.username || start.password) throw Error('Use a disposable localhost app over HTTP')
const output = resolve(destination)
const viewport = { width: 1440, height: 900 }
const candidates = await repoRoutes(repo)
const queue = []
const scheduled = new Set()
const frames = []
const connections = []
const gaps = candidates.filter(path => path.includes('$')).map(route => ({ route, reason: 'A concrete example URL is needed' }))
const frameForRoute = new Map()
const pendingLinks = []
const routeLimit = 24

function schedule(url) {
  const address = new URL(url, start)
  if (address.origin !== start.origin || address.username || address.password ||
      /\/(?:api|logout|sign-out|delete|remove|approve|reject|submit|purchase|checkout|confirm)(?:[\/_-]|$)/i.test(address.pathname) ||
      /\.[a-z\d]{2,6}$/i.test(address.pathname)) return null
  const route = flowRoute(address)
  if (address.hash && !route.endsWith(address.hash)) return null
  if (!scheduled.has(route)) {
    scheduled.add(route)
    queue.push(route)
  }
  return route
}

async function capture(page, route, label, steps = [], checkpoint = [], heading) {
  const id = 'frame-' + (frames.length + 1)
  await page.screenshot({ path: join(output, id + '.png'), animations: 'disabled', timeout: 5000 })
  frames.push({ id, route, label, steps, checkpoint, heading, image: id + '.png' })
  return id
}

async function open(page, route) {
  const target = new URL(route, start)
  const current = new URL(page.url())
  if (current.origin === target.origin && current.pathname === target.pathname &&
      current.search === target.search && current.hash !== target.hash) {
    await page.goto('about:blank')
  }
  const response = await page.goto(target.href, { timeout: 8000, waitUntil: 'domcontentloaded' })
  if (response && !response.ok()) throw Error('HTTP ' + response.status())
  if (new URL(page.url()).origin !== start.origin) throw Error('Left the mapped app')
  await page.waitForFunction(() => Boolean(document.body.innerText.trim()), { timeout: 3000 })
  const initial = await page.evaluate(observePage)
  if (!/^loading[. …]*$/i.test(initial.heading.trim())) return initial
  await page.waitForFunction(() => {
    const heading = document.querySelector('main h1, main h2, h1')?.innerText.trim() || document.title
    return heading && !/^loading[. …]*$/i.test(heading)
  }, undefined, { timeout: 1500 })
  return page.evaluate(observePage)
}

async function observeInteraction(page, route, trigger, baseId) {
  const before = await open(page, route)
  const control = locateTrigger(page, trigger)
  if (await control.count() !== 1) {
    gaps.push({ route, action: trigger.label, reason: 'Control is missing or ambiguous' })
    return
  }
  await control.click({ timeout: 1500 })
  const deadline = Date.now() + 850
  let additions = []
  do {
    const actual = new URL(page.url())
    if (actual.origin !== start.origin) return
    if (flowRoute(actual) !== route) {
      const path = schedule(actual.href)
      if (path) pendingLinks.push({ from: baseId, route: path, action: trigger.label })
      return
    }
    const after = await page.evaluate(observePage)
    additions = after.surfaces.filter(surface => !before.surfaces.some(old =>
      old.role === surface.role && old.label === surface.label))
    if (additions.length) {
      // Include the other choice groups so the same visible record in a
      // different combination of filters cannot masquerade as this frame.
      additions.push(...after.surfaces.filter(surface => surface.role === 'pressed-option' && !additions.includes(surface)))
      break
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  } while (Date.now() < deadline)
  if (!additions.length) {
    gaps.push({ route, action: trigger.label, reason: 'No distinct state appeared after activation' })
    return
  }
  const id = await capture(page, route, trigger.label, [trigger], additions)
  connections.push({ from: baseId, to: id, action: trigger.label, observed: true })
}

schedule(start.href)
await mkdir(output, { recursive: true })
if ((await readdir(output)).length) throw Error('Choose an empty output directory')
const browser = await chromium.launch({ headless: true })
try {
  const context = await captureContext(browser, start.origin, viewport)
  const audit = await createAuditCapture(context, repo)
  const scans = []
  const page = await context.newPage()
  async function auditBase() {
    const frame = frames.at(-1)
    try {
      const scan = await audit(page, frame, start.origin)
      if (!scan) throw Error('Page changed during audit')
      scans.push(scan)
    } catch (error) {
      gaps.push({ route: frame.route, reason: 'Variables audit: ' + error.message.split('\n')[0] })
    }
  }
  let visited = 0
  while (queue.length && visited++ < routeLimit) {
    const route = queue.shift()
    try {
      const observed = await open(page, route)
      const actual = flowRoute(new URL(page.url()))
      if (actual !== route) {
        schedule(page.url())
        gaps.push({ route, reason: 'Redirected to ' + actual })
      } else {
        const base = await capture(page, route, observed.heading, [], observed.surfaces, observed.heading)
        frameForRoute.set(route, base)
        await auditBase()
        for (const link of observed.links) {
          const path = schedule(link.href)
          if (path && path !== route && link.label) pendingLinks.push({ from: base, route: path, action: link.label })
        }
        const distinct = new Map(observed.triggers.map(trigger => [trigger.role + ':' + trigger.label, trigger]))
        if (distinct.size > 8) gaps.push({ route, reason: 'Control budget reached', skipped: distinct.size - 8 })
        for (const trigger of [...distinct.values()].slice(0, 8)) {
          try { await observeInteraction(page, route, trigger, base) }
          catch { gaps.push({ route, action: trigger.label, reason: 'Could not reopen the control' }) }
        }
      }
    } catch (error) {
      gaps.push({ route, reason: error.message.split('\n')[0] })
    }
    if (!queue.length) for (const path of candidates.filter(path => !path.includes('$'))) schedule(path)
  }
  if (stateRoute) {
    const address = new URL(stateRoute, start)
    const route = flowRoute(address)
    const base = frameForRoute.get(address.pathname.replace(/\/$/, '') || '/')
    if (address.origin !== start.origin || !base || !address.search || frameForRoute.has(route)) {
      throw Error('Expected a new query state for a mapped page')
    }
    const observed = await open(page, route)
    if (flowRoute(new URL(page.url())) !== route) throw Error('The requested state did not reopen')
    const id = await capture(page, route, stateLabel, [], observed.surfaces, observed.heading)
    connections.push({ from: base, to: id, action: stateLabel, observed: true })
    frameForRoute.set(route, id)
    await auditBase()
  }
  for (const link of pendingLinks) {
    const to = frameForRoute.get(link.route)
    if (to && !connections.some(edge => edge.from === link.from && edge.to === to && edge.action === link.action)) {
      connections.push({ from: link.from, to, action: link.action, observed: false })
    }
  }
  for (const route of queue) gaps.push({ route, reason: 'Route budget reached' })
  let projectName = basename(resolve(repo))
  try {
    const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
    if (typeof pkg.name === 'string' && pkg.name.trim()) projectName = pkg.name.trim()
  } catch { /* The mapped project may have no package manifest. */ }
  await writeAudit(output, scans)
  const map = { projectName, origin: start.origin, viewport, frames, connections, gaps }
  await writeFile(join(output, 'map.json'), JSON.stringify(map, null, 2))
  await context.close()
  await capturePreviews(browser, output, map)
  console.log('Mapped', frames.length, 'frames and', connections.length, 'connections. Gaps:', gaps.length)
} finally {
  await browser.close()
}
