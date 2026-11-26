// Development-only. Return the original React element without adding props,
// DOM attributes, wrappers, hooks or new instances.
const calls = new WeakMap()
const repeated = new WeakSet()
const modules = new Map()
export function selectedModule(url,file,revision) {
  modules.set(new URL(url).pathname,{file,revision})
}
export function selectedCall(element, basis, fields) {
  if (element?.props) {
    if (basis) calls.set(element.props,{basis,fields})
    else repeated.add(element.props)
  }
  return element
}
function currentFiber(node) {
  const key = Object.getOwnPropertyNames(node).find(name => name.startsWith('__reactFiber$'))
  const fiber = key && node[key]
  if (!fiber) return
  let root = fiber
  while (root.return) root = root.return
  if (root.stateNode?.current === root) return fiber
  if (root.stateNode?.current === root.alternate) return fiber.alternate
}
function selected(node) {
  if (!node.matches('button,a[href]') || node.hasAttribute('aria-labelledby')) return
  const label = (node.getAttribute('aria-label') || node.textContent).trim()
  if (!label || label.length > 160) return
  let proof, collection = false
  const dependencies = new Map()
  for (let f=currentFiber(node); f; f=f.return) {
    collection ||= f.key != null || repeated.has(f.memoizedProps)
    const call = calls.get(f.memoizedProps)
    if (call) {
      const fields = call.fields.filter(k => f.memoizedProps[k] === label)
      if (fields.length > 1 || (proof && fields.length)) return
      if (fields.length) proof = {...call.basis,field:fields[0],dependencies:[...dependencies.values()]}
    }
    if (proof) continue
    // Record only loaded project modules found between the host and this
    // invocation. The development stack is corroboration, never identity.
    for (const line of f._debugStack?.stack?.split('\n').slice(1,5) ?? []) {
      const url = line.match(/https?:\/\/[^\s)]+?(?=:\d+:\d+\)?$)/)?.[0]
      if (!url) continue
      const mod = modules.get(new URL(url).pathname)
      if (mod) { dependencies.set(mod.file,mod);break }
    }
  }
  return proof && {proof,collection}
}
document.addEventListener('li-read-selected-use', event => {
  const node = event.target
  if (!(node instanceof HTMLElement)) return
  const match = selected(node)
  if (!match || match.collection || match.proof.dependencies.length > 12) return
  const receipt = match.proof
  const actions = document.querySelectorAll('button,a[href]')
  if (actions.length > 400) return
  for (const other of actions) {
    if (other !== node && selected(other)?.proof.id === receipt.id) return
  }
  node.dispatchEvent(new CustomEvent('li-selected-use',{detail:JSON.stringify(receipt)}))
})
