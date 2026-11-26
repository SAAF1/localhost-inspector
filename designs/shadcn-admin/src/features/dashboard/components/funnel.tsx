import { useState } from 'react'
import { ListFilter } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const channels = [
  { name: 'Organic search', counts: [12600, 5100, 2640, 1320] },
  { name: 'Paid search', counts: [9600, 3040, 1760, 660] },
  { name: 'Referral', counts: [5400, 2820, 1740, 990] },
  { name: 'Direct', counts: [4400, 2040, 1260, 730] },
]
const stages = [
  'Visited site',
  'Viewed product',
  'Started checkout',
  'Purchased',
]
const percentage = (part: number, total: number) =>
  ((part / total) * 100).toFixed(1) + '%'
const count = new Intl.NumberFormat('en-US')

export function Reports() {
  const [filter, setFilter] = useState('All channels')
  const selected = channels.filter(
    (channel) => filter === 'All channels' || channel.name === filter
  )
  const totals = stages.map((_, stage) =>
    selected.reduce((sum, channel) => sum + channel.counts[stage], 0)
  )
  return (
    <section className='space-y-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 className='text-xl font-semibold tracking-tight'>
            Conversion funnel
          </h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            October 1–31, 2026
          </p>
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger aria-label='Acquisition channel'>
            <ListFilter className='size-4' />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['All channels', ...channels.map((item) => item.name)].map(
              (name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Visitor to purchase</CardTitle>
          <CardDescription>
            {percentage(totals[3], totals[0])} of visitors completed a purchase
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='mb-2 grid grid-cols-[minmax(0,1fr)_5rem] gap-4 text-xs text-muted-foreground sm:grid-cols-[9rem_minmax(0,1fr)_5rem]'>
            <span className='hidden sm:block'>Stage</span>
            <span>Visitors</span>
            <span className='text-right'>Drop-off</span>
          </div>
          <ol className='space-y-3'>
            {stages.map((label, i) => (
              <li
                key={label}
                className='grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-4 gap-y-1 sm:grid-cols-[9rem_minmax(0,1fr)_5rem]'
              >
                <span className='col-span-2 text-sm font-medium sm:col-span-1'>
                  {label}
                </span>
                <div className='flex h-10 items-center gap-2'>
                  <div
                    className='h-full rounded-sm bg-primary'
                    style={{
                      width: percentage(totals[i], totals[0]),
                      opacity: 1 - i * 0.12,
                    }}
                  />
                  <span className='text-xs font-medium tabular-nums'>
                    {count.format(totals[i])}
                  </span>
                </div>
                <span className='text-right text-sm text-muted-foreground tabular-nums'>
                  {i === 0
                    ? '—'
                    : percentage(totals[i - 1] - totals[i], totals[i - 1])}
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Performance by channel</CardTitle>
          <CardDescription>
            From first visit to completed purchase
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Acquisition channel</TableHead>
                <TableHead className='text-right'>Visitors</TableHead>
                <TableHead className='text-right'>Purchases</TableHead>
                <TableHead className='text-right'>Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {selected.map(({ name, counts }) => (
                <TableRow key={name}>
                  <TableCell className='font-medium'>{name}</TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {count.format(counts[0])}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {count.format(counts[3])}
                  </TableCell>
                  <TableCell className='text-right font-medium tabular-nums'>
                    {percentage(counts[3], counts[0])}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </section>
  )
}
