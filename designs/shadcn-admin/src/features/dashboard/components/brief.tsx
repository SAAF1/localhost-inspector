import { useState } from 'react'
import { ArrowUpRight, CalendarDays } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const periods = [
  {
    month: 'October',
    previous: 'September',
    revenue: 284600,
    prior: 254500,
    accounts: 128,
    retention: '96.2%',
    series: [181, 204, 226, 241, 254.5, 284.6],
    months: ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'],
    drivers: [
      ['New business', 24100],
      ['Expansion', 9600],
      ['Churn', -3600],
    ] as const,
  },
  {
    month: 'September',
    previous: 'August',
    revenue: 254500,
    prior: 241000,
    accounts: 112,
    retention: '95.4%',
    series: [175, 181, 204, 226, 241, 254.5],
    months: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'],
    drivers: [
      ['New business', 14100],
      ['Expansion', 5200],
      ['Churn', -5800],
    ] as const,
  },
]
const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export function Reports() {
  const [month, setMonth] = useState(periods[0].month)
  const period = periods.find((item) => item.month === month) ?? periods[0]
  const growth = ((period.revenue / period.prior - 1) * 100).toFixed(1)
  return (
    <section className='@container space-y-5'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='text-xl font-semibold tracking-tight'>
          Monthly business review
        </h2>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger aria-label='Review period'>
            <CalendarDays className='size-4' />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {periods.map((item) => (
              <SelectItem key={item.month} value={item.month}>
                {item.month} 2026
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Card className='gap-5'>
        <CardHeader>
          <CardTitle>Revenue performance</CardTitle>
        </CardHeader>
        <CardContent className='grid items-end gap-7 @2xl:grid-cols-[1fr_1.4fr]'>
          <div>
            <p className='text-4xl font-semibold tracking-tight sm:text-5xl'>
              {dollars.format(period.revenue)}
            </p>
            <p className='mt-3 flex items-center gap-1 text-sm'>
              <ArrowUpRight className='size-4' />
              <strong>{growth}%</strong>
              <span className='text-muted-foreground'>
                since {period.previous}
              </span>
            </p>
            <p className='mt-5 max-w-sm text-sm text-muted-foreground'>
              New business contributed {dollars.format(period.drivers[0][1])} to
              this month’s growth.
            </p>
          </div>
          <div
            className='flex h-40 items-end gap-2'
            aria-label='Monthly revenue trend'
          >
            {period.series.map((amount, index) => (
              <div
                key={period.months[index]}
                className='flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5'
              >
                <span className='text-[10px] text-muted-foreground tabular-nums sm:text-xs'>
                  ${Math.round(amount)}k
                </span>
                <div
                  className={
                    index === period.series.length - 1
                      ? 'w-full rounded-t bg-primary'
                      : 'w-full rounded-t bg-muted-foreground/30'
                  }
                  style={{ height: (amount / 300) * 110 }}
                />
                <span className='text-xs text-muted-foreground'>
                  {period.months[index]}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className='grid gap-4 @xl:grid-cols-[1.45fr_1fr]'>
        <Card>
          <CardHeader>
            <CardTitle>Revenue movement</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className='divide-y'>
              {period.drivers.map(([name, amount]) => (
                <div key={name} className='flex justify-between py-2.5 text-sm'>
                  <dt>{name}</dt>
                  <dd className='font-medium tabular-nums'>
                    {amount > 0 ? '+' : '−'}
                    {dollars.format(Math.abs(amount))}
                  </dd>
                </div>
              ))}
              <div className='flex justify-between pt-3 text-sm font-semibold'>
                <dt>Net change</dt>
                <dd>+{dollars.format(period.revenue - period.prior)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Customer health</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div>
              <p className='text-2xl font-semibold'>{period.accounts}</p>
              <p className='text-sm text-muted-foreground'>New accounts</p>
            </div>
            <div className='border-t pt-4'>
              <p className='text-2xl font-semibold'>{period.retention}</p>
              <p className='text-sm text-muted-foreground'>Account retention</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
