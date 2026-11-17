import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { chromium } from 'playwright'
import { locateTrigger, observePage, repoRoutes } from './discover.mjs'

const [repo, url, destination] = process.argv.slice(2)
if (!repo || !url || !destination) throw Error('Usage: node scripts/flow/map.mjs REPO DISPOSABLE_LOCALHOST_URL OUTPUT_DIRECTORY')
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
      /\/(?:api|logout|sign-out)(?:\/|$)/i.test(address.pathname) ||
      /\.[a-z\d]{2,6}$/i.test(address.pathname)) return null
  const route = address.pathname.replace(/\/$/, '') || '/'
  if (!scheduled.has(route)) {
    scheduled.add(route)
    queue.push(route)
  }
  return route
}

async function capture(page, route, label, steps = [], checkpoint = []) {
  const id = 'frame-' + (frames.length + 1)
  await page.screenshot({ path: join(output, id + '.png'), animations: 'disabled', timeout: 5000 })
  frames.push({ id, route, label, steps, checkpoint, image: id + '.png' })
  return id
}

async function open(page, route) {
  const response = await page.goto(new URL(route, start).href, { timeout: 8000, waitUntil: 'domcontentloaded' })
  if (response && !response.ok()) throw Error('HTTP ' + response.status())
  if (new URL(page.url()).origin !== start.origin) throw Error('Left the mapped app')
  await page.waitForFunction(() => Boolean(document.body.innerText.trim()), { timeout: 3000 })
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
  const after = await page.evaluate(observePage)
  const additions = after.surfaces.filter(surface => !before.surfaces.some(old =>
    old.role === surface.role && old.label === surface.label))
  if (!additions.length || new URL(page.url()).pathname !== new URL(route, start).pathname) return
  const id = await capture(page, route, trigger.label, [trigger], additions)
  connections.push({ from: baseId, to: id, action: trigger.label, observed: true })
}

schedule(start.href)
await mkdir(output, { recursive: true })
if ((await readdir(output)).length) throw Error('Choose an empty output directory')
const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: false })
  await context.route('**/*', route => {
    const request = route.request()
    return new URL(request.url()).origin === start.origin && ['GET', 'HEAD'].includes(request.method())
      ? route.continue() : route.abort()
  })
  await context.routeWebSocket('**/*', socket => socket.close())
  const page = await context.newPage()
  let visited = 0
  while (queue.length && visited++ < routeLimit) {
    const route = queue.shift()
    try {
      const observed = await open(page, route)
      const actual = new URL(page.url()).pathname.replace(/\/$/, '') || '/'
      if (actual !== route) {
        schedule(page.url())
        gaps.push({ route, reason: 'Redirected to ' + actual })
      } else {
        const base = await capture(page, route, observed.heading)
        frameForRoute.set(route, base)
        for (const link of observed.links) {
          const path = schedule(link.href)
          if (path && path !== route && link.label) pendingLinks.push({ from: base, route: path, action: link.label })
        }
        const distinct = new Map(observed.triggers.map(trigger => [trigger.role + ':' + trigger.label, trigger]))
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
  for (const link of pendingLinks) {
    const to = frameForRoute.get(link.route)
    if (to && !connections.some(edge => edge.from === link.from && edge.to === to && edge.action === link.action)) {
      connections.push({ from: link.from, to, action: link.action, observed: false })
    }
  }
  for (const route of queue) gaps.push({ route, reason: 'Route budget reached' })
  await writeFile(join(output, 'map.json'), JSON.stringify({ origin: start.origin, viewport, frames, connections, gaps }, null, 2))
  console.log('Mapped', frames.length, 'frames and', connections.length, 'connections. Gaps:', gaps.length)
} finally {
  await browser.close()
}
