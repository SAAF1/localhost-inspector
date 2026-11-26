// Original one-book request. Use only on a disposable studio in the isolated Linux runner.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'
import { candidateHandoff } from '../../../scripts/proposal-journal.mjs'
import { installedControls } from './installed-controls.mjs'

if (process.platform !== 'linux') throw Error('Run this trial in the isolated Linux browser runner.')
const [studio, output] = process.argv.slice(2).map(p => resolve(p))
const trace = []
let context
try {
  const session = await openStudio(studio,{id:'a',route:'/',headless:true})
  context = session.context
  const {page,worker,version}=session
  await page.setViewportSize({width:1920,height:1080})
  const {panel,until}=installedControls(page,worker)
  const frame=page.frameLocator('#app-preview')
  const cards=frame.locator('article.book-card')
  const rows=()=>cards.evaluateAll(nodes=>nodes.map(n=>({title:n.querySelector('.card-text button').textContent,
    radius:getComputedStyle(n).borderRadius,key:n.getAttribute('data-inspector-target')})))
  const original='Atomic Habits'
  const selected=cards.filter({has:frame.getByRole('button',{name:original,exact:true})})
  const matches=(values,radius)=>values.length===6 && values.filter(v=>v.title===original).length===1 &&
    values.every(v=>v.radius===(v.title===original?radius:'0px'))
  const verify=async (step,radius)=>{
    await until(async()=>matches(await rows(),radius),step)
    trace.push({step,rows:await rows()})
  }
  async function choose() {
    await selected.locator('.card-text button').click({modifiers:['Meta']})
    await panel('#parent'); await panel('#parent')
    await panel('#authored-edit-scope','','keyboard')
    await page.keyboard.press('End');await page.keyboard.press('Enter')
    await until(async()=>(await panel('#prepared-scope','',false)).includes('One record'), 'Selected-record scope')
  }
  async function radius(px) {
    await panel('#control-border-radius')
    await page.keyboard.press('Control+a');await page.keyboard.type(String(px));await page.keyboard.press('Enter')
  }
  await verify('original','0px')
  await choose();await radius(17);await verify('one-book radius','17px')
  await panel('#edits-tab');await panel('.li-pending-open');await verify('saved inspection','17px')
  await selected.locator('.cover-link').click()
  await frame.locator('.book-overview').waitFor()
  await frame.locator('.back').click()
  await verify('detail and return','17px')
  await page.reload()
  await verify('reload','17px')
  await panel('#edits-tab');await panel('#undo');await verify('undo','0px')
  await panel('#design-tab');await choose();await radius(17);await verify('request restored for acceptance','17px')
  const handoff=candidateHandoff(version.directory)
  assert.equal(handoff.operations.length,1)
  const [op]=handoff.operations
  assert.equal(op.status,'pending'); assert.equal(op.scope,'selected-record')
  assert.equal(op.changes[0].recordScope.value,'atomic-habits')
  trace.push({step:'source handoff',op})
} catch(error) {trace.push({error:error.stack});process.exitCode=1}
finally {await context?.close();await writeFile(output,JSON.stringify(trace,null,2))}
