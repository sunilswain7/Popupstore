// SSE connection for real-time events
let eventSource = null;

// Submit drop form
document.getElementById('dropForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('dropInput').value.trim();
  if (!input) return;

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Launching...';

  // Show pipeline
  const pipeline = document.getElementById('pipeline');
  const events = document.getElementById('events');
  pipeline.classList.remove('hidden');
  events.innerHTML = '';

  try {
    const res = await fetch('/api/drops', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    const data = await res.json();

    if (data.storeId) {
      addEvent('info', `Pipeline started for store ${data.storeId.substring(0, 8)}...`);
      connectSSE(data.storeId);
    }
  } catch (err) {
    addEvent('error', `Failed: ${err.message}`);
  }

  btn.disabled = false;
  btn.textContent = 'Launch Drop';
  document.getElementById('dropInput').value = '';
});

function connectSSE(storeId) {
  if (eventSource) eventSource.close();

  // Listen to store-specific events
  eventSource = new EventSource(`/events/${storeId}`);

  const handlers = {
    'agent1:start': (d) => addEvent('info', d.message),
    'agent1:complete': (d) => addEvent('success', `Spec approved: ${d.spec?.productName} - $${d.spec?.price} x${d.spec?.inventory}`),
    'agent1:blocked': (d) => addEvent('error', `Blocked: ${d.reason}`),
    'agent2:start': (d) => addEvent('info', d.message),
    'agent2:balance_ok': (d) => addEvent('success', `Credits OK: $${d.credits}`),
    'agent2:db_record_created': (d) => addEvent('success', `Store record created`),
    'agent2:progress': (d) => addEvent('info', d.message),
    'agent2:checkout_created': (d) => addEvent('success', `Checkout session ready`),
    'agent2:service_created': (d) => addEvent('success', `Service created: ${d.serviceUrl}`),
    'agent2:deploy_started': (d) => addEvent('info', `Deployment started (ID: ${d.deploymentId?.substring(0, 12)}...)`),
    'agent2:deploy_status': (d) => addEvent('info', `Deploy status: ${d.status} (poll ${d.poll})`),
    'agent2:store_live': (d) => {
      addEvent('success', `LIVE at ${d.url}`);
      loadStores();
    },
    'agent2:deploy_failed': (d) => addEvent('error', `Deployment failed`),
    'agent2:error': (d) => addEvent('error', d.reason),
    'agent2:warning': (d) => addEvent('warning', d.message),
    'agent3:sale': (d) => addEvent('success', `Sale! ${d.remaining}/${d.total} remaining`),
    'agent3:transition': (d) => {
      addEvent('info', `State -> ${d.newState}`);
      loadStores();
    },
    'agent3:redeploy': (d) => addEvent('info', `Redeploying storefront (${d.reason})`),
  };

  for (const [event, handler] of Object.entries(handlers)) {
    eventSource.addEventListener(event, (e) => {
      try { handler(JSON.parse(e.data)); } catch {}
    });
  }

  eventSource.onerror = () => {
    addEvent('warning', 'SSE connection lost, reconnecting...');
  };
}

function addEvent(type, message) {
  const events = document.getElementById('events');
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = `event-line ${type}`;
  div.textContent = `[${time}] ${message}`;
  events.appendChild(div);
  events.scrollTop = events.scrollHeight;
}

// Load stores list
async function loadStores() {
  try {
    const res = await fetch('/api/stores');
    const data = await res.json();
    renderStores(data.stores || []);
  } catch {}
}

function renderStores(stores) {
  const list = document.getElementById('storesList');
  if (stores.length === 0) {
    list.innerHTML = '<p class="empty">No drops yet. Create one above!</p>';
    return;
  }

  list.innerHTML = stores.map(s => {
    const sold = s.inventoryTotal - s.inventoryRemaining;
    const revenue = (sold * parseFloat(s.priceUsdc)).toFixed(2);
    return `
      <div class="store-card" onclick="showStore('${s.id}')">
        <div class="store-info">
          <h3>${escapeHtml(s.productName)}</h3>
          <span class="meta">$${s.priceUsdc} USDC | ${sold}/${s.inventoryTotal} sold | $${revenue} revenue</span>
        </div>
        <span class="status-badge status-${s.status}">${s.status.replace('_', ' ')}</span>
      </div>`;
  }).join('');
}

