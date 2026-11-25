import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function projectVite(root) {
  const require = createRequire(join(root, 'package.json'))
  const namespace = await import(pathToFileURL(require.resolve('vite')))
  // Vite 5 resolves its CommonJS facade here. Node exposes that API as default.
  return typeof namespace.createServer === 'function' ? namespace : namespace.default
}
