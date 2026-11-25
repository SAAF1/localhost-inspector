// Returned to the authoring agent before it writes a canvas variant.
export const authoringGuidance = [
  'Start with the user’s goal. Decide what idea each variant explores and which interactions matter.',
  'Identify the smallest useful pieces for each idea. Look for existing app components and usage examples where they fit. The canvas components command supports --used-in and --find.',
  'Build any missing reusable pieces in the variant’s editable source. Give them names that describe their purpose and implement the states the design actually uses.',
  'Compose those pieces into larger patterns and then the screen. Share a pattern across variants when the prompt calls for consistency. Let different directions use different pieces.',
  'When adding each variant to the canvas, use --note to give it one or two short sentences in everyday language. Say what it explores and why you made the main design choice.',
  'When the user responds to existing variants, list canvas activity for their canvas or linked app, then use canvas respond with each referenced variant ID. Opening, inspecting, and creating other variants leave existing items in Inbox.',
]
