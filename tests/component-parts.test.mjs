import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseAuthoredJsx } from '../scripts/flow/authored-forwarding.mjs'
import {
	returnedPart,
	literalStyleInput,
} from '../scripts/flow/component-parts.mjs'
import { componentFingerprint } from '../scripts/flow/component-proof.mjs'
import { onlyElement } from '../scripts/flow/component-surface.mjs'
const opening = (jsx) =>
	parseAuthoredJsx(jsx).program.body[0].expression.openingElement
const def = (src) => ({
	fn: parseAuthoredJsx(src).program.body[0],
	imports: new Map(),
	file: 'view.jsx',
})
test('resolve the parameter gate from the specific callsite and reject duplicated part markers', () => {
	const src =
		'function Action({href,style,...other}) { if(href) return <a/>; return <button style={style} {...other}/> }'
	const none = opening('<Action style={{height:"36px"}} />')
	assert.equal(returnedPart(def(src), none).tag, 'button')
	assert.equal(
		returnedPart(def(src), opening('<Action href="/" />')),
		undefined,
	)
	assert.equal(
		returnedPart(def(src.replace('if(href)', 'if(Date.now())')), none),
		undefined,
	)
	assert.equal(
		returnedPart(
			def(
				src.replace(
					'return <button',
					'const clone=<i {...other}/>;return <button',
				),
			),
			none,
		),
		undefined,
	)
	assert.equal(literalStyleInput(none, 'height').value, '36px')
	assert.equal(
		literalStyleInput(
			opening('<Action style={{height:"36px",...other}}/>'),
			'height',
		),
		undefined,
	)
})
test('multiple rendered children cannot constitute a sole painted surface', () => {
	const children = (jsx) =>
		parseAuthoredJsx(jsx).program.body[0].expression.children
	assert.equal(
		onlyElement(children('<a><Card/></a>')).openingElement.name.name,
		'Card',
	)
	for (const src of [
		'<a><Card/><Card/></a>',
		'<a>text<Card/></a>',
		'<a>{visible && <Card/>}</a>',
	])
		assert.equal(onlyElement(children(src)), undefined)
})
test('component freshness preserves layout-neutral comments and detects a controlling input change', () => {
	const src =
		'function Box({style,...other}) { return <div style={style} {...other}/> }'
	assert.equal(
		componentFingerprint(src),
		componentFingerprint('// ordinary comment\n' + src),
	)
	assert.notEqual(
		componentFingerprint(src),
		componentFingerprint(
			src.replace('style={style}', 'style={{height:"30px"}}'),
		),
	)
})

test('an ordinary fragment-returning component is not a forwarding host', async () => {
  const { forwardedHost } = await import('../scripts/flow/authored-forwarding.mjs')
  const source = 'export function Row({children,...props}){return <><div {...props}>{children}</div></>}'
  assert.equal(forwardedHost(source,'Row'),undefined)
})

test('only an unshadowed public recipe reaching the returned class can prepare a finite field', async t => {
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises')
  const {join}=await import('node:path')
  const {tmpdir}=await import('node:os')
  const {typeModule}=await import('../component-types.mjs')
  const {finiteComponentInputs}=await import('../scripts/flow/finite-component-input.mjs')
  const root=await mkdtemp(join(tmpdir(),'finite-recipe-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const file='Badge.jsx', caller=parseAuthoredJsx('function Page(){return <Badge tone="quiet"/>}')
    .program.body[0].body.body[0].argument.openingElement
  for (const [extra,expression,expected] of [
    ['', 'recipe({tone})',true],['function other(recipe){return recipe}', 'recipe({tone})',false],
    ['', '"fixed"',false],
  ]) {
    const source="import {cva as variants} from 'class-variance-authority';"+
      "const recipe=variants('',{variants:{tone:{quiet:'base quiet',loud:'base loud'}}});"+
      'export function Badge({tone,...rest}){return <b {...rest} className={'+expression+'}/>};'+extra
    await writeFile(join(root,file),source)
    const tree=parseAuthoredJsx(source),fn=tree.program.body[2].declaration
    const input=finiteComponentInputs(root,{file,tree,fn,imports:typeModule(tree,file).imports},caller)
    assert.equal(Boolean(input),expected)
    if(expected)assert.deepEqual(input[0].verify,{quiet:{tokens:['quiet']},loud:{tokens:['loud']}})
  }
  const multiSource = "import {cva} from 'class-variance-authority';"+
    "const recipe=cva('',{variants:{tone:{quiet:'tone-light',loud:'tone-bold',hover:'hover:tone-bold'},density:{loose:'pad-large',tight:'pad-small'}}});"+
    'export function Chip({tone,density}){return <span className={recipe({tone,density})}/>}'
  await writeFile(join(root,file),multiSource)
  const tree=parseAuthoredJsx(multiSource)
  const source={file,tree,fn:tree.program.body[2].declaration,imports:typeModule(tree,file).imports}
  const opening=text=>parseAuthoredJsx('const chip='+text).program.body[0].declarations[0].init.openingElement
  const fields=finiteComponentInputs(root,source,opening('<Chip tone="quiet" density="loose"/>'))
  assert.deepEqual(fields.map(({field,options})=>[field,options]),[
    ['tone',['quiet','loud']],['density',['loose','tight']],
  ])
  assert.deepEqual(finiteComponentInputs(root,source,opening('<Chip tone="hover" density="loose"/>')).map(f=>f.field),['density'])

})
