import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const maxEvidenceLength = 140_000
const maxImagesPerProject = 64
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const validId = id => typeof id === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)

const directory = (root, binding) => join(root, binding.id + '-evidence')
const imagePath = (root, binding, id) => join(directory(root, binding), id + '.png')

function decodeImage(image) {
  if (typeof image !== 'string' || image.length > maxEvidenceLength) return null
  const bytes = Buffer.from(image, 'base64')
  if (bytes.length < 45 || bytes.toString('base64') !== image ||
      !bytes.subarray(0, 8).equals(pngSignature) ||
      bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.toString('ascii', bytes.length - 8, bytes.length - 4) !== 'IEND') return null
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return width && height && width <= 1600 && height <= 1600 ? bytes : null
}

export async function saveVisualEvidence(root, binding, journal, id, route, image) {
  if (binding.visualEvidence !== true || !validId(binding.id) || !validId(id) ||
      !journal.edits.some(edit => edit.id === id && edit.route === route && (!edit.group || edit.group === id) &&
        !edit.undone && edit.intent === 'feature-template' && edit.property !== 'button-size')) return false
  const bytes = decodeImage(image)
  if (!bytes) return false

  const folder = directory(root, binding)
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const entries = await readdir(folder)
  const destination = imagePath(root, binding, id)
  if (entries.includes(id + '.png')) return true
  if (entries.filter(entry => entry.endsWith('.png')).length >= maxImagesPerProject) return false

  const temp = join(folder, randomUUID() + '.tmp')
  try {
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temp, destination)
  } finally {
    await rm(temp, { force: true }).catch(() => {})
  }
  return true
}

export async function addVisualEvidence(root, binding, handoff) {
  if (binding.visualEvidence !== true || !validId(binding.id)) return
  await Promise.all(handoff.operations.map(async operation => {
    if (operation.status !== 'pending' || !validId(operation.id)) return
    const file = imagePath(root, binding, operation.id)
    const info = await lstat(file).catch(() => null)
    if (info?.isFile()) operation.visualEvidence = { imagePath: file }
  }))
}

export async function removeVisualEvidence(root, binding, ids) {
  if (!validId(binding.id)) return []
  const failures = await Promise.all(ids.filter(validId).map(id =>
    rm(imagePath(root, binding, id), { force: true }).then(() => null, () => id)))
  return failures.filter(Boolean)
}
