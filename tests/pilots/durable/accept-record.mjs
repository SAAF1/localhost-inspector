import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { chromium } from 'playwright'
import { candidateHandoff, helperResult } from '../../../scripts/proposal-journal.mjs'
import { keepStudio } from '../../../scripts/keep-studio.mjs'
import { acceptProposal } from '../../../scripts/proposal.mjs'
import { host, port } from './hosts.mjs'

if (process.platform !== 'linux') throw Error('Use the isolated Linux browser runner.')
const [directory,output]=process.argv.slice(2).map(path=>resolve(path))
const studio=JSON.parse(await readFile(join(directory,'studio.json'),'utf8'))
const [original,candidate]=studio.versions
const result={}
let browser
async function ordinary(app,expected) {
  const server=await host(app,'','',await port(),true)
  const page=await browser.newPage()
  try {
    await page.goto(server.origin)
    const cards=page.locator('article.book-card')
    const rows=async()=>{
      await cards.first().waitFor()
      assert.equal(await page.locator('#localhost-inspector,[data-li-record-scope],[data-inspector-target]').count(),0)
      const observed=await cards.evaluateAll(nodes=>nodes.map(node=>[node.querySelector('.card-text button').textContent,getComputedStyle(node).borderRadius]))
      assert.equal(observed.length,6)
      assert.equal(observed.filter(([title])=>title==='Atomic Habits').length,1)
      for(const [title,radius] of observed)assert.equal(radius,title==='Atomic Habits'?expected:'0px')
      return observed
    }
    const first=await rows()
    await cards.filter({hasText:'Atomic Habits'}).locator('.cover-link').click()
    await page.locator('.book-overview').waitFor()
    await page.locator('.back').click()
    const returned=await rows()
    await page.reload()
    return {first,returned,reloaded:await rows()}
  } finally {await page.close();await server.close()}
}
try{
  process.env.INSPECTOR_HELPER_PORT=String(studio.helperPort)
  const plan=candidateHandoff(candidate.directory)
  assert.equal(plan.operations.length,1)
  assert.equal(plan.operations[0].scope,'selected-record')
  result.plan=plan.operations
  result.staged=keepStudio(candidate.directory)
  browser=await chromium.launch({headless:true})
  result.ordinaryCandidate=await ordinary(candidate.app,'17px')
  const report=join(directory,'verified-record-radius-report.json')
  await writeFile(report,JSON.stringify({projectId:plan.project.id,revision:plan.revision,verified:[{
    id:plan.operations[0].id,summary:'Verified selected record and five unaffected peers in ordinary Vite after detail return and reload.'
  }]}))
  result.completed=helperResult(join(directory,'helper'),'complete',String(candidate.port),report)
  assert.deepEqual(candidateHandoff(candidate.directory).operations,[])
  result.originalBefore=await ordinary(original.app,'0px')
  result.accepted=await acceptProposal(candidate.directory)
  result.acceptedOrdinary=await ordinary(original.app,'17px')
  result.diff=execFileSync('git',['diff'],{cwd:original.app,encoding:'utf8'})
  assert.doesNotMatch(result.diff,/data-li-|__inspector|--li-/)
}catch(error){result.error=error.stack;process.exitCode=1}
finally{await browser?.close();await writeFile(output,JSON.stringify(result,null,2))}
