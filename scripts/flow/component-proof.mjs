import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAuthoredJsx } from './authored-forwarding.mjs'

const trivia = new Set([
	'start',
	'end',
	'loc',
	'extra',
	'leadingComments',
	'trailingComments',
	'innerComments',
	'comments',
])

// JSXText and literal values remain significant. Comments and source positions
// have no bearing on which prop is delivered to which host.
export function componentFingerprint(code) {
	return syntaxFingerprint(parseAuthoredJsx(code).program)
}

export function syntaxFingerprint(node) {
	const syntax = JSON.stringify(node, (key, value) =>
		trivia.has(key) ? undefined : value,
	)
	return createHash('sha256').update(syntax).digest('hex')
}

export function componentProof(root) {
	const cache = new Map()
	return (files) =>
		Object.fromEntries(
			files.map((file) => {
				if (!cache.has(file))
					cache.set(
						file,
						componentFingerprint(readFileSync(join(root, file), 'utf8')),
					)
				return [file, cache.get(file)]
			}),
		)
}
