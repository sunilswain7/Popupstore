const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Env vars injected by Agent 2 at deploy time
const config = {
  storeId: process.env.STORE_ID || 'demo-store',
  productName: process.env.PRODUCT_NAME || 'Demo Product',
  priceUsdc: process.env.PRICE_USDC || '25.00',
  inventoryTotal: parseInt(process.env.INVENTORY_TOTAL || '20', 10),
  checkoutSessionId: process.env.CHECKOUT_SESSION_ID || '',
  inventoryApiUrl: process.env.INVENTORY_API_URL || '',
  dropStatus: process.env.DROP_STATUS || 'ACTIVE',
  postDropAction: process.env.POST_DROP_ACTION || 'SOLD_OUT_PAGE',
  endDate: process.env.END_DATE || '',
  imageUrl: process.env.IMAGE_URL || '',
  showWaitlist: process.env.SHOW_WAITLIST === 'true',
  checkoutBaseUrl: process.env.CHECKOUT_BASE_URL || 'https://beta.paywithlocus.com/checkout',
};

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Health check — required by Locus
app.get('/', (req, res) => {
  // If Accept header wants JSON, return health status
  if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html')) {
    return res.json({ status: 'ok', storeId: config.storeId });
  }
  // Otherwise serve the storefront page
  res.send(renderPage());
});

// API: get current store config (used by frontend JS)
app.get('/api/config', (req, res) => {
  res.json({
    storeId: config.storeId,
    productName: config.productName,
    priceUsdc: config.priceUsdc,
    inventoryTotal: config.inventoryTotal,
    dropStatus: config.dropStatus,
    postDropAction: config.postDropAction,
    endDate: config.endDate,
    imageUrl: config.imageUrl,
    showWaitlist: config.showWaitlist,
    checkoutUrl: config.checkoutSessionId
      ? `${config.checkoutBaseUrl}/${config.checkoutSessionId}`
      : '',
  });
});

// API: proxy inventory check to dashboard
app.get('/api/inventory', async (req, res) => {
  if (!config.inventoryApiUrl) {
    return res.json({ remaining: config.inventoryTotal, total: config.inventoryTotal });
  }
  try {
    const resp = await fetch(config.inventoryApiUrl);
    const data = await resp.json();
    res.json(data);
  } catch {
    res.json({ remaining: config.inventoryTotal, total: config.inventoryTotal });
  }
});