// Show store detail modal
async function showStore(id) {
  try {
    const res = await fetch(`/api/stores/${id}`);
    const data = await res.json();
    renderStoreDetail(data.store);
    document.getElementById('storeModal').classList.remove('hidden');
  } catch {}
}

function closeModal() {
  document.getElementById('storeModal').classList.add('hidden');
}

function renderStoreDetail(store) {
  const sold = store.inventoryTotal - store.inventoryRemaining;
  const revenue = (sold * parseFloat(store.priceUsdc)).toFixed(2);
  const endDate = new Date(store.endDate);
  const remaining = endDate.getTime() - Date.now();
  const timeLeft = remaining > 0
    ? `${Math.floor(remaining / 3600000)}h ${Math.floor((remaining % 3600000) / 60000)}m`
    : 'Ended';

  const canArchive = ['ACTIVE', 'SOLD_OUT'].includes(store.status);
  const canDelete = store.status === 'ARCHIVED';

  document.getElementById('storeDetail').innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(store.productName)}</h2>
      <span class="status-badge status-${store.status}">${store.status.replace('_', ' ')}</span>
    </div>

    <div class="detail-grid">
      <div class="detail-item"><label>Price</label><div class="value">$${store.priceUsdc} USDC</div></div>
      <div class="detail-item"><label>Inventory</label><div class="value">${store.inventoryRemaining}/${store.inventoryTotal}</div></div>
      <div class="detail-item"><label>Revenue</label><div class="value">$${revenue} USDC</div></div>
      <div class="detail-item"><label>Time Left</label><div class="value">${timeLeft}</div></div>
      <div class="detail-item"><label>Post-Drop</label><div class="value">${store.postDropAction}</div></div>
      <div class="detail-item"><label>Created</label><div class="value">${new Date(store.createdAt).toLocaleDateString()}</div></div>
    </div>

    ${store.locusServiceUrl ? `<div class="detail-item" style="margin-bottom:1rem"><label>Live URL</label><div class="value"><a href="${store.locusServiceUrl}" target="_blank" style="color:#3b82f6">${store.locusServiceUrl}</a></div></div>` : ''}

    <div class="detail-actions">
      <button class="btn btn-warning" ${canArchive ? '' : 'disabled'} onclick="overrideStore('${store.id}','ARCHIVE')">Archive Now</button>
      <button class="btn btn-danger" ${canDelete ? '' : 'disabled'} onclick="overrideStore('${store.id}','DELETE')">Delete Now</button>
      ${store.locusServiceUrl ? `<a href="${store.locusServiceUrl}" target="_blank" class="btn btn-primary">Visit Store</a>` : ''}
    </div>

    <div class="tx-list">
      <h3>Recent Sales (${store.transactions?.length || 0})</h3>
      ${(store.transactions || []).map(tx => `
        <div class="tx-item">
          <span class="tx-hash">${tx.txHash ? tx.txHash.substring(0, 16) + '...' : 'pending'}</span>
          <span class="tx-amount">$${tx.amountUsdc} USDC</span>
        </div>
      `).join('') || '<p class="empty">No sales yet</p>'}
    </div>`;
}

async function overrideStore(id, action) {
  if (!confirm(`Are you sure you want to ${action.toLowerCase()} this drop?`)) return;
  try {
    await fetch(`/api/stores/${id}/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    showStore(id);
    loadStores();
  } catch {}
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Initial load
loadStores();

// Also connect to global SSE for live updates
const globalSSE = new EventSource('/events');
globalSSE.addEventListener('agent3:sale', () => loadStores());
globalSSE.addEventListener('agent3:transition', () => loadStores());
globalSSE.addEventListener('agent2:store_live', () => loadStores());
