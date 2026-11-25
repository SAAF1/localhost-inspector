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

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'inspector-authored-use-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  function write(file, code) {
    writeFileSync(join(root, file), code)
  }
  write('scene.tsx', source)
  write('part.tsx', part)
  async function markers() {
    const plugin = authoredUseSites(root)
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
