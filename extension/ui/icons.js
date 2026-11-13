(() => {
  'use strict'
  const ui = window.LocalhostInspector = window.LocalhostInspector || {}
  const markup = {
  "launcherSliders": "<svg fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 16 16\"><path d=\"M2 4h2m3 0h7M2 8h7m3 0h2M2 12h4m3 0h5\"/><circle cx=\"5.5\" cy=\"4\" r=\"1.5\"/><circle cx=\"10.5\" cy=\"8\" r=\"1.5\"/><circle cx=\"7.5\" cy=\"12\" r=\"1.5\"/></svg>",
  "selectParent": "<svg fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 16 16\"><path d=\"M8 3H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8\"/><rect x=\"5\" y=\"7\" width=\"4.5\" height=\"3.5\" rx=\".5\"/><path d=\"M12 6V2m-1.75 1.75L12 2l1.75 1.75\"/></svg>",
  "undoPreview": "<svg fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 16 16\"><path d=\"m6 4-3 3 3 3M3 7h6a4 4 0 0 1 4 4v2\"/></svg>",
  "comparePreview": "<svg fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 16 16\"><rect x=\"2.5\" y=\"2.5\" width=\"11\" height=\"11\" rx=\"1\"/><path d=\"M8 2.5v11\"/></svg>",
  "revertPreviews": "<svg fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" viewBox=\"0 0 16 16\"><path d=\"M2.5 4v4h4m-4 0A5.5 5.5 0 1 1 4 12\"/></svg>",
  "alignmentMark": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"2\" height=\"7\" x=\"3\" y=\"4.5\" fill=\"currentColor\" rx=\"1\"/><rect width=\"2\" height=\"10\" x=\"7\" y=\"3\" fill=\"currentColor\" rx=\"1\"/><rect width=\"2\" height=\"5\" x=\"11\" y=\"5.5\" fill=\"currentColor\" rx=\"1\"/></svg>",
  "minWidth": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M8.5 2v11M2 7.5h5m-2.5-2 2 2-2 2m10.5-2h-5m2.5-2-2 2 2 2\"/></svg>",
  "maxWidth": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" d=\"M1.5 2v12m13-12v12\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M3 8h10M5.5 5.5 3 8l2.5 2.5m5-5L13 8l-2.5 2.5\"/></svg>",
  "minHeight": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" d=\"M2.5 8h12m-6-8v5m0 6v5\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M6 2.5 8.5 5 11 2.5m-5 11L8.5 11l2.5 2.5\"/></svg>",
  "maxHeight": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M2.5 1.5h10m-10 13h10m-5-11v9M5 6l2.5-2.5L10 6m-5 4 2.5 2.5L10 10\"/></svg>",
  "cornerRadius": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M6 2.5H4.5a2 2 0 0 0-2 2V6M10 2.5h1.5a2 2 0 0 1 2 2V6m-11 4v1.5a2 2 0 0 0 2 2H6m7.5-3.5v1.5a2 2 0 0 1-2 2H10\"/></svg>",
  "lineHeight": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M2.5 2.5h11m-11 11h11M5 11l3-8 3 8M6 8.5h4\"/></svg>",
  "letterSpacing": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M2.5 2.5v11m11-11v11m-8.5-3 2.5-6 2.5 6m-4-2h3\"/></svg>",
  "strokeWeight": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M2.5 2.5h11\"/><path stroke=\"currentColor\" d=\"M2.5 5.5h11v2h-11zm0 5h11v3h-11z\"/></svg>",
  "paddingLeft": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"11\" height=\"11\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M4.5 4.5v7\"/></svg>",
  "paddingTop": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"11\" height=\"11\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M4.5 4.5h7\"/></svg>",
  "paddingRight": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"11\" height=\"11\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M11.5 4.5v7\"/></svg>",
  "paddingBottom": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"11\" height=\"11\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M4.5 11.5h7\"/></svg>",
  "paddingHorizontal": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"11\" height=\"11\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M5.5 5.5v5m5-5v5\"/></svg>",
  "paddingVertical": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"11\" height=\"11\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M5.5 5.5h5m-5 5h5\"/></svg>",
  "paddingSidesToggle": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"11\" height=\"11\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M6.5 4.5h3m-3 7h3M4.5 6v4m7-4v4\"/></svg>",
  "gapHorizontal": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M3.5 3.5q1 .5 1 2v5q0 1.5-1 2m9-9q-1 .5-1 2v5q0 1.5 1 2\"/><circle cx=\"8\" cy=\"8\" r=\"1\" fill=\"currentColor\"/></svg>",
  "chevronDown": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M5.5 6.5 8 9l2.5-2.5\"/></svg>",
  "search": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><circle cx=\"7\" cy=\"7\" r=\"4\" stroke=\"currentColor\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"m10 10 3 3\"/></svg>",
  "unlink": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path d=\"m2.5 2.5 11 11M8 4l1.2-1.2a2.8 2.8 0 1 1 4 4L12 8m-4 4-1.2 1.2a2.8 2.8 0 1 1-4-4L4 8\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
  "sampleColor": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"m8 5 3 3m-1-4 2-2a1.4 1.4 0 0 1 2 2l-2 2m-1-1 2 2m-3 1-5 5H3v-2l5-5\"/></svg>",
  "applyVariable": '<svg fill="none" viewBox="0 0 16 16"><path d="m8 2.25 5 2.9v5.7l-5 2.9-5-2.9v-5.7z" stroke="currentColor" stroke-linejoin="round"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>',
  "numberVariable": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><rect x=\"2.5\" y=\"2.5\" width=\"11\" height=\"11\" rx=\"2\" stroke=\"currentColor\"/><path d=\"M6.5 5.5 6 10.5m4-5-.5 5M5 7h6m-6 2h6\" stroke=\"currentColor\" stroke-linecap=\"round\"/></svg>",
  "variables": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><g stroke=\"currentColor\"><circle cx=\"5\" cy=\"5\" r=\"1.75\"/><circle cx=\"11\" cy=\"5\" r=\"1.75\"/><circle cx=\"5\" cy=\"11\" r=\"1.75\"/><circle cx=\"11\" cy=\"11\" r=\"1.75\"/></g></svg>",
  "add": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M8 3v10M3 8h10\"/></svg>",
  "close": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"m5.5 5.5 5 5m0-5-5 5\"/></svg>",
  "dismiss": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M3 3l10 10m0-10L3 13\"/></svg>",
  "minus": "<svg fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M5 8h6\"/></svg>",
  "menuCheck": "<svg fill=\"none\" viewBox=\"0 0 12 12\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"m3.5 5.5 4 3.5L12 1.5\"/></svg>",
  "flowRow": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"4\" height=\"4\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><rect width=\"4\" height=\"4\" x=\"9.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M2.5 11.5h11m-2-2 2 2-2 2\"/></svg>",
  "flowColumn": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><rect width=\"4\" height=\"4\" x=\"2.5\" y=\"2.5\" stroke=\"currentColor\" rx=\"1\"/><rect width=\"4\" height=\"4\" x=\"2.5\" y=\"9.5\" stroke=\"currentColor\" rx=\"1\"/><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M11.5 2.5v11m-2-2 2 2 2-2\"/></svg>",
  "reverseDirection": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M8.5 3.5H10a3 3 0 0 1 0 6H3.5m3-3-3 3 3 3\"/></svg>",
  "textAlignLeft": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M2.5 3.5h11m-11 4h7m-7 4h9\"/></svg>",
  "textAlignCenter": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M2.5 3.5h11m-9 4h7m-8 4h9\"/></svg>",
  "textAlignRight": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M2.5 3.5h11m-7 4h7m-9 4h9\"/></svg>",
  "layoutSettings": "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path stroke=\"currentColor\" stroke-linecap=\"round\" d=\"M4.5 2v3m0 4v5m7-12v7m0 4v1\"/><circle cx=\"4.5\" cy=\"7\" r=\"2\" stroke=\"currentColor\"/><circle cx=\"11.5\" cy=\"11\" r=\"2\" stroke=\"currentColor\"/></svg>"
}
  ui.icon = name => {
    if (!Object.prototype.hasOwnProperty.call(markup, name)) throw new Error('Unknown inspector icon: ' + name)
    const template = document.createElement('template')
    template.innerHTML = markup[name]
    const svg = template.content.firstElementChild
    svg.classList.add('li-icon')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
    return svg
  }
})()
