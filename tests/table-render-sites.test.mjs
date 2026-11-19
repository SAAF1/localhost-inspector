import assert from 'node:assert/strict'
import test from 'node:test'
import { tableRenderSites } from '../scripts/flow/table-render-sites.mjs'

test('one render site keeps its identity across builds and stays distinct from identical JSX elsewhere', () => {
  const adapter = tableRenderSites('/app')
  const code = 'const make = row => <tr><td><span>{row.name}</span></td><td><span>{row.name}</span></td></tr>'
  const build = (source, path) => adapter.transform(source, '/app/' + path)?.code
  const ids = (source, path) => [...build(source, path).matchAll(/<span data-inspector-template="([^"]+)"/g)].map(match => match[1])
  const first = ids(code, 'rows.tsx')
  assert.equal(new Set(first).size, 2)
  assert.deepEqual(ids(code, 'rows.tsx'), first)
  for (const changed of [ids(code, 'other.tsx'), ids(code.replaceAll('row.name', 'row.amount'), 'rows.tsx')]) {
    assert.ok(changed.every(id => !first.includes(id)))
  }
})

test('custom markers, forwarded styles and unrelated render functions keep their own behavior', () => {
  const source = `const column = { accessorKey: 'artist', cell: row => <div>
    <span data-inspector-template="artist/name">{row.name}</span>
    <span {...row.props} /><span className={row.className} />
    <button onClick={() => open(() => <aside />)}>Details</button>
  </div> }; const other = {cell: () => <div />}`
  const result = tableRenderSites('/app').transform(source, '/app/columns.tsx').code
  assert.equal((result.match(/data-inspector-template="jsx-site/g) ?? []).length, 2)
  assert.match(result, /<span data-inspector-template="artist\/name">/)
  assert.match(result, /<aside \/>/)
  assert.match(result, /other = \{cell: \(\) => <div \/>/)
})
