const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8081;

// Env vars injected by Agent 2
const config = {
  storeId: process.env.STORE_ID || 'demo-store',
  dropName: process.env.DROP_NAME || process.env.PRODUCT_NAME || 'Art Prints & Postcards Drop',
  dropStatus: process.env.DROP_STATUS || 'ACTIVE',
  postDropAction: process.env.POST_DROP_ACTION || 'SOLD_OUT_PAGE',
  endDate: process.env.END_DATE || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  showWaitlist: process.env.SHOW_WAITLIST === 'true',
  inventoryApiUrl: process.env.INVENTORY_API_URL || '',
  checkoutBaseUrl: process.env.CHECKOUT_BASE_URL || 'https://checkout.paywithlocus.com',
};

// Parse items from ITEMS_JSON env var, or fall back to single-item legacy env vars
let items = [];
try {
  items = JSON.parse(process.env.ITEMS_JSON || '[]');
} catch {
  items = [];
}
if (items.length === 0) {
  // Legacy single-item fallback
  items = [
    {
      id: 'item-1',
      productName: 'Framed Illustration',
      price: 95,
      inventoryTotal: 5,
      checkoutSessionId: '',
      imageUrl: '',
    },
    {
      id: 'item-2',
      productName: 'Postcard Set',
      price: 12,
      inventoryTotal: 25,
      checkoutSessionId: '',
      imageUrl: '',
    }
  ];
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Dedicated health check — lightweight, no logging, fast response for ECS
app.get('/health', (req, res) => res.send('ok'));

app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html')) {
    return res.json({ status: 'ok', storeId: config.storeId });
  }
  console.log(JSON.stringify({ event: 'page_view', storeId: config.storeId, ts: Date.now() }));
  res.send(renderPage());
});

// Checkout click tracking
app.get('/api/checkout-click/:itemId', (req, res) => {
  console.log(JSON.stringify({ event: 'checkout_click', storeId: config.storeId, itemId: req.params.itemId, ts: Date.now() }));
  res.json({ tracked: true });
});

app.get('/api/config', (req, res) => {
  res.json({
    storeId: config.storeId,
    dropName: config.dropName,
    dropStatus: config.dropStatus,
    postDropAction: config.postDropAction,
    endDate: config.endDate,
    showWaitlist: config.showWaitlist,
    items: items.map(i => ({
      id: i.id,
      productName: i.productName,
      price: i.price,
      inventoryTotal: i.inventoryTotal,
      imageUrl: i.imageUrl || '',
      checkoutUrl: i.checkoutUrl || (i.checkoutSessionId
        ? `${config.checkoutBaseUrl}/${i.checkoutSessionId}`
        : ''),
    })),
  });
});

app.get('/api/inventory', async (req, res) => {
  if (!config.inventoryApiUrl) {
    return res.json({ items: items.map(i => ({ id: i.id, productName: i.productName, remaining: i.inventoryTotal, total: i.inventoryTotal })) });
  }
  try {
    const resp = await fetch(config.inventoryApiUrl);
    const data = await resp.json();
    res.json(data);
  } catch {
    res.json({ items: items.map(i => ({ id: i.id, productName: i.productName, remaining: i.inventoryTotal, total: i.inventoryTotal })) });
  }
});

