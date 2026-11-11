export const fixture = `<!doctype html><style>
  body{margin:24px;font:14px sans-serif;background:#eee}
  #target{box-sizing:border-box;display:flex;flex-direction:row;align-items:center;justify-content:start;
    width:240px;height:100px;padding:16px;gap:8px;border:1px solid #1c1c1c;border-radius:0;
    font-size:12px;line-height:16px;letter-spacing:0;color:#1c1c1c;background:#fff}
  #target span{width:24px;height:20px;flex:none;background:#ddd}
  #other{display:block;margin-top:24px;width:120px;height:30px}
</style><div id="target"><span>One</span><span>Two</span></div><button id="other">Other target</button>
<div role="dialog" id="dialog">Overlay target</div>`
