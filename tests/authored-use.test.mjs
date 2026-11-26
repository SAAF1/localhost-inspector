import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { authoredUseSites, planAuthoredUse, reverseAuthoredUse } from '../scripts/flow/authored-use.mjs'

const source = `import { Row as Controls } from './part';
export function Scene({ items }) {
  return items.map((item) => (
    <section key={item.id}>
      <p>{item.summary}</p>
      <Controls className="flex justify-between"><button>Open</button><button>Delete</button></Controls>
    </section>
  ));
}
export function Toolbar() { return <Controls className="flex"><button>New</button></Controls>; }
`
const part = `export function Row({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={className} {...props} />;
}`

function fixture(t, schema = 1) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'inspector-authored-use-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  function write(file, code) {
    writeFileSync(join(root, file), code)
  }
  write('scene.tsx', source)
  write('part.tsx', part)
  async function markers() {
    const plugin = authoredUseSites(root, schema)
    const read = readFileSync(join(root, 'scene.tsx'), 'utf8')
    const result = await plugin.transform.handler.call(
      {
        resolve: (specifier) => (specifier === './part' ? { id: join(root, 'part.tsx') } : undefined),
      },
      read,
      join(root, 'scene.tsx'),
    )
    return [...result.code.matchAll(/data-li-authored-use=\{("(?:[^"\\]|\\.)*")\}/g)].map((match) =>
      JSON.parse(JSON.parse(match[1])),
    )
  }
  return { root, write, markers }
}

test('use-local inherited paint retains token identity and can be edited and undone after unrelated work', async (t) => {
  const { root, write, markers } = fixture(t)
  const binding = (await markers()).find(({ tag }) => tag === 'p')
  const first = planAuthoredUse(root, binding, { color: 'var(--accent)' })
  assert.equal(first.after, source.replace('<p>', '<p style={{ color: "var(--accent)" }}>'))
  write('scene.tsx', '// separate work\n' + first.after)
  const afterFirst = (await markers()).find(({ tag }) => tag === 'p')
  assert.deepEqual(afterFirst, first.nextBinding)
  assert.throws(() => planAuthoredUse(root, binding, { color: 'red' }), /changed since/)
  const second = planAuthoredUse(root, afterFirst, { color: '#223344' })
  write('scene.tsx', second.after)
  const undoSecond = reverseAuthoredUse(root, second)
  assert.equal(undoSecond.after, '// separate work\n' + first.after)
  write('scene.tsx', undoSecond.after)
  const undoFirst = reverseAuthoredUse(root, first)
  assert.equal(undoFirst.after, '// separate work\n' + source)
})

test('writes one forwarded flex use, preserves a neighboring use, and detects changed ownership', async (t) => {
  const { root, write, markers } = fixture(t)
  const bindings = (await markers()).filter(({ family }) => family === 'spacing')
  assert.equal(bindings.length, 2)
  const plan = planAuthoredUse(root, bindings[0], { gap: '16px' })
  assert.match(
    plan.after,
    /<Controls style=\{\{ justifyContent: "flex-start", gap: "16px" \}\} className="flex justify-between">/,
  )
  assert.match(plan.after, /<Controls className="flex"><button>New/)
  assert.deepEqual(plan.values, { gap: '16px', 'justify-content': 'flex-start' })
  write('scene.tsx', plan.after)
  assert.deepEqual(
    (await markers()).filter(({ family }) => family === 'spacing'),
    [plan.nextBinding, bindings[1]],
  )
  assert.equal(reverseAuthoredUse(root, plan).after, source)
  write(
    'part.tsx',
    part.replace('className={className} {...props}', 'className={className} {...props} style={{ gap: 4 }}'),
  )
  assert.equal((await markers()).filter(({ family }) => family === 'spacing').length, 0)
  assert.throws(() => reverseAuthoredUse(root, plan), /dependency changed/)
})

test('ambiguous native lookalikes and component props that are swallowed stay unresolved', async (t) => {
  const { write, markers } = fixture(t)
  write('scene.tsx', source.replace('<p>{item.summary}</p>', '<p>{item.summary}</p><p>{item.summary}</p>'))
  write('part.tsx', part.replace('className, ...props', 'className, style, ...props'))
  const bindings = await markers()
  assert.equal(
    bindings.some(({ tag, family }) => tag === 'p' || family === 'spacing'),
    false,
  )
})

test('external controlling edits and shadowed component imports cannot reuse a binding', async (t) => {
  const { root, write, markers } = fixture(t)
  const [spacing] = (await markers()).filter(({ family }) => family === 'spacing')
  const plan = planAuthoredUse(root, spacing, { gap: '12px' })
  write('scene.tsx', plan.after.replace('gap: "12px"', 'gap: "8px"'))
  assert.throws(() => reverseAuthoredUse(root, plan), /has changed/)
  write('scene.tsx', source.replace('Scene({ items })', 'Scene({ items, Controls })'))
  assert.equal((await markers()).filter(({ family }) => family === 'spacing').length, 0)
})

