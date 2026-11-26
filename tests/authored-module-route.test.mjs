import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authoredModulePath, routeAuthoredModule } from '../scripts/flow/authored-module-route.mjs'

test('the authored module is routed through the current resolved Vite base', () => {
  const file = 'src/parts/Space & Color.tsx'
  const modulePath = authoredModulePath(file)
  assert.equal(modulePath, '/__inspector-flow/authored-module/src/parts/Space%20%26%20Color.tsx')
  for (const base of ['/', '/site/version/']) {
    const request = { url: modulePath + '?t=1795637119000&raw' }
    let forwarded = false
    assert.equal(routeAuthoredModule(request, null, base, () => { forwarded = true }), true)
    assert.equal(forwarded, true)
    assert.equal(request.url, base + 'src/parts/Space%20%26%20Color.tsx?t=1795637119000')
  }
})

test('the authored module route leaves unrelated requests alone and rejects invalid file paths', () => {
  const request = {url:'/site/assets/script.js'}
  assert.equal(routeAuthoredModule(request, null, '/site/'), false)
  assert.equal(request.url, '/site/assets/script.js')
  const prefix = '/__inspector-flow/authored-module/'
  for (const path of ['%2foutside.jsx', 'src/.git/example.jsx', 'src/%2e%2e/example.jsx', 'src/secret.json', 'src/%zz.jsx']) {
    let status
    const response = { writeHead: value => ({ end: () => { status = value } }) }
    assert.equal(routeAuthoredModule({url:prefix + path}, response, '/site/'), true)
    assert.equal(status, 404)
  }
})
