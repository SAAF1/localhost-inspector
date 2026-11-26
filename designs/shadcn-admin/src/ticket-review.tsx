import { useCallback, useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ArrowRightLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { registerComponent } from './features/chats/components/inspector-registration.mjs'
import { linearTickets, TicketDetails, type LinearTicket } from './features/chats/components/linear-ticket'
import './styles/index.css'
import './styles/ticket-review.css'

const statuses = ['Todo', 'In progress', 'Done'] as const
const statusExamples = statuses.map(status => linearTickets.find(ticket => ticket.status === status)!)
const initialTicket = linearTickets[0]
const blockingIssue = linearTickets[1]
const definition = {
  library: 'Inbox',
  name: 'TicketReplacement',
  description: 'Compare a draft’s attached Linear ticket with a replacement before applying it.',
  slots: [{
    id: 'attachment',
    label: 'Attached ticket',
    options: linearTickets.map(ticket => ({ value: ticket.id, label: ticket.id + ' · ' + ticket.title })),
  }],
}

type Attachment = { value: LinearTicket['id'] | null; visible: boolean }

function TicketReplacement() {
  const [attachment, setAttachment] = useState<Attachment>({ value: initialTicket.id, visible: true })
  const [isChoosing, setIsChoosing] = useState(true)
  const [candidate, setCandidate] = useState<LinearTicket | null>(null)
  const [query, setQuery] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const headingId = useId()
  const radioName = useId()
  const attachmentRow = useRef<HTMLDivElement>(null)
  const changeButton = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const currentTicket = linearTickets.find(ticket => ticket.id === attachment.value)
  const normalizedQuery = query.trim().toLowerCase()
  const results = linearTickets.filter(ticket =>
    ticket.id !== attachment.value &&
    (ticket.id + ' ' + ticket.title).toLowerCase().includes(normalizedQuery),
  )

  const attachRoot = useCallback((root: HTMLElement | null) => {
    if (!root) return
    return registerComponent(root, definition, {
      readSlot: () => {
        const row = attachmentRow.current
        return {
          value: root.dataset.attachment || null,
          visible: row !== null,
          element: row,
          renderedValue: row?.dataset.ticket,
        }
      },
      setSlot: (_id: string, state: Attachment) => {
        flushSync(() => {
          setAttachment(state)
          setCandidate(null)
        })
      },
    })
  }, [])

  function closePicker(next?: LinearTicket) {
    flushSync(() => {
      if (next) {
        setAttachment({ value: next.id, visible: true })
        setAnnouncement(next.id + ' attached')
      } else {
        setAnnouncement('Current attachment kept')
      }
      setCandidate(null)
      setQuery('')
      setIsChoosing(false)
    })
    changeButton.current?.focus()
  }

  return (
    <section ref={attachRoot} data-attachment={attachment.value} className='ticket-replacement' aria-labelledby={headingId}>
      <header className='ticket-replacement-header'>
        <h2 id={headingId}>Replace an attached ticket</h2>
        <p>Choose a different Linear issue. The draft keeps its current attachment until you apply the change.</p>
      </header>
      <div className='ticket-replacement-comparison' role='group' aria-label='Attachment comparison'>
        <div className='ticket-replacement-current'>
          <p className='ticket-review-label'>Current attachment</p>
          {attachment.visible && currentTicket
            ? <div ref={attachmentRow} data-ticket={currentTicket.id} className='ticket-review-row'><TicketDetails ticket={currentTicket} /></div>
            : <p className='ticket-review-row'>No ticket visible</p>}
        </div>
        {candidate && (
          <div className='ticket-replacement-proposed'>
            <p className='ticket-review-label'>Proposed replacement</p>
            <div className='ticket-review-row'><TicketDetails ticket={candidate} /></div>
          </div>
        )}
      </div>
      <div className='ticket-replacement-current'>
        <p className='ticket-review-label'>Blocking this draft</p>
        <div className='ticket-review-row'><TicketDetails ticket={blockingIssue} /></div>
      </div>

      {isChoosing ? (
        <div className='ticket-replacement-picker'>
          <label htmlFor={radioName}>Find a replacement</label>
          <Input ref={search} id={radioName} aria-label='Find a replacement' placeholder='Search by title or issue ID' value={query} onChange={event => {
            setQuery(event.target.value)
            setCandidate(null)
          }} />
          <fieldset className='ticket-replacement-options'>
            <legend className='sr-only'>Replacement ticket</legend>
            {results.map(ticket =>
              <label key={ticket.id} className='ticket-replacement-option'>
                <input type='radio' name={radioName} checked={candidate?.id === ticket.id} onChange={() => {
                  setCandidate(ticket)
                  setAnnouncement(ticket.id + ' selected for comparison')
                }} />
                <TicketDetails ticket={ticket} />
              </label>,
            )}
            {!results.length && <p className='ticket-replacement-empty'>No matching Linear tickets</p>}
          </fieldset>
          <footer className='ticket-replacement-actions'>
            <Button type='button' variant='outline' onClick={() => closePicker()}>Keep current ticket</Button>
            <Button type='button' disabled={!candidate} onClick={() => candidate && closePicker(candidate)}>Confirm replacement</Button>
          </footer>
        </div>
      ) : (
        <footer className='ticket-replacement-actions ticket-replacement-closed'>
          <Button ref={changeButton} type='button' variant='outline' onClick={() => {
            flushSync(() => setIsChoosing(true))
            search.current?.focus()
          }}><ArrowRightLeft aria-hidden='true' /> Change ticket</Button>
        </footer>
      )}
      <p role='status' className='sr-only'>{announcement}</p>
    </section>
  )
}

function TicketReview() {
  return (
    <main className='ticket-review type-body'>
      <h1 className='type-page-title'>Ticket details</h1>
      <div className='ticket-review-grid'>
        <TicketReplacement />
        <section className='ticket-status-examples' aria-labelledby='ticket-status-heading'>
          <h2 id='ticket-status-heading'>Compact status examples</h2>
          <p>Each row shows the issue ID, title, and status as it appears on an attachment.</p>
          <ul>{statusExamples.map(ticket =>
            <li key={ticket.id} className='ticket-review-row'><TicketDetails ticket={ticket} /></li>,
          )}</ul>
        </section>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<TicketReview />)
