export function flowRoute(address) {
  return (address.pathname.replace(/\/$/, '') || '/') + address.search +
    (/^#!?\//.test(address.hash) ? address.hash : '')
}

export function observePage(doc = document, surfacesOnly = false) {
  const visible = node => Boolean(node.getClientRects().length &&
    doc.defaultView.getComputedStyle(node).visibility === 'visible' &&
    !node.closest('[hidden], [inert], [aria-hidden="true"]'))
  const label = node => (node.getAttribute('aria-label') || node.innerText || node.title || '').trim().replace(/\s+/g, ' ').slice(0, 100)
  const surfaces = [...doc.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tabpanel"], [data-state="open"][data-side]')]
    .filter(visible)
    .map(node => ({
      role: node.getAttribute('role') || 'popover',
      label: (doc.getElementById(node.getAttribute('aria-labelledby'))?.textContent || label(node)).trim().slice(0, 120),
    }))
  if (surfacesOnly) return { surfaces }
  const links = [...doc.querySelectorAll('a[href]')].filter(visible).map(node => ({ href: node.href, label: label(node) }))
  const main = doc.querySelector('main, [role="main"]')
  // Controlled forms may use ordinary buttons as their launchers.
  const openForm = /^(create|add|invite|import|new)(?: |$)/i
  const triggers = [...(main || doc).querySelectorAll('[role="tab"], button')].filter(node =>
    node.matches('[role="tab"], button[aria-haspopup]') || (main && openForm.test(label(node)) && !node.closest('form')))
    .filter(node => visible(node) && !node.closest('th') && !node.disabled && node.getAttribute('aria-disabled') !== 'true' &&
      node.getAttribute('aria-selected') !== 'true' && node.getAttribute('aria-expanded') !== 'true' &&
      node.getAttribute('type') !== 'submit')
    .map(node => ({
      role: node.getAttribute('role') === 'tab' ? 'tab' : node.getAttribute('role') === 'combobox' ? 'combobox' : 'button',
      label: label(node),
      inMain: Boolean(main),
      popup: node.hasAttribute('aria-haspopup'),
    }))
    .filter(item => item.label && !/delete|remove|send|submit|sign out|log out|publish|purchase|pay now/i.test(item.label))
  return { links, triggers, surfaces, heading: (main?.querySelector('h1, h2') || doc.querySelector('h1'))?.innerText.trim() || doc.title }
}

export function observeSurfaces(doc) {
  return observePage(doc, true).surfaces
}
