const config = require('./config');

async function sendDropSummary(store, items, transactions) {
  const totalSold = items.reduce((sum, i) => sum + (i.inventoryTotal - i.inventoryRemaining), 0);
  const totalInventory = items.reduce((sum, i) => sum + i.inventoryTotal, 0);
  const revenue = transactions.reduce((sum, t) => sum + parseFloat(t.amountUsdc || 0), 0).toFixed(2);

  const itemRows = items.map(i => {
    const sold = i.inventoryTotal - i.inventoryRemaining;
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #222;color:#e5e5e5">${i.productName}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;color:#3b82f6">$${i.priceUsdc} USDC</td>
      <td style="padding:8px 12px;border-bottom:1px solid #222;color:#e5e5e5">${sold}/${i.inventoryTotal}</td>
    </tr>`;
  }).join('');

  const recentSales = transactions.slice(0, 10).map(t => {
    const itemName = t.item?.productName || 'Unknown';
    const time = new Date(t.createdAt).toLocaleString();
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #222;color:#e5e5e5">${itemName}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #222;color:#22c55e">$${t.amountUsdc} USDC</td>
      <td style="padding:6px 12px;border-bottom:1px solid #222;color:#9ca3af;font-size:12px">${time}</td>
    </tr>`;
  }).join('');

  const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:2rem 1rem">
    <div style="text-align:center;margin-bottom:2rem">
      <h1 style="font-size:1.5rem;background:linear-gradient(135deg,#3b82f6,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent">PopupStore</h1>
      <p style="color:#9ca3af;font-size:0.85rem">Drop Summary Report</p>
    </div>

    <div style="background:#111;border:1px solid #222;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem">
      <h2 style="color:#f5f5f5;font-size:1.25rem;margin:0 0 1rem">${store.dropName}</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
        <div>
          <div style="color:#6b7280;font-size:0.75rem;text-transform:uppercase">Total Sold</div>
          <div style="color:#f5f5f5;font-size:1.1rem;font-weight:600">${totalSold} / ${totalInventory}</div>
        </div>
        <div>
          <div style="color:#6b7280;font-size:0.75rem;text-transform:uppercase">Revenue</div>
          <div style="color:#22c55e;font-size:1.1rem;font-weight:600">$${revenue} USDC</div>
        </div>
        <div>
          <div style="color:#6b7280;font-size:0.75rem;text-transform:uppercase">Status</div>
          <div style="color:#f59e0b;font-size:1.1rem;font-weight:600">${store.status}</div>
        </div>
        <div>
          <div style="color:#6b7280;font-size:0.75rem;text-transform:uppercase">Duration</div>
          <div style="color:#f5f5f5;font-size:0.9rem">${new Date(store.createdAt).toLocaleDateString()} — ${new Date(store.endDate).toLocaleDateString()}</div>
        </div>
      </div>
    </div>

    <div style="background:#111;border:1px solid #222;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem">
      <h3 style="color:#9ca3af;font-size:0.85rem;margin:0 0 0.75rem">Items</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px 12px;color:#6b7280;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid #333">Product</th>
            <th style="text-align:left;padding:8px 12px;color:#6b7280;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid #333">Price</th>
            <th style="text-align:left;padding:8px 12px;color:#6b7280;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid #333">Sold</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>

    ${transactions.length > 0 ? `
    <div style="background:#111;border:1px solid #222;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem">
      <h3 style="color:#9ca3af;font-size:0.85rem;margin:0 0 0.75rem">Recent Sales</h3>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 12px;color:#6b7280;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid #333">Item</th>
            <th style="text-align:left;padding:6px 12px;color:#6b7280;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid #333">Amount</th>
            <th style="text-align:left;padding:6px 12px;color:#6b7280;font-size:0.7rem;text-transform:uppercase;border-bottom:1px solid #333">Time</th>
          </tr>
        </thead>
        <tbody>${recentSales}</tbody>
      </table>
    </div>` : ''}

    <div style="text-align:center;color:#4b5563;font-size:0.75rem;margin-top:2rem">
      <p>Powered by <span style="color:#6b7280">PopupStore</span> on <span style="color:#6b7280">Locus</span></p>
    </div>
  </div>
</body>
</html>`;

  const subject = `Drop Report: ${store.dropName} — $${revenue} USDC revenue`;

  // Send via Resend API if configured
  if (config.resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: config.emailFrom || 'PopupStore <noreply@popupstore.dev>',
          to: [store.ownerEmail],
          subject,
          html,
        }),
      });
      const result = await res.json();
      if (result.id) {
        console.log(`[Email] Summary sent to ${store.ownerEmail} (${result.id})`);
        return true;
      }
      console.error(`[Email] Resend error:`, result);
      return false;
    } catch (err) {
      console.error(`[Email] Failed to send:`, err.message);
      return false;
    }
  }

  // Fallback: log to console (demo mode)
  console.log(`[Email] Would send summary to ${store.ownerEmail}`);
  console.log(`[Email] Subject: ${subject}`);
  console.log(`[Email] Revenue: $${revenue} | Sold: ${totalSold}/${totalInventory}`);
  return false;
}

module.exports = { sendDropSummary };
