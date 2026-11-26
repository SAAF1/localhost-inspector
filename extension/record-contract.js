(() => {
  const ui=window.LocalhostInspector
  const known=new Map()
  let subscription = ''
  function publish() {
    if (subscription) document.dispatchEvent(new CustomEvent('li-watch-records',{detail:subscription}))
  }
  document.addEventListener('li-read-record-watch',publish)
  function watch(proofs) {
    const anchors = new Set(), files = new Set(), hooks = new Set()
    for (const proof of proofs) {
      anchors.add(proof.anchor.id)
      hooks.add(proof.authority.id)
      for (const source of [proof.anchor,proof.part,proof.authority,...(proof.renderPath ?? []),...(proof.statePath ?? [])]) files.add(source.file)
    }
    const next = JSON.stringify({anchors:[...anchors],files:[...files],hooks:[...hooks]})
    if (next===subscription) return
    subscription=next
    publish()
  }
  function read(node,mode) {
    let proof
    const receive=e=>{try{proof=JSON.parse(e.detail)}catch{/* Unavailable development evidence. */}}
    node.addEventListener('li-record-contract',receive)
    try{node.dispatchEvent(new CustomEvent('li-read-record-contract',{bubbles:true,detail:mode}))}
    finally{node.removeEventListener('li-record-contract',receive)}
    return proof
  }
  function same(a,b,legacy=false){
    return a && b && a.kind===b.kind && a.field===b.field &&
      (legacy || JSON.stringify(a.statePath)===JSON.stringify(b.statePath)) &&
      JSON.stringify(a.renderPath)===JSON.stringify(b.renderPath) && a.value===b.value && a.witness===b.witness &&
      ['anchor','part','authority'].every(k=>a[k].id===b[k].id && a[k].file===b[k].file &&
        a[k].revision===b[k].revision)
  }
  function remember(proof){
    if(proof?.kind!=='state-record' || typeof proof.key!=='string')return
    known.set(proof.key,proof)
  }
  async function prepare(node, operation = 'border-radius') {
    const request = {mode:'admit', operation}
    const proof=read(node,request)
    if(!proof)return
    if(proof.unavailable)throw Error('Cannot verify one unique application record and its painted source part. No change was saved.')
    if (proof.operation !== operation) throw Error('This record does not support the requested operation.')
    for(const cached of known.values()){
      if(same(cached,proof))return {...cached,operation,members:proof.members,preparation:'reused'}
    }
    const state=JSON.stringify([proof.part.id,proof.anchor.id,proof.authority.file,proof.authority.id,
      proof.field,proof.value,proof.witness,proof.part.revision,proof.anchor.revision,proof.authority.revision,
      proof.renderPath.map(site=>[site.file,site.owner,site.revision]),proof.statePath.map(site=>[site.file,site.owner,site.revision])])
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(state))
    proof.key='bound:'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')
    if(!same(proof,read(node,request)))throw Error('The selected record changed during verification. No change was saved.')
    // An explicit edit on the same live record can renew a pre-state-path
    // receipt. Its old ID and values remain available to Undo.
    for (const previous of known.values()) {
      if (!previous.statePath && same(previous,proof,true)) proof.requalifiedKey=previous.key
    }
    proof.preparation='prepared'
    remember(proof)
    return proof
  }
  function matches(node,key) {
    const expected=known.get(key)
    return Boolean(expected && node && same(expected,read(node,{mode:'restore',anchor:expected.anchor.id,value:expected.value,legacy:!expected.statePath}),!expected.statePath))
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
  ui.recordContracts={watch,prepare,remember,matches,candidates,available}
})()

