(() => {
  'use strict'
  const ui = window.LocalhostInspector = window.LocalhostInspector || {}
  const markup = {
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
