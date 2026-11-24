const names = {
  a: 'Link', article: 'Article', aside: 'Sidebar', blockquote: 'Quote',
  button: 'Button', dialog: 'Dialog', div: 'Group', fieldset: 'Fieldset',
  footer: 'Footer', form: 'Form', header: 'Header', img: 'Image', input: 'Input',
  label: 'Label', li: 'List item', main: 'Main', nav: 'Navigation',
  ol: 'List', p: 'Paragraph', section: 'Section', select: 'Select', span: 'Text',
  table: 'Table', tbody: 'Table body', td: 'Cell', textarea: 'Text area',
  th: 'Column header', thead: 'Table header', tr: 'Row', ul: 'List',
}

const roleNames = {
  button: 'Button', checkbox: 'Checkbox', combobox: 'Combo box', dialog: 'Dialog',
  banner: 'Header', complementary: 'Sidebar', contentinfo: 'Footer', form: 'Form',
  grid: 'Grid', img: 'Image', list: 'List', menu: 'Menu', menuitem: 'Menu item',
  listitem: 'List item', main: 'Main', navigation: 'Navigation', region: 'Region', radio: 'Radio', search: 'Search', slider: 'Slider',
  switch: 'Switch', tab: 'Tab', tablist: 'Tabs', textbox: 'Text field', toolbar: 'Toolbar',
}

export function layerDetails(node, hasChildren) {
  const tag = node.localName
  const slot = node.getAttribute('data-slot')
  const role = node.getAttribute('role')?.split(/\s+/)[0]
  const roleName = Object.hasOwn(roleNames, role) ? roleNames[role] : undefined
  const heading = /^h[1-6]$/.test(tag) || role === 'heading'
  const directText = [...node.childNodes].filter(child => child.nodeType === 3)
    .map(child => child.textContent).join(' ')
  const labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\s+/)
    .map(id => node.ownerDocument.getElementById(id)?.textContent || '').join(' ')
  if (tag === 'svg') {
    const label = [node.getAttribute('aria-label'), labelledBy, node.querySelector(':scope > title')?.textContent]
      .map(value => value?.trim()).find(Boolean)
    return { label: label || 'Icon', icon: 'vectorLayer' }
  }
  const isControl = ['button', 'a', 'summary', 'label'].includes(tag) || roleName === 'Button'
  const text = [node.getAttribute('aria-label'), labelledBy, node.getAttribute('alt'), directText,
    heading || isControl ? node.innerText : '', node.getAttribute('placeholder')]
    .map(value => value?.replace(/\s+/g, ' ').trim()).find(Boolean)
  const slotName = slot?.replace(/[-_]+/g, ' ').trim()
  const type = heading ? 'Heading' : roleName || (slotName
    ? slotName[0].toUpperCase() + slotName.slice(1) : Object.hasOwn(names, tag) ? names[tag] : tag)
  let icon = 'frame'
  if (['grid', 'table'].includes(role || tag)) icon = 'layoutSettings'
  else if (text && !hasChildren && !isControl && tag !== 'img') icon = 'textLayer'
  else if (hasChildren) {
    const style = node.ownerDocument.defaultView.getComputedStyle(node)
    if (style.display.includes('flex')) icon = style.flexDirection.startsWith('column') ? 'flowColumn' : 'flowRow'
  }
  let label = text || type
  if (!text && !roleName && !slotName && ['article', 'section', 'div'].includes(tag)) {
    const headings = node.querySelectorAll(':scope > :is(h1,h2,h3,h4,h5,h6,[role="heading"])')
    const title = headings.length === 1 && headings[0].innerText?.replace(/\s+/g, ' ').trim()
    if (title) label = title + ' ' + type.toLowerCase()
  }
  return { label: label.slice(0, 200), icon }
}
