const buttonFile = 'src/features/tasks/components/tasks-primary-buttons.tsx'
const button = {
  file: buttonFile,
  owner: 'TasksPrimaryButtons',
  dependencies: ['src/components/ui/button.tsx', 'src/styles/index.css', 'src/styles/theme.css', 'pnpm-lock.yaml'],
}
export const transfer = [
  {
    id: 'status-cell',
    file: 'src/features/tasks/components/tasks-columns.tsx',
    owner: 'tasksColumns',
    opening: "<div className='flex w-25 items-center gap-2'>",
    dependencies: ['src/styles/index.css', 'src/styles/theme.css', 'pnpm-lock.yaml'],
    style: {
      property: 'gap',
      attribute: 'className',
      literal: 'gap-2',
      utility: { fallback: 'calc(var(--spacing) * 2)' },
    },
  },
  {
    ...button,
    id: 'import-button',
    opening:
      "<Button\n        variant='outline'\n        className='space-x-1'\n        onClick={() => setOpen('import')}\n      >",
    input: {
      attribute: 'variant',
      field: 'variant',
      options: ['outline', 'secondary'],
      base: 'outline',
      verify: { outline: { self: '.bg-background' }, secondary: { self: '.bg-secondary' } },
    },
  },
  {
    ...button,
    id: 'create-button',
    opening: "<Button className='space-x-1' onClick={() => setOpen('create')}>",
    input: {
      child: '<Plus size={18} />',
      field: 'icon',
      options: ['plus', 'download'],
      base: 'plus',
      verify: { plus: { child: 'svg.lucide-plus' }, download: { child: 'svg.lucide-download' } },
      choices: { plus: 'Plus', download: 'Download' },
    },
  },
]
// Reserved for independent review. The pilot never opens this screen.
transfer.push({
  ...button,
  file: 'src/features/users/components/users-primary-buttons.tsx',
  owner: 'UsersPrimaryButtons',
  id: 'invite-button',
  opening:
    "<Button\n        variant='outline'\n        className='space-x-1'\n        onClick={() => setOpen('invite')}\n      >",
  input: transfer[1].input,
})
export const queue = [
  {
    id: 'queue-row',
    file: 'Rows.jsx',
    owner: 'Row',
    dependencies: ['theme.css'],
    opening: '<div className="part" style={{ display: \'flex\', gap: wide ? 14 : 8 }}>',
    style: { property: 'gap', attribute: 'style', literal: 'wide ? 14 : 8', unit: 'px' },
  },
  {
    id: 'queue-action',
    symbols: ['Action', 'Circle', 'Square'],
    file: 'Rows.jsx',
    owner: 'Row',
    dependencies: ['theme.css'],
    opening:
      '<Action aria-label="Job action" tone="quiet" icon={<Circle />} loading={loading} onClick={onClick}/>',
    input: {
      attribute: 'icon',
      field: 'icon',
      options: ['circle', 'square'],
      base: 'circle',
      verify: { circle: { child: 'svg circle' }, square: { child: 'svg rect' } },
      choices: { circle: 'Circle', square: 'Square' },
    },
  },
]
