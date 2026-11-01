// Map-phase and battle controls shared by the phone page and the on-device side panel.
import { PLAYERS, ADJACENCY, territoryById, COSTS, armySize } from './shared/map.js';

const $ = (id) => document.getElementById(id);
const buzz = (ms) => navigator.vibrate?.(ms);

export function createController({ root, send, toast, onHeader = () => {}, scroller = window }) {
  let state = null;
  let viewKey = '';
  const ui = { recruitTerr: null, from: null, to: null, send: null };
  let cueHandler = null;

  // ---------- helpers ----------
  const me = () => state.players[state.you];
  const myColor = () => PLAYERS[state.you]?.color || '#5b1a14';
  const mine = () => Object.entries(state.territories).filter(([, t]) => t.owner === state.you);
  const armyText = (a) => `⚔${a.soldiers} ♞${a.knights} ⛭${a.catapults}`;
  const tName = (id) => territoryById[id]?.name || id;

  function render() {
    if (state.you === null || state.you === undefined) return;
    root.style.setProperty('--house', myColor());
    onHeader(me(), myColor(), state);

    const m = state.mini;
    const key = [state.phase, state.season, m?.id, me().done, me().locked, me().ready, state.players[1 - state.you].locked, state.players.map((p) => `${p.joined}${p.ready}${p.connected}`).join()].join('|');
    // Controllers keep their DOM alive between updates so held buttons and sliders aren't interrupted.
    if (key === viewKey && (m || state.phase === 'move')) return;
    const scroll = scroller === window ? window.scrollY : scroller.scrollTop;
    viewKey = key;
    cueHandler = null;

    if (state.phase === 'lobby') renderLobby();
    else if (state.phase === 'recruit') renderRecruit();
    else if (state.phase === 'move') renderMove();
    else if (state.phase === 'resolve') renderResolve();
    else if (state.phase === 'over') renderOver();
    if (!m) { if (scroller === window) window.scrollTo(0, scroll); else scroller.scrollTop = scroll; }
  }

  // ---------- lobby ----------
  function renderLobby() {
    const other = state.players[1 - state.you];
    root.innerHTML = `
      <div class="card center">
        <h2 style="color:${myColor()}">${PLAYERS[state.you].house}</h2>
        <p>You are <b>${me().name}</b>. Your seat is the keep of <b>${tName(PLAYERS[state.you].keep)}</b>.</p>
        <p class="muted">Rival: ${other.ai ? `${other.name}, the computer lord (${PLAYERS[1 - state.you].house})` : other.joined ? `${other.name} (${PLAYERS[1 - state.you].house}) — ${other.ready ? 'ready' : 'not ready'}` : 'waiting for a second lord…'}</p>
        <button id="readyBtn" class="${me().ready ? 'ok' : 'house'}">${me().ready ? '✔ Ready — tap to cancel' : 'I am ready'}</button>
      </div>
      <div class="card">
        <h3>How to play</h3>
        <p>Each season: <b>muster</b> troops with your gold, then secretly choose <b>one march</b>. Marching into enemy land starts a <b>swordfight</b>; enemy castles must be <b>besieged</b> first. If both lords march at each other, a <b>joust</b> decides who strikes first. Take your rival's keep — or all of England — to win the crown.</p>
      </div>`;
    $('readyBtn').onclick = () => send({ type: 'ready' });
  }

  // ---------- recruit ----------
  function renderRecruit() {
    const lands = mine();
    if (!ui.recruitTerr || !lands.find(([id]) => id === ui.recruitTerr)) ui.recruitTerr = PLAYERS[state.you].keep in state.territories && state.territories[PLAYERS[state.you].keep].owner === state.you ? PLAYERS[state.you].keep : lands[0]?.[0];
    const sel = state.territories[ui.recruitTerr];
    const done = me().done;
    const gold = me().gold;
    root.innerHTML = `
      <h2>Season ${state.season}: Muster</h2>
      <div class="card">
        <h3>Choose where troops gather</h3>
        ${lands.map(([id, t]) => `<div class="terr ${id === ui.recruitTerr ? 'sel' : ''}" data-id="${id}"><span class="n">${tName(id)}${t.type !== 'open' ? (t.type === 'keep' ? ' 🏰' : ' ♜') : ''}</span><span class="army">${armyText(t.army)}</span></div>`).join('')}
      </div>
      <div class="card">
        <h3>Recruit at ${tName(ui.recruitTerr)}</h3>
        ${[['soldier', 'Men-at-arms', 'Bulk of your army'], ['knight', 'Knight', 'Worth three soldiers in a duel'], ['catapult', 'Catapult', '+2 siege shots each']].map(([u, label, desc]) => `
          <div class="buy"><div><b>${label}</b><div class="muted">${desc}</div></div><button data-buy="${u}" ${done || gold < COSTS[u] ? 'disabled' : ''}>${COSTS[u]} 🪙</button></div>`).join('')}
        ${sel?.type === 'open' ? `<div class="buy"><div><b>Build a castle</b><div class="muted">Walls force attackers to siege</div></div><button data-buy="castle" ${done || gold < COSTS.castle ? 'disabled' : ''}>${COSTS.castle} 🪙</button></div>` : ''}
      </div>
      <button id="doneBtn" class="${done ? 'ok' : 'house'}">${done ? '✔ Mustered — tap to change' : 'Finish mustering'}</button>
      <p class="muted center">${state.players[1 - state.you].done ? 'Your rival has finished mustering.' : 'Your rival is still recruiting.'}</p>`;
    root.querySelectorAll('.terr').forEach((el) => { el.onclick = () => { ui.recruitTerr = el.dataset.id; renderRecruit(); }; });
    root.querySelectorAll('[data-buy]').forEach((el) => { el.onclick = () => { send({ type: 'buy', unit: el.dataset.buy, territory: ui.recruitTerr }); buzz(15); }; });
    $('doneBtn').onclick = () => send({ type: 'recruitDone' });
  }

  // ---------- move ----------
  function renderMove() {
    const p = me();
    if (p.locked) {
      const mv = p.move;
      root.innerHTML = `
        <h2>Orders sealed</h2>
        <div class="card center">
          <p>${mv === 'hold' ? 'Your armies hold their ground this season.' : `March from <b>${tName(mv.from)}</b> to <b>${tName(mv.to)}</b><br>${armyText(mv.army)}`}</p>
          <p class="muted">${state.players[1 - state.you].locked ? 'Both lords have sealed orders…' : 'Waiting for your rival…'}</p>
          <button id="cancelBtn" class="alt">Change orders</button>
        </div>`;
      $('cancelBtn').onclick = () => send({ type: 'cancelMove' });
      return;
    }
    const sources = mine().filter(([, t]) => armySize(t.army) > 0);
    if (ui.from && !sources.find(([id]) => id === ui.from)) ui.from = null;
    const from = ui.from ? state.territories[ui.from] : null;
    if (from && (!ui.send || ui.sendFor !== ui.from)) {
      ui.send = { soldiers: Math.max(0, from.army.soldiers - 1), knights: from.army.knights, catapults: from.army.catapults };
      if (armySize(ui.send) === 0) ui.send.soldiers = from.army.soldiers;
      ui.sendFor = ui.from;
    }
    const dests = ui.from ? ADJACENCY[ui.from] : [];
    if (ui.to && !dests.includes(ui.to)) ui.to = null;
    const describe = (id) => {
      const t = state.territories[id];
      const who = t.owner === null ? 'unclaimed' : t.owner === state.you ? 'yours' : `${state.players[t.owner].name}'s`;
      const fort = t.type === 'keep' ? 'keep — capture to win!' : t.type === 'castle' ? 'castle — siege' : armySize(t.army) && t.owner !== state.you && t.owner !== null ? 'duel' : '';
      return `${who}${t.owner !== null ? ' · ' + armyText(t.army) : ''}${fort ? ' · ' + fort : ''}`;
    };

    root.innerHTML = `
      <h2>Season ${state.season}: Campaign</h2>
      <div class="card">
        <h3>1 · March from</h3>
        ${sources.map(([id, t]) => `<div class="terr ${id === ui.from ? 'sel' : ''}" data-from="${id}"><span class="n">${tName(id)}</span><span class="army">${armyText(t.army)}</span></div>`).join('') || '<p class="muted">You have no troops to march.</p>'}
      </div>
      ${ui.from ? `
      <div class="card">
        <h3>2 · March to</h3>
        ${dests.map((id) => `<div class="terr ${id === ui.to ? 'sel' : ''}" data-to="${id}"><span class="n">${tName(id)}</span><span class="army muted">${describe(id)}</span></div>`).join('')}
      </div>
      <div class="card">
        <h3>3 · Who marches</h3>
        ${['soldiers', 'knights', 'catapults'].map((k) => `
          <div class="stepper"><span>${{ soldiers: '⚔ Men-at-arms', knights: '♞ Knights', catapults: '⛭ Catapults' }[k]}</span>
          <button class="alt" data-dec="${k}">−</button><span class="v">${ui.send[k]}</span><button class="alt" data-inc="${k}">+</button></div>`).join('')}
        <p class="muted">Anything left behind guards ${tName(ui.from)}.</p>
      </div>` : ''}
      <div class="row">
        <button id="holdBtn" class="alt">Hold position</button>
        <button id="marchBtn" class="house" ${ui.from && ui.to && armySize(ui.send || {}) > 0 ? '' : 'disabled'}>March!</button>
      </div>`;
    root.querySelectorAll('[data-from]').forEach((el) => { el.onclick = () => { ui.from = el.dataset.from; ui.to = null; renderMove(); }; });
    root.querySelectorAll('[data-to]').forEach((el) => { el.onclick = () => { ui.to = el.dataset.to; renderMove(); }; });
    root.querySelectorAll('[data-inc]').forEach((el) => { el.onclick = () => { const k = el.dataset.inc; ui.send[k] = Math.min(from.army[k], ui.send[k] + 1); renderMove(); }; });
    root.querySelectorAll('[data-dec]').forEach((el) => { el.onclick = () => { const k = el.dataset.dec; ui.send[k] = Math.max(0, ui.send[k] - 1); renderMove(); }; });
    $('holdBtn').onclick = () => send({ type: 'hold' });
    $('marchBtn').onclick = () => { send({ type: 'move', from: ui.from, to: ui.to, army: ui.send }); buzz(30); ui.from = ui.to = null; ui.send = null; };
  }

  // ---------- resolve / mini-games ----------
  function renderResolve() {
    const m = state.mini;
    if (!m || !m.players.includes(state.you)) {
      root.innerHTML = `
        <h2>The armies march</h2>
        <div class="card center"><p>${m ? 'Watch the TV — other lords are fighting.' : 'Watch the TV…'}</p></div>
        <div class="card"><h3>Chronicle</h3>${state.log.slice(-5).map((l) => `<p>${l}</p>`).join('')}</div>`;
      return;
    }
    if (m.kind === 'joust') return joustController(m);
    if (m.kind === 'siege') return m.attacker === state.you ? siegeAttacker(m) : siegeDefender(m);
    if (m.kind === 'duel') return duelController(m);
  }

  function joustController(m) {
    root.innerHTML = `
      <div class="ctrl">
        <div class="big-msg" id="jMsg">Tournament Joust</div>
        <p class="center" id="jSub" style="text-align:center">Wait for the countdown, then press and HOLD. Release just before the lances meet.</p>
        <div class="timing"><div class="zone" style="left:${100 * (1 - 600 / 3000)}%;width:${100 * (340 / 3000)}%;opacity:.5"></div><div class="zone" style="left:${100 * (1 - 260 / 3000)}%;width:${100 * (260 / 3000)}%"></div><div class="fill" id="jFill"></div><div class="impact"></div></div>
        <button class="lance-btn" id="lance">HOLD<br>LANCE</button>
      </div>`;
    const btn = $('lance'), fill = $('jFill');
    let pass = 0, chargeAt = null, duration = 3000, released = true, raf = null;
    const down = (e) => { e.preventDefault(); released = false; btn.classList.add('held'); buzz(20); };
    const up = (e) => {
      e?.preventDefault();
      if (released) return;
      released = true; btn.classList.remove('held');
      if (chargeAt !== null) {
        const t = performance.now() - chargeAt;
        send({ type: 'input', miniId: m.id, data: { pass, release: t } });
        $('jMsg').textContent = 'Lance lowered!';
        chargeAt = null;
      }
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('pointerleave', up);
    const anim = () => {
      if (chargeAt === null) return;
      const f = Math.min(1, (performance.now() - chargeAt) / duration);
      fill.style.width = `${f * 100}%`;
      raf = requestAnimationFrame(anim);
    };
    cueHandler = (d) => {
      if (d.phase === 'countdown') { pass = d.pass; $('jMsg').textContent = `Pass ${d.pass} — HOLD!`; $('jSub').textContent = `Score ${d.wins[0]}–${d.wins[1]}`; fill.style.width = '0'; }
      if (d.phase === 'charge') {
        pass = d.pass; duration = d.duration; chargeAt = performance.now();
        $('jMsg').textContent = released ? 'CHARGE! (press and hold!)' : 'CHARGE!';
        cancelAnimationFrame(raf); anim();
        // A rider who was already holding when the charge began is fine; one who wasn't can still press and release.
      }
      if (d.phase === 'result') { chargeAt = null; const mine = m.players.indexOf(state.you); $('jMsg').textContent = d.grades[mine]; $('jSub').textContent = `Score ${d.wins[0]}–${d.wins[1]}`; buzz(d.grades[mine] === 'clean hit' ? [40, 40, 40] : 60); }
      if (d.phase === 'done') { $('jMsg').textContent = d.winner === state.you ? 'You win the joust!' : 'You are unseated…'; }
    };
  }

  function siegeAttacker(m) {
    let aim = 0, power = 30, last = 0;
    root.innerHTML = `
      <div class="ctrl">
        <div class="big-msg" id="sMsg">${m.finale ? 'Siege of the Keep' : 'Siege'} — you attack</div>
        <p style="text-align:center" id="sSub">${m.shots} stones · aim, set power, fire. Breach any wall section!</p>
        <div class="card slider-wrap"><label><span>◀ Aim</span><b id="aimV">0°</b><span>▶</span></label><input id="aim" type="range" min="-40" max="40" step="1" value="0"></div>
        <div class="card slider-wrap"><label><span>Power</span><b id="powV">30</b></label><input id="pow" type="range" min="0" max="100" step="1" value="30"></div>
        <button class="fire" id="fire">FIRE!</button>
      </div>`;
    const push = (force) => {
      const now = performance.now();
      if (!force && now - last < 70) return;
      last = now;
      send({ type: 'input', miniId: m.id, data: { aim, power } });
    };
    $('aim').oninput = (e) => { aim = +e.target.value; $('aimV').textContent = `${aim > 0 ? '+' : ''}${aim}°`; push(); };
    $('pow').oninput = (e) => { power = +e.target.value; $('powV').textContent = power; push(); };
    $('aim').onchange = $('pow').onchange = () => push(true);
    $('fire').onclick = () => { send({ type: 'input', miniId: m.id, data: { aim, power, fire: true } }); buzz(50); };
    push(true);
    cueHandler = (d) => {
      $('sSub').textContent = `${d.shots} stones left · ${d.timeLeft}s`;
      if (d.hit) $('sMsg').textContent = d.hit;
      if (d.done) { $('sMsg').textContent = d.breached ? 'Breach! Charge!' : 'The walls hold…'; $('fire').disabled = true; }
    };
  }

  function siegeDefender(m) {
    let walls = m.walls.slice(), max = m.wallMax, cooldownUntil = 0;
    const names = ['West wall', 'Gatehouse', 'Great hall wall', 'East wall'];
    root.innerHTML = `
      <div class="ctrl">
        <div class="big-msg" id="dMsg">${m.finale ? 'Your keep' : 'Your castle'} is under siege!</div>
        <p style="text-align:center">Tap a wall section to send masons. One repair every 5 seconds.</p>
        <div id="wallBtns" style="display:grid;gap:8px"></div>
        <div class="cooldown" id="cd">Masons ready</div>
      </div>`;
    const draw = () => {
      $('wallBtns').innerHTML = walls.map((w, i) => `<button class="wall-btn" data-w="${i}" ${w <= 0 ? 'disabled' : ''}><div class="hpfill" style="width:${(100 * w) / max}%"></div><span>${names[i]} — ${w <= 0 ? 'BREACHED' : Math.round(w) + '/' + max}</span></button>`).join('');
      $('wallBtns').querySelectorAll('[data-w]').forEach((el) => {
        el.onclick = () => {
          if (performance.now() < cooldownUntil) { toast('The masons are still working'); return; }
          send({ type: 'input', miniId: m.id, data: { repair: +el.dataset.w } });
        };
      });
    };
    draw();
    const tick = setInterval(() => {
      if (!document.body.contains($('cd'))) return clearInterval(tick);
      const left = Math.max(0, cooldownUntil - performance.now());
      $('cd').textContent = left > 0 ? `Masons busy… ${(left / 1000).toFixed(1)}s` : 'Masons ready';
    }, 100);
    cueHandler = (d) => {
      walls = d.walls; max = d.max;
      if (d.repaired !== undefined) { cooldownUntil = performance.now() + d.cooldown; buzz(20); }
      if (d.hit) { $('dMsg').textContent = d.hit; if (d.hit.startsWith('Direct')) buzz([80, 40, 80]); }
      if (d.done) $('dMsg').textContent = d.breached ? 'The walls are breached! To arms!' : 'Your walls hold!';
      draw();
    };
  }

  function duelController(m) {
    const mi = state.you; // duel cues are indexed by slot
    let guard = 'high';
    root.innerHTML = `
      <div class="ctrl">
        <div class="big-msg" id="duMsg">${m.finale ? 'Throne-room duel!' : 'Swordfight!'}</div>
        <div class="card">
          <div class="hprow"><span>You</span><div class="hpbar"><div id="hpMe" style="width:100%"></div></div></div>
          <div class="hprow"><span>Rival</span><div class="hpbar"><div id="hpThem" style="width:100%;background:${PLAYERS[1 - mi].color}"></div></div></div>
        </div>
        <div class="row"><button id="gH" class="alt guard-on">🛡 Guard HIGH</button><button id="gL" class="alt">🛡 Guard LOW</button></div>
        <div class="duel-grid">
          <button data-act="high">Slash HIGH</button>
          <button data-act="low">Slash LOW</button>
          <button data-act="thrust" class="thrust">THRUST (slow, breaks guard)</button>
        </div>
      </div>`;
    const setGuard = (g) => {
      guard = g;
      $('gH').classList.toggle('guard-on', g === 'high');
      $('gL').classList.toggle('guard-on', g === 'low');
      send({ type: 'input', miniId: m.id, data: { act: g === 'high' ? 'guardHigh' : 'guardLow' } });
    };
    $('gH').onpointerdown = (e) => { e.preventDefault(); setGuard('high'); };
    $('gL').onpointerdown = (e) => { e.preventDefault(); setGuard('low'); };
    root.querySelectorAll('[data-act]').forEach((el) => {
      el.onpointerdown = (e) => { e.preventDefault(); send({ type: 'input', miniId: m.id, data: { act: el.dataset.act } }); buzz(15); };
    });
    cueHandler = (d) => {
      if (d.hp) {
        $('hpMe').style.width = `${(100 * d.hp[mi]) / d.max[mi]}%`;
        $('hpThem').style.width = `${(100 * d.hp[1 - mi]) / d.max[1 - mi]}%`;
      }
      if (d.event === 'hit') { $('duMsg').textContent = d.on === state.you ? 'You are struck!' : 'A hit!'; if (d.on === state.you) buzz(120); }
      if (d.event === 'block') $('duMsg').textContent = d.by === state.you ? 'Parried!' : 'Blocked!';
      if (d.live) $('duMsg').textContent = 'Fight!';
      if (d.done) $('duMsg').textContent = d.winner === state.you ? 'Victory!' : 'Defeated…';
    };
  }

  // ---------- game over ----------
  function renderOver() {
    const won = state.winner === state.you;
    root.innerHTML = `
      <div class="card center">
        <h2 style="color:${won ? '#5b1a14' : '#333'}">${won ? 'The crown is yours!' : 'Your house has fallen.'}</h2>
        <p>${state.winReason || ''}</p>
        <button id="againBtn" class="house">Play again</button>
      </div>`;
    $('againBtn').onclick = () => send({ type: 'ready' });
  }


  return {
    setState(s) { state = s; render(); },
    cue(miniId, data) { if (cueHandler && state?.mini && miniId === state.mini.id) cueHandler(data); },
    reset() { viewKey = ''; ui.from = ui.to = ui.send = null; },
  };
}
