type Option = { value: string; label: string }
type Field = { id: string; label: string; options: Option[] }
type Definition = {
  name: string
  library?: string
  description?: string
  properties?: (Field & { kind: string })[]
}
type SlotState<T extends string> = { value: T | null; visible: boolean }
type SlotRead<T extends string> = SlotState<T> & {
  element: Element | null
  renderedValue?: string
  unavailableReason?: string
}

export function registerComponent(
  root: Element,
  definition: Definition,
  instance: { readProperty: (id: string) => string },
): () => void

export function registerComponent<T extends string>(
  root: Element,
  definition: Definition & { slots: Field[] },
  instance: {
    readSlot: (id: string) => SlotRead<string>
    setSlot: (id: string, state: SlotState<T>) => void | Promise<void>
  },
): () => void
