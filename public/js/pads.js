// On-device battle controls: keyboard, mouse and touch pads for human lords sharing one screen.
import { PLAYERS } from './shared/map.js';
import { CHARGE_MS, HIT_WINDOW, GLANCE_WINDOW } from './scenes/joust.js';
import { SECTION_NAMES, REPAIR_COOLDOWN } from './scenes/siege.js';

// Each seat has a mirrored cluster of keys. In single-player the arrows/space/shift also work.
export const KEYSETS = [
  { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], act: ['KeyE'], act2: ['KeyQ'], label: { up: 'W', down: 'S', left: 'A', right: 'D', act: 'E', act2: 'Q' } },
  { up: ['KeyI'], down: ['KeyK'], left: ['KeyJ'], right: ['KeyL'], act: ['KeyU'], act2: ['KeyO'], label: { up: 'I', down: 'K', left: 'J', right: 'L', act: 'U', act2: 'O' } },
];
const SOLO_EXTRA = { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], act: ['Space', 'Enter'], act2: ['ShiftLeft', 'ShiftRight'] };

export function keyHelpHtml(solo) {
  const row = (seat, who) => {
    const l = KEYSETS[seat].label;
    return `<tr><th style="color:${PLAYERS[seat].color}">${who}</th>
      <td><kbd>${l.act}</kbd> hold / fire / slash high</td><td><kbd>${l.act2}</kbd> slash low</td>
      <td><kbd>${l.up}</kbd><kbd>${l.down}</kbd> guard · power</td><td><kbd>${l.left}</kbd><kbd>${l.right}</kbd> aim · wall · thrust (toward rival)</td></tr>`;
  };
  return `<table class="keys">${row(0, solo ? 'You' : 'Wolf')}${solo ? `<tr><th></th><td colspan="4">…or arrows, <kbd>Space</kbd> and <kbd>Shift</kbd>. Mouse and touch work too.</td></tr>` : row(1, 'Stag')}</table>`;
}

export class LocalControls {
  constructor(scene, humanSlots, container) {
    this.scene = scene;
    this.mini = scene.mini;
    this.humans = humanSlots.filter((s) => this.mini.players.includes(s));
    this.solo = humanSlots.length === 1;
    this.container = container;
    this.held = {}; // `${slot}:${button}` -> true
    this.seat = {}; // per-slot game-specific state
    container.innerHTML = '';
    container.classList.toggle('two', this.humans.length === 2);
    this.pads = {};
    for (const slot of this.humans) this.pads[slot] = this.buildPad(slot);
    this.onKey = this.onKey.bind(this);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.container.innerHTML = '';
  }

  keyFor(code) {
    for (const slot of this.humans) {
      const set = KEYSETS[slot];
      for (const btn of Object.keys(SOLO_EXTRA)) {
        if (set[btn].includes(code) || (this.solo && SOLO_EXTRA[btn].includes(code))) return { slot, btn };
      }
    }
    return null;
  }

  onKey(e) {
    if (e.target?.tagName === 'INPUT') return;
    const hit = this.keyFor(e.code);
    if (!hit) return;
    e.preventDefault();
    const down = e.type === 'keydown';
    if (down && e.repeat) return;
    this.press(hit.slot, hit.btn, down);
  }

  // Unified entry for keys, mouse and touch.
  press(slot, btn, down) {
    const key = `${slot}:${btn}`;
    if (down) this.held[key] = true; else delete this.held[key];
    const kind = this.mini.kind;
    const s = this.scene;
    const st = this.seat[slot];
    const send = (data) => s.onInput(slot, data);

    if (kind === 'joust') {
      if (btn !== 'act') return;
      st.btn.classList.toggle('held', down);
      if (!down && (s.phase === 'charge' || s.phase === 'grace')) send({ pass: s.pass, release: s.timer });
      return;
    }
    if (kind === 'siege' && slot === this.mini.attacker) {
      if (btn === 'act' && down) send({ aim: st.aim, power: st.power, fire: true });
      return; // aim/power are continuous, handled in update()
    }
    if (kind === 'siege') {
      if (!down) return;
      if (btn === 'left') st.cursor = (st.cursor + 3) % 4;
      if (btn === 'right') st.cursor = (st.cursor + 1) % 4;
      if (btn === 'act' || btn === 'act2') send({ repair: st.cursor });
      return;
    }
    if (kind === 'duel') {
      if (!down) return;
      const forward = slot === 0 ? 'right' : 'left';
      const act = { up: 'guardHigh', down: 'guardLow', act: 'high', act2: 'low' }[btn] || (btn === forward ? 'thrust' : null);
      if (act) send({ act });
    }
  }

