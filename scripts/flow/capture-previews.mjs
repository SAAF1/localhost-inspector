import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { locateTrigger } from './discover.mjs'
import { contentOverflow, framePresets, growToContents } from './frame-view.mjs'
import { flowRoute, observePage } from './page-state.mjs'
import { settleVisuals } from './settle-visuals.mjs'

export async function captureContext(browser, origin, viewport, deviceScaleFactor = 1) {
  const context = await browser.newContext({ viewport, deviceScaleFactor, reducedMotion: 'reduce',
    serviceWorkers: 'block', acceptDownloads: false })
  await context.route('**/*', entry => {
    const request = entry.request()
    return new URL(request.url()).origin === origin && ['GET', 'HEAD'].includes(request.method())
      ? entry.continue() : entry.abort()
  })
  await context.routeWebSocket('**/*', socket => socket.close())
  return context
}

async function verify(page, frame, origin) {
  const url = new URL(page.url())
  if (url.origin !== origin || flowRoute(url) !== frame.route) return false
  const { heading, surfaces } = await page.evaluate(observePage)
  return (!frame.heading || frame.heading === heading) && frame.checkpoint.every(check =>
    surfaces.some(surface => surface.role === check.role && surface.label === check.label))
}

async function capture(page, encoder, output, file) {
  await page.evaluate(settleVisuals)
  const { width, height } = page.viewportSize()
  const sharp = width * height * 4 <= 8_000_000
  const png = await page.screenshot({ animations: 'disabled', scale: sharp ? 'device' : 'css', timeout: 5000 })
  const images = await encoder.evaluate(async ({ base64, width, height, sharp }) => {
    const image = new Image()
    image.src = 'data:image/png;base64,' + base64
    await image.decode()
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    const encode = (width, height) => {
      canvas.width = width
      canvas.height = height
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, width, height)
      return canvas.toDataURL('image/webp', .94).split(',')[1]
    }
    return [encode(width, height), sharp && encode(image.width, image.height)]
  }, { base64: png.toString('base64'), width, height, sharp })
  const sharpFile = file.replace(/\.webp$/, '-2x.webp')
  for (const [name, encoded] of [[file, images[0]], [sharpFile, images[1]]]) {
    if (!encoded) continue
    const path = join(output, name)
    await writeFile(path + '.tmp', Buffer.from(encoded, 'base64'))
    await rename(path + '.tmp', path)
  }
  return sharp ? sharpFile : undefined
}

export async function capturePreviews(browser, output, map) {
  const { origin, viewport, frames } = map
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error('Expected a localhost map')
  const context = await captureContext(browser, origin, viewport, 2)
  const previews = {}
  const gaps = []
  try {
    const page = await context.newPage()
    const encoder = await context.newPage()
    for (const [preset, { width, height }] of Object.entries(framePresets(viewport))) {
      for (const frame of frames) {
        const url = new URL(frame.route, origin)
        if (!/^frame-\d+$/.test(frame.id) || url.origin !== origin) continue
        try {
          await page.setViewportSize({ width, height })
          const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 5500 })
          if (!response?.ok()) throw Error('Page unavailable')
          await page.waitForFunction(() => document.body.innerText.trim(), null, { timeout: 1600 })
          for (const step of frame.steps) await locateTrigger(page, step).click({ timeout: 1400 })
          const deadline = Date.now() + 800
          while (!(await verify(page, frame, origin))) {
            if (Date.now() >= deadline) throw Error('Mapped state changed at this size')
            await pause(40)
          }
          const prefix = frame.id + '-' + preset
          const fixed = prefix + '.webp'
          const sharp = await capture(page, encoder, output, fixed)
          const variants = (previews[frame.id] ??= {})
          variants[preset] = { fixed, sharp }
          const expandedHeight = await growToContents(height, () => page.evaluate(contentOverflow), async height => {
            await page.setViewportSize({ width, height })
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
            return verify(page, frame, origin)
          })
          if (expandedHeight) {
            const hug = prefix + '-hug.webp'
            const hugSharp = await capture(page, encoder, output, hug)
            Object.assign(variants[preset], { hug, hugSharp, height: expandedHeight })
          }
        } catch {
          if (!previews[frame.id]?.[preset]) gaps.push({ id: frame.id, label: frame.label, preset })
        }
      }
    }
    const file = join(output, 'previews.json')
    await writeFile(file + '.tmp', JSON.stringify(previews))
    await rename(file + '.tmp', file)
    console.log('Responsive previews:', Object.values(previews).reduce((count, variants) => count + Object.keys(variants).length, 0),
      'of', frames.length * 3, 'states', gaps.length ? JSON.stringify(gaps) : '')
  } finally { await context.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = process.argv[2]
  if (!output) throw Error('Usage: node scripts/flow/capture-previews.mjs MAP_DIRECTORY')
  const map = JSON.parse(await readFile(join(output, 'map.json'), 'utf8'))
  const browser = await chromium.launch()
  try { await capturePreviews(browser, output, map) }
  finally { await browser.close() }
}
