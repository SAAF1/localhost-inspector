(() => {
  const ui = window.LocalhostInspector
  const pixel = document.createElement('canvas')
  pixel.width = pixel.height = 1
  const context = pixel.getContext('2d', { willReadFrequently: true })

  function rgba(value) {
    if (!context || !CSS.supports('color', value)) return [0, 0, 0, 255]
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const alpha = context.getImageData(0, 0, 1, 1).data[3]
    // Read RGB at full opacity so low-alpha colors retain usable slider coordinates.
    context.fillStyle = 'color(from ' + value + ' srgb r g b / 1)'
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
    return [red, green, blue, alpha]
  }

  // Hex is a display approximation for colors outside 8-bit sRGB.
  ui.colorFieldText = value => {
    const color = ui.normalizeSolidColor(value)
    if (!color || !context) return ui.colorText(value)
    const channels = rgba(color)
    if (channels[3] === 255) channels.pop()
    return channels.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()
  }

  function hsv(red, green, blue) {
    const [r, g, b] = [red / 255, green / 255, blue / 255]
    const max = Math.max(r, g, b)
    const delta = max - Math.min(r, g, b)
    let hue = 0
    if (delta && max === r) hue = (g - b) / delta
    else if (delta && max === g) hue = 2 + (b - r) / delta
    else if (delta) hue = 4 + (r - g) / delta
    return { hue: (hue * 60 + 360) % 360, saturation: max ? delta / max : 0, brightness: max }
  }

  function rgb(hue, saturation, brightness) {
    return [5, 3, 1].map(offset => {
      const step = (offset + hue / 60) % 6
      return Math.round(255 * (brightness - brightness * saturation * Math.max(0, Math.min(step, 4 - step, 1))))
    })
  }

  const clamp = value => Math.min(1, Math.max(0, value))

  ui.solidColorPicker = (initialValue, onChange) => {
    const panel = ui.element('div', 'li-solid-color')
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-label', 'Custom')
    const plane = ui.element('button', 'li-color-plane')
    plane.type = 'button'
    plane.setAttribute('aria-label', 'Saturation and brightness. Use arrow keys to adjust.')
    const handle = ui.element('span', 'li-color-reticle')
    plane.append(handle)
    const tracks = ui.element('div', 'li-color-tracks')
    const sliders = ui.element('div', 'li-color-sliders')
    const makeSlider = (label, max) => {
      const slider = ui.element('input', 'li-color-slider')
      slider.type = 'range'
      slider.min = '0'
      slider.max = String(max)
      slider.setAttribute('aria-label', label)
      sliders.append(slider)
      return slider
    }
    const hue = makeSlider('Hue', 360)
    hue.classList.add('li-color-hue')
    const opacity = makeSlider('Opacity', 100)
    opacity.classList.add('li-color-opacity')
    const browser = typeof window.EyeDropper === 'function' ? window : null
    const sample = ui.action('Sample color', 'sampleColor', () => { void sampleColor() }, !browser)
    if (!browser) ui.setTooltip(sample, 'Screen sampling is unavailable in this browser')
    tracks.append(sample, sliders)

    const field = ui.element('label', 'li-field li-solid-color-value')
    field.append(ui.element('span', 'li-prefix', 'Color'))
    const input = ui.element('input')
    input.setAttribute('aria-label', 'Custom color value')
    input.spellcheck = false
    field.append(input)
    const error = ui.element('p', 'li-color-picker-message')
    error.setAttribute('role', 'alert')
    error.hidden = true
    panel.append(plane, tracks, field, error)

    let state
    let currentValue
    let acceptedValue
    let pointer
    let sampler
    let pending = false
    function showError(message) {
      error.textContent = message
      error.hidden = !message
    }
    function display() {
      const { hue: angle, saturation, brightness, alpha } = state
      plane.style.backgroundColor = 'hsl(' + angle + ' 100% 50%)'
      handle.style.left = saturation * 100 + '%'
      handle.style.top = (1 - brightness) * 100 + '%'
      hue.value = String(Math.round(angle))
      opacity.value = String(Math.round(alpha * 100))
      opacity.style.setProperty('--li-picked-rgb', rgb(angle, saturation, brightness).join(' '))
      input.value = ui.colorText(currentValue)
    }
    function reset(value) {
      acceptedValue = currentValue = value
      const [red, green, blue, alpha] = rgba(value)
      state = { ...hsv(red, green, blue), alpha: alpha / 255 }
      display()
    }
    function updateValue() {
      const { hue: angle, saturation, brightness, alpha } = state
      currentValue = 'rgb(' + rgb(angle, saturation, brightness).join(' ') + ' / ' + alpha + ')'
      display()
    }
    async function commit(value = currentValue) {
      if (pending) return
      const next = ui.normalizeSolidColor(ui.colorValue(value.trim()))
      if (!next) { showError('Enter a solid color.'); return }
      pending = true
      showError('')
      panel.setAttribute('aria-busy', 'true')
      try {
        await onChange(next)
        if (panel.isConnected) reset(next)
      } catch (cause) {
        if (panel.isConnected) {
          reset(acceptedValue)
          showError(cause.message || 'Could not apply color.')
        }
      } finally {
        pending = false
        panel.removeAttribute('aria-busy')
      }
    }
    function move(event) {
      const bounds = plane.getBoundingClientRect()
      state.saturation = clamp((event.clientX - bounds.left) / bounds.width)
      state.brightness = 1 - clamp((event.clientY - bounds.top) / bounds.height)
      updateValue()
    }
    plane.onpointerdown = event => {
      if (event.button !== 0 || pending) return
      pointer = { id: event.pointerId, value: currentValue }
      plane.setPointerCapture(event.pointerId)
      move(event)
    }
    plane.onpointermove = event => { if (pointer?.id === event.pointerId) move(event) }
    plane.onpointerup = event => {
      if (pointer?.id !== event.pointerId) return
      pointer = null
      void commit()
    }
    plane.onlostpointercapture = () => {
      if (pointer) reset(pointer.value)
      pointer = null
    }
    plane.onkeydown = event => {
      const axes = { ArrowLeft: ['saturation', -1], ArrowRight: ['saturation', 1], ArrowUp: ['brightness', 1], ArrowDown: ['brightness', -1] }
      const axis = axes[event.key]
      if (!axis || pending) return
      event.preventDefault()
      const [key, step] = axis
      state[key] = clamp(state[key] + step * (event.shiftKey ? 0.1 : 0.01))
      updateValue()
      void commit()
    }
    hue.oninput = () => { if (pending) { display(); return } state.hue = Number(hue.value); updateValue() }
    opacity.oninput = () => { if (pending) { display(); return } state.alpha = Number(opacity.value) / 100; updateValue() }
    hue.onchange = opacity.onchange = () => { void commit() }
    input.onchange = () => { void commit(input.value) }
    input.onkeydown = event => {
      if (event.key !== 'Enter' || event.isComposing) return
      event.preventDefault()
      void commit(input.value)
    }

    function stopSampling() { sampler?.abort() }
    async function sampleColor() {
      if (!browser || sampler || pending) return
      const controller = new AbortController()
      sampler = controller
      showError('')
      try {
        const { sRGBHex } = await new browser.EyeDropper().open({ signal: controller.signal })
        if (panel.isConnected && !controller.signal.aborted) await commit(sRGBHex)
      } catch (cause) {
        if (panel.isConnected && cause.name !== 'AbortError') showError('Could not sample color. Try the color controls.')
      } finally {
        sampler = null
      }
    }
    reset(initialValue)
    return { panel, reset, stopSampling }
  }
})()
