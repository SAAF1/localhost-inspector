import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverComponentCatalog } from '../component-catalog.mjs'

test('discovers rendered slots and public variants, and refreshes changed source identities', async t => {
  const root = await mkdtemp(join(tmpdir(), 'component-index-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const file = join(root, 'unrelated-name.tsx')
  await writeFile(file, `
    type Props = { caption: React.ReactNode, tone: 'quiet' | 'loud' }
    function Plaque(props: Props) {
      const { caption: label, tone } = props
      return <section data-slot="fixture" className={tone}>{label ?? 'Default'}</section>
    }
    function Row() { return <div data-slot="row"/> }
  `)
  const first = await discoverComponentCatalog(root)
  assert.deepEqual(first.definitions, [{ name: 'Plaque', source: 'unrelated-name.tsx', fields: ['caption','tone'], markers: ['fixture'], options: { tone: ['quiet','loud'] } }])
  assert.equal((await discoverComponentCatalog(root)).revision, first.revision)
  const other = join(root, 'second.jsx')
  await writeFile(other, 'function Other() { return <div data-slot="fixture"/> }')
  assert.deepEqual((await discoverComponentCatalog(root)).definitions[0].markers, [])
  await rm(other)
  assert.equal((await discoverComponentCatalog(root)).revision, first.revision)
  await writeFile(file, 'function Replacement({ children }) { return <main>{children}</main> }')
  const changed = await discoverComponentCatalog(root)
  assert.notEqual(changed.revision, first.revision)
  assert.deepEqual(changed.definitions.map(d => d.name), ['Replacement'])
})

test('indexes public defaults from the variant recipe and explicit prop overrides', async t => {
  const root = await mkdtemp(join(tmpdir(), 'component-defaults-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'chip.tsx'), `
    import { cva } from 'class-variance-authority'
    const recipe = cva('', { variants: { tone: { soft: '', solid: '' }, size: { sm: '', lg: '' } },
      defaultVariants: { tone: 'soft', size: 'sm' } })
    function Chip({ tone, size = 'lg' }) {
      return <span data-slot="chip" className={recipe({ tone, size })}/>
    }
  `)
  const { definitions } = await discoverComponentCatalog(root)
  assert.deepEqual(definitions[0].defaults, { tone: 'soft', size: 'lg' })
})

test('refreshes imported prop shapes, keeps wrapper layers distinct, and finds forwarded content', async t => {
  const root = await mkdtemp(join(tmpdir(), 'component-imports-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const write = (file, source) => writeFile(join(root, file), source)
  const model = `
    import type { ReactNode as Content } from 'react'
    export interface FrameSlots { ornament?: Content }
    export interface CaptionProps extends FrameSlots { emphasis: 'soft' | 'loud' }
  `
  await write('model.ts', model)
  await write('exports.ts', "export type { CaptionProps as DisplayFields } from './model.js'")
  await write('views.tsx', `
    import { createContext, forwardRef as forward } from 'react'
    import type { DisplayFields as Props } from './exports'
    const Session = createContext(null)
    export const ContextHost = ({ children }) => <Session.Provider value={null}>{children}</Session.Provider>
    export const Flag = forward<HTMLElement, Props>(({ ornament }, ref) => <aside ref={ref}>{ornament}</aside>)
    export function Shell({ className, ...rest }) { return <div data-slot="shell" {...rest} /> }
    export function Caption({ ornament, emphasis, ...rest }: Props) {
      return <section className={emphasis} {...rest}>{ornament}</section>
    }
    export function Chip({ tone, ...rest }: React.ComponentProps<'small'> & { tone: 'low' | 'high' }) {
      return <small data-slot="chip" className={tone} {...rest}/>
    }
    export function Stamp({ children, tone, ...rest }: { tone: 'low' | 'high' }) {
      return <small data-slot="stamp" className={tone} {...rest}/>
    }
  `)
  const first = await discoverComponentCatalog(root)
  assert.deepEqual(first.definitions.map(d => d.name), ['Caption', 'Chip', 'Flag', 'Stamp'])
  assert.deepEqual(first.definitions.map(d => d.fields), [['emphasis','ornament'], ['children','tone'], ['ornament'], ['tone']])
  await write('model.ts', model.replace('ornament?: Content', 'ornament?: never').replace("'soft' | 'loud'", "'plain' | 'quiet'"))
  const second = await discoverComponentCatalog(root)
  assert.deepEqual(second.definitions[0].fields, ['emphasis'])
  assert.deepEqual(second.definitions[0].options.emphasis, ['plain','quiet'])
})

test('declared visibility controls expose boolean choices while structural switches stay internal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'component-visibility-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'card.tsx'), `
    function Card({ heading, showSymbol = true, asChild = false }: { heading: string, showSymbol?: boolean, asChild?: boolean }) {
      const Tag = asChild ? Slot : 'article'
      return <Tag>{heading}{showSymbol && <span>Symbol</span>}</Tag>
    }
  `)
  const { definitions: [card] } = await discoverComponentCatalog(root)
  assert.deepEqual(card.fields, ['heading', 'showSymbol'])
  assert.deepEqual(card.options.showSymbol, [false, true])
  assert.equal(card.defaults.showSymbol, true)
})
