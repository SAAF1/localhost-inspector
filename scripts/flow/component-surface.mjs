import { localBindingNames } from './authored-use.mjs'
import { returnedPart } from './component-parts.mjs'

export function onlyElement(children) {
	const rendered = children.filter(
		(n) =>
			!(n.type === 'JSXText' && !n.value.trim()) &&
			!(
				n.type === 'JSXExpressionContainer' &&
				n.expression.type === 'JSXEmptyExpression'
			),
	)
	return rendered.length === 1 && rendered[0].type === 'JSXElement'
		? rendered[0]
		: undefined
}

// Resolve a single explicitly authored child whose root receives caller props.
// A source class on that root must own the painted surface. At runtime the
// selected envelope and the part must still be one-to-one and cover the same box.
export function componentSurface(node, context) {
	const { config, file, code, imports, locals, outer, reference } = context
	if (!reference || !outer || !config.panelBindings || config.css.indexError)
		return
	const element = onlyElement(node.children)
	const child = element?.openingElement
	if (
		!child ||
		child.attributes.some(
			(a) =>
				a.type === 'JSXSpreadAttribute' || a.name?.name?.startsWith('data-li-'),
		)
	)
		return
	const name = child.name.name
	if (!name || locals.has(name)) return
	const def = config.definition(file, imports.get(name))
	const part = def && returnedPart(def, child, config.hostLibrary)
	if (!part) return
	const expression = part.host.attributes.find(
		(a) => a.name?.name === 'className',
	)?.value?.expression
	if (
		expression?.type !== 'CallExpression' ||
		expression.callee.type !== 'Identifier'
	)
		return
	const joiner = def.imports.get(expression.callee.name)
	if (
		joiner?.name !== 'default' ||
		!config.classJoins.has(JSON.stringify([def.file, joiner.from]))
	)
		return
	const local = localBindingNames(def.tree)
	if (local.has(expression.callee.name)) return
	const args = expression.arguments.filter(
		(a) => !(a.type === 'Identifier' && a.name === part.props.get('className')),
	)
	if (args.length !== 1) return
	const member = args[0]
	if (
		member.type !== 'MemberExpression' ||
		member.computed ||
		member.object.type !== 'Identifier' ||
		local.has(member.object.name)
	)
		return
	const module = def.imports.get(member.object.name)
	if (module?.name !== 'default') return
	const path = config.resolved.get(JSON.stringify([def.file, module.from]))
	const rules = config.css.moduleClasses.get(
		JSON.stringify([path, member.property.name]),
	)
	if (!rules) return
	const properties = ['background-color', 'border-radius']
	const styles = []
	for (const property of properties) {
		const inner = rules.filter((s) => s.property === property),
			envelope = outer.filter((s) => s.property === property)
		if (inner.length !== 1 || envelope.length > 1) continue
		styles.push({ ...inner[0], part: 'surface' })
		if (envelope.length) styles.push(envelope[0])
	}
	if (!styles.some((s) => s.property === 'background-color')) return
	return {
		surface: {
			opening: code.slice(child.start, child.end),
			tag: part.tag,
			file: path,
			member: member.property.name,
		},
		componentFiles: def.files,
		styles,
		dependencies: [...def.files, path, reference.file],
	}
}
