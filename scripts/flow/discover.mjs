import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function repoRoutes(root) {
  const source = await readFile(join(root, 'src/routeTree.gen.ts'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return [...new Set(Array.from(source.matchAll(/^\s+fullPath:\s*['"]([^'"]+)['"]/gm), match => match[1]))].sort()
}

export { observePage } from './page-state.mjs'

export function locateTrigger(page, trigger, includeHidden = false) {
  const scope = trigger.inMain ? page.locator('main, [role="main"]').first() : page
  const control = scope.getByRole(trigger.role, { name: trigger.label, exact: true, includeHidden })
  return trigger.popup ? control.and(page.locator('button[aria-haspopup]:not(th button)')) : control
}
