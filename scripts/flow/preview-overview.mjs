import { createHash } from 'node:crypto'
import { link, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const columns = 16, rows = 16, slot = 64
const digestOf = bytes => createHash('sha256').update(bytes).digest('hex')
const missing = error => { if (error.code !== 'ENOENT') throw error }

export async function prepareOverview(root, stage, encoder) {
  const assets = join(root, 'variant-previews')
  const steps = join(assets, 'steps')
  const digests = new Set()
  function include(record) {
    if (typeof record?.small === 'string' && /^[a-f0-9]{64}$/.test(record.small)) digests.add(record.small)
  }
  const index = await readFile(join(root, 'variant-previews.json'), 'utf8').catch(missing)
  if (index) for (const record of Object.values(JSON.parse(index))) include(record)
  for (const name of (await readdir(steps).catch(missing) ?? []).sort()) {
    if (!name.endsWith('.json')) continue
    const record = await readFile(join(steps, name), 'utf8').catch(missing)
    if (record) include(JSON.parse(record))
  }
  const sources = [...digests]
  const manifest = { version: 1, columns, rows, slot, sheets: [], images: {} }
  for (let first = 0; first < sources.length; first += columns * rows) {
    const sheet = await encoder.evaluateHandle(({ columns, rows, slot }) => {
      const canvas = document.createElement('canvas')
      canvas.width = columns * slot
      canvas.height = rows * slot
      return canvas
    }, { columns, rows, slot })
    try {
      const placements = []
      // Transfer and decode at most a single strip of previews at a time.
      for (let row = 0; row < rows && first + row * columns < sources.length; row++) {
        const keys = sources.slice(first + row * columns, first + (row + 1) * columns)
        const inputs = await Promise.all(keys.map(async key => {
          const bytes = await readFile(join(assets, key + '.webp')).catch(missing)
          return bytes && digestOf(bytes) === key ? bytes.toString('base64') : null
        }))
        const drawn = await sheet.evaluate(async (canvas, { inputs, row, slot }) => {
          const context = canvas.getContext('2d')
          context.imageSmoothingQuality = 'high'
          const drawn = []
          for (const [column, input] of inputs.entries()) {
            if (!input) continue
            const image = new Image()
            image.src = 'data:image/webp;base64,' + input
            try { await image.decode() } catch { continue }
            context.drawImage(image, column * slot, row * slot, slot, slot)
            drawn.push(column)
          }
          return drawn
        }, { inputs, row, slot })
        for (const column of drawn) placements.push([keys[column], row * columns + column])
      }
      if (!placements.length) continue
      const encoded = await sheet.evaluate(canvas => canvas.toDataURL('image/webp', .94).split(',')[1])
      const bytes = Buffer.from(encoded, 'base64')
      const digest = digestOf(bytes)
      const file = join(stage, 'sheet-' + first + '.webp')
      await writeFile(file, bytes)
      await link(file, join(assets, digest + '.webp')).catch(error => { if (error.code !== 'EEXIST') throw error })
      const sheetIndex = manifest.sheets.push(digest) - 1
      for (const [key, position] of placements) manifest.images[key] = [sheetIndex, position]
    } finally { await sheet.dispose() }
  }
  const manifestFile = join(stage, 'overview.json')
  await writeFile(manifestFile, JSON.stringify(manifest))
  await rename(manifestFile, join(assets, 'overview.json'))
  const count = Object.keys(manifest.images).length
  console.log('Packed ' + count + ' of ' + sources.length + ' distinct previews into ' + manifest.sheets.length + ' overview sheets.')
  return sources.length - count
}
