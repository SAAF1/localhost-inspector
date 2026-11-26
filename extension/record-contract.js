(() => {
  const ui=window.LocalhostInspector
  const known=new Map()
  function read(node,mode) {
    let proof
    const receive=e=>{try{proof=JSON.parse(e.detail)}catch{/* Unavailable development evidence. */}}
    node.addEventListener('li-record-contract',receive)
    try{node.dispatchEvent(new CustomEvent('li-read-record-contract',{bubbles:true,detail:mode}))}
    finally{node.removeEventListener('li-record-contract',receive)}
    return proof
  }
  function same(a,b){
    return a && b && a.kind===b.kind && a.operation===b.operation && a.field===b.field &&
      a.value===b.value && a.witness===b.witness &&
      ['anchor','part','authority'].every(k=>a[k].id===b[k].id && a[k].file===b[k].file &&
        a[k].revision===b[k].revision)
  }
  function remember(proof){
    if(proof?.kind==='state-record' && typeof proof.key==='string')known.set(proof.key,proof)
  }
  async function prepare(node) {
    const proof=read(node,'admit')
    if(!proof)return
    if(proof.unavailable)throw Error('Cannot verify one unique application record and its painted source part. No change was saved.')
    const state=JSON.stringify([proof.part.id,proof.anchor.id,proof.authority.file,proof.authority.id,
      proof.field,proof.value,proof.witness])
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(state))
    proof.key='bound:'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')
    if(!same(proof,read(node,'admit')))return
    remember(proof)
    return proof
  }
  function matches(node,key) {
    const expected=known.get(key)
    return Boolean(expected && node && same(expected,read(node,'restore')))
  }
  function candidates(key){
    const expected=known.get(key)
    if(!expected)return []
    const {id,file,owner}=expected.part
    const value=JSON.stringify({id,file,owner})
    const nodes=document.querySelectorAll('[data-li-source-use="'+CSS.escape(value)+'"]')
    return nodes.length>128?[]:[...nodes].filter(n=>matches(n,key))
  }
  function available(node){return read(node,'admit')?.kind==='state-record'}
  ui.recordContracts={prepare,remember,matches,candidates,available}
})()

