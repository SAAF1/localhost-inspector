(() => {
  const ui = window.LocalhostInspector
  const state = new WeakMap()

  function visibleTableCell(row, cell) {
    if (!row.isConnected || cell.parentElement !== row || !(cell instanceof HTMLElement) ||
        getComputedStyle(row).display !== 'table-row') return false
    const style = getComputedStyle(cell)
    return style.display === 'table-cell' && style.visibility === 'visible' && cell.getClientRects().length > 0
  }

  function cellNames(row, cells) {
    const table = row.closest('table')
    const headers = table?.tHead?.rows
    const headerRow = headers?.length === 1 ? Array.from(headers[0].cells) : []
    const rowCells = Array.from(row.cells ?? [])
    const simpleHeader = rowCells.length === headerRow.length &&
      [...rowCells, ...headerRow].every(cell => cell.colSpan === 1 && cell.rowSpan === 1)
    // A spanning cell in an earlier row can shift the columns of this row.
    const unambiguous = simpleHeader && (!row.previousElementSibling ||
      Array.from(row.parentElement.rows ?? []).slice(0, row.sectionRowIndex)
        .every(earlier => Array.from(earlier.cells).every(cell => cell.rowSpan === 1)))
    const labels = cells.map(cell => {
      const references = (cell.getAttribute('headers') ?? '').trim().split(/\s+/).filter(Boolean)
      const header = references.length === 1 ? cell.ownerDocument.getElementById(references[0]) :
        references.length === 0 && unambiguous ? headerRow[cell.cellIndex] : null
      if (header?.localName !== 'th' || header.closest('table') !== table ||
          !['', 'col'].includes(header.getAttribute('scope') ?? '')) return ''
      return (header.getAttribute('aria-label') || header.textContent).trim().replace(/\s+/g, ' ')
    })
    return labels.map((label, index) => label && label.length <= 28 && labels.indexOf(label) === labels.lastIndexOf(label)
      ? label + ' cell'
      : 'Cell ' + ((cells[index].cellIndex ?? Array.from(row.children).indexOf(cells[index])) + 1))
  }

  function controlledPaddingField(context, axis, glyph) {
    const { node, selectRelated, previewRelated } = context
    const label = axis + ' padding'
    const field = ui.element('button', 'li-field li-controlled-field')
    field.type = 'button'
    field.id = 'control-padding-' + axis.toLowerCase()
    field.setAttribute('aria-label', label)
    field.setAttribute('aria-haspopup', 'menu')
    field.setAttribute('aria-expanded', 'false')
    field.append(ui.icon(glyph), ui.element('span', '', '—'), ui.icon('chevronDown'))
    field.onclick = event => {
      const anchor = event.currentTarget
      if (anchor.getAttribute('aria-expanded') === 'true') {
        ui.closeMenu()
        return
      }
      const isRow = getComputedStyle(node).display === 'table-row'
      const availableCells = () => Array.from(node.children).filter(cell => visibleTableCell(node, cell))
      const cells = isRow ? availableCells() : []
      const names = cellNames(node, cells)
      const single = cells.length === 1
      const choices = cells.map((cell, index) => {
        const name = names[index]
        const destination = /^Cell \d+$/.test(name) ? name : 'the ' + name
        return [cell, single ? 'Padding is on ' + destination : name, { destination: true }]
      })
      if (choices.length > 1) choices[0][2].separator = true
      const canJump = cell => cells.includes(cell) && visibleTableCell(node, cell)
      const observer = new MutationObserver(() => {
        const current = availableCells()
        if (current.length !== cells.length || current.some((cell, index) => cell !== cells[index])) close()
      })
      const close = ui.openMenu(anchor, choices, null, cell => {
        if (canJump(cell)) selectRelated(cell)
      }, {
        label,
        below: true,
        commands: true,
        description: single ? undefined : isRow
          ? 'Padding is set on the cells.' + (cells.length ? '' : ' No cells available.')
          : 'This layer has no padding box.',
        onPreview: cell => previewRelated(cell && (() => canJump(cell) ? cell : null)),
        onClose: () => {
          observer.disconnect()
          previewRelated(null)
        },
      })
      if (isRow) observer.observe(node, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden'],
      })
    }
    return field
  }

  ui.paddingControls = (context, controls, refresh) => {
    const { node, disabled, paddingCount, paddingTemplate, hasPaddingPreview, commitPaddingPair } = context
    if (!ui.canApplyPadding(context.style)) {
      return ui.stack('Padding', ui.row(
        controlledPaddingField(context, 'Horizontal', 'paddingHorizontal'),
        controlledPaddingField(context, 'Vertical', 'paddingVertical'),
      ))
    }
    const padding = Object.fromEntries(
      ['left', 'right', 'top', 'bottom'].map(side => [side, controls.value('padding-' + side)]),
    )
    const asymmetric = padding.left !== padding.right || padding.top !== padding.bottom
    const hasDifferentBindings = [['left', 'right'], ['top', 'bottom']].some(([first, second]) => {
      const a = node.style.getPropertyValue('padding-' + first)
      const b = node.style.getPropertyValue('padding-' + second)
      return a !== b && context.spacingCatalog?.names.some(name => {
        const reference = ui.spacingVariableValue(name)
        return a === reference || b === reference
      })
    })
    const expanded = state.get(node) ?? (asymmetric || hasDifferentBindings)
    const group = ui.element('div', 'li-stack li-padding')
    const toggle = controls.button(expanded ? 'Collapse individual padding' : 'Expand individual padding', 'paddingSidesToggle', () => {
      state.set(node, !expanded)
      refresh('padding-toggle')
    })
    toggle.id = 'control-padding-toggle'
    toggle.setAttribute('aria-expanded', String(expanded))
    toggle.setAttribute('aria-pressed', String(expanded))
    toggle.disabled = disabled
    group.append(ui.caption('Padding'))
    const values = ui.element('div', 'li-padding-values')
    group.append(values)
    if (expanded) {
      values.append(
        ui.row(ui.spacingField(context, controls, 'padding-left', 'Left padding', 'paddingLeft'), ui.spacingField(context, controls, 'padding-top', 'Top padding', 'paddingTop'), toggle),
        ui.row(ui.spacingField(context, controls, 'padding-right', 'Right padding', 'paddingRight'), ui.spacingField(context, controls, 'padding-bottom', 'Bottom padding', 'paddingBottom')),
      )
    } else {
      const axis = (name, first, second, icon) => {
        const a = padding[first]
        const b = padding[second]
        return ui.spacingField(context, controls, 'padding-' + name, name === 'horizontal' ? 'Horizontal padding' : 'Vertical padding', icon, {
          properties: ['padding-' + first, 'padding-' + second],
          value: a === b ? a : '', placeholder: a === b ? a : 'Mixed',
          detachPair: value => context.detachLocalPaddingPair(name, value),
          submitVariable: (value, options) => commitPaddingPair(name, value, options),
          submit: number => commitPaddingPair(name, number + 'px'),
        })
      }
      values.append(ui.row(axis('horizontal', 'left', 'right', 'paddingHorizontal'), axis('vertical', 'top', 'bottom', 'paddingVertical'), toggle))
    }
    if (!expanded && paddingCount && !disabled) {
      const item = paddingTemplate && node.getAttribute('role') !== 'row' ? 'elements' : 'rows'
      const scope = ui.element('button', 'li-padding-scope', paddingCount + ' ' + item)
      scope.type = 'button'
      scope.setAttribute('aria-label', 'Show ' + paddingCount + ' affected ' + item)
      scope.prepend(ui.icon('link'))
      ui.setTooltip(scope, 'Shared vertical padding')
      group.append(scope)
    } else if (!paddingTemplate && !expanded && !disabled && (node.getAttribute('role') === 'row' || hasPaddingPreview)) {
      const text = node.getAttribute('role') === 'row' ? 'This row only in preview' : 'This selection only in preview'
      group.append(ui.element('span', 'li-padding-scope', text))
    }
    return group
  }
})()
