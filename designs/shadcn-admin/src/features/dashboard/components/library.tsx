import { useState } from 'react'
import {
  ArrowUpRight,
  ChartColumn,
  CircleDollarSign,
  Search,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

const categories = {
  Revenue: { Icon: CircleDollarSign, color: 'text-chart-2 bg-chart-2/10' },
  Customers: { Icon: Users, color: 'text-chart-3 bg-chart-3/10' },
  Product: { Icon: ChartColumn, color: 'text-chart-1 bg-chart-1/10' },
}

type Report = {
  title: string
  category: keyof typeof categories
  description: string
  metric: string
  unit: string
  values: number[]
}
const reports: Report[] = [
  {
    title: 'Recurring revenue',
    category: 'Revenue',
    description: 'Monthly subscription revenue across active accounts.',
    metric: 'Monthly recurring revenue',
    unit: '$',
    values: [31200, 34800, 36100, 38900, 40700, 45232],
  },
  {
    title: 'Customer acquisition',
    category: 'Customers',
    description: 'New customers who started a paid subscription.',
    metric: 'New customers',
    unit: '',
    values: [182, 211, 204, 243, 279, 316],
  },
  {
    title: 'Feature adoption',
    category: 'Product',
    description: 'Active teams using at least three core features.',
    metric: 'Adoption rate',
    unit: '%',
    values: [41, 44, 48, 54, 58, 64],
  },
  {
    title: 'Revenue per account',
    category: 'Revenue',
    description: 'Average monthly revenue per paying account.',
    metric: 'Average revenue',
    unit: '$',
    values: [79, 84, 83, 91, 96, 102],
  },
  {
    title: 'Customer retention',
    category: 'Customers',
    description: 'Subscribers who renewed at the end of each month.',
    metric: 'Renewal rate',
    unit: '%',
    values: [87, 89, 88, 92, 91, 94],
  },
  {
    title: 'Weekly activity',
    category: 'Product',
    description: 'Average weekly active teams by calendar month.',
    metric: 'Weekly active teams',
    unit: '',
    values: [370, 434, 459, 518, 544, 608],
  },
]
const months = ['June', 'July', 'August', 'September', 'October', 'November']
const valueLabel = (n: number, unit: string) =>
  unit === '$'
    ? '$' + n.toLocaleString('en-US')
    : n.toLocaleString('en-US') + unit

export function Reports() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [active, setActive] = useState<Report | null>(null)
  const filtered = reports.filter(
    (report) =>
      (category === 'All' || report.category === category) &&
      (report.title + ' ' + report.description)
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  )
  return (
    <section aria-label='Report library' className='space-y-5'>
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h2 className='text-2xl font-semibold tracking-tight'>
            Report library
          </h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Explore revenue, customers, and product usage.
          </p>
        </div>
        <div className='relative w-full sm:w-64'>
          <Search
            aria-hidden='true'
            className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground'
          />
          <Input
            aria-label='Search reports'
            placeholder='Search reports…'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className='pl-9'
          />
        </div>
      </div>
      <div className='flex flex-wrap gap-2'>
        {['All', ...Object.keys(categories)].map((item) => (
          <Button
            key={item}
            size='sm'
            variant={category === item ? 'default' : 'outline'}
            aria-pressed={category === item}
            onClick={() => setCategory(item)}
          >
            {item}
          </Button>
        ))}
      </div>
      <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
        {filtered.map((report) => {
          const { Icon, color } = categories[report.category]
          return (
            <Card
              key={report.title}
              className='p-0 transition-shadow hover:shadow-md'
            >
              <button
                onClick={() => setActive(report)}
                className='group flex h-full flex-col items-start rounded-xl p-5 text-left focus-visible:ring-2 focus-visible:ring-ring'
              >
                <span className='mb-6 flex w-full items-center justify-between'>
                  <span
                    className={
                      'grid size-10 place-items-center rounded-lg ' + color
                    }
                  >
                    <Icon className='size-5' />
                  </span>
                  <ArrowUpRight
                    aria-hidden='true'
                    className='size-4 text-muted-foreground group-hover:text-foreground'
                  />
                </span>
                <span className='text-base font-semibold'>{report.title}</span>
                <span className='mt-1 mb-5 text-sm text-muted-foreground'>
                  {report.description}
                </span>
                <Badge variant='secondary' className='mt-auto'>
                  {report.category}
                </Badge>
              </button>
            </Card>
          )
        })}
      </div>
      {!filtered.length && (
        <Card className='items-center py-10'>
          <p>No reports match your search.</p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              setQuery('')
              setCategory('All')
            }}
          >
            Clear filters
          </Button>
        </Card>
      )}
      <Dialog
        open={!!active}
        onOpenChange={(open) => {
          if (!open) setActive(null)
        }}
      >
        {active && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{active.title}</DialogTitle>
              <DialogDescription>{active.description}</DialogDescription>
            </DialogHeader>
            <div className='border-y py-4'>
              <p className='text-sm text-muted-foreground'>
                {active.metric} · November
              </p>
              <p className='text-3xl font-semibold tabular-nums'>
                {valueLabel(active.values[5], active.unit)}
              </p>
            </div>
            <dl className='space-y-3'>
              {active.values.map((v, i) => (
                <div
                  key={months[i]}
                  className='grid grid-cols-[5rem_1fr_4rem] items-center gap-3 text-sm'
                >
                  <dt>{months[i]}</dt>
                  <span aria-hidden='true' className='h-2 rounded bg-muted'>
                    <span
                      className='block h-full rounded bg-chart-2'
                      style={{
                        width: (100 * v) / Math.max(...active.values) + '%',
                      }}
                    />
                  </span>
                  <dd className='text-right font-medium tabular-nums'>
                    {valueLabel(v, active.unit)}
                  </dd>
                </div>
              ))}
            </dl>
          </DialogContent>
        )}
      </Dialog>
    </section>
  )
}