test('V2 verifies forwarded text paint and native fixed spacing as separate actions on structural uses', async (t) => {
  const { root, write, markers } = fixture(t, 2)
  const candidate = `import { Row as Item } from './part'
export function Scene({ entries }) {
  return entries.map((entry) => <article key={entry.id}>
    <Item>{entry.name}</Item>
    <Item>${'\u0024'}{entry.amount}</Item>
    <div className="flex justify-between"><div><button>Decrease</button><button>Increase</button></div><button>Remove</button></div>
  </article>)
}
`
  write('scene.tsx', candidate)
  write(
    'part.tsx',
    'export function Row({ className, ...props }) { return <td className={className} {...props} /> }',
  )
  const uses = await markers()
  const [name, amount] = uses.filter(({ tag }) => tag === 'td')
  assert.notEqual(name.id, amount.id)
  assert.deepEqual(amount.actions, ['paint'])
  assert.equal(amount.family, undefined)
  assert.throws(() => planAuthoredUse(root, { ...amount, family: 'spacing' }, { gap: '16px' }), /unsupported/)
  const paint = planAuthoredUse(root, { ...amount, family: 'paint' }, { color: '#e3bb52' })
  assert.equal(paint.nextBinding.id, amount.id)
  assert.notEqual(paint.nextBinding.revision, amount.revision)
  assert.match(paint.after, /<Item style=\{\{ color: "#e3bb52" \}\}>\$\{entry.amount\}/)
  assert.match(paint.after, /<Item>\{entry.name\}<\/Item>/)
  write('scene.tsx', paint.after)
  const spacing = (await markers()).find(({ tag, actions }) => tag === 'div' && actions.includes('spacing'))
  assert.deepEqual(spacing.dependencies, [])
  const gap = planAuthoredUse(root, { ...spacing, family: 'spacing' }, { gap: '16px' })
  assert.equal(gap.nextBinding.id, spacing.id)
  assert.match(gap.after, /<div style=\{\{ justifyContent: "flex-start", gap: "16px" \}\} className=/)
  write('scene.tsx', gap.after)
  const undo = reverseAuthoredUse(root, gap)
  assert.equal(undo.after, paint.after)
})

test('V2 rejects a forwarding component that drops or replaces the authored children', async (t) => {
  const { write, markers } = fixture(t, 2)
  write(
    'scene.tsx',
    source.replace(
      '<Controls className="flex"><button>New</button></Controls>',
      '<Controls>{summary}</Controls>',
    ),
  )
  write('part.tsx', part.replace('className, ...props', 'className, children, ...props'))
  assert.equal(
    (await markers()).some(({ dependencies }) => dependencies.length),
    false,
  )
  write('part.tsx', part.replace('{...props} />', '{...props}>Replacement</div>'))
  assert.equal(
    (await markers()).some(({ dependencies }) => dependencies.length),
    false,
  )
})

test('shared executor selection requires the same source opening and complete mounted membership', async () => {
  const { runInNewContext } = await import('node:vm')
  const use = { schema: 2, actions: ['spacing'], id: 'cards', file: 'Card.tsx', revision: 'current', tag: 'article' }
  const prepared = { file: use.file, revision: 'prepared' }
  const marker = use.id + ' ' + prepared.revision
  function member(visible, opening = marker, revision = use.revision) {
    return {
      localName: 'article', isConnected: true,
      getClientRects: () => visible ? [1] : [],
      getAttribute: name => name === 'data-li-authored-use' ? JSON.stringify({ ...use, revision }) : opening,
    }
  }
  const selected = member(true), peer = member(true), hidden = member(false)
  const mounted = [selected, peer, hidden]
  let preparedMembers = mounted.slice()
  const ui = { preparedPreview: { membersOf: () => preparedMembers } }
  runInNewContext(readFileSync(new URL('../extension/authored-use-preview.js', import.meta.url), 'utf8'), {
    window: { LocalhostInspector: ui }, document: { querySelectorAll: () => mounted },
    getComputedStyle: () => ({ visibility: 'visible' }),
  })
  const matches = () => ui.authoredUsePreview.samePreparedUse(selected, use, prepared)
  assert.equal(matches(), true)
  preparedMembers = [selected, peer]
  assert.equal(matches(), false, 'hidden mounted peer was missing')
  preparedMembers = [selected, peer, member(false)]
  assert.equal(matches(), false, 'equal count with a different peer')
  preparedMembers = mounted
  mounted[1] = member(true, 'different opening')
  assert.equal(matches(), false)
  mounted[1] = member(true, marker, 'stale')
  assert.equal(matches(), false)
  mounted[1] = peer
  assert.equal(ui.authoredUsePreview.samePreparedUse(selected, use, { ...prepared, file: 'Other.tsx' }), false)
})

