let eventSource = null;
let parsedSpec = null;

// ── Step 1: Parse natural language ──
document.getElementById('dropForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('dropInput').value.trim();
  if (!input) return;

  const btn = document.getElementById('parseBtn');
  btn.disabled = true;
  btn.textContent = 'Parsing...';

  try {
    const res = await fetch('/api/drops/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    });
    const data = await res.json();

    if (data.error && !data.spec) {
      alert('Parse failed: ' + (data.error || 'Unknown error'));
      return;
    }

    parsedSpec = data.spec || { items: [], dropName: '', endDate: null, postDropAction: 'SOLD_OUT_PAGE' };
    showReviewForm(parsedSpec, data.errors || []);
  } catch (err) {
    alert('Failed to parse: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Parse Drop';
  }
});

// ── Step 2: Review form ──
function showReviewForm(spec, errors) {
  document.getElementById('step1').classList.add('hidden');
  document.getElementById('step2').classList.remove('hidden');

  // Populate fields
  document.getElementById('reviewDropName').value = spec.dropName || '';
  document.getElementById('reviewPostDrop').value = spec.postDropAction || 'SOLD_OUT_PAGE';

  // Convert ISO date to datetime-local format
  if (spec.endDate) {
    const d = new Date(spec.endDate);
    if (!isNaN(d.getTime())) {
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      document.getElementById('reviewEndDate').value = local;
    }
  } else {
    document.getElementById('reviewEndDate').value = '';
  }

  renderItems(spec.items || []);
  showFieldErrors(errors);
}

function renderItems(items) {
  const container = document.getElementById('reviewItems');
  if (items.length === 0) {
    items.push({ productName: '', price: null, inventory: null, generateImage: false, imagePrompt: null });
  }

  container.innerHTML = items.map((item, i) => `
    <div class="item-form" data-index="${i}">
      <div class="item-form-header">
        <span>Item ${i + 1}</span>
        ${items.length > 1 ? `<button type="button" class="btn-remove-item" onclick="removeItem(${i})">Remove</button>` : ''}
      </div>
      <div class="item-fields">
        <div class="form-group">
          <label>Product Name</label>
          <input type="text" class="item-name" value="${escapeAttr(item.productName || '')}" placeholder="e.g. Signed Art Print">
          <span class="field-error" id="err-items-${i}-productName"></span>
        </div>
        <div class="form-group-row">
          <div class="form-group">
            <label>Price (USDC)</label>
            <input type="number" class="item-price" value="${item.price || ''}" placeholder="25.00" step="0.01" min="0.01">
            <span class="field-error" id="err-items-${i}-price"></span>
          </div>
          <div class="form-group">
            <label>Inventory</label>
            <input type="number" class="item-inventory" value="${item.inventory || ''}" placeholder="100" step="1" min="1">
            <span class="field-error" id="err-items-${i}-inventory"></span>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function removeItem(index) {
  const items = collectItemsFromForm();
  items.splice(index, 1);
  renderItems(items);
}

document.getElementById('addItemBtn').addEventListener('click', () => {
  const items = collectItemsFromForm();
  items.push({ productName: '', price: null, inventory: null, generateImage: false, imagePrompt: null });
  renderItems(items);
});

function collectItemsFromForm() {
  const forms = document.querySelectorAll('.item-form');
  return Array.from(forms).map(form => ({
    productName: form.querySelector('.item-name').value.trim(),
    price: parseFloat(form.querySelector('.item-price').value) || null,
    inventory: parseInt(form.querySelector('.item-inventory').value, 10) || null,
    generateImage: false,
    imagePrompt: null,
  }));
}

function collectSpecFromForm() {
  const endDateInput = document.getElementById('reviewEndDate').value;
  let endDate = null;
  if (endDateInput) {
    endDate = new Date(endDateInput).toISOString();
  }

  return {
    dropName: document.getElementById('reviewDropName').value.trim(),
    endDate,
    postDropAction: document.getElementById('reviewPostDrop').value,
    items: collectItemsFromForm(),
  };
}

function showFieldErrors(errors) {
  // Clear all previous errors
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  document.querySelectorAll('.form-group input, .form-group select').forEach(el => el.classList.remove('input-error'));

  for (const err of errors) {
    // Map field paths to error element IDs
    let errId = null;
    if (err.field === 'dropName') errId = 'err-dropName';
    else if (err.field === 'endDate') errId = 'err-endDate';
    else if (err.field === 'postDropAction') errId = 'err-postDropAction';
    else if (err.field === 'items') errId = null; // general items error
    else {
      // items[0].price → err-items-0-price
      const match = err.field.match(/items\[(\d+)\]\.(\w+)/);
      if (match) errId = `err-items-${match[1]}-${match[2]}`;
    }

    if (errId) {
      const el = document.getElementById(errId);
      if (el) {
        el.textContent = err.message;
        const input = el.previousElementSibling;
        if (input) input.classList.add('input-error');
      }
    }
  }
}

// Back button
document.getElementById('backBtn').addEventListener('click', () => {
  document.getElementById('step2').classList.add('hidden');
  document.getElementById('step1').classList.remove('hidden');
});

// ── Confirm & Launch ──
document.getElementById('confirmBtn').addEventListener('click', async () => {
  const spec = collectSpecFromForm();
  const btn = document.getElementById('confirmBtn');
  btn.disabled = true;
  btn.textContent = 'Launching...';

  // Clear old errors
  document.querySelectorAll('.field-error').forEach(el => el.textContent = '');

  try {
    const res = await fetch('/api/drops/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec }),
    });
    const data = await res.json();

    if (data.errors && data.errors.length > 0) {
      showFieldErrors(data.errors);
      btn.disabled = false;
      btn.textContent = 'Confirm & Launch';
      return;
    }

    if (data.error && !data.storeId) {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = 'Confirm & Launch';
      return;
    }

    // Success — show pipeline
    document.getElementById('step2').classList.add('hidden');
    document.getElementById('step1').classList.remove('hidden');
    document.getElementById('dropInput').value = '';

    const pipeline = document.getElementById('pipeline');
    const events = document.getElementById('events');
    pipeline.classList.remove('hidden');
    events.innerHTML = '';
    addEvent('success', `Drop confirmed! Pipeline started (${data.storeId.substring(0, 8)}...)`);
    connectSSE(data.storeId);
  } catch (err) {
    alert('Failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm & Launch';
  }
});

// ── SSE for pipeline progress ──
function connectSSE(storeId) {
  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/events/${storeId}`);

  const handlers = {
    'agent1:start': (d) => addEvent('info', d.message),
    'agent1:complete': (d) => {
      const itemsSummary = d.spec?.items?.map(i => `${i.productName} ($${i.price} x${i.inventory})`).join(', ');
      addEvent('success', `Spec approved: ${itemsSummary || d.spec?.dropName}`);
    },
    'agent1:blocked': (d) => addEvent('error', `Blocked: ${d.reason}`),
    'agent2:start': (d) => addEvent('info', d.message),
    'agent2:balance_ok': (d) => addEvent('success', `Credits OK: $${d.credits}`),
    'agent2:progress': (d) => addEvent('info', d.message),
    'agent2:items_created': (d) => addEvent('success', `${d.count} item(s) configured`),
    'agent2:service_created': (d) => addEvent('success', `Service created: ${d.serviceUrl}`),
    'agent2:deploy_started': (d) => addEvent('info', `Deployment started (${d.deploymentId?.substring(0, 12)}...)`),
    'agent2:deploy_status': (d) => addEvent('info', `Deploy: ${d.status} (poll ${d.poll})`),
    'agent2:store_live': (d) => {
      addEvent('success', `LIVE at ${d.url} (${d.itemCount} items)`);
      loadStores();
    },
    'agent2:deploy_failed': () => addEvent('error', 'Deployment failed'),
    'agent2:error': (d) => addEvent('error', d.reason),
    'agent2:warning': (d) => addEvent('warning', d.message),
    'agent3:sale': (d) => {
      addEvent('success', `Sale: ${d.itemName} — ${d.remaining}/${d.total} left`);
      loadStores();
    },
    'agent3:transition': (d) => { addEvent('info', `State -> ${d.newState}`); loadStores(); },
    'agent3:redeploy': (d) => addEvent('info', `Redeploying (${d.reason})`),
  };

  for (const [event, handler] of Object.entries(handlers)) {
    eventSource.addEventListener(event, (e) => {
      try { handler(JSON.parse(e.data)); } catch {}
    });
  }

  eventSource.onerror = () => addEvent('warning', 'SSE reconnecting...');
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

// ── Stores list ──
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
    const totalItems = s.items?.length || 0;
    const totalSold = (s.items || []).reduce((sum, i) => sum + (i.inventoryTotal - i.inventoryRemaining), 0);
    const totalInv = (s.items || []).reduce((sum, i) => sum + i.inventoryTotal, 0);
    const revenue = (s.transactions || []).reduce((sum, t) => sum + (t.amountUsdc || 0), 0).toFixed(2);
    return `
      <div class="store-card" onclick="showStore('${s.id}')">
        <div class="store-info">
          <h3>${escapeHtml(s.dropName)}</h3>
          <span class="meta">${totalItems} item(s) | ${totalSold}/${totalInv} sold | $${revenue} revenue</span>
        </div>
        <span class="status-badge status-${s.status}">${s.status.replace('_', ' ')}</span>
      </div>`;
  }).join('');
}

