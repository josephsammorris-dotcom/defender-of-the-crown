// Play-on-this-device host: runs the rules engine in the page and saves the campaign locally.
import { Engine } from './shared/engine.js';

const SAVE_KEY = 'dotc-local-save';

function readSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return s?.config ? s : null; } catch { return null; }
}

export class LocalHost {
  static savedCampaign() {
    const s = readSave();
    return s && ['recruit', 'move', 'resolve'].includes(s.phase) ? s : null;
  }

  constructor(onState, onError) {
    this.onState = onState;
    this.onError = onError;
    this.engine = new Engine();
    this.setup = null;
  }

  start(setup) {
    this.setup = setup;
    this.engine.startLocal(setup);
    this.emit();
  }

  resume() {
    const s = readSave();
    if (!s) return false;
    this.engine = new Engine(s);
    this.setup = { humans: s.config.humans, difficulty: s.config.difficulty, names: s.players.map((p) => p.name) };
    // A battle interrupted by a reload restarts from its beginning.
    this.emit();
    return true;
  }

  get humans() { return this.engine.state.players.filter((p) => !p.ai).map((p) => p.slot); }

  view(slot) { return this.engine.view(slot); }

  act(slot, msg) {
    try {
      if (msg.type === 'ready' && this.engine.state.phase === 'over') this.engine.startLocal(this.setup);
      else this.engine.act(slot, msg);
    } catch (e) { this.onError?.(String(e.message || e)); }
    this.emit();
  }

  // Messages the TV would normally send to the server.
  send(msg) {
    if (msg.type === 'miniResult') { if (this.engine.miniResult(msg.miniId, msg.result)) this.emit(); }
    else if (msg.type === 'newGame') { this.engine.startLocal(this.setup); this.emit(); }
  }

  emit() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.engine.state)); } catch { /* storage unavailable */ }
    this.onState(this.engine.view(null));
  }

  close() {}
}
