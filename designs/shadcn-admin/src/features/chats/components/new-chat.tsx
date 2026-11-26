import { useState } from 'react'
import { Check, ChevronDown, Send, X } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { getDisplayNameInitials } from '@/lib/utils'
import { type ChatUser } from '../data/chat-types'
import { LinearMark, linearTickets, TicketDetails, type LinearTicket } from './linear-ticket'

type NewChatProps = {
  users: ChatUser[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSend: (recipient: ChatUser, message: string, ticket: LinearTicket | null) => void
  initialRecipient: ChatUser | null
  initialMessage: string
  initialTicket: LinearTicket | null
  initialTicketSearch: string | null
}

export function NewChat({
  users, onOpenChange, open, onSend, initialRecipient, initialMessage, initialTicket, initialTicketSearch,
}: NewChatProps) {
  const [recipient, setRecipient] = useState(initialRecipient)
  const [recipientOpen, setRecipientOpen] = useState(false)
  const [ticketOpen, setTicketOpen] = useState(initialTicketSearch !== null)
  const [ticketQuery, setTicketQuery] = useState(initialTicketSearch ?? '')
  const [ticket, setTicket] = useState(initialTicket)
  const [candidate, setCandidate] = useState<LinearTicket | null>(null)
  const [message, setMessage] = useState(initialMessage)
  const canSend = Boolean(recipient && (message.trim() || ticket))

  function close() {
    onOpenChange(false)
    setRecipient(null)
    setRecipientOpen(false)
    setTicketOpen(false)
    setTicketQuery('')
    setCandidate(null)
    setTicket(null)
    setMessage('')
  }

  function closeTicketPicker() {
    setTicketOpen(false)
    setTicketQuery('')
    setCandidate(null)
  }

  function chooseTicket(issue: LinearTicket) {
    if (ticket) {
      setCandidate(issue)
      return
    }
    setTicket(issue)
    closeTicketPicker()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
      <DialogContent
        className='gap-0 overflow-hidden p-0 sm:max-w-142'
        onOpenAutoFocus={(event) => {
          if (ticketOpen) event.preventDefault()
        }}
      >
        <DialogHeader className='px-5 pt-5 pb-4 text-start sm:px-6 sm:pt-6'>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription className='sr-only'>Choose a recipient, write a message, and optionally attach a Linear ticket.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => {
          event.preventDefault()
          if (!recipient || !canSend) return
          onSend(recipient, message.trim(), ticket)
          close()
        }}>
          <div className='flex items-center gap-3 border-y px-5 py-2.5 sm:px-6'>
            <span className='text-sm text-muted-foreground'>To</span>
            <Popover open={recipientOpen} onOpenChange={setRecipientOpen}>
              <PopoverTrigger asChild>
                <Button type='button' size='sm' variant='ghost' aria-label={recipient ? `Recipient: ${recipient.fullName}` : 'Choose recipient'} className='gap-2'>
                  {recipient ? recipient.fullName : 'Choose recipient'}<ChevronDown className='text-muted-foreground' />
                </Button>
              </PopoverTrigger>
              <PopoverContent align='start' className='w-64 p-0'>
                <Command>
                  <CommandInput placeholder='Search people…' />
                  <CommandList>
                    <CommandEmpty>No people found.</CommandEmpty>
                    <CommandGroup>
                      {users.map((user) => (
                        <CommandItem key={user.id} value={`${user.fullName} ${user.username}`} onSelect={() => {
                          setRecipient(user)
                          setRecipientOpen(false)
                        }}>
                          <Avatar className='size-7'>
                            <AvatarImage src={user.profile} alt='' />
                            <AvatarFallback>{getDisplayNameInitials(user.fullName)}</AvatarFallback>
                          </Avatar>
                          <span className='flex-1'>{user.fullName}</span>
                          {recipient?.id === user.id && <Check />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className='px-5 pt-3 pb-4 sm:px-6'>
            <textarea aria-label='Message' placeholder='Write a message…' value={message} onChange={(event) => setMessage(event.target.value)}
              className='block min-h-24 w-full resize-y rounded-md px-2 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring' />
            {ticket && (
              <div className='mt-3 flex items-center gap-2 rounded-lg border bg-muted/45 px-3 py-2' aria-label='Attached Linear ticket'>
                <TicketDetails ticket={ticket} />
                <Button type='button' size='icon' className='size-7' variant='ghost' aria-label='Remove Linear ticket' onClick={() => setTicket(null)}>
                  <X />
                </Button>
              </div>
            )}
          </div>

          <div className='flex items-center justify-between gap-2 border-t px-5 py-3 sm:px-6'>
            <Popover open={ticketOpen} onOpenChange={(next) => {
              if (next) setTicketOpen(true)
              else closeTicketPicker()
            }}>
              <PopoverTrigger asChild>
                <Button type='button' variant='outline' size='sm'>
                  <LinearMark />{ticket ? 'Change ticket' : 'Attach Linear ticket'}<ChevronDown className='text-muted-foreground' />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align='start'
                className='w-[min(23rem,calc(100vw-3rem))] overflow-hidden p-0'
                onFocusOutside={(event) => {
                  if (initialTicketSearch !== null) event.preventDefault()
                }}
              >
                {ticket && (
                  <div className='border-b p-3'>
                    <p className='mb-2 text-xs font-medium text-muted-foreground'>Currently attached</p>
                    <div className='flex items-center gap-2 rounded-md bg-muted px-2 py-1.5'>
                      <TicketDetails ticket={ticket} />
                    </div>
                  </div>
                )}
                <Command>
                  <CommandInput placeholder='Search by title or issue ID…' value={ticketQuery} onValueChange={setTicketQuery} />
                  <CommandList>
                    <CommandEmpty>No matching Linear tickets.</CommandEmpty>
                    <CommandGroup heading='Linear workspace'>
                      {linearTickets.filter((issue) => issue.id !== ticket?.id).map((issue) => (
                        <CommandItem key={issue.id} value={`${issue.id} ${issue.title}`} onSelect={() => chooseTicket(issue)}
                          className='items-center gap-2 py-2' data-replacement-selected={candidate?.id === issue.id || undefined}>
                          <TicketDetails ticket={issue} />
                          {candidate?.id === issue.id && <Check aria-label='Selected replacement' className='size-4 shrink-0' />}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
                {ticket && (
                  <div className='flex justify-end gap-2 border-t px-3 py-2'>
                    <Button type='button' variant='ghost' size='sm' onClick={closeTicketPicker}>Cancel</Button>
                    <Button type='button' size='sm' disabled={!candidate} onClick={() => {
                      if (!candidate) return
                      setTicket(candidate)
                      closeTicketPicker()
                    }}>Replace ticket</Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <Button type='submit' size='sm' disabled={!canSend}><Send />Send<span className='sr-only'> message</span></Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
