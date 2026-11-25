export function installedControls(page, worker) {
  async function panel(selector, label = '', click = true) {
    const limit = Date.now() + 6000
    let result
    do {
      result = await worker.evaluate(
        async ({ origin, selector, label, keyboard }) => {
          const [tab] = await chrome.tabs.query({ url: origin + '/__inspector-flow/*' })
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (selector, label, keyboard) => {
              const host = document.querySelector('#localhost-inspector')
              const root = host && chrome.dom.openOrClosedShadowRoot(host)
              const node = [...(root?.querySelectorAll(selector) ?? [])].find(
                (n) =>
                  !n.disabled &&
                  !n.hidden &&
                  n.getClientRects().length &&
                  n.textContent.toLowerCase().includes(label.toLowerCase()),
              )
              if (!node)
                return {
                  info: root?.textContent?.slice(-1400),
                  shell: document.body.outerHTML.slice(0, 160),
                  iframe: document.querySelector('#app-preview')?.outerHTML.slice(0, 300),
                  dock: document.querySelector('#localhost-inspector-dock')?.outerHTML.slice(0, 300),
                }
              if (keyboard) node.focus()
              node.scrollIntoView({ block: 'nearest' })
              const r = node.getBoundingClientRect()
              return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: node.textContent }
            },
            args: [selector, label, keyboard],
          })
          return result
        },
        { origin: new URL(page.url()).origin, selector, label, keyboard: click === 'keyboard' },
      )
      if (result?.x !== undefined) {
        if (click === 'keyboard') await page.keyboard.press('Enter')
        else if (click) await page.mouse.click(result.x, result.y)
        return result.text
      }
      await page.waitForTimeout(80)
    } while (Date.now() < limit)
    throw Error('Control unavailable ' + selector + ' ' + label + ' ' + JSON.stringify(result))
  }
  async function until(check, label) {
    for (let i = 0; i < 80; i++) {
      try {
        if (await check()) return
      } catch (error) {
        if (!/Execution context was destroyed|Frame was detached/.test(error.message)) throw error
      }
      await page.waitForTimeout(100)
    }
    throw Error(label)
  }
  return { panel, until }
}
