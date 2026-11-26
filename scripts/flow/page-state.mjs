export function flowRoute(address) {
  return (address.pathname.replace(/\/$/, '') || '/') + address.search +
    (/^#!?\//.test(address.hash) ? address.hash : '')
}

export function observePage(doc = document, mode = 'page', find) {
  const visible = node => Boolean(node.getClientRects().length &&
    doc.defaultView.getComputedStyle(node).visibility === 'visible' &&
    !node.closest('[hidden], [inert], [aria-hidden="true"]'))
  const label = node => {
    const references = node.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? []
    const named = references.map(id => doc.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ')
    return (named || node.getAttribute('aria-label') || node.innerText || node.title || '').trim().replace(/\s+/g, ' ').slice(0, 100)
  }
  const main = doc.querySelector('main, [role="main"]')
  const heading = () => (main?.querySelector('h1, h2') || doc.querySelector('h1'))?.innerText.trim() || doc.title
  if (mode === 'heading') return heading()
  const role = node => node.getAttribute('role') || 'button'
  if (find) {
    const scope = find.inMain ? main : doc
    const matches = [...(scope?.querySelectorAll('[role="tab"], button') ?? [])].filter(node =>
      visible(node) && !node.disabled && !node.closest('th') && node.getAttribute('aria-disabled') !== 'true' &&
      (!find.popup || node.hasAttribute('aria-haspopup')) && role(node) === find.role && label(node) === find.label)
    return matches.length === 1 ? matches[0] : null
  }
  const surfaces = [...doc.querySelectorAll('dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tabpanel"], [data-state="open"][data-side]')]
    .filter(visible)
    .map(node => ({
      role: node.getAttribute('role') || (node.matches('dialog[open]') ? 'dialog' : 'popover'),
      label: (doc.getElementById(node.getAttribute('aria-labelledby'))?.textContent || label(node)).trim().slice(0, 120),
    }))
  for (const tab of doc.querySelectorAll('[role="tab"][aria-selected="true"]')) {
    const name = label(tab)
    if (name && visible(tab)) surfaces.push({ role: 'selected-tab', label: name })
  }
  // A single pressed button can be a persistent toggle such as a favorite. Only
  // offer choices from a visible sibling group with one explicit active option.
  const options = new Set()
  const groups = new Map()
  const parents = new Set([...doc.querySelectorAll('button[aria-pressed="true"]')].map(button => button.parentElement))
  for (const parent of parents) {
    const members = [...parent.children].filter(visible)
    if (members.length < 2 || members.some(button =>
      !button.matches('button[aria-pressed="true"], button[aria-pressed="false"]') || button.closest('form'))) continue
    const names = members.map(label).sort()
    const active = members.filter(button => button.getAttribute('aria-pressed') === 'true')
    if (!names.every(Boolean) || new Set(names).size !== names.length || active.length !== 1) continue
    const key = JSON.stringify(names)
    groups.set(key, groups.has(key) ? null : { members, names, active: active[0] })
  }
  for (const group of groups.values()) {
    if (!group) continue
    surfaces.push({ role: 'pressed-option', label: JSON.stringify([label(group.active), ...group.names]) })
    for (const button of group.members) if (button !== group.active) options.add(button)
  }
  if (mode === 'surfaces') return { surfaces }
  const links = [...doc.querySelectorAll('a[href]')].filter(visible).map(node => ({ href: node.href, label: label(node) }))
  // Controlled forms may use ordinary buttons as their launchers.
  const openForm = /^(create|add|invite|import|new)(?: |$)/i
  const triggers = [...(main || doc).querySelectorAll('[role="tab"], button')].filter(node =>
    options.has(node) || node.matches('[role="tab"], button[aria-haspopup]') || (main && openForm.test(label(node)) && !node.closest('form')))
    .filter(node => visible(node) && !node.closest('th') && !node.disabled && node.getAttribute('aria-disabled') !== 'true' &&
      node.getAttribute('aria-selected') !== 'true' && node.getAttribute('aria-expanded') !== 'true' &&
      node.getAttribute('type') !== 'submit')
    .map(node => ({
      role: role(node),
      label: label(node),
      inMain: Boolean(main),
      popup: node.hasAttribute('aria-haspopup'),
    }))
    .filter(item => item.label && !/delete|remove|send|submit|sign out|log out|publish|purchase|pay now/i.test(item.label))
  return { links, triggers, surfaces, heading: heading() }
}

export function observeSurfaces(doc) {
  return observePage(doc, 'surfaces').surfaces
}
