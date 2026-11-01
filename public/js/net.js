// Tiny reconnecting websocket wrapper used by both TV and phone.
export function connect(room, hello, onMessage, onStatus = () => {}) {
  let ws = null;
  let closedByUs = false;
  let retry = 500;

  function open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws?room=${room}`);
    ws.addEventListener('open', () => {
      retry = 500;
      onStatus(true);
      ws.send(JSON.stringify({ type: 'hello', ...hello() }));
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage(msg);
    });
    ws.addEventListener('close', () => {
      onStatus(false);
      if (closedByUs) return;
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 5000);
    });
  }
  open();

  return {
    send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    close() { closedByUs = true; ws?.close(); },
  };
}
