// Only canvases prepared for pictured previews opt into refreshing them on save.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function queueVariantCapture(directory, publish) {
  const pending = new Set()
  let timer
  let child
  function run() {
    if (child || !pending.size) return
    const id = pending.values().next().value
    pending.delete(id)
    child = spawn(process.execPath, [fileURLToPath(new URL('./prepare-variant-previews.mjs', import.meta.url)),
      directory, '--step', id], { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('error', error => console.error('Could not refresh variant preview:', error.message))
    child.once('close', code => {
      if (code === 0) publish()
      child = undefined
      run()
    })
  }
  process.once('exit', () => child?.kill())
  return id => {
    if (!existsSync(join(directory, 'variant-previews.json')) &&
        !existsSync(join(directory, 'variant-previews', 'steps'))) return
    pending.add(id)
    clearTimeout(timer)
    timer = setTimeout(run, 700)
  }
}
