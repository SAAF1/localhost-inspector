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
