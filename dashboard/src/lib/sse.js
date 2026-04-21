// SSE client management
const clients = new Map(); // storeId -> Set of response objects
const globalClients = new Set(); // clients listening to all events

function addClient(res, storeId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write(':\n\n'); // heartbeat

  if (storeId) {
    if (!clients.has(storeId)) clients.set(storeId, new Set());
    clients.get(storeId).add(res);
    res.on('close', () => clients.get(storeId)?.delete(res));
  } else {
    globalClients.add(res);
    res.on('close', () => globalClients.delete(res));
  }
}

function emit(event, data, storeId) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  // Send to store-specific clients
  if (storeId && clients.has(storeId)) {
    for (const res of clients.get(storeId)) {
      res.write(payload);
    }
  }

  // Always send to global clients
  for (const res of globalClients) {
    res.write(payload);
  }
}

module.exports = { addClient, emit };
