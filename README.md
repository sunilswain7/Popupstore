# PopupStore

> Describe a drop in one sentence. Get a live USDC storefront in minutes.

PopupStore turns natural-language drop descriptions into fully-deployed, autonomous e-commerce storefronts powered by USDC payments. A creator types something like *"Sell 20 signed prints at $25 and 50 stickers at $5, drop ends Sunday"* and three agents take it from there — validating the spec, provisioning a storefront on Locus Build, and monitoring the drop until it sells out.

Built for the **BuildWithLocus** hackathon, integrating [Locus Build](https://buildwithlocus.com) for deployment and [PaywithLocus](https://paywithlocus.com) for USDC checkout.

---

## How it works

```
   Creator
     │
     ▼
┌───────────────┐    parse      ┌─────────────────┐
│  Dashboard    │ ────────────▶ │  Agent 1        │
│  (Express)    │ ◀──────────── │  SpecGuard      │
└───────────────┘   spec + errs │  (validator)    │
     │                          └─────────────────┘
     │ confirm + email
     ▼
┌─────────────────┐              ┌─────────────────┐
│  Agent 2        │ ──deploy──▶  │  Locus Build    │
│  Builder        │              │  (container)    │
└─────────────────┘              └─────────────────┘
     │                                    │
     │ SSE events                          ▼
     ▼                            ┌─────────────────┐
┌──────────────┐                  │   Storefront    │
│  Agent 3     │ ◀─── checkout ── │   (Express)     │
│  Monitor     │    webhooks      │   [PaywithLocus]│
└──────────────┘                  └─────────────────┘
     │                                    ▲
     │ sold out / archive                 │
     ▼                                    │
  (lifecycle)                        buyers (USDC)
```

**Agent 1 — SpecGuard** parses the natural-language description (price/inventory/dates/items), runs validation, and returns either a clean spec or a list of field errors.

**Agent 2 — Builder** provisions a storefront container on Locus Build, creates checkout sessions via PaywithLocus for every item, and deploys.

**Agent 3 — Monitor** listens to checkout webhooks, updates inventory in real time, transitions the store through `ACTIVE → SOLD_OUT → ARCHIVED`, optionally emails the creator a sales summary when the drop ends.

The dashboard streams every agent's progress to the browser over Server-Sent Events — each event lands in the pipeline console as a falling Tetris brick (see **UI** below).

---

## Features

- **Natural-language drop creation** — one textarea, one button. No form gymnastics.
- **Email-before-launch** — optional sales-summary email sign-up gated inline in the pipeline chat.
- **Live pipeline chat (Tetris)** — each SSE event from Agent 1/2/3 drops in as a pixel brick, color-coded by agent.
- **Multi-item drops** — any number of items per drop, each with its own price, inventory, and checkout session.
- **USDC payments** — PaywithLocus checkout, no wallet required by the buyer.
- **Live inventory** — storefront polls `/api/inventory` every 15 s, updates remaining-stock bars.
- **Pretty slug URLs** — `/s/midnight-print-drop` instead of raw UUIDs.
- **Post-drop actions** — show a sold-out page, collect waitlist emails, or tear the storefront down.
- **Sales summary email** — optional Resend-powered report emailed to the creator when a drop ends.
- **Real-time dashboard** — stores list refreshes on every sale / state transition via global SSE.

---

## Project structure

```
.
├── dashboard/              ← Creator-facing admin
│   ├── public/
│   │   ├── index.html      ← 3-step UI (create / review / pipeline)
│   │   ├── css/style.css   ← Y2K Tetris theme
│   │   └── js/app.js       ← Parse → email-gate → SSE pipeline
│   ├── prisma/
│   │   ├── schema.prisma   ← Store, Item, Transaction models
│   │   └── migrations/
│   └── src/
│       ├── server.js       ← Express + SSE + slug proxy + webhook
│       ├── routes/api.js   ← /api/drops/parse, /confirm, /stores...
│       ├── agents/
│       │   ├── agent1-specguard.js
│       │   ├── agent2-builder.js
│       │   └── agent3-lifecycle.js
│       └── lib/            ← config, prisma client, locus clients
│
└── storefront/             ← Customer-facing drop page
    ├── server.js           ← Express template (env-driven)
    ├── Dockerfile          ← Deployed per-drop by Agent 2
    └── package.json
```

---

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL (for Prisma)
- A [Locus Build](https://buildwithlocus.com) API key (or use `MOCK_LOCUS_API=true` for local dev)
- A PaywithLocus API key (for real checkout sessions)
- Optional: a Resend API key (for the sales-summary email)

### Dashboard

```bash
cd dashboard
npm install
cp .env.example .env       # fill in values — see "Environment" below
npx prisma migrate deploy
npm run dev                # http://localhost:3000
```

### Storefront

The storefront is built per-drop by Agent 2 and deployed to Locus Build — you normally don't run it by hand. To inspect the template locally:

```bash
cd storefront
npm install
DROP_NAME="Midnight Print Drop" \
DROP_STATUS=ACTIVE \
ITEMS_JSON='[{"id":"a","productName":"Signed Print","price":25,"inventoryTotal":20,"checkoutSessionId":"sess_abc"}]' \
END_DATE="2026-05-01T18:00:00Z" \
npm run dev                # http://localhost:8080
```

---

## Environment

### `dashboard/.env`

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `DASHBOARD_URL` | Public URL of this dashboard (used in webhook URL, slug proxy) |
| `PORT` | Default `3000` |
| `LOCUS_API_KEY` / `LOCUS_BUILD_TOKEN` | Locus Build API credentials |
| `LOCUS_BUILD_API_BASE` | `https://api.buildwithlocus.com` (or mock URL) |
| `LOCUS_PAY_API_BASE` | `https://api.paywithlocus.com` |
| `STOREFRONT_REPO` | Git URL of the storefront repo (this repo, `/storefront`) |
| `STOREFRONT_REPO_BRANCH` | Branch to deploy from (default `main`) |
| `STOREFRONT_PROJECT_ID`, `STOREFRONT_ENV_ID` | Locus Build project/env IDs |
| `WEBHOOK_SECRET` | HMAC secret for PaywithLocus checkout webhooks |
| `MOCK_LOCUS_API` | `true` to stub Locus calls during local dev |
| `RESEND_API_KEY`, `EMAIL_FROM` | Optional — enables sales-summary emails |

### Storefront env (set by Agent 2)

| Var | Purpose |
|---|---|
| `STORE_ID` | UUID of the store |
| `DROP_NAME`, `DROP_STATUS`, `END_DATE` | Drop metadata |
| `ITEMS_JSON` | JSON array of `{id, productName, price, inventoryTotal, checkoutSessionId, imageUrl}` |
| `POST_DROP_ACTION` | `SOLD_OUT_PAGE` / `WAITLIST` / `TEARDOWN` |
| `SHOW_WAITLIST` | `true` to render the restock-alert form on sold-out |
| `INVENTORY_API_URL` | Dashboard endpoint the storefront polls for live stock |
| `CHECKOUT_BASE_URL` | Default `https://checkout.paywithlocus.com` |

---

## API

**Dashboard**

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/drops/parse` | Natural-language → spec + validation errors |
| `POST` | `/api/drops/confirm` | Validated spec → creates `Store`, kicks off Agent 2 |
| `GET`  | `/api/stores` | List all drops for the dashboard grid |
| `GET`  | `/api/stores/:id` | Store detail + items + transactions |
| `POST` | `/api/stores/:id/email` | Update owner email after launch |
| `GET`  | `/api/inventory/:storeId` | Live stock per item (polled by storefront) |
| `GET`  | `/events/:storeId` | SSE stream of a single drop's pipeline |
| `GET`  | `/events` | Global SSE stream (sales + transitions) |
| `POST` | `/webhooks/checkout` | PaywithLocus checkout webhook |
| `GET`  | `/s/:slug` | Public slug redirect → Locus Build URL |

---

## UI

The project's visual identity is **Y2K pastel pixel** — cyan, hot pink, bright yellow, violet — inspired by late-90s retro computer graphics. Headings use [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans); body copy uses Inter.

The live pipeline chat is the signature piece: every SSE event from the agents renders as a **Tetris-style brick** that falls from the top of the console and locks into a zig-zag stack. Each agent gets a different piece shape:

| Agent | Shape | Color |
|---|---|---|
| System | O-piece (small square) | cyan |
| SpecGuard (Agent 1) | I-piece (wide flat) | yellow |
| Builder (Agent 2) | L-piece (with mini Locus `L` mark) | mint |
| Monitor (Agent 3) | T-piece (center bump) | violet |
| Launched | Long I-piece with pulsing ★ | hot pink |
| Warning | J-piece | amber |
| Error | J-piece | coral |

The CSS is a pure drop-in — animations run on mount via keyframes, so `app.js` appends chat messages exactly as before, nothing else changed.

---

## Data model (Prisma)

```
Store ──┬── Item (many)
        └── Transaction (many) ── item (opt)
```

`Store.status` transitions: `PENDING → ACTIVE → SOLD_OUT → ARCHIVED` (`FAILED` or `DELETED` branches on error / manual override).

Slug is unique and generated from `dropName` + a short hash suffix.

