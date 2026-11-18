(() => {
  const ui = window.LocalhostInspector
  const attribute = 'data-inspector-shared-vertical-padding'
  const properties = ['padding-top', 'padding-bottom']
  const maxMembers = 20

  // The app marks elements whose two padding declarations share an authored
  // owner. A common parent bounds this to one rendered collection.
  function members(node) {
    const name = node?.getAttribute(attribute)
    if (!node?.isConnected || !node.parentElement || !/^[a-z0-9_-]{1,80}$/i.test(name ?? '')) return []
    const peers = Array.from(node.parentElement.children).filter(child => child.getAttribute(attribute) === name)
    if (peers.length < 2 || peers.length > maxMembers) return []
    return peers.every(peer => {
      if (!(peer instanceof HTMLElement) || peer.localName !== node.localName) return false
      const style = getComputedStyle(peer)
      const target = ui.describePreviewTarget(peer)
      return target.key && ui.findPreviewTarget(target, peer) === peer &&
        style.display !== 'none' && ui.canApplyPadding(style) &&
        peer.getClientRects().length > 0
    }) ? peers : []
  }

  function matchesGroup(edits) {
    const first = edits[0]
    const node = ui.findPreviewTarget(first.target)
    const peers = members(node)
    const keys = new Set(edits.map(edit => edit.target.key))
    return node?.getAttribute(attribute) === first.sharedPadding &&
      peers.length === keys.size && peers.every(peer => keys.has(peer.getAttribute('data-inspector-target')))
  }

  ui.sharedPadding = { attribute, members, matchesGroup, properties }
})()
