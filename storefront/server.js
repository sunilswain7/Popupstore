const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Env vars injected by Agent 2
const config = {
  storeId: process.env.STORE_ID || 'demo-store',
  dropName: process.env.DROP_NAME || process.env.PRODUCT_NAME || 'Demo Drop',
  dropStatus: process.env.DROP_STATUS || 'ACTIVE',
  postDropAction: process.env.POST_DROP_ACTION || 'SOLD_OUT_PAGE',
  endDate: process.env.END_DATE || '',
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
  items = [{
    id: 'legacy',
    productName: process.env.PRODUCT_NAME || 'Product',
    price: parseFloat(process.env.PRICE_USDC || '0'),
    inventoryTotal: parseInt(process.env.INVENTORY_TOTAL || '0', 10),
    checkoutSessionId: process.env.CHECKOUT_SESSION_ID || '',
    imageUrl: process.env.IMAGE_URL || '',
  }];
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html')) {
    return res.json({ status: 'ok', storeId: config.storeId });
  }
  res.send(renderPage());
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(config.dropName)} — PopupStore</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #fff;
      min-height: 100vh;
    }
    .page {
      max-width: 900px; margin: 0 auto; padding: 2rem 1rem;
    }
    .header {
      text-align: center; margin-bottom: 2rem;
    }
    .badge {
      display: inline-block; padding: 4px 14px; border-radius: 999px;
      font-size: 0.75rem; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.05em; margin-bottom: 1rem;
    }
    .badge.active { background: #22c55e20; color: #22c55e; border: 1px solid #22c55e40; }
    .badge.sold-out { background: #ef444420; color: #ef4444; border: 1px solid #ef444440; }
    .badge.archived { background: #6b728020; color: #9ca3af; border: 1px solid #6b728040; }
    .header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .countdown { color: #f59e0b; font-size: 0.9rem; }

    /* Items grid */
    .items-grid {
      display: grid;
      grid-template-columns: ${isSingle ? '1fr' : 'repeat(auto-fill, minmax(260px, 1fr))'};
      gap: 1.5rem;
      ${isSingle ? 'max-width: 400px; margin: 0 auto;' : ''}
    }
    .item-card {
      background: #111; border: 1px solid #222; border-radius: 12px;
      overflow: hidden; transition: border-color 0.2s;
    }
    .item-card:hover { border-color: #333; }
    .item-image {
      width: 100%; height: 200px; object-fit: cover;
    }
    .item-image-placeholder {
      width: 100%; height: 200px;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      display: flex; align-items: center; justify-content: center;
      font-size: 2.5rem;
    }
    .item-body { padding: 1.25rem; }
    .item-name { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem; }
    .item-price { font-size: 1.5rem; font-weight: 700; color: #3b82f6; margin-bottom: 0.5rem; }
    .item-price span { font-size: 0.85rem; color: #6b7280; font-weight: 400; }
    .item-inventory { font-size: 0.85rem; color: #9ca3af; margin-bottom: 0.75rem; }
    .progress-bar {
      width: 100%; height: 5px; background: #222; border-radius: 3px;
      margin-bottom: 1rem; overflow: hidden;
    }
    .progress-fill {
      height: 100%; background: linear-gradient(90deg, #3b82f6, #8b5cf6);
      border-radius: 3px; transition: width 0.3s;
    }
    .buy-btn {
      display: block; width: 100%; padding: 0.75rem; text-align: center;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      color: #fff; font-size: 0.95rem; font-weight: 600;
      border: none; border-radius: 8px; cursor: pointer;
      text-decoration: none; transition: opacity 0.2s;
    }
    .buy-btn:hover { opacity: 0.9; }
    .buy-btn.disabled { opacity: 0.4; cursor: not-allowed; background: #374151; }

    .message-box {
      margin-top: 1.5rem; padding: 1.25rem; border-radius: 10px;
      background: #111; border: 1px solid #222; color: #9ca3af;
      text-align: center; font-size: 0.95rem;
    }
    .waitlist-form {
      margin-top: 1rem; display: flex; gap: 0.5rem; max-width: 400px; margin-left: auto; margin-right: auto;
    }
    .waitlist-form input {
      flex: 1; padding: 0.6rem 1rem; border-radius: 8px;
      border: 1px solid #333; background: #0a0a0a; color: #fff; font-size: 0.9rem;
    }
    .waitlist-form button {
      padding: 0.6rem 1.25rem; border-radius: 8px;
      background: #8b5cf6; color: #fff; border: none; font-weight: 600; cursor: pointer;
    }
    .powered-by {
      margin-top: 2.5rem; text-align: center; font-size: 0.75rem; color: #4b5563;
    }
    .powered-by a { color: #6b7280; text-decoration: none; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      ${isActive ? '<span class="badge active">Live Drop</span>'
        : isSoldOut ? '<span class="badge sold-out">Sold Out</span>'
        : '<span class="badge archived">Ended</span>'}
      <h1>${esc(config.dropName)}</h1>
      ${isActive && config.endDate ? '<div class="countdown" id="countdown"></div>' : ''}
    </div>

    ${isActive ? renderItemsGrid() : ''}

    ${isSoldOut && config.showWaitlist
      ? `<div class="message-box">This drop is sold out!
           <form class="waitlist-form" onsubmit="joinWaitlist(event)">
             <input type="email" placeholder="Email for restock alerts" required>
             <button type="submit">Notify Me</button>
           </form></div>`
      : isSoldOut
        ? '<div class="message-box">This drop is sold out. Thanks to everyone who grabbed one!</div>'
        : isArchived
          ? '<div class="message-box">This drop has ended. Thanks for visiting!</div>'
          : ''}

    <div class="powered-by">Powered by <a href="https://buildwithlocus.com">Locus</a></div>
  </div>

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

app.listen(PORT, () => {
  console.log(`Storefront listening on port ${PORT}`);
  console.log(`Drop: ${config.dropName} | Items: ${items.length} | Status: ${config.dropStatus}`);
});
