import * as THREE from 'three';
import { connect } from './net.js';
import { PLAYERS, TERRITORIES } from './shared/map.js';
import { MapScene } from './scenes/map.js';
import { JoustScene } from './scenes/joust.js';
import { SiegeScene } from './scenes/siege.js';
import { DuelScene } from './scenes/duel.js';
import { Audio } from './audio.js';
import { LocalHost } from './local.js';
import { makeBot } from './bots.js';
import { LocalControls, keyHelpHtml } from './pads.js';
import { createController } from './controller.js';

const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);
const audio = new Audio();
const SCENES = { joust: JoustScene, siege: SiegeScene, duel: DuelScene };

let mode = null;   // 'phones' | 'local'
let host = null;   // websocket wrapper or LocalHost — both have send()
let room = null;
let state = null;
let mini = null;   // active battle scene
let bots = [];
let pads = null;
let pendingConfig = null;

function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const mapScene = new MapScene();

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  // Keep England centred in the space the panel leaves free: a side panel on wide screens,
  // a bottom sheet on narrow or portrait ones (matches the CSS media query).
  const open = !$('panel').classList.contains('hidden');
  const side = w >= 820 && w > h;
  const pw = open && side ? $('panel').offsetWidth : 0;
  const ph = open && !side ? $('panel').offsetHeight || h * 0.55 : 0;
  mapScene.resize(w, h, { w: w - pw, h: h - ph });
  if (pw || ph) mapScene.camera.setViewOffset(w, h, pw / 2, ph / 2, w, h);
  else mapScene.camera.clearViewOffset();
  mini?.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------- menu ----------
let setup = null;
function showMenu() {
  host?.close?.();
  host = null; mode = null; state = null;
  endMini();
  ['lobby', 'gameover', 'topbar', 'chronicle', 'panel', 'pass', 'menuCorner', 'clickToStart'].forEach((id) => show(id, false));
  show('menu', true); show('menuMain', true); show('menuSetup', false);
  show('continueBtn', !!LocalHost.savedCampaign());
  $('status').textContent = '';
  history.replaceState(null, '', '/');
  mapScene.setState({ territories: {}, phase: 'lobby' });
  resize();
}

function unlockAudio() { audio.start(); audio.startMusic(); }

document.querySelectorAll('[data-local]').forEach((b) => b.addEventListener('click', () => {
  unlockAudio();
  setup = { humans: +b.dataset.local, difficulty: setup?.difficulty || 'normal' };
  show('menuMain', false); show('menuSetup', true);
  $('setupTitle').textContent = setup.humans === 1 ? 'One lord against the computer' : 'Two lords, one screen';
  show('name1Wrap', setup.humans === 2);
  show('diffWrap', setup.humans === 1);
  $('name0').placeholder = setup.humans === 1 ? 'Your name' : 'First lord';
  $('name1').placeholder = 'Second lord';
  $('name0').value = localStorage.getItem('dotc-name0') || '';
  $('name1').value = localStorage.getItem('dotc-name1') || '';
  $('keysHelp').innerHTML = `<p class="hint">Battle controls</p>${keyHelpHtml(setup.humans === 1)}`;
  setTimeout(() => $('name0').focus(), 50);
}));
document.querySelectorAll('#diffSeg [data-diff]').forEach((b) => b.addEventListener('click', () => {
  setup.difficulty = b.dataset.diff;
  document.querySelectorAll('#diffSeg button').forEach((x) => x.classList.toggle('on', x === b));
}));
$('backBtn').onclick = () => { show('menuMain', true); show('menuSetup', false); };
$('beginBtn').onclick = () => {
  const names = [$('name0').value.trim(), $('name1').value.trim()];
  localStorage.setItem('dotc-name0', names[0]);
  if (setup.humans === 2) localStorage.setItem('dotc-name1', names[1]);
  startLocal({ ...setup, names });
};
$('continueBtn').onclick = () => { unlockAudio(); startLocal(null); };
document.querySelectorAll('[data-phones]').forEach((b) => b.addEventListener('click', async () => {
  unlockAudio();
  const r = (await (await fetch('/api/new')).json()).room;
  startPhones(r, { humans: +b.dataset.phones, difficulty: 'normal' });
}));
$('menuCorner').onclick = () => {
  if (mode === 'local' || confirm('Leave this room and return to the main menu?')) showMenu();
};
$('overMenu').onclick = () => showMenu();
$('overAgain').onclick = () => {
  if (mode === 'local') host.act(host.humans[0], { type: 'ready' });
  else host.send({ type: 'newGame' });
};