  btn(label, keyLabel, slot, btnName, cls = '') {
    const b = document.createElement('button');
    b.className = `pad-btn ${cls}`;
    b.innerHTML = `${label}${keyLabel ? `<kbd>${keyLabel}</kbd>` : ''}`;
    const down = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); this.press(slot, btnName, true); };
    const up = (e) => { e.preventDefault(); if (this.held[`${slot}:${btnName}`]) this.press(slot, btnName, false); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  buildPad(slot) {
    const pad = document.createElement('div');
    pad.className = `pad seat${slot}`;
    pad.style.setProperty('--house', PLAYERS[slot].color);
    const L = KEYSETS[slot].label;
    const k = (b) => (this.solo ? `${L[b]}` : L[b]);
    const kind = this.mini.kind;
    const st = (this.seat[slot] = {});
    const title = document.createElement('div');
    title.className = 'pad-title';
    pad.appendChild(title);

    if (kind === 'joust') {
      title.textContent = `${PLAYERS[slot].short}: hold, release before impact`;
      const bar = document.createElement('div');
      bar.className = 'timing';
      bar.innerHTML = `<div class="zone" style="left:${100 * (1 - GLANCE_WINDOW / CHARGE_MS)}%;width:${100 * ((GLANCE_WINDOW - HIT_WINDOW) / CHARGE_MS)}%;opacity:.5"></div><div class="zone" style="left:${100 * (1 - HIT_WINDOW / CHARGE_MS)}%;width:${100 * (HIT_WINDOW / CHARGE_MS)}%"></div><div class="fill"></div><div class="impact"></div>`;
      st.fill = bar.querySelector('.fill');
      pad.appendChild(bar);
      st.btn = this.btn('LANCE', k('act'), slot, 'act', 'lance');
      pad.appendChild(st.btn);
    } else if (kind === 'siege' && slot === this.mini.attacker) {
      title.textContent = `${PLAYERS[slot].short}: catapult`;
      st.aim = 0; st.power = 45;
      const mk = (name, min, max, val, keys) => {
        const wrap = document.createElement('label');
        wrap.className = 'pad-slider';
        wrap.innerHTML = `<span>${name} <kbd>${keys}</kbd></span><b></b><input type="range" min="${min}" max="${max}" value="${val}">`;
        const input = wrap.querySelector('input');
        input.addEventListener('input', () => { st[name.toLowerCase()] = +input.value; this.scene.onInput(slot, { aim: st.aim, power: st.power }); });
        pad.appendChild(wrap);
        return { input, out: wrap.querySelector('b') };
      };
      st.aimUi = mk('Aim', -40, 40, 0, `${L.left}${L.right}`);
      st.powUi = mk('Power', 0, 100, 45, `${L.up}${L.down}`);
      pad.appendChild(this.btn('FIRE', k('act'), slot, 'act', 'fire'));
      this.scene.onInput(slot, { aim: st.aim, power: st.power });
    } else if (kind === 'siege') {
      title.textContent = `${PLAYERS[slot].short}: send masons`;
      st.cursor = 1;
      const grid = document.createElement('div');
      grid.className = 'pad-walls';
      st.walls = SECTION_NAMES.map((n, i) => {
        const b = document.createElement('button');
        b.className = 'pad-btn wall';
        b.innerHTML = `<i></i><span>${n}</span>`;
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); st.cursor = i; this.scene.onInput(slot, { repair: i }); });
        grid.appendChild(b);
        return b;
      });
      pad.appendChild(grid);
      const hint = document.createElement('div');
      hint.className = 'pad-hint';
      hint.innerHTML = `<kbd>${L.left}</kbd><kbd>${L.right}</kbd> choose · <kbd>${L.act}</kbd> repair`;
      st.cd = document.createElement('div');
      st.cd.className = 'pad-hint';
      pad.appendChild(hint); pad.appendChild(st.cd);
    } else if (kind === 'duel') {
      title.textContent = `${PLAYERS[slot].short}: sword`;
      const fwd = slot === 0 ? 'right' : 'left';
      const grid = document.createElement('div');
      grid.className = 'pad-duel';
      st.gh = this.btn('🛡 Guard high', L.up, slot, 'up', 'guard');
      st.gl = this.btn('🛡 Guard low', L.down, slot, 'down', 'guard');
      grid.append(st.gh, this.btn('Slash high', L.act, slot, 'act'), st.gl, this.btn('Slash low', L.act2, slot, 'act2'));
      pad.appendChild(grid);
      pad.appendChild(this.btn('THRUST', L[fwd], slot, fwd, 'thrust'));
    }
    this.container.appendChild(pad);
    return pad;
  }

  update(dt) {
    const s = this.scene;
    for (const slot of this.humans) {
      const st = this.seat[slot];
      const h = (b) => this.held[`${slot}:${b}`];
      if (this.mini.kind === 'joust') {
        const f = s.phase === 'charge' || s.phase === 'grace' ? Math.min(1, s.timer / CHARGE_MS) : 0;
        st.fill.style.width = `${f * 100}%`;
      } else if (this.mini.kind === 'siege' && slot === this.mini.attacker) {
        const da = (h('right') ? 1 : 0) - (h('left') ? 1 : 0);
        const dp = (h('up') ? 1 : 0) - (h('down') ? 1 : 0);
        if (da || dp) {
          st.aim = Math.max(-40, Math.min(40, st.aim + da * 30 * dt));
          st.power = Math.max(0, Math.min(100, st.power + dp * 40 * dt));
          s.onInput(slot, { aim: st.aim, power: st.power });
          st.aimUi.input.value = st.aim; st.powUi.input.value = st.power;
        }
        st.aimUi.out.textContent = `${st.aim > 0 ? '+' : ''}${Math.round(st.aim)}°`;
        st.powUi.out.textContent = Math.round(st.power);
      } else if (this.mini.kind === 'siege') {
        st.walls.forEach((b, i) => {
          const w = s.walls[i];
          b.querySelector('i').style.width = `${(100 * w) / s.max}%`;
          b.classList.toggle('cursor', i === st.cursor);
          b.disabled = w <= 0;
        });
        const left = Math.max(0, REPAIR_COOLDOWN - (s.elapsed - s.lastRepair));
        st.cd.textContent = s.phase !== 'live' ? '' : left > 0 ? `Masons busy… ${(left / 1000).toFixed(1)}s` : 'Masons ready';
      } else if (this.mini.kind === 'duel') {
        const g = s.fighters[slot].guard;
        st.gh.classList.toggle('on', g === 'high');
        st.gl.classList.toggle('on', g === 'low');
      }
    }
  }
}
