import { useState } from 'react'
import { CalendarClock, ArrowUpRight, Mail } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'

const schedules = [
  {
    title: 'Morning revenue pulse',
    time: '08:00',
    day: 'Wed, Nov 25',
    cadence: 'Weekdays',
    group: 'Finance',
    recipients: 4,
    contents:
      'Revenue by region, daily change, and the three largest transactions.',
  },
  {
    title: 'Pipeline health',
    time: '09:30',
    day: 'Wed, Nov 25',
    cadence: 'Wednesdays',
    group: 'Sales leads',
    recipients: 7,
    contents:
      'Open pipeline by stage, stalled opportunities, and forecast changes.',
  },
  {
    title: 'Customer retention',
    time: '10:00',
    day: 'Mon, Nov 30',
    cadence: 'Mondays',
    group: 'Customer success',
    recipients: 5,
    contents:
      'Retention by signup cohort, renewal risks, and account activity.',
  },
  {
    title: 'Monthly close',
    time: '16:00',
    day: 'Mon, Nov 30',
    cadence: 'Month end',
    group: 'Leadership',
    recipients: 3,
    contents: 'Net revenue, margin against plan, and month-end adjustments.',
  },
]

export function Reports() {
  const [enabled, setEnabled] = useState([true, true, true, false])
  const [selected, setSelected] = useState<number | null>(null)
  const detail = selected === null ? null : schedules[selected]
  const next = schedules.find((_, i) => enabled[i])
  return (
    <section className='space-y-5'>
      <header>
        <h2 className='text-2xl font-semibold tracking-tight'>
          Report delivery
        </h2>
        <p className='text-sm text-muted-foreground'>
          Manage recurring reports and see what goes out next.
        </p>
      </header>
      <div className='grid gap-4 xl:grid-cols-[1.2fr_2fr]'>
        <Card className='self-start bg-muted/35'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-sm'>
              <CalendarClock className='size-4' /> Next delivery
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-5'>
            {next ? (
              <>
                <div>
                  <div className='text-5xl font-semibold tracking-tight tabular-nums'>
                    {next.time}
                  </div>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {next.day} · Eastern time
                  </p>
                </div>
                <div className='border-t pt-4'>
                  <p className='font-medium'>{next.title}</p>
                  <p className='mt-1 text-sm text-muted-foreground'>
                    {next.group} · {next.recipients} recipients
                  </p>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => setSelected(schedules.indexOf(next))}
                >
                  Delivery details <ArrowUpRight />
                </Button>
              </>
            ) : (
              <p className='text-sm'>All schedules are paused.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Delivery schedules</CardTitle>
            <p className='text-sm text-muted-foreground'>
              {enabled.filter(Boolean).length} active ·{' '}
              {enabled.filter((v) => !v).length} paused
            </p>
          </CardHeader>
          <CardContent className='divide-y'>
            {schedules.map((s, i) => (
              <div
                key={s.title}
                className='flex items-center gap-3 py-4 first:pt-0 last:pb-0'
              >
                <span className='rounded-md border p-2 text-muted-foreground'>
                  <Mail className='size-4' />
                </span>
                <button
                  className='min-w-0 flex-1 text-left hover:underline'
                  onClick={() => setSelected(i)}
                >
                  <div className='text-sm font-medium'>{s.title}</div>
                  <div className='text-xs text-muted-foreground'>
                    {s.cadence} · {s.time} ET
                  </div>
                </button>
                <Switch
                  aria-label={'Enable ' + s.title}
                  checked={enabled[i]}
                  onCheckedChange={(value) =>
                    setEnabled((old) =>
                      old.map((x, n) => (n === i ? value : x))
                    )
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent deliveries</CardTitle>
        </CardHeader>
        <CardContent className='divide-y'>
          {[
            ['Morning revenue pulse', 'Nov 24, 08:00', 'Finance'],
            ['Customer retention', 'Nov 23, 10:00', 'Customer success'],
          ].map(([title, time, group]) => (
            <div
              key={title}
              className='flex flex-wrap items-center gap-3 py-3 text-sm first:pt-0 last:pb-0'
            >
              <span className='flex-1 font-medium'>{title}</span>
              <span className='text-muted-foreground'>
                {group} · {time}
              </span>
              <Badge variant='secondary'>Delivered</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.title}</DialogTitle>
            <DialogDescription>{detail?.contents}</DialogDescription>
          </DialogHeader>
          {detail && (
            <dl className='grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm'>
              <dt>Schedule</dt>
              <dd>
                {detail.cadence} at {detail.time} ET
              </dd>
              <dt>Recipients</dt>
              <dd>
                {detail.group} ({detail.recipients})
              </dd>
              <dt>Status</dt>
              <dd>{enabled[selected!] ? 'Active' : 'Paused'}</dd>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
