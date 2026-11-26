# Inbox and Reports design studies

Open this directory as the project root in a React/Vite design tool. Install dependencies with `pnpm install --frozen-lockfile`, then run `pnpm dev`. Open the paths below on the address Vite prints. For a production preview, run `pnpm build` followed by `pnpm preview`.

The ticket comparison lives on the **Ticket details** frame. Select a proposed issue to compare it with the current attachment, then choose **Keep current ticket** or **Confirm replacement**. The Linear issues are sample data. The combined dashboard report opens at `/?tab=reports`.

## Reports

- **Executive brief** — `/?tab=reports&study=brief`
- **Executive brief · static HTML** — `/executive-brief.html`
- **Conversion & retention** — `/?tab=reports`
- **Conversion funnel** — `/?tab=reports&study=funnel`
- **Report library** — `/?tab=reports&study=library`
- **Report delivery** — `/?tab=reports&study=schedules`
- **Cohort retention** — `/?tab=reports&study=segments`

## Inbox

- **Compose a message** — `/chats?demo=compose`
- **Choose a recipient and write** — `/chats?demo=draft`
- **Review the attachment** — `/chats?demo=attached`
- **Find a Linear ticket** — `/chats?demo=search`
- **See the sent message** — `/chats?demo=sent`

## Swap a Linear ticket / Components

- **Ticket details** — `/component-review.html`

## Swap a Linear ticket

- **Review the current ticket** — `/chats?demo=swap-original`
- **Choose a replacement** — `/chats?demo=swap-picker`
- **Check the updated draft** — `/chats?demo=swap-updated`
- **See the replacement in the thread** — `/chats?demo=swap-sent`

The [design index](designs.json) includes the frame notes. Editable sources include the [component review](src/ticket-review.tsx), [Inbox](src/features/chats), and [Reports](src/features/dashboard/components). The app fixture is based on [Shadcn Admin](https://github.com/satnaing/shadcn-admin) and includes its [MIT license](LICENSE).

## Reopen the Inspector canvas

From the repository root, run the following with Node 22.13 or newer and pnpm available.

```sh
npm ci
pnpm --dir designs/shadcn-admin install --frozen-lockfile
node designs/prepare-canvas.mjs
node scripts/flow/serve.mjs --source designs/shadcn-admin 5485 designs/canvas
```

Open [the saved canvas](http://127.0.0.1:5485/__inspector-flow/#context=1&frame=frame-10&view=canvas). Frame definitions, review notes, captures, and portable Inspector state are tracked under `designs/canvas`. Run the preparation command again after editing the app to rebuild the saved frame previews.
