(() => {
  const ui = window.LocalhostInspector
  ui.commitSelectionPaints = async (paints, value, context) => {
    const entries = []
    try {
      for (const { node, property } of paints) {
        if (!context.valid()) throw Error('Selection changed.')
        const target = ui.describePreviewTarget(node)
        const entry = await context.apply(node, property, value, context.valid)
        entry.liveTarget = target
        entries.push(entry)
      }
      const records = await Promise.all(entries.map(async entry => ({
        ...await context.editRecord(entry, entry.liveTarget), intent: 'selected occurrence only',
      })))
      if (!context.valid() || entries.some(entry => !ui.matchesPreviewTarget(entry.node, entry.liveTarget) ||
          !ui.ownsPreviewDeclaration(entry))) throw Error('Selection changed.')
      await context.persist(records)
      if (!context.valid()) {
        for (const entry of entries.reverse()) context.discardTemporary(entry)
        return
      }
      entries.forEach((entry, index) => context.remember({ ...records[index], group: records[0].id }, entry))
    } catch (error) {
      for (const entry of entries.reverse()) context.discardTemporary(entry)
      throw error
    }
  }

  ui.waitForPreview = async (current, matches, requiredFrames = 0) => {
    const deadline=performance.now()+550
    let frames = 0, frame
    function sample() {
      frames = current() && matches() ? frames+1 : 0
      if (frames < requiredFrames) frame = requestAnimationFrame(sample)
    }
    if (requiredFrames) frame = requestAnimationFrame(sample)
    try {
      while(current()){
        if(frames >= requiredFrames && matches())return true
        if(performance.now()>=deadline)return false
        await new Promise(resolve=>setTimeout(resolve,16))
      }
      return false
    } finally {
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }
  ui.createStylePreview = catalogs => {
    const temporary = new Set()
    function remove(entry) {
      const { node, property, prior, priorPriority } = entry
      if (!ui.ownsPreviewDeclaration(entry)) return
      if (entry.background) {
        const {style} = node
        // A later authored shorthand supersedes our longhand.
        if (style.getPropertyValue('background')) return
        const changes = []
        for (const name of entry.background.longhands) {
          if (name === property) continue
          const value = style.getPropertyValue(name)
          if (value || !Array.from(style).includes(name))
            changes.push([name,value,style.getPropertyPriority(name)])
        }
        style.setProperty('background',entry.background.value,entry.background.priority)
        for (const [name,value,priority] of changes) {
          if (value) style.setProperty(name,value,priority)
          else style.removeProperty(name)
        }
      } else if (prior) node.style.setProperty(property, prior, priorPriority)
      else node.style.removeProperty(property)
    }
    async function apply(node, property, requested, isCurrent, {
      colorToken, pendingColor, spacingToken, textStyleToken, pendingTextStyle, protectSiblingSizes,
    } = {}) {
      const { colorCatalog, spacingCatalog, textStyleCatalog } = catalogs()
      if (colorToken && (
        !ui.supportsColorVariable(node, property) || requested !== ui.colorVariableValue(colorToken.name) ||
        colorToken.source !== colorCatalog?.source || !colorCatalog.names.includes(colorToken.name) ||
        !ui.resolveColorVariable(node, colorToken.name)
      )) throw Error('This color variable is unavailable for the selected color.')
      if (pendingColor && (
        property !== 'background-color' || !ui.supportsColorVariable(node, property) ||
        pendingColor.source !== colorCatalog?.source || requested !== pendingColor.value
      )) throw Error('The color source is unavailable.')
      if (spacingToken && (
        requested !== ui.spacingVariableValue(spacingToken.name) ||
        spacingToken.source !== spacingCatalog?.source || !spacingCatalog.names.includes(spacingToken.name) ||
        !ui.supportsSpacingVariable(node, property) || ui.resolveSpacingLength(node, spacingToken.name) === null
      )) throw Error('This spacing variable is unavailable for the selected field.')
      if (textStyleToken && (
        !ui.textStyleProperties.includes(property) || requested !== ui.textStyleReference(textStyleToken.name, property) ||
        textStyleToken.source !== textStyleCatalog?.source || !textStyleCatalog.names.includes(textStyleToken.name) ||
        !ui.supportsTextStyle(node) || !ui.textStyleValues(node, textStyleToken.name)
      )) throw Error('This text style is unavailable for the selected text.')
      if (pendingTextStyle && (
        !ui.textStyleProperties.includes(property) ||
        requested !== ui.textStyleReference(pendingTextStyle.name, property, pendingTextStyle.values[property]) ||
        pendingTextStyle.source !== textStyleCatalog?.source || !ui.supportsTextStyle(node)
      )) throw Error('This text style preview is unavailable for the selected text.')
      if (!CSS.supports(property, requested)) throw Error('That value is not valid for this control')
      const baseline = getComputedStyle(node).getPropertyValue(property)
      const prior = node.style.getPropertyValue(property)
      const priorPriority = node.style.getPropertyPriority(property)
      // A shorthand containing a pending variable can serialize all of its
      // longhands as empty strings, even when it supplies the visible paint.
      const background = property === 'background-color' && !prior && node.style.background ? {
        value:node.style.background, priority:node.style.getPropertyPriority('background'),
        longhands:Array.from(node.style).filter(name=>name.startsWith('background-')),
      } : undefined
      if (property === 'padding' && [...node.style].some(key => /^padding-(top|right|bottom|left)$/.test(key))) {
        throw Error('Use individual sides when padding is already set inline')
      }
      const measure = () => {
        const box = node.getBoundingClientRect()
        return property === 'height' ? box.height : box.width
      }
      const dimensions = property === 'width' || property === 'height'
      const beforeSize = dimensions ? measure() : 0
      // Both reads run in the same task so unrelated async layout is not
      // attributed to this declaration. Positions may move in normal flow.
      const siblings = protectSiblingSizes && dimensions && /^\d+(?:\.\d+)?px$/.test(requested)
        ? [node.previousElementSibling, node.nextElementSibling].filter(Boolean)
          .map(sibling => ({ sibling, before: sibling.getBoundingClientRect() }))
          .filter(({ before }) => before.width > 0 && before.height > 0)
        : []
      const hadStyle = siblings.length && node.hasAttribute('style')
      node.style.setProperty(property, requested)
      const declared = node.style.getPropertyValue(property)
      const entry = { node, property, requested: declared, before: baseline, prior, priorPriority, background, colorToken, pendingColor, spacingToken, textStyleToken, pendingTextStyle }
      temporary.add(entry)
      if (siblings.some(({ sibling, before }) => {
        const after = sibling.getBoundingClientRect()
        return Math.abs(after.width - before.width) > 0.5 || Math.abs(after.height - before.height) > 0.5
      })) {
        discardTemporary(entry)
        if (!hadStyle && node.getAttribute('style') === '') node.removeAttribute('style')
        throw Error('This size also resizes a neighboring element. No change was saved.')
      }
      let observed = getComputedStyle(node).getPropertyValue(property)
      const mode = ['100%', 'fit-content'].includes(requested)
      const changedSize = () => Math.abs(measure() - beforeSize) > 0.5
      const sameValue = () => observed === declared || observed === requested ||
        (['min-width', 'min-height'].includes(property) && requested === 'auto' && observed === '0px')
      const verified = () => {
        if (colorToken) return ui.ownsPreviewDeclaration(entry) && observed === ui.resolveColorVariable(node, colorToken.name)
        if (spacingToken) return ui.ownsPreviewDeclaration(entry) && ui.spacingVariableMatches(node, property, spacingToken.name, observed)
        if (textStyleToken || pendingTextStyle) return ui.ownsPreviewDeclaration(entry) && ui.textStyleMatches(
          observed, pendingTextStyle?.values[property] ?? ui.textStyleValues(node, textStyleToken.name)?.[property],
        )
        if (mode) return changedSize()
        return sameValue() && (!dimensions || changedSize() || baseline === observed)
      }
      if (!await ui.waitForPreview(()=>isCurrent()&&node.isConnected,()=>{
        observed=getComputedStyle(node).getPropertyValue(property)
        return verified()
      })) {
        discardTemporary(entry)
        throw Error(dimensions ? 'The box did not resize as requested. Check its layout constraints.' : 'The browser kept a different value')
      }
      entry.observed = observed
      return entry
    }
    function discardTemporary(entry) {
      if (temporary.delete(entry)) remove(entry)
    }
    return { apply, remove, temporary, discardTemporary }
  }
})()