// ---------- phones mode ----------
function startPhones(code, config) {
  mode = 'phones';
  room = code;
  pendingConfig = config;
  history.replaceState(null, '', `/?room=${room}`);
  const joinUrl = `${location.origin}/play?room=${room}`;
  $('roomCode').textContent = room;
  $('joinUrl').textContent = joinUrl.replace(/^https?:\/\//, '');
  try {
    const qr = qrcode(0, 'M'); qr.addData(joinUrl); qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0 });
  } catch { $('qr').textContent = ''; }
  show('menu', false);
  show('menuCorner', true);
  host = connect(room, () => ({ role: 'tv' }), onMessage, (up) => {
    $('status').textContent = up ? `Room ${room} · connected` : 'Reconnecting…';
  });
}

function onMessage(msg) {
  if (msg.type === 'state') {
    if (pendingConfig && msg.state.phase === 'lobby') { host.send({ type: 'config', ...pendingConfig }); pendingConfig = null; }
    onState(msg.state);
  }
  if (msg.type === 'input' && mini && msg.miniId === mini.mini.id) mini.onInput(msg.slot, msg.data);
  if (msg.type === 'error') toast(msg.message);
}

document.querySelectorAll('#humansSeg [data-humans]').forEach((b) => b.addEventListener('click', () => {
  host?.send({ type: 'config', humans: +b.dataset.humans, difficulty: state?.config?.difficulty });
}));
document.querySelectorAll('#lobbyDiffSeg [data-diff]').forEach((b) => b.addEventListener('click', () => {
  host?.send({ type: 'config', humans: state?.config?.humans, difficulty: b.dataset.diff });
}));

// ---------- on-device mode ----------
const controller = createController({
  root: $('panelBody'),
  scroller: $('panel'),
  send: (o) => host.act(panelSlot, o),
  toast,
  onHeader(me, color) {
    $('panel').style.setProperty('--house', color);
    $('panelName').textContent = `${me.name} · ${PLAYERS[me.slot].house}`;
    $('panelGold').textContent = `${me.gold} 🪙`;
  },
});
let panelSlot = null;
let holder = null; // which human currently has the device

function startLocal(cfg) {
  mode = 'local';
  host = new LocalHost(onState, toast);
  panelSlot = null;
  holder = cfg ? 0 : null;
  show('menu', false);
  show('menuCorner', true);
  $('status').textContent = '';
  if (cfg) host.start(cfg);
  else if (!host.resume()) showMenu();
}

function updatePanel(s) {
  let slot = null;
  if (mode === 'local' && !s.mini && (s.phase === 'recruit' || s.phase === 'move')) {
    const waiting = (h) => (s.phase === 'recruit' ? !s.players[h].done : !s.players[h].locked);
    const humans = host.humans.filter(waiting);
    slot = humans.includes(holder) ? holder : humans[0] ?? null;
  }
  const wasOpen = !$('panel').classList.contains('hidden');
  show('panel', slot !== null);
  document.body.classList.toggle('panel-open', slot !== null);
  if (slot === null) { panelSlot = null; show('pass', false); if (wasOpen) resize(); return; }
  if (slot !== panelSlot) {
    controller.reset();
    panelSlot = slot;
    $('panel').scrollTop = 0;
    if (host.humans.length === 2 && holder !== slot) {
      $('passName').textContent = s.players[slot].name;
      $('passName').style.color = PLAYERS[slot].color;
      $('passHouse').textContent = `${PLAYERS[slot].house} — ${s.phase === 'recruit' ? 'muster your forces' : 'give your secret orders'}`;
      show('pass', true);
    }
  }
  controller.setState(host.view(slot));
  if (!wasOpen) resize();
}
$('passBtn').onclick = () => { holder = panelSlot; show('pass', false); audio.chime(); };

// ---------- battles ----------
function endMini() {
  mini?.dispose(); mini = null;
  bots = [];
  pads?.dispose(); pads = null;
  show('pads', false);
}

function miniCtx(miniData) {
  return {
    get state() { return state; },
    hud: $('miniHud'),
    audio,
    cue: (data) => { if (mode === 'phones') host.send({ type: 'cue', miniId: miniData.id, data }); },
    finish: (result) => host.send({ type: 'miniResult', miniId: miniData.id, result }),
  };
}

function startMini(m, s) {
  endMini();
  mini = new SCENES[m.kind](m, miniCtx(m));
  bots = m.players.filter((slot) => s.players[slot].ai).map((slot) => makeBot(mini, slot, s.config?.difficulty));
  if (mode === 'local') {
    pads = new LocalControls(mini, host.humans, $('pads'));
    show('pads', true);
  }
  resize();
}

