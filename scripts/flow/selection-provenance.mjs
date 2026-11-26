import { createHash } from 'node:crypto'

// A source location can be known while every operation on it is unqualified.
// Keep duplicate openings ambiguous. Never turn this marker into write authority.
export function sourceUseId(file, owner, opening) {
	return (
		'use-' +
		createHash('sha256')
			.update(JSON.stringify([file, owner, opening]))
			.digest('hex')
			.slice(0, 24)
	)
}

export function markSourceSelections(file, code, openings, out) {
	const seen = new Map()
	for (const { node, owner } of openings) {
		if (
			!/^[a-z][a-z0-9-]*$/.test(node.name.name ?? '') ||
			node.attributes.some(
				(attr) =>
					attr.type === 'JSXSpreadAttribute' ||
					attr.name?.name === 'data-li-source-use',
			)
		)
			continue
		const id = sourceUseId(
			file,
			owner.id.name,
			code.slice(node.start, node.end),
		)
		if (seen.has(id)) seen.set(id, null)
		else seen.set(id, { node, owner: owner.id.name })
	}
	let changed = false
	for (const [id, use] of seen) {
		if (!use) continue
		out.appendLeft(
			use.node.name.end,
			' data-li-source-use={' +
				JSON.stringify(JSON.stringify({ id, file, owner: use.owner })) +
				'}',
		)
		changed = true
	}
	return changed
}