// ── Store detail modal ──
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
  const totalSold = (store.items || []).reduce((sum, i) => sum + (i.inventoryTotal - i.inventoryRemaining), 0);
  const totalInv = (store.items || []).reduce((sum, i) => sum + i.inventoryTotal, 0);
  const revenue = (store.transactions || []).reduce((sum, t) => sum + (t.amountUsdc || 0), 0).toFixed(2);
  const endDate = new Date(store.endDate);
  const remaining = endDate.getTime() - Date.now();
  const timeLeft = remaining > 0
    ? `${Math.floor(remaining / 3600000)}h ${Math.floor((remaining % 3600000) / 60000)}m`
    : 'Ended';

  const canArchive = ['ACTIVE', 'SOLD_OUT'].includes(store.status);
  const canDelete = store.status === 'ARCHIVED';

  const itemsHtml = (store.items || []).map(item => {
    const sold = item.inventoryTotal - item.inventoryRemaining;
    const pct = item.inventoryTotal > 0 ? (item.inventoryRemaining / item.inventoryTotal) * 100 : 0;
    return `
      <div style="background:#0a0a0a;border:1px solid #222;border-radius:8px;padding:1rem;margin-bottom:0.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <strong style="color:#f5f5f5">${escapeHtml(item.productName)}</strong>
          <span style="color:#3b82f6;font-weight:600">$${item.priceUsdc} USDC</span>
        </div>
        <div style="font-size:0.8rem;color:#9ca3af;margin-bottom:0.5rem">${sold}/${item.inventoryTotal} sold (${item.inventoryRemaining} left)</div>
        <div style="width:100%;height:4px;background:#222;border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);border-radius:2px"></div>
        </div>
      </div>`;
  }).join('');

  document.getElementById('storeDetail').innerHTML = `
    <div class="detail-header">
      <h2>${escapeHtml(store.dropName)}</h2>
      <span class="status-badge status-${store.status}">${store.status.replace('_', ' ')}</span>
    </div>

    <div class="detail-grid">
      <div class="detail-item"><label>Items</label><div class="value">${store.items?.length || 0}</div></div>
      <div class="detail-item"><label>Sold</label><div class="value">${totalSold}/${totalInv}</div></div>
      <div class="detail-item"><label>Revenue</label><div class="value">$${revenue} USDC</div></div>
      <div class="detail-item"><label>Time Left</label><div class="value">${timeLeft}</div></div>
      <div class="detail-item"><label>Post-Drop</label><div class="value">${store.postDropAction}</div></div>
      <div class="detail-item"><label>Created</label><div class="value">${new Date(store.createdAt).toLocaleDateString()}</div></div>
    </div>

    ${store.locusServiceUrl ? `<div class="detail-item" style="margin-bottom:1rem"><label>Live URL</label><div class="value"><a href="${store.locusServiceUrl}" target="_blank" style="color:#3b82f6">${store.locusServiceUrl}</a></div></div>` : ''}

    <h3 style="font-size:0.9rem;margin-bottom:0.75rem;color:#9ca3af">Items</h3>
    ${itemsHtml}

    <div class="detail-actions" style="margin-top:1rem">
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
  div.textContent = str || '';
  return div.innerHTML;
}

function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Initial load + global SSE
loadStores();
const globalSSE = new EventSource('/events');
globalSSE.addEventListener('agent3:sale', () => loadStores());
globalSSE.addEventListener('agent3:transition', () => loadStores());
globalSSE.addEventListener('agent2:store_live', () => loadStores());
