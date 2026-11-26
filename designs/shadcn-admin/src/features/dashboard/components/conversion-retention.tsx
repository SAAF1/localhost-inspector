import { useState } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import './reports.css'

const stages = ['Visited site', 'Viewed product', 'Started checkout', 'Purchased']
const channels = [
  { name: 'Organic search', counts: [12600, 5100, 2640, 1320] },
  { name: 'Paid search', counts: [9600, 3040, 1760, 660] },
  { name: 'Referral', counts: [5400, 2820, 1740, 990] },
  { name: 'Direct', counts: [4400, 2040, 1260, 730] },
]
const allCounts = stages.map((_, stage) =>
  channels.reduce((total, channel) => total + channel.counts[stage], 0)
)
const cohorts = [
  { month: 'June', size: 248, returning: [182, 157, 141, 132, 126] },
  { month: 'July', size: 301, returning: [223, 196, 175, 169] },
  { month: 'August', size: 285, returning: [217, 192, 174] },
  { month: 'September', size: 362, returning: [280, 254] },
  { month: 'October', size: 409, returning: [328] },
  { month: 'November', size: 452, returning: [] },
]
const ageMonths = [1, 2, 3, 4, 5]
const eligible = cohorts.filter((cohort) => cohort.returning.length > 0)
const monthOneReturned = eligible.reduce((total, cohort) => total + cohort.returning[0], 0)
const monthOneEligible = eligible.reduce((total, cohort) => total + cohort.size, 0)

const count = new Intl.NumberFormat('en-US')
const percentage = (part: number, total: number, precision = 0) =>
  ((part / total) * 100).toFixed(precision) + '%'

function ConversionFunnel() {
  const [channel, setChannel] = useState('All channels')
  const totals = channels.find(({ name }) => name === channel)?.counts ?? allCounts
  const dropoffs = totals.slice(1).map((total, index) => (totals[index] - total) / totals[index])
  const biggestDrop = Math.max(...dropoffs)

  return (
    <section aria-labelledby='conversion-heading' className='combined-funnel'>
      <div className='combined-section-heading'>
        <div>
          <h3 id='conversion-heading'>Conversion funnel</h3>
          <p>October 1–31, 2026</p>
        </div>
        <Select value={channel} onValueChange={setChannel}>
          <SelectTrigger aria-label='Funnel acquisition channel'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='All channels'>All channels</SelectItem>
            {channels.map(({ name }) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className='combined-stat' aria-live='polite'>
        <strong>{percentage(totals[3], totals[0], 1)}</strong>
        <span>of site visitors purchased</span>
      </div>
      <ol className='combined-stages' aria-label='Funnel stages'>
        {stages.map((stage, index) => (
          <li key={stage}>
            <div className='combined-stage-label'>
              <span>{stage}</span>
              <strong>{count.format(totals[index])}</strong>
            </div>
            <div className='combined-bar-rail' aria-hidden='true'>
              <div className='combined-bar' style={{ width: percentage(totals[index], totals[0], 1) }} />
            </div>
            {index > 0 && (
              <p className={dropoffs[index - 1] === biggestDrop ? 'combined-largest-drop' : undefined}>
                {percentage(totals[index - 1] - totals[index], totals[index - 1], 1)} drop-off
                {dropoffs[index - 1] === biggestDrop ? ' · largest' : ''}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className='combined-method'>Bar length uses all visitors in the selected channel. Drop-off compares with the previous step.</p>
    </section>
  )
}

function CohortRetention() {
  const [selected, setSelected] = useState({ row: 4, age: 1 })
  const cohort = cohorts[selected.row]
  const observation = cohorts[selected.row + selected.age]
  const returned = cohort.returning[selected.age - 1]

  return (
    <section aria-labelledby='retention-heading' className='combined-retention'>
      <div className='combined-section-heading'>
        <div>
          <h3 id='retention-heading'>Cohort retention</h3>
          <p>June–November 2026 signup cohorts</p>
        </div>
      </div>
      <div className='combined-stat'>
        <strong>{percentage(monthOneReturned, monthOneEligible)}</strong>
        <span>returned the month after signup</span>
      </div>
      <div className='combined-cohort-scroll'>
        <table className='combined-cohort-table'>
          <caption className='sr-only'>Share of each signup cohort who returned, by month since signup. Choose a rate to see its customer count.</caption>
          <thead>
            <tr>
              <th scope='col'>Signup</th>
              <th scope='col' className='combined-cohort-size'>Joined</th>
              {ageMonths.map((age) => <th key={age} scope='col'><span aria-hidden='true'>M{age}</span><span className='sr-only'>Month {age}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {cohorts.map(({ month, size, returning }, row) => (
              <tr key={month}>
                <th scope='row'><abbr title={month}>{month.slice(0, 3)}</abbr></th>
                <td className='combined-cohort-size'>{count.format(size)}</td>
                {ageMonths.map((age) => {
                  const returningCount = returning[age - 1]
                  if (returningCount === undefined) {
                    return <td key={age} className='combined-unobserved'><span aria-label='Not yet observed'>—</span></td>
                  }
                  const rate = returningCount / size
                  return (
                    <td key={age}>
                      <button
                        type='button'
                        className='combined-cell'
                        style={{ background: `color-mix(in oklab, var(--report-accent) ${Math.round((rate - 0.4) * 90 + 8)}%, var(--background))` }}
                        aria-pressed={selected.row === row && selected.age === age}
                        aria-label={`${month}, month ${age}, ${percentage(returningCount, size)} retained`}
                        onClick={() => setSelected({ row, age })}
                      >
                        {percentage(returningCount, size)}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className='combined-detail' aria-live='polite'>
        <strong>{cohort.month} cohort · Month {selected.age}</strong>
        <span>{count.format(returned)} of {count.format(cohort.size)} customers returned in {observation.month}.</span>
      </p>
      <p className='combined-method'>M1 is the month after signup. Dashes mark months still to be observed. The summary uses only cohorts with a full first month.</p>
    </section>
  )
}

export function Reports() {
  return (
    <article aria-labelledby='combined-report-heading' className='combined-report'>
      <header className='combined-report-heading'>
        <h2 id='combined-report-heading'>Conversion &amp; retention</h2>
        <p>See where site visitors drop off and when signup cohorts come back.</p>
      </header>
      <div className='combined-report-body'>
        <ConversionFunnel />
        <CohortRetention />
      </div>
    </article>
  )
}
