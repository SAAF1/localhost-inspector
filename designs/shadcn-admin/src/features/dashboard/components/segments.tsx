import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const months = ['June', 'July', 'August', 'September', 'October', 'November']
const sizes = [248, 301, 285, 362, 409, 452]
const returning = [
  [248, 182, 157, 141, 132, 126],
  [301, 223, 196, 175, 169],
  [285, 217, 192, 174],
  [362, 280, 254],
  [409, 328],
  [452],
]
const shades = [
  'bg-chart-2/10',
  'bg-chart-2/20',
  'bg-chart-2/30',
  'bg-chart-2/40',
  'bg-chart-2/50',
]
const rate = (row: number, month: number) =>
  Math.round((returning[row][month] / sizes[row]) * 100)
const shade = (value: number) =>
  shades[value < 55 ? 0 : value < 65 ? 1 : value < 75 ? 2 : value < 85 ? 3 : 4]
const format = (n: number) => n.toLocaleString('en-US')

export function Reports() {
  const [display, setDisplay] = useState('rate')
  const [selected, setSelected] = useState({ row: 4, month: 1 })
  const { row, month } = selected
  const percentage = rate(row, month)
  const nextMonth = Math.round(
    (returning.slice(0, -1).reduce((sum, group) => sum + group[1], 0) /
      sizes.slice(0, -1).reduce((a, b) => a + b, 0)) *
      100
  )
  return (
    <section aria-label='Customer retention' className='space-y-5'>
      <div>
        <h2 className='text-2xl font-semibold tracking-tight'>
          Customer retention
        </h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          Track how often customers return after their first month.
        </p>
      </div>
      <div className='grid gap-3 sm:grid-cols-3'>
        {[
          [
            'New customers',
            format(sizes.reduce((a, b) => a + b, 0)),
            'Across six monthly cohorts',
          ],
          [
            'First-month retention',
            nextMonth + '%',
            'Weighted across eligible cohorts',
          ],
          ['Highest first-month retention', '80%', 'October cohort'],
        ].map(([label, value, detail]) => (
          <Card key={label} className='gap-2 py-4'>
            <CardHeader className='px-5'>
              <CardDescription>{label}</CardDescription>
            </CardHeader>
            <CardContent className='px-5'>
              <p className='text-2xl font-semibold tracking-tight tabular-nums'>
                {value}
              </p>
              <p className='mt-1 text-xs text-muted-foreground'>{detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card className='gap-5'>
        <CardHeader className='flex flex-wrap items-start justify-between gap-3'>
          <div className='space-y-1.5'>
            <CardTitle>Retention by cohort</CardTitle>
            <CardDescription>June – November 2026</CardDescription>
          </div>
          <Select value={display} onValueChange={setDisplay}>
            <SelectTrigger aria-label='Matrix values' className='w-40'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='rate'>Retention rate</SelectItem>
              <SelectItem value='count'>Customer count</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className='space-y-5'>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[600px] border-separate border-spacing-1 text-sm'>
              <caption className='sr-only'>
                Returning customers grouped by signup month. Select a cell for
                details.
              </caption>
              <thead>
                <tr className='text-xs text-muted-foreground'>
                  <th scope='col' className='pb-2 text-left font-medium'>
                    Signup cohort
                  </th>
                  {months.map((label, i) => (
                    <th key={label} scope='col' className='pb-2 font-medium'>
                      Month {i}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map((label, r) => (
                  <tr key={label}>
                    <th
                      scope='row'
                      className='pr-3 text-left font-medium whitespace-nowrap'
                    >
                      {label}
                    </th>
                    {months.map((_, m) => (
                      <td key={m} className='h-10 p-0 text-center'>
                        {m < returning[r].length ? (
                          <button
                            aria-label={
                              label +
                              ', month ' +
                              m +
                              ', ' +
                              rate(r, m) +
                              '% retained'
                            }
                            aria-pressed={r === row && m === month}
                            onClick={() => setSelected({ row: r, month: m })}
                            className={
                              'h-full w-full rounded-md px-2 font-medium tabular-nums outline-offset-1 hover:ring-1 hover:ring-foreground/50 focus-visible:outline-2 aria-pressed:ring-2 aria-pressed:ring-foreground ' +
                              shade(rate(r, m))
                            }
                          >
                            {display === 'rate'
                              ? rate(r, m) + '%'
                              : format(returning[r][m])}
                          </button>
                        ) : (
                          <span
                            className='text-muted-foreground/50'
                            aria-label='Not yet observed'
                          >
                            —
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className='flex items-center justify-end gap-2 text-xs text-muted-foreground'>
            <span>Lower retention</span>
            <span aria-hidden='true' className='flex gap-0.5'>
              {shades.map((color) => (
                <i key={color} className={'h-2.5 w-4 rounded-sm ' + color} />
              ))}
            </span>
            <span>Higher</span>
          </div>
          <div
            aria-live='polite'
            className='flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 px-4 py-3'
          >
            <div>
              <p className='font-semibold'>
                {months[row]} cohort · Month {month}
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {month === 0
                  ? format(sizes[row]) +
                    ' customers joined in ' +
                    months[row] +
                    '.'
                  : format(returning[row][month]) +
                    ' of ' +
                    format(sizes[row]) +
                    ' customers returned in ' +
                    months[row + month] +
                    '.'}
              </p>
            </div>
            <span className='text-2xl font-semibold tabular-nums'>
              {percentage}%
            </span>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