test('only the prepared JSX opening carries the paired source and preparation revisions', async (t) => {
  const { preparedSites } = await import('../scripts/flow/prepared-sites.mjs')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shared-opening-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const code = 'export function Cards() { return <main><article className="card"><b>A</b><b>B</b></article><aside><b>C</b><b>D</b></aside></main> }'
  const file = join(root, 'Cards.jsx'), manifest = join(root, 'prepared.json')
  writeFileSync(file, code)
  writeFileSync(join(root, 'card.css'), '.card { display: flex; flex-direction: column; gap: 12px }')
  const site = {
    id: 'card-gap', file: 'Cards.jsx', owner: 'Cards', opening: '<article className="card">', dependencies: ['card.css'],
    styles: [{ property: 'gap', attribute: 'className', literal: 'card',
      css: { file: 'card.css', selector: '.card', declaration: 'gap', value: '12px' } }],
  }
  writeFileSync(manifest, JSON.stringify({ namespace: 'fixture', sites: [site] }))
  const plugin = preparedSites(root, manifest, { authoredUseSchema: 2 })
  const generated = (await plugin.transform.handler.call({ resolve: async () => null }, code, file)).code
  const [article] = generated.match(/<article [^>]+>/) ?? []
  assert.ok(article)
  const parse = (name) => JSON.parse(JSON.parse(article.match(new RegExp(name+'=\\{("(?:[^"\\\\]|\\\\.)*")\\}'))[1]))
  const native = parse('data-li-authored-use'), prepared = parse('data-li-contract')
  assert.equal(article.match(/data-li-shared-opening="([^"]+)"/)[1], native.id + ' ' + prepared.revision)
  assert.equal(generated.match(/data-li-shared-opening=/g).length, 1)
  assert.match(generated, /<aside [^>]*data-li-authored-use=/)
})

test('a prepared column gap measures the children without admitting the horizontal native transaction', async () => {
  const { runInNewContext } = await import('node:vm')
  const ui = {}
  const lower = { top: 43, bottom: 58 }
  const styles = { display: 'flex', flexDirection: 'column', flexWrap: 'nowrap', direction: 'ltr', writingMode: 'horizontal-tb', visibility: 'visible' }
  const node = { children: [{ top: 4, bottom: 24 }, lower].map(rect => ({
    isConnected: true, getClientRects: () => [rect], getBoundingClientRect: () => rect,
  })) }
  runInNewContext(readFileSync(new URL('../extension/authored-use-preview.js', import.meta.url), 'utf8'), {
    window: { LocalhostInspector: ui }, getComputedStyle: () => styles,
  })
  assert.equal(ui.authoredUsePreview.eligible(node, 'spacing'), false)
  assert.deepEqual(Array.from(ui.authoredUsePreview.separation(node, true)), [19])
  lower.top = 64
  assert.deepEqual(Array.from(ui.authoredUsePreview.separation(node, true)), [40])
  styles.flexWrap = 'wrap'
  assert.equal(ui.authoredUsePreview.separation(node, true), null)
})

test('finite subscriptions preserve block and concise component arrows, early returns and multiple uses', async t => {
  const {preparedSites} = await import('../scripts/flow/prepared-sites.mjs')
  const {parseAuthoredJsx} = await import('../scripts/flow/authored-forwarding.mjs')
  const root=realpathSync(mkdtempSync(join(tmpdir(),'finite-arrow-')))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const name='Scene', file='Scene.jsx', openings=['<Badge tone="soft"/>','<Badge tone="firm"/>']
  const input=base=>({field:'tone',attribute:'tone',base,component:'fixture',options:['soft','firm'],
    verify:{soft:{tokens:['soft']},firm:{tokens:['firm']}}})
  const sites=openings.map((opening,i)=>({id:'finite-'+i,file,owner:name,opening,dependencies:[],input:input(i?'firm':'soft')}))
  const manifest=join(root,'prepared.json');writeFileSync(manifest,JSON.stringify({namespace:'fixture',sites}))
  const plugin=preparedSites(root,manifest)
  const group='<main>'+openings.join('')+'</main>'
  for (const [source,expected] of [
    ['export const Scene = () => ('+group+')',2],
    ['export const Scene = enabled => ((enabled ? '+group+' : null))',2],
    ['export const Scene = () => '+openings[0],1],
    ['export const Scene = enabled => {"use strict"; if (!enabled) return null; return '+group+'}',2],
    ['export let Scene = () => '+group,0],
    ['export const Scene = wrap(() => '+group+')',0],
  ]){
    const generated=(await plugin.transform.handler.call({},source,join(root,file))).code
    const tree=parseAuthoredJsx(generated)
    assert.equal((generated.match(/ = __liUse\(/g)??[]).length,expected)
    if (expected){
      const fn=tree.program.body.find(s=>s.type==='ExportNamedDeclaration').declaration.declarations[0].init
      assert.equal(fn.body.type,'BlockStatement')
      assert.ok(fn.body.body.slice(0,expected).every(s=>s.type==='VariableDeclaration'))
      assert.equal(fn.body.body.at(-1).type,'ReturnStatement')
    }
  }
})
