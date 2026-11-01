// Match Durable Object — hosts one room for phones mode.
// Rules live in the shared Engine; this class handles sockets, joining and persistence.
// Phones send intents; the TV runs mini-games moment-to-moment and reports results.
import { Engine } from '../public/js/shared/engine.js';

export class Match {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sockets = new Map(); // ws -> { role: 'tv'|'phone', slot }
    this.engine = new Engine();
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('state');
      if (saved?.config) this.engine = new Engine(saved);
    });
  }

  async fetch() {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.sockets.set(server, { role: null, slot: null });
    server.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      try { this.onMessage(server, msg); } catch (e) { this.send(server, { type: 'error', message: String(e.message || e) }); }
    });
    const close = () => { this.sockets.delete(server); this.broadcast(); };
    server.addEventListener('close', close);
    server.addEventListener('error', close);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch { /* socket gone */ } }

  connectedSlots() {
    const set = new Set();
    for (const info of this.sockets.values()) if (info.role === 'phone' && info.slot !== null) set.add(info.slot);
    return set;
  }

  broadcast() {
    const connected = this.connectedSlots();
    const tvConnected = [...this.sockets.values()].some((i) => i.role === 'tv');
    for (const [ws, info] of this.sockets) {
      if (!info.role || (info.role === 'phone' && info.slot === null)) continue;
      const view = this.engine.view(info.role === 'phone' ? info.slot : null, connected);
      view.tvConnected = tvConnected;
      this.send(ws, { type: 'state', state: view });
    }
  }

  async commit() {
    this.broadcast();
    await this.ctx.storage.put('state', this.engine.state);
  }

  relay(role, obj) {
    for (const [ws, info] of this.sockets) if (info.role === role) this.send(ws, obj);
  }

  onMessage(ws, msg) {
    const info = this.sockets.get(ws);
    const e = this.engine;
    const s = e.state;

    if (msg.type === 'hello') {
      if (msg.role === 'tv') info.role = 'tv';
      else {
        info.role = 'phone';
        const slot = e.join(msg.token, msg.name);
        if (slot === null) { this.send(ws, { type: 'full' }); return; }
        info.slot = slot;
      }
      return this.commit();
    }

    if (info.role === 'tv') {
      if (msg.type === 'miniResult') { if (e.miniResult(msg.miniId, msg.result)) return this.commit(); return; }
      if (msg.type === 'cue') {
        if (s.mini && msg.miniId === s.mini.id) this.relay('phone', { type: 'cue', miniId: s.mini.id, data: msg.data });
        return;
      }
      if (msg.type === 'newGame') { e.newGame(); return this.commit(); }
      if (msg.type === 'config') {
        e.configure(msg);
        // A phone holding a seat that is now the computer's loses it.
        for (const [sock, i] of this.sockets) {
          if (i.role === 'phone' && i.slot !== null && e.state.players[i.slot].ai) { i.slot = null; this.send(sock, { type: 'full' }); }
        }
        return this.commit();
      }
      return;
    }

    if (info.role === 'phone' && info.slot !== null) {
      // Live mini-game input goes straight to the TV.
      if (msg.type === 'input') {
        if (s.mini && msg.miniId === s.mini.id) this.relay('tv', { type: 'input', slot: info.slot, miniId: s.mini.id, data: msg.data });
        return;
      }
      e.act(info.slot, msg);
      return this.commit();
    }
  }
}
