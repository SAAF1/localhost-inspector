// Read a component use through Vite's actual local import and named re-exports.
// Keep the files consulted so an edit to the adapter or a barrel requalifies it.
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { parseAuthoredJsx } from './authored-forwarding.mjs'
import { typeModule } from '../../component-types.mjs'

export function componentDefinitions(root, resolved) {
	const cache = new Map()
	function definition(file, spec, seen = new Set()) {
		const path = spec && resolved.get(JSON.stringify([file, spec.from]))
		if (!path || !/\.[jt]sx?$/.test(path) || seen.has(path) || seen.size > 8)
			return
		const key = JSON.stringify([path, spec.name])
		if (cache.has(key)) return cache.get(key)
		const full = join(root, path)
		if (realpathSync(full) !== full) return
		const tree = parseAuthoredJsx(readFileSync(full, 'utf8'))
		const module = typeModule(tree, path)
		const exported = module.exports.get(spec.name)
		let result
		if (exported?.from) {
			const target = definition(path, exported, new Set([...seen, path]))
			if (target) result = { ...target, files: [path, ...target.files] }
		} else {
			for (const stmt of tree.program.body) {
				const fn = stmt.declaration ?? stmt
				if (fn.type !== 'FunctionDeclaration') continue
				if (
					(spec.name === 'default' &&
						stmt.type === 'ExportDefaultDeclaration') ||
					(stmt.type === 'ExportNamedDeclaration' &&
						fn.id?.name === spec.name) ||
					(exported && exported.name === fn.id?.name)
				) {
					result = {
						fn,
						tree,
						file: path,
						files: [path],
						imports: module.imports,
					}
					break
				}
			}
		}
		cache.set(key, result)
		return result
	}
	return definition
}

function descendants(node, predicate) {
	if (!node?.type) return false
	if (predicate(node)) return true
	return Object.values(node).some((v) =>
		Array.isArray(v)
			? v.some((x) => descendants(x, predicate))
			: descendants(v, predicate),
	)
}

function inputs(fn) {
	if (fn.params.length !== 1) return
	const param = fn.params[0]
	if (param.type === 'ObjectPattern') return param
	if (param.type !== 'Identifier') return
	const objects = fn.body.body.flatMap((stmt) =>
		stmt.type === 'VariableDeclaration' && stmt.kind === 'const'
			? stmt.declarations.filter(
					(d) =>
						d.id.type === 'ObjectPattern' &&
						d.init?.type === 'Identifier' &&
						d.init.name === param.name,
				)
			: [],
	)
	if (objects.length === 1) return objects[0].id
}

// Resolve an early truthy-prop return only when the prop is absent on this
// particular call. Unknown conditions and general component branches stay opaque.
export function returnedPart(def, use, hostLibrary) {
	if (!def || use.attributes.some((a) => a.type === 'JSXSpreadAttribute'))
		return
	const pattern = inputs(def.fn)
	if (!pattern) return
	const props = new Map()
	for (const entry of pattern.properties) {
		if (entry.type === 'RestElement') continue
		if (
			entry.type !== 'ObjectProperty' ||
			entry.computed ||
			entry.key.type !== 'Identifier'
		)
			return
		if (entry.value.type === 'Identifier')
			props.set(entry.key.name, entry.value.name)
	}
	const rest = pattern.properties.at(-1)
	if (rest?.type !== 'RestElement' || rest.argument.type !== 'Identifier')
		return
	const statements = def.fn.body.body
	for (const stmt of statements.slice(0, -1)) {
		if (!descendants(stmt, (n) => n.type === 'ReturnStatement')) continue
		if (
			stmt.type !== 'IfStatement' ||
			stmt.alternate ||
			stmt.test.type !== 'Identifier'
		)
			return
		const gate = [...props].find(([, local]) => local === stmt.test.name)?.[0]
		if (!gate || use.attributes.some((a) => a.name?.name === gate)) return
		// A reassigned parameter cannot prove the branch is inactive.
		if (
			descendants(
				def.fn.body,
				(n) =>
					['AssignmentExpression', 'UpdateExpression'].includes(n.type) &&
					(n.left ?? n.argument)?.name === stmt.test.name,
			)
		)
			return
	}
	const last = statements.at(-1)
	if (last?.type !== 'ReturnStatement' || last.argument?.type !== 'JSXElement')
		return
	const host = last.argument.openingElement
	let tag = host.name.name
	if (host.name.type === 'JSXMemberExpression' && hostLibrary) {
		const lib = def.imports.get(host.name.object.name)
		if (lib?.name === 'motion' && hostLibrary(def.file, lib.from))
			tag = host.name.property.name
	}
	if (!tag || !/^[a-z][a-z0-9-]*$/.test(tag)) return
	const spreads = host.attributes.filter((a) => a.type === 'JSXSpreadAttribute')
	if (
		spreads.length !== 1 ||
		spreads[0].argument.type !== 'Identifier' ||
		spreads[0].argument.name !== rest.argument.name
	)
		return
	if (host.attributes.some((a) => a.name?.name?.startsWith('data-li-'))) return
	// Multiple occurrences of the same rest bag could emit multiple marked parts.
	let uses = 0
	descendants(def.fn.body, (n) => {
		if (
			n.type === 'Identifier' &&
			n.name === rest.argument.name &&
			n !== rest.argument
		)
			uses++
		return false
	})
	if (uses !== 1) return
	return { host, tag, props }
}

export function literalStyleInput(opening, property) {
	const styles = opening.attributes.filter((a) => a.name?.name === 'style')
	const obj = styles.length === 1 && styles[0].value?.expression
	if (
		obj?.type !== 'ObjectExpression' ||
		obj.properties.some((p) => p.type !== 'ObjectProperty' || p.computed)
	)
		return
	const entries = obj.properties.filter(
		(p) => (p.key.name ?? p.key.value) === property,
	)
	const value = entries.length === 1 && entries[0].value
	return value?.type === 'StringLiteral' &&
		/^\d+(?:\.\d+)?px$/.test(value.value)
		? value
		: undefined
}
