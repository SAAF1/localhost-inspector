import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { project } from '../../scripts/check-modules.mjs'

const exec = promisify(execFile)

test('mapper preserves URL states and waits for a delayed rendered branch', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'inspector-mapper-test-'))
  let actionRequests = 0
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (url.pathname === '/approve') actionRequests++
    if (url.pathname === '/project') {
      const name = url.searchParams.get('tab') === 'usage' ? 'Usage' : 'Members'
      response.end('<main><h1>Loading…</h1><script>setTimeout(() => document.querySelector("h1").textContent="' +
        name + '", 300)</script></main>')
    } else if (url.pathname === '/hash') {
      response.end('<main><h1></h1><script>document.querySelector("h1").textContent=location.hash.slice(2)</script></main>')
    } else {
      response.end(`<main><h1>Home</h1>
        <a href="/project?tab=usage">Usage</a><a href="/project?tab=members">Members</a>
        <a href="/hash#/details">Details</a><a href="/hash#/billing">Billing</a>
        <a href="/approve?id=4">Approve</a><a href="/hidden-link" style="visibility:hidden">Hidden link</a>
        <button aria-haspopup="dialog" onclick="setTimeout(() => document.getElementById('details').hidden=false, 450)">Show details</button>
        <div id="details" role="dialog" aria-label="Delayed details" hidden>Loaded</div>
        </main>`)
    }
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = 'http://127.0.0.1:' + server.address().port
    const output = join(temporary, 'map')
    await exec(process.execPath, [join(project, 'scripts/flow/map.mjs'), temporary, origin, output],
      { timeout: 20000 })
    const { frames, connections } = JSON.parse(await readFile(join(output, 'map.json'), 'utf8'))
    const labels = new Map(frames.filter(frame => !frame.steps.length).map(frame => [frame.route, frame.label]))
    assert.deepEqual([...labels.entries()], [
      ['/', 'Home'],
      ['/project?tab=usage', 'Usage'],
      ['/project?tab=members', 'Members'],
      ['/hash#/details', 'details'],
      ['/hash#/billing', 'billing'],
    ])
    const delayed = frames.find(frame => frame.label === 'Show details')
    assert.deepEqual(delayed?.checkpoint, [{ role: 'dialog', label: 'Delayed details' }])
    assert.ok(connections.some(edge => edge.to === delayed.id && edge.observed))
    assert.equal(actionRequests, 0)
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve))
    await rm(temporary, { recursive: true, force: true })
  }
})
