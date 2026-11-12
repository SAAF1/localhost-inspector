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
})()