function renderPage() {
  const status = config.dropStatus;
  const isActive = status === 'ACTIVE';
  const isSoldOut = status === 'SOLD_OUT';
  const isArchived = status === 'ARCHIVED';

  const checkoutUrl = config.checkoutSessionId
    ? `${config.checkoutBaseUrl}/${config.checkoutSessionId}`
    : '#';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(config.productName)} — PopupStore</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #fff;
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
    }
    .container {
      max-width: 480px; width: 100%; padding: 2rem; text-align: center;
    }
    .badge {
      display: inline-block; padding: 4px 12px; border-radius: 999px;
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
      margin-bottom: 1.5rem;
    }
    .badge.active { background: #22c55e20; color: #22c55e; border: 1px solid #22c55e40; }
    .badge.sold-out { background: #ef444420; color: #ef4444; border: 1px solid #ef444440; }
    .badge.archived { background: #6b728020; color: #9ca3af; border: 1px solid #6b728040; }
    .product-image {
      width: 100%; max-height: 320px; object-fit: cover; border-radius: 12px;
      margin-bottom: 1.5rem; border: 1px solid #222;
    }
    .product-image-placeholder {
      width: 100%; height: 200px; border-radius: 12px; margin-bottom: 1.5rem;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      display: flex; align-items: center; justify-content: center;
      border: 1px solid #222; font-size: 3rem;
    }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    .price { font-size: 2rem; font-weight: 700; color: #3b82f6; margin: 1rem 0; }
    .price span { font-size: 1rem; color: #6b7280; font-weight: 400; }
    .inventory {
      font-size: 0.9rem; color: #9ca3af; margin-bottom: 0.5rem;
    }
    .countdown {
      font-size: 0.85rem; color: #f59e0b; margin-bottom: 1.5rem;
    }
    .progress-bar {
      width: 100%; height: 6px; background: #222; border-radius: 3px;
      margin-bottom: 1.5rem; overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      border-radius: 3px; transition: width 0.3s;
    }
    .buy-btn {
      display: inline-block; width: 100%; padding: 1rem 2rem;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: #fff; font-size: 1.1rem; font-weight: 600;
      border: none; border-radius: 12px; cursor: pointer;
      text-decoration: none; transition: opacity 0.2s;
    }
    .buy-btn:hover { opacity: 0.9; }
    .buy-btn:disabled, .buy-btn.disabled {
      opacity: 0.4; cursor: not-allowed;
      background: #374151;
    }
    .waitlist-form {
      margin-top: 1.5rem; display: flex; gap: 0.5rem;
    }
    .waitlist-form input {
      flex: 1; padding: 0.75rem 1rem; border-radius: 8px;
      border: 1px solid #333; background: #111; color: #fff;
      font-size: 0.9rem;
    }
    .waitlist-form button {
      padding: 0.75rem 1.5rem; border-radius: 8px;
      background: #8b5cf6; color: #fff; border: none;
      font-weight: 600; cursor: pointer;
    }
    .message {
      margin-top: 1.5rem; padding: 1rem; border-radius: 8px;
      background: #111; border: 1px solid #222; color: #9ca3af;
      font-size: 0.9rem;
    }
    .powered-by {
      margin-top: 2rem; font-size: 0.75rem; color: #4b5563;
    }
    .powered-by a { color: #6b7280; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    ${isActive ? '<span class="badge active">Live Drop</span>'
      : isSoldOut ? '<span class="badge sold-out">Sold Out</span>'
      : '<span class="badge archived">Ended</span>'}

    ${config.imageUrl
      ? `<img class="product-image" src="${escapeHtml(config.imageUrl)}" alt="${escapeHtml(config.productName)}">`
      : '<div class="product-image-placeholder">&#x1f4e6;</div>'}

    <h1>${escapeHtml(config.productName)}</h1>
    <div class="price">$${escapeHtml(config.priceUsdc)} <span>USDC</span></div>

    <div class="inventory" id="inventory">
      Loading inventory...
    </div>

    <div class="progress-bar">
      <div class="progress-bar-fill" id="progress" style="width: 100%"></div>
    </div>

    ${isActive && config.endDate ? `<div class="countdown" id="countdown"></div>` : ''}

    ${isActive
      ? `<a href="${escapeHtml(checkoutUrl)}" class="buy-btn" id="buyBtn" target="_blank" rel="noopener">
           Buy Now — $${escapeHtml(config.priceUsdc)} USDC
         </a>`
      : isSoldOut && config.showWaitlist
        ? `<div class="message">This drop is sold out!</div>
           <form class="waitlist-form" onsubmit="joinWaitlist(event)">
             <input type="email" placeholder="Email for restock alerts" required>
             <button type="submit">Notify Me</button>
           </form>`
        : isSoldOut
          ? '<div class="message">This drop is sold out. Thanks to everyone who grabbed one!</div>'
          : '<div class="message">This drop has ended. Thanks for visiting!</div>'
    }

    <div class="powered-by">Powered by <a href="https://buildwithlocus.com">Locus</a></div>
  </div>

  <script>
    const endDate = "${config.endDate}";
    const inventoryApiUrl = "/api/inventory";

    async function updateInventory() {
      try {
        const res = await fetch(inventoryApiUrl);
        const data = await res.json();
        const remaining = data.remaining;
        const total = data.total;
        const sold = total - remaining;
        document.getElementById('inventory').textContent = remaining + ' of ' + total + ' remaining (' + sold + ' sold)';
        const pct = total > 0 ? (remaining / total) * 100 : 0;
        document.getElementById('progress').style.width = pct + '%';
        if (remaining <= 0) {
          const btn = document.getElementById('buyBtn');
          if (btn) { btn.classList.add('disabled'); btn.textContent = 'Sold Out'; }
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
      e.target.innerHTML = '<div style="color:#22c55e">Thanks! We will notify ' + email + '</div>';
    }

    updateInventory();
    setInterval(updateInventory, 15000);
    updateCountdown();
    setInterval(updateCountdown, 1000);
  </script>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.listen(PORT, () => {
  console.log(`Storefront listening on port ${PORT}`);
  console.log(`Store: ${config.productName} | Status: ${config.dropStatus}`);
});
