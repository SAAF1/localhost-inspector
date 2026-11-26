import assert from 'node:assert/strict'
import test from 'node:test'
import { VariantWindow, WindowedVariant } from '../scripts/flow/variant-window.mjs'

test('zoom-out prepares newly exposed edges and releases those pictures at rest', () => {
  const window = new VariantWindow()
  const card = (id, x, y) => {
    const handle = new WindowedVariant(null, { id }, 0, () => ({ canRelease: true, remove() {} }), window.mounted)
    handle.bounds = { x, y, width: 300, height: 200, labelHeight: 0 }
    return handle
  }
  const frames = [
    card('center', 0, 0), card('left', -7900, 0), card('right', 27100, 0),
    card('top', 0, -6100), card('bottom', 0, 22400), card('distant', 31000, 0),
  ]
  window.rebuild(frames)
  // Pinch around an off-center point. The right and bottom edges travel farther.
  const previous = { x: 200, y: 150, scale: 0.05 }
  const current = { ...previous, scale: 0.04 }
  const mounted = () => [...window.mounted].map(frame => frame.variant).sort()
  window.pictures(current, 1000, 800, true, previous, 2)
  assert.deepEqual(mounted(), ['bottom', 'center', 'left', 'right', 'top'])
  window.pictures(current, 1000, 800, true, current, 0)
  assert.deepEqual(mounted(), ['center'])
})
