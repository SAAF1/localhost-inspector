import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'

function Circle() { return <svg aria-label="Circle"><circle r="4" cx="5" cy="5"/></svg> }
export function Square() { return <svg aria-label="Square"><rect width="8" height="8"/></svg> }

function Action({ tone, icon, loading, onClick, ...rest }) {
  return <button {...rest} onClick={onClick} className={tone}>{loading ? 'Loading' : icon} Run</button>
}

function Row({ name, wide, loading, onClick }) {
  return <article aria-label={name}>
    <div className="part" style={{ display: 'flex', gap: wide ? 14 : 8 }}>
      <span>{name}</span><span>Ready</span>
    </div>
    <Action aria-label="Job action" tone="quiet" icon={<Circle />} loading={loading} onClick={onClick}/>
  </article>
}
function Queue() {
  const [reverse, order] = useState(false)
  const [other, scene] = useState(false)
  const [wide, size] = useState(false)
  const [loading, wait] = useState(false)
  const [runs, run] = useState(0)
  return <main>
    <nav>
      <button onClick={() => order(!reverse)}>Reverse</button>
      <button onClick={() => scene(!other)}>Scene</button>
      <button onClick={() => size(!wide)}>Density</button>
      <button onClick={() => wait(!loading)}>Loading</button>
      <button onClick={() => document.documentElement.toggleAttribute('data-dark')}>Theme</button>
    </nav>
    <output>Runs {runs}</output>
    {(other ? ['Archive'] : reverse ? ['Review','Build'] : ['Build','Review']).map(name =>
      <Row key={name} {...{ name, wide, loading }} onClick={() => run(runs + 1)}/>)}
    <aside><div className="part" style={{ display: 'flex', gap: 8 }}>Independent part</div>
      <Action tone="quiet" icon={<Circle />} onClick={() => run(runs + 1)}/></aside>
  </main>
}
createRoot(document.getElementById('root')).render(React.createElement(Queue))
