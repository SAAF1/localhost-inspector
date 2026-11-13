(() => {
  const ui = window.LocalhostInspector ||= {}
  ui.element = (tag, className = '', text) => {
    const element = document.createElement(tag)
    element.className = className
    if (text !== undefined) element.textContent = text
    return element
  }
  ui.caption = (text, small = false) => ui.element('span', small ? 'li-caption li-bound-caption' : 'li-caption', text)
  ui.row = (...children) => {
    const row = ui.element('div', 'li-row')
    row.append(...children.filter(Boolean))
    return row
  }
  ui.stack = (caption, control, small = false) => {
    const stack = ui.element('div', 'li-stack')
    stack.append(ui.caption(caption, small), control)
    return stack
  }
  ui.section = (title, ...children) => {
    const section = ui.element('section', 'li-section')
    section.dataset.inspectorSection = title
    const heading = ui.element('h2', '', title)
    const body = ui.element('div', 'li-body')
    body.append(...children.filter(Boolean))
    section.append(heading, body)
    return section
  }
  ui.action = (label, iconName, handler, disabled = false) => {
    const button = ui.element('button', 'li-icon-button')
    button.type = 'button'
    ui.setTooltip(button, label)
    button.setAttribute('aria-label', label)
    button.disabled = disabled
    button.append(ui.icon(iconName))
    if (handler) button.onclick = handler
    return button
  }
  ui.colorSwatch = value => {
    const swatch = ui.element('span', 'li-swatch')
    swatch.style.backgroundColor = value ?? ''
    swatch.setAttribute('aria-hidden', 'true')
    return swatch
  }
  ui.colorSwatchTrigger = (label, value, onOpen, disabled = false) => {
    const button = ui.element('button', 'li-color-swatch-trigger')
    button.type = 'button'
    button.disabled = disabled
    button.setAttribute('aria-label', label)
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-expanded', 'false')
    button.append(ui.colorSwatch(value))
    button.onclick = onOpen
    return button
  }
  ui.popupHeader = (title, ...actions) => {
    const header = ui.element('header', 'li-popup-header')
    const controls = ui.element('div', 'li-popup-actions')
    controls.append(...actions)
    header.append(ui.element('span', '', title), controls)
    return header
  }
})()