function renderPage() {
  const status = config.dropStatus;
  const isActive = status === 'ACTIVE';
  const isSoldOut = status === 'SOLD_OUT';
  const isArchived = status === 'ARCHIVED';
  const isSingle = items.length === 1;

  const minPrice = items.reduce((a, b) => Math.min(a, Number(b.price) || Infinity), Infinity);
  const totalInv = items.reduce((a, b) => a + (Number(b.inventoryTotal) || 0), 0);
  const endsDisplay = config.endDate
    ? new Date(config.endDate).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(config.dropName)} — PopupStore</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Silkscreen:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --paper:      #E3F9FA;
      --card:       #FFFFFF;
      --rule:       #C9A2F5;
      --ink:        #3D1B66;
      --ink-soft:   #6E4FAD;
      --muted:      #8A76B0;
      --dim:        #B0A3CE;
      --cyan:       #4AD9DE;
      --cyan-soft:  #C4F0F2;
      --pink:       #FF52A6;
      --pink-dk:    #DB2D88;
      --pink-soft:  #FFD5EA;
      --yellow:     #FFD94A;
      --yellow-soft:#FFF3A8;
      --violet:     #B66DFF;
      --violet-dk:  #8841DF;
      --violet-soft:#E3CCFF;
      --mint:       #9EF2D8;
      --green:      #3FC29B;
      --red:        #FF4F6B;
      --red-soft:   #FFD0D7;
    }
    html { scroll-behavior: smooth; }
    body {
      font-family: 'Inter', sans-serif;
      color: var(--ink); background-color: var(--paper);
      min-height: 100vh; line-height: 1.5; -webkit-font-smoothing: antialiased;
      background-image:
        radial-gradient(circle at 12% 15%, rgba(255,82,166,0.22) 3px, transparent 4px),
        radial-gradient(circle at 86% 22%, rgba(255,217,74,0.25) 3px, transparent 4px),
        radial-gradient(circle at 5% 62%, rgba(182,109,255,0.22) 3px, transparent 4px),
        radial-gradient(circle at 94% 78%, rgba(74,217,222,0.28) 3px, transparent 4px),
        radial-gradient(circle at 48% 92%, rgba(255,82,166,0.15) 3px, transparent 4px),
        radial-gradient(circle at 40% 8%, rgba(182,109,255,0.18) 3px, transparent 4px),
        linear-gradient(rgba(61,27,102,0.05) 1px, transparent 1px),
        linear-gradient(90deg, rgba(61,27,102,0.05) 1px, transparent 1px);
      background-size: auto, auto, auto, auto, auto, auto, 28px 28px, 28px 28px;
      background-attachment: fixed;
    }
    .page { max-width: 940px; margin: 0 auto; padding: 3rem 1.25rem 5rem; position: relative; }

    /* Card with pixel-corner dots */
    .card {
      position: relative; background: var(--card);
      border: 2px solid var(--ink); border-radius: 14px;
      box-shadow: 4px 4px 0 var(--rule), 0 6px 16px rgba(61,27,102,0.06);
    }
    .card::before, .card::after {
      content: ''; position: absolute; width: 6px; height: 6px;
      border-radius: 1px; pointer-events: none;
    }
    .card::before { top: -3px; left: -3px; background: var(--violet); }
    .card::after  { bottom: -3px; right: -3px; background: var(--pink); }

    /* Top bar */
    .top-bar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0.25rem 1rem; margin-bottom: 1.5rem;
      border-bottom: 1px dashed var(--rule); flex-wrap: wrap; gap: 0.75rem;
    }
    .brand {
      display: inline-flex; align-items: center; gap: 0.65rem;
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 1.1rem; color: var(--ink); letter-spacing: -0.01em;
    }
    .status-pill {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 3px 10px; font-family: 'Inter', sans-serif;
      font-size: 0.62rem; font-weight: 700; letter-spacing: 0.14em;
      text-transform: uppercase; border: 2px solid var(--ink); border-radius: 999px;
      box-shadow: 2px 2px 0 var(--ink);
    }
    .status-pill.live    { background: var(--mint);     color: var(--ink); }
    .status-pill.live::before    { content: '●'; color: var(--green); }
    .status-pill.sold    { background: var(--pink);     color: #fff; }
    .status-pill.sold::before    { content: '●'; }
    .status-pill.ended   { background: var(--violet-soft); color: var(--ink); }
    .status-pill.ended::before   { content: '●'; color: var(--muted); }
    .top-right {
      display: flex; align-items: center; gap: 0.6rem;
      font-family: 'Inter', sans-serif; font-size: 0.66rem;
      font-weight: 600; letter-spacing: 0.18em; color: var(--muted);
      text-transform: uppercase;
    }
    .dots { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; }
    .dots i { width: 3px; height: 3px; background: var(--dim); display: block; }

    /* Hero */
    .hero {
      padding: 1.75rem 1.75rem 1.5rem; margin-bottom: 1.25rem;
      display: grid; grid-template-columns: 1fr auto; gap: 1.5rem; align-items: center;
    }
    .hero h1 {
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: clamp(1.65rem, 4.4vw, 2.4rem); line-height: 1.1;
      color: var(--ink); margin-bottom: 0.5rem; letter-spacing: -0.01em;
    }
    .hero .sub { font-size: 0.95rem; color: var(--ink-soft); margin-bottom: 1.1rem; max-width: 48ch; }
    .chips { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; height: 28px;
      padding: 0 12px; border-radius: 999px;
      font-family: 'Inter', sans-serif; font-size: 0.68rem; font-weight: 700;
      letter-spacing: 0.12em; text-transform: uppercase;
      border: 2px solid var(--ink); white-space: nowrap;
      box-shadow: 2px 2px 0 var(--ink);
    }
    .chip.live     { background: var(--mint);     color: var(--ink); }
    .chip.live::before     { content: '●'; color: var(--green); }
    .chip.sold     { background: var(--pink);     color: #fff; }
    .chip.ended    { background: var(--violet-soft); color: var(--ink); }
    .chip.timer    { background: var(--cyan-soft);   color: var(--ink); font-variant-numeric: tabular-nums; letter-spacing: 0.08em; }
    .chip.items    { background: var(--yellow-soft); color: var(--ink); }
    .chip.currency { background: var(--card); color: var(--pink-dk); }

    .hero-thumb {
      width: 128px; height: 128px; flex-shrink: 0;
      background: var(--cyan-soft);
      border: 2px solid var(--ink); border-radius: 12px;
      box-shadow: 3px 3px 0 var(--pink);
      display: grid; place-items: center; position: relative;
    }
    .hero-thumb .glyph {
      font-size: 3.2rem; line-height: 1; color: var(--ink);
      text-shadow: 3px 3px 0 var(--yellow);
    }
    @media (max-width: 560px) {
      .hero { grid-template-columns: 1fr; }
      .hero-thumb { width: 96px; height: 96px; justify-self: flex-start; }
      .hero-thumb .glyph { font-size: 2.5rem; }
    }

    /* Stats card */
    .stats-card { margin-bottom: 1.25rem; padding: 0; overflow: hidden; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); }
    .stat { padding: 1rem 1.2rem; border-right: 2px solid var(--rule); }
    .stat:last-child { border-right: none; }
    .stat b {
      display: block; font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase;
      color: var(--muted); margin-bottom: 6px;
    }
    .stat .v {
      font-family: 'Inter', sans-serif; font-weight: 700;
      font-size: 1.15rem; color: var(--ink); letter-spacing: -0.01em;
      font-variant-numeric: tabular-nums;
    }
    .stat .v small { color: var(--muted); font-weight: 500; font-size: 0.82rem; margin-left: 5px; }
    @media (max-width: 640px) {
      .stats { grid-template-columns: 1fr 1fr; }
      .stat:nth-child(3n+3) { border-right: none; }
      .stat:not(:last-child) { border-bottom: 2px solid var(--rule); }
    }

    /* Section heading */
    .eyebrow {
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 0.86rem; letter-spacing: 0.08em; color: var(--ink);
      text-transform: uppercase; display: inline-flex; align-items: center; gap: 0.5rem;
    }
    .eyebrow::before { content: '■'; color: var(--pink); font-size: 0.55rem; }
    .section-heading {
      display: flex; justify-content: space-between; align-items: center;
      margin: 1.75rem 0 1rem; flex-wrap: wrap; gap: 0.5rem;
    }

    /* Items grid */
    .items-grid {
      display: grid;
      grid-template-columns: ${isSingle ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))'};
      gap: 1.25rem; margin-bottom: 1.75rem;
      ${isSingle ? 'max-width: 420px; margin-left: auto; margin-right: auto;' : ''}
    }
    .item-card {
      position: relative; background: var(--card);
      border: 2px solid var(--ink); border-radius: 12px;
      box-shadow: 4px 4px 0 var(--violet);
      padding: 0; overflow: hidden;
      display: flex; flex-direction: column;
      transition: transform .15s, box-shadow .2s;
    }
    .item-card::before, .item-card::after {
      content: ''; position: absolute; width: 5px; height: 5px;
      border-radius: 1px; pointer-events: none;
    }
    .item-card::before { top: -3px; left: -3px; background: var(--pink); }
    .item-card::after  { bottom: -3px; right: -3px; background: var(--yellow); }
    .item-card:nth-child(3n+2) { box-shadow: 4px 4px 0 var(--pink); }
    .item-card:nth-child(3n+3) { box-shadow: 4px 4px 0 var(--yellow); }
    .item-card:hover { transform: translate(-2px, -2px); box-shadow: 6px 6px 0 var(--violet); }
    .item-card:nth-child(3n+2):hover { box-shadow: 6px 6px 0 var(--pink); }
    .item-card:nth-child(3n+3):hover { box-shadow: 6px 6px 0 var(--yellow); }
    .item-image {
      width: 100%; height: 180px; object-fit: cover;
      border-bottom: 2px solid var(--ink);
    }
    .item-image-placeholder {
      width: 100%; height: 180px;
      display: grid; place-items: center; font-size: 2.75rem;
      color: var(--ink); text-shadow: 2px 2px 0 rgba(61,27,102,0.15);
      border-bottom: 2px solid var(--ink);
    }
    .item-card:nth-child(3n+1) .item-image-placeholder { background: var(--cyan-soft); }
    .item-card:nth-child(3n+2) .item-image-placeholder { background: var(--pink-soft); }
    .item-card:nth-child(3n+3) .item-image-placeholder { background: var(--violet-soft); }
    .item-body { padding: 1rem 1.15rem 1.15rem; display: flex; flex-direction: column; flex: 1; }
    .item-name {
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 1.2rem; margin-bottom: 0.35rem; letter-spacing: -0.01em; color: var(--ink);
    }
    .item-price {
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 1.4rem; color: var(--pink-dk); margin-bottom: 0.5rem;
      font-variant-numeric: tabular-nums;
    }
    .item-price span { font-size: 0.8rem; color: var(--muted); font-weight: 500; font-family: 'Inter', sans-serif; margin-left: 4px; }
    .item-inventory { font-family: 'Inter', sans-serif; font-size: 0.84rem; color: var(--ink-soft); margin-bottom: 0.75rem; }
    .progress-bar {
      width: 100%; height: 10px; background: var(--cyan-soft);
      border: 2px solid var(--ink); border-radius: 3px;
      margin-bottom: 1rem; overflow: hidden;
    }
    .progress-fill {
      height: 100%; background: var(--pink);
      transition: width 0.3s;
    }
    .buy-btn {
      display: block; width: 100%; margin-top: auto;
      padding: 0.78rem; text-align: center;
      background: var(--pink); color: #fff;
      font-family: 'Silkscreen', sans-serif; font-weight: 700; font-size: 1rem;
      letter-spacing: 0.02em;
      border: 2px solid var(--ink); border-radius: 6px;
      text-decoration: none; cursor: pointer;
      box-shadow: 3px 3px 0 var(--ink);
      transition: transform .1s, box-shadow .1s, background .15s;
    }
    .buy-btn:hover { background: var(--pink-dk); transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--ink); }
    .buy-btn:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ink); }
    .buy-btn.disabled {
      background: var(--dim); color: var(--ink); cursor: not-allowed;
      box-shadow: 2px 2px 0 var(--ink);
    }
    .buy-btn.disabled:hover { transform: none; box-shadow: 2px 2px 0 var(--ink); }

    /* Message / waitlist */
    .message-box {
      padding: 1.5rem; text-align: center;
      font-family: 'Inter', sans-serif; font-size: 0.95rem; color: var(--ink);
      margin-bottom: 1.5rem;
    }
    .message-box h2 {
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 1.4rem; margin-bottom: 0.4rem; color: var(--ink); letter-spacing: -0.01em;
    }
    .waitlist-form {
      margin-top: 1.25rem; display: flex; gap: 0.5rem;
      max-width: 420px; margin-left: auto; margin-right: auto;
    }
    .waitlist-form input {
      flex: 1; padding: 0.65rem 0.9rem; border-radius: 6px;
      border: 2px solid var(--ink); background: var(--paper);
      color: var(--ink); font-family: 'Inter', sans-serif; font-size: 0.9rem;
    }
    .waitlist-form input:focus { outline: none; background: #fff; box-shadow: 3px 3px 0 var(--pink); }
    .waitlist-form button {
      padding: 0.65rem 1.25rem; border-radius: 6px;
      background: var(--pink); color: #fff; border: 2px solid var(--ink);
      font-family: 'Silkscreen', sans-serif; font-weight: 700; font-size: 0.92rem;
      cursor: pointer; box-shadow: 3px 3px 0 var(--ink);
      transition: transform .1s, box-shadow .1s;
    }
    .waitlist-form button:hover { transform: translate(-1px, -1px); box-shadow: 4px 4px 0 var(--ink); }
    .waitlist-form button:active { transform: translate(2px, 2px); box-shadow: 1px 1px 0 var(--ink); }

    /* How to buy */
    .how { padding: 1.75rem; margin-bottom: 1rem; }
    .how h2 {
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 1.55rem; color: var(--ink); letter-spacing: -0.01em; margin-bottom: 0.3rem;
    }
    .how-sub { font-size: 0.92rem; color: var(--muted); margin-bottom: 1.25rem; }
    .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.25rem; }
    .step {
      padding: 1rem 1.1rem; border: 2px solid var(--ink); border-radius: 10px;
      box-shadow: 3px 3px 0 var(--ink);
    }
    .step:nth-child(1) { background: var(--cyan-soft); }
    .step:nth-child(2) { background: var(--yellow-soft); }
    .step:nth-child(3) { background: var(--violet-soft); }
    .step-num {
      display: inline-grid; place-items: center;
      width: 30px; height: 30px; margin-bottom: 0.5rem;
      background: var(--card); border: 2px solid var(--ink); border-radius: 50%;
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 1rem; color: var(--ink);
      box-shadow: 2px 2px 0 var(--ink);
    }
    .step h3 {
      font-family: 'Silkscreen', sans-serif; font-weight: 700;
      font-size: 1.05rem; color: var(--ink); margin-bottom: 0.3rem; letter-spacing: -0.01em;
    }
    .step p { font-size: 0.84rem; color: var(--ink); line-height: 1.45; opacity: 0.85; }
    @media (max-width: 640px) { .steps { grid-template-columns: 1fr; } }

    .trust-row { display: flex; gap: 0.5rem; flex-wrap: wrap; padding-top: 1rem; border-top: 2px dashed var(--rule); }
    .trust {
      flex: 1; min-width: 180px;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 8px 12px; background: var(--paper);
      border: 2px solid var(--ink); border-radius: 8px;
      font-size: 0.84rem; color: var(--ink); font-weight: 500;
    }
    .trust b { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 5px; font-weight: 700; font-size: 0.85rem; border: 1.5px solid var(--ink); }
    .trust:nth-child(1) b { background: var(--cyan-soft); }
    .trust:nth-child(2) b { background: var(--yellow-soft); }
    .trust:nth-child(3) b { background: var(--pink-soft); }

    .powered-by {
      margin-top: 2rem; text-align: center;
      font-family: 'Inter', sans-serif; font-size: 0.82rem; color: var(--muted);
    }
    .powered-by a { color: var(--pink-dk); text-decoration: none; font-weight: 600; border-bottom: 1px dotted var(--pink-dk); }
    /* ── NAVBAR ── */
    .navbar {
      position:sticky;top:0;z-index:200;
      background:linear-gradient(90deg,var(--violet-dk) 0%,var(--ink) 100%);
      border-bottom:3px solid var(--ink);
      box-shadow:0 4px 0 rgba(0,0,0,.15);
    }
    .navbar-inner {
      max-width:1200px;margin:0 auto;
      padding:.85rem 2rem;
      display:flex;align-items:center;justify-content:space-between;
    }
    .navbar-brand {
      display:flex;align-items:center;gap:.55rem;
      font-family:'Silkscreen',sans-serif;font-size:1.55rem;
      font-weight:700;color:#fff;letter-spacing:-.01em;
    }
    .brand-pixel{color:var(--cyan);font-size:1rem;}
    .navbar-links {
      list-style:none;display:flex;align-items:center;gap:.25rem;
    }
    .nav-link {
      display:inline-block;padding:.45rem .95rem;
      font-family:'Silkscreen',sans-serif;font-size:.9rem;font-weight:600;
      color:rgba(255,255,255,.8);text-decoration:none;
      background:transparent;border:none;cursor:pointer;
      border-radius:6px;
      transition:background .15s,color .15s;
    }
    .nav-link:hover{background:rgba(255,255,255,.1);color:#fff;}
    .nav-signout{color:var(--pink);border:2px solid var(--pink);padding:.4rem .8rem;}
    .nav-signout:hover{background:var(--pink);color:#fff;}

    /* ── SITE FOOTER ── */
    .site-footer {
      background: linear-gradient(90deg, var(--violet-dk) 0%, var(--ink) 100%);
      border-top: 3px solid var(--ink);
      margin-top: 3rem;
    }
    .footer-inner {
      max-width: 1200px; margin: 0 auto;
      padding: 2.5rem 2rem 2rem;
      display: flex; flex-direction: column; gap: .65rem;
    }
    .footer-brand { display: flex; align-items: center; gap: .55rem; margin-bottom: .25rem; }
    .footer-pixel { color: var(--cyan); font-size: 1rem; }
    .footer-name { font-family: 'Silkscreen', sans-serif; font-size: 1.45rem; font-weight: 700; letter-spacing: .08em; color: #fff; }
    .footer-tagline { font-family: 'Silkscreen', sans-serif; font-size: 1rem; font-weight: 600; color: var(--cyan-soft); letter-spacing: .02em; }
    .footer-sub { font-family: 'Inter', sans-serif; font-size: .88rem; color: rgba(255,255,255,.55); max-width: 480px; line-height: 1.6; }
    .footer-divider {
      width: 60px; height: 3px; margin: .5rem auto;
      background-image: repeating-linear-gradient(to right, var(--cyan) 0 12px, var(--ink) 12px 14px, var(--pink) 14px 26px, var(--ink) 26px 28px, var(--yellow) 28px 40px, var(--ink) 40px 42px, var(--violet) 42px 54px, var(--ink) 54px 56px);
      border-radius: 2px;
    }
    .footer-copy { font-family: 'Inter', sans-serif; font-size: .75rem; color: rgba(255,255,255,.35); letter-spacing: .04em; }

    /* FOOTER NAV GRID */
    .footer-nav {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 2rem; width: 100%; padding-bottom: 2.5rem;
    }
    .footer-col-heading {
      font-family: 'Silkscreen', sans-serif; font-size: 1rem; font-weight: 700; color: #fff; letter-spacing: .06em; margin-bottom: .9rem; text-transform: uppercase;
    }
    .footer-col-links { list-style: none; display: flex; flex-direction: column; gap: .5rem; }
    .footer-col-links a {
      font-family: 'Inter', system-ui, sans-serif; font-size: .88rem; color: rgba(255,255,255,.6); text-decoration: none; display: inline-block; transition: color .15s, transform .15s;
    }
    .footer-col-links a:hover { color: #fff; transform: translateX(3px); }
    .footer-sep {
      width: 100%; height: 2px; margin-bottom: 2rem;
      background-image: repeating-linear-gradient(to right, var(--cyan) 0 18px, rgba(255,255,255,.08) 18px 22px, var(--pink) 22px 40px, rgba(255,255,255,.08) 40px 44px, var(--yellow) 44px 62px, rgba(255,255,255,.08) 62px 66px, var(--violet) 66px 84px, rgba(255,255,255,.08) 84px 88px);
    }
    .footer-brand, .footer-tagline, .footer-sub, .footer-divider, .footer-copy { align-self: center; text-align: center; }
    @media(max-width:720px){ .footer-nav { grid-template-columns: repeat(2, 1fr); } }
    @media(max-width:420px){ .footer-nav { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <nav class="navbar">
    <div class="navbar-inner">
      <div class="navbar-brand">
        <span class="brand-pixel">■</span>
        <span class="brand-name">PopupStore</span>
      </div>
    </div>
  </nav>
  <div class="page">
    <div class="top-bar">
      <span class="brand">PopupStore
        ${isActive ? '<span class="status-pill live">Live</span>'
          : isSoldOut ? '<span class="status-pill sold">Sold Out</span>'
          : '<span class="status-pill ended">Ended</span>'}
      </span>
      <span class="top-right">USDC-ready
        <span class="dots"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
      </span>
    </div>

    <section class="card hero">
      <div class="hero-body">
        <h1>${esc(config.dropName)}</h1>
        <p class="sub">${
          isActive ? 'Grab yours before the drop ends. USDC payments, no wallet needed.'
          : isSoldOut ? 'Sold out — thanks to everyone who grabbed one.'
          : 'This drop has ended. Thanks for visiting.'
        }</p>
        <div class="chips">
          ${isActive ? '<span class="chip live">Live</span>'
            : isSoldOut ? '<span class="chip sold">Sold Out</span>'
            : '<span class="chip ended">Ended</span>'}
          ${isActive && config.endDate ? '<span class="chip timer" id="countdown">--:--:--</span>' : ''}
          <span class="chip items">${items.length} item${items.length === 1 ? '' : 's'}</span>
          <span class="chip currency">USDC</span>
        </div>
      </div>
      <div class="hero-thumb"><span class="glyph">✦</span></div>
    </section>

    ${isActive ? `
    <section class="card stats-card">
      <div class="stats">
        <div class="stat"><b>Price from</b><span class="v">$${esc(String(Number.isFinite(minPrice) ? minPrice : 0))}<small>USDC</small></span></div>
        <div class="stat"><b>Items</b><span class="v">${items.length}<small>total in drop</small></span></div>
        <div class="stat"><b>Ends</b><span class="v">${esc(endsDisplay)}</span></div>
      </div>
    </section>` : ''}

    ${isActive ? `
    <div class="section-heading">
      <span class="eyebrow">Drop items</span>
      ${totalInv > 0 ? `<span class="eyebrow" style="color: var(--pink-dk);">${totalInv} across ${items.length}</span>` : ''}
    </div>
    ${renderItemsGrid()}` : ''}

    ${isSoldOut && config.showWaitlist
      ? `<section class="card message-box">
           <h2>Get restock alerts</h2>
           <p>This drop is sold out. Drop your email and we'll ping you if more become available.</p>
           <form class="waitlist-form" onsubmit="joinWaitlist(event)">
             <input type="email" placeholder="your@email.com" required>
             <button type="submit">Notify Me</button>
           </form>
         </section>`
      : isSoldOut
        ? '<section class="card message-box"><h2>Sold out</h2><p>Thanks to everyone who grabbed one!</p></section>'
        : isArchived
          ? '<section class="card message-box"><h2>This drop has ended</h2><p>Thanks for visiting — check back next time.</p></section>'
          : ''}

    ${isActive ? `
    <section class="card how">
      <h2>How to buy</h2>
      <p class="how-sub">Simple and instant. No wallet or signup needed.</p>
      <div class="steps">
        <div class="step">
          <span class="step-num">1</span>
          <h3>Pick an item</h3>
          <p>Choose what you want from the drop above. Stock updates live.</p>
        </div>
        <div class="step">
          <span class="step-num">2</span>
          <h3>Pay with USDC</h3>
          <p>Checkout opens in your browser. No wallet needed to get started.</p>
        </div>
        <div class="step">
          <span class="step-num">3</span>
          <h3>We ship fast</h3>
          <p>Tracked shipping worldwide. Confirmation lands in your inbox.</p>
        </div>
      </div>
      <div class="trust-row">
        <span class="trust"><b>⚡</b>Instant USDC checkout</span>
        <span class="trust"><b>🔒</b>No wallet needed</span>
        <span class="trust"><b>✓</b>Secured by Locus</span>
      </div>
    </section>` : ''}

    <div class="powered-by">Powered by <a href="https://buildwithlocus.com">BuildWithLocus</a> + <a href="https://paywithlocus.com">PaywithLocus</a></div>
  </div>

  <footer class="site-footer">
    <div class="footer-inner">
      <!-- Retro footer nav structure -->
      <div class="footer-nav">
        <div class="footer-col">
          <h4 class="footer-col-heading">Launch</h4>
          <ul class="footer-col-links">
            <li><a href="#">Drop builder</a></li>
            <li><a href="#">Integrations</a></li>
            <li><a href="#">Example storefront</a></li>
            <li><a href="#">Seller guide</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4 class="footer-col-heading">Workflow</h4>
          <ul class="footer-col-links">
            <li><a href="#">Detect items</a></li>
            <li><a href="#">Schedule expiry</a></li>
            <li><a href="#">Generate storefront</a></li>
            <li><a href="#">Notify buyers</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4 class="footer-col-heading">Platform</h4>
          <ul class="footer-col-links">
            <li><a href="https://buildwithlocus.com" target="_blank">BuildWithLocus</a></li>
            <li><a href="https://paywithlocus.com" target="_blank">PayWithLocus</a></li>
            <li><a href="#">Agent pipeline</a></li>
            <li><a href="https://github.com/sunilswain7/Popupstore" target="_blank">GitHub source</a></li>
          </ul>
        </div>
        <div class="footer-col">
          <h4 class="footer-col-heading">Support</h4>
          <ul class="footer-col-links">
            <li><a href="#">FAQ</a></li>
            <li><a href="#">Report issue</a></li>
            <li><a href="#">Contact</a></li>
          </ul>
        </div>
      </div>

      <div class="footer-sep"></div>

      <!-- existing centered content -->
      <div class="footer-brand">
        <span class="footer-pixel">■</span>
        <span class="footer-name">POPUPSTORE</span>
      </div>
      <p class="footer-tagline">Limited-time storefront infrastructure for creators.</p>
      <p class="footer-sub">Describe your drop. Launch instantly. Agents handle the rest.</p>
      <div class="footer-divider"></div>
      <p class="footer-copy">&copy; 2026 PopupStore. Built for the BuildWithLocus hackathon.</p>
    </div>
  </footer>

  <script>
    const endDate = "${config.endDate}";
    const inventoryApiUrl = "/api/inventory";
    const itemCount = ${items.length};

    async function updateInventory() {
      try {
        const res = await fetch(inventoryApiUrl);
        const data = await res.json();
        const itemList = data.items || [];
        for (const item of itemList) {
          const invEl = document.getElementById('inv-' + item.id);
          const progEl = document.getElementById('prog-' + item.id);
          const btnEl = document.getElementById('btn-' + item.id);
          if (invEl) {
            const sold = item.total - item.remaining;
            invEl.textContent = item.remaining + ' of ' + item.total + ' left (' + sold + ' sold)';
          }
          if (progEl) {
            const pct = item.total > 0 ? (item.remaining / item.total) * 100 : 0;
            progEl.style.width = pct + '%';
          }
          if (btnEl && item.remaining <= 0) {
            btnEl.classList.add('disabled');
            btnEl.textContent = 'Sold Out';
            btnEl.removeAttribute('href');
          }
        }
      } catch {}
    }

    function updateCountdown() {
      if (!endDate) return;
      const el = document.getElementById('countdown');
      if (!el) return;
      const diff = new Date(endDate).getTime() - Date.now();
      if (diff <= 0) { el.textContent = 'Drop has ended'; return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = 'Ends in ' + h + 'h ' + m + 'm ' + s + 's';
    }

    function joinWaitlist(e) {
      e.preventDefault();
      const email = e.target.querySelector('input').value;
      e.target.innerHTML = '<div style="color:#22c55e;margin-top:0.5rem">Thanks! We will notify ' + email + '</div>';
    }

    // Track checkout clicks
    document.querySelectorAll('.buy-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const itemId = this.id.replace('btn-', '');
        fetch('/api/checkout-click/' + itemId).catch(() => {});
      });
    });

    updateInventory();
    setInterval(updateInventory, 15000);
    updateCountdown();
    setInterval(updateCountdown, 1000);
  </script>
</body>
</html>`;
}

function renderItemsGrid() {
  return `<div class="items-grid">
    ${items.map(item => {
      const checkoutUrl = item.checkoutUrl
        || (item.checkoutSessionId ? `${config.checkoutBaseUrl}/${item.checkoutSessionId}` : '#');
      return `
      <div class="item-card">
        ${item.imageUrl
          ? `<img class="item-image" src="${esc(item.imageUrl)}" alt="${esc(item.productName)}">`
          : `<div class="item-image-placeholder">&#x1f4e6;</div>`}
        <div class="item-body">
          <div class="item-name">${esc(item.productName)}</div>
          <div class="item-price">$${esc(String(item.price))} <span>USDC</span></div>
          <div class="item-inventory" id="inv-${item.id}">Loading...</div>
          <div class="progress-bar"><div class="progress-fill" id="prog-${item.id}" style="width:100%"></div></div>
          <a href="${esc(checkoutUrl)}" class="buy-btn" id="btn-${item.id}" target="_blank" rel="noopener">
            Buy — $${esc(String(item.price))} USDC
          </a>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Storefront listening on port ${PORT}`);
  console.log(`Drop: ${config.dropName} | Items: ${items.length} | Status: ${config.dropStatus}`);
});
