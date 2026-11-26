import { registerComponent } from './inspector-registration.mjs'
import { Circle, CircleCheck, CircleDot } from 'lucide-react'

export const linearTickets = [
  { id: 'ENG-142', title: 'Keep drafts when switching conversations', status: 'In progress' },
  { id: 'ENG-157', title: 'Add keyboard shortcuts to the message composer', status: 'Todo' },
  { id: 'DES-84', title: 'Review Inbox empty states', status: 'Done' },
  { id: 'DES-91', title: 'Improve attachment previews on mobile', status: 'Todo' },
] as const

export type LinearTicket = (typeof linearTickets)[number]

export function LinearMark() {
  return (
    <svg aria-hidden='true' className='size-4 shrink-0' viewBox='0 0 24 24' fill='currentColor'>
      <path d='M2.7 14.8a9.8 9.8 0 0 0 6.5 6.5l-6.5-6.5Zm-.5-3.1 10.1 10.1a9.5 9.5 0 0 0 2.2-.3L2.5 9.5a9.5 9.5 0 0 0-.3 2.2Zm1-4.2 13.3 13.3a9.8 9.8 0 1 0-13.3-13.3Z' />
    </svg>
  )
}

const definition = {
  library: 'Inbox',
  name: 'TicketDetails',
  properties: [{ id: 'status', label: 'Status', kind: 'enum',
    options: ['Todo', 'In progress', 'Done'].map(value => ({ value, label: value })) }],
}

export function TicketDetails({ ticket }: { ticket: LinearTicket }) {
  const StatusIcon = ticket.status === 'Done' ? CircleCheck : ticket.status === 'In progress' ? CircleDot : Circle
  return (
    <span className='flex min-w-0 flex-1 items-center gap-[var(--space-2)]' ref={root => {
      if (root) return registerComponent(root, definition, { readProperty: () => ticket.status })
    }}>
      <LinearMark />
      <span className='min-w-0 flex-1'>
        <span className='block text-xs text-muted-foreground'>Linear · {ticket.id}</span>
        <span className='block wrap-break-word type-body'>{ticket.title}</span>
      </span>
      <span className='flex shrink-0 items-center gap-1.5 text-xs opacity-80'>
        <StatusIcon aria-hidden='true' className='size-3.5' />{ticket.status}
      </span>
    </span>
  )
}