// ---------- state ----------
function onState(s) {
  const prevLogLen = state?.log?.length || 0;
  state = s;
  mapScene.setState(s);

  if (s.mini && (!mini || mini.mini.id !== s.mini.id)) startMini(s.mini, s);
  else if (!s.mini && mini) endMini();

  const inGame = s.phase !== 'lobby';
  show('lobby', mode === 'phones' && !inGame);
  show('topbar', inGame && !mini);
  show('chronicle', inGame && !mini);
  show('miniHud', !!mini);
  show('menuCorner', !!mode && !mini);
  show('gameover', s.phase === 'over');
  show('overHint', mode === 'phones');
  show('overAgain', mode === 'local');

  if (mode === 'phones') renderLobby(s);
  renderTop(s);
  renderLog(s);
  updatePanel(s);
  if (s.phase === 'over') {
    const w = s.players[s.winner];
    $('winTitle').textContent = w?.ai ? `${w.name} seizes the crown!` : `Long live King ${w?.name || ''}!`;
    $('winTitle').style.color = PLAYERS[s.winner]?.color || '';
    $('winText').textContent = s.winReason || '';
  }
  if (s.log.length !== prevLogLen && !mini) audio.chime();
}

function renderLobby(s) {
  document.querySelectorAll('#humansSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.humans === s.config?.humans));
  document.querySelectorAll('#lobbyDiffSeg button').forEach((b) => b.classList.toggle('on', b.dataset.diff === s.config?.difficulty));
  show('lobbyDiffSeg', s.config?.humans === 1);
  $('slots').innerHTML = s.players.map((p, i) => `
    <div class="slot" style="border-color:${PLAYERS[i].color}">
      <div class="who" style="color:${PLAYERS[i].color}">${PLAYERS[i].house}</div>
      <div>${p.ai ? `${p.name} <i>(computer)</i>` : p.joined ? p.name : '<i>waiting for a lord…</i>'}</div>
      <div class="st">${p.ai ? '✔ Ready' : !p.joined ? '' : !p.connected ? 'disconnected' : p.ready ? '✔ Ready' : 'not ready'}</div>
    </div>`).join('');
}

const PHASE_NAMES = { recruit: 'Muster your forces', move: 'Plan your campaign', resolve: 'The armies march', over: 'The crown is won' };

function renderTop(s) {
  $('seasonText').textContent = `Season ${s.season} of ${s.maxSeasons}`;
  $('phaseText').textContent = PHASE_NAMES[s.phase] || '';
  s.players.forEach((p, i) => {
    const owned = Object.values(s.territories).filter((t) => t.owner === i).length;
    let badge = '';
    if (!p.connected) badge = '<span class="badge off">phone disconnected</span>';
    else if (s.phase === 'recruit') badge = p.done ? '<span class="badge ok">mustered</span>' : '<span class="badge">recruiting…</span>';
    else if (s.phase === 'move') badge = p.locked ? '<span class="badge ok">orders sealed</span>' : '<span class="badge">planning…</span>';
    $(`lord${i}`).innerHTML = `
      <div class="name" style="color:${PLAYERS[i].color}">${p.name || PLAYERS[i].short}${p.ai ? ' <small>(computer)</small>' : ''}</div>
      <div class="meta">${PLAYERS[i].house} · ${owned}/${TERRITORIES.length} lands · ${p.gold} gold</div>
      ${badge}`;
  });
}

function renderLog(s) {
  $('log').innerHTML = s.log.slice(-8).map((l) => `<li>${l}</li>`).join('');
}

// ---------- keys ----------
window.addEventListener('keydown', (e) => {
  if (e.target?.tagName === 'INPUT') { if (e.key === 'Enter' && !$('menuSetup').classList.contains('hidden')) $('beginBtn').click(); return; }
  if (mini) return; // battle keys belong to the pads
  if (e.key === 'm' || e.key === 'M') audio.toggleMusic();
  if (e.key === 'Escape' && mode) $('menuCorner').click();
});

// ---------- loop ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (mini) {
    for (const b of bots) b.update(dt);
    pads?.update(dt);
    mini.update(dt);
  }
  // The battle may have ended (and been disposed) during its own update.
  if (mini) renderer.render(mini.scene, mini.camera);
  else { mapScene.update(dt); renderer.render(mapScene.scene, mapScene.camera); }
  requestAnimationFrame(frame);
}
frame();

// ---------- boot ----------
const urlRoom = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
if (/^[A-Z]{4}$/.test(urlRoom)) {
  show('menu', false);
  show('clickToStart', true);
  $('clickToStart').addEventListener('click', () => { unlockAudio(); show('clickToStart', false); }, { once: true });
  startPhones(urlRoom, null);
} else showMenu();

// Exposed for debugging and tests.
window.dotc = { get state() { return state; }, get mode() { return mode; }, get mini() { return mini; }, get host() { return host; } };
