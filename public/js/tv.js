import * as THREE from 'three';
import { connect } from './net.js';
import { PLAYERS, TERRITORIES } from './shared/map.js';
import { MapScene } from './scenes/map.js';
import { JoustScene } from './scenes/joust.js';
import { SiegeScene } from './scenes/siege.js';
import { DuelScene } from './scenes/duel.js';
import { Audio } from './audio.js';

const $ = (id) => document.getElementById(id);
const audio = new Audio();

// ---------- room ----------
const params = new URLSearchParams(location.search);
let room = (params.get('room') || '').toUpperCase();
if (!/^[A-Z]{4}$/.test(room)) {
  room = (await (await fetch('/api/new')).json()).room;
  history.replaceState(null, '', `/?room=${room}`);
}
const joinUrl = `${location.origin}/play?room=${room}`;
$('roomCode').textContent = room;
$('joinUrl').textContent = joinUrl.replace(/^https?:\/\//, '');
try {
  const qr = qrcode(0, 'M'); qr.addData(joinUrl); qr.make();
  $('qr').innerHTML = qr.createSvgTag({ cellSize: 6, margin: 0 });
} catch { $('qr').textContent = ''; }

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const mapScene = new MapScene();
let mini = null; // active mini-game scene
let state = null;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  mapScene.resize(w, h);
  mini?.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// ---------- network ----------
const net = connect(room, () => ({ role: 'tv' }), onMessage, (up) => {
  $('status').textContent = up ? `Room ${room} · connected` : 'Reconnecting…';
});

function onMessage(msg) {
  if (msg.type === 'state') onState(msg.state);
  if (msg.type === 'input' && mini && msg.miniId === mini.mini.id) mini.onInput(msg.slot, msg.data);
}

function miniCtx(miniData) {
  return {
    get state() { return state; },
    hud: $('miniHud'),
    audio,
    cue: (data) => net.send({ type: 'cue', miniId: miniData.id, data }),
    finish: (result) => net.send({ type: 'miniResult', miniId: miniData.id, result }),
  };
}

const SCENES = { joust: JoustScene, siege: SiegeScene, duel: DuelScene };

function onState(s) {
  const prevLogLen = state?.log?.length || 0;
  state = s;
  mapScene.setState(s);

  // Mini-game lifecycle
  if (s.mini && (!mini || mini.mini.id !== s.mini.id)) {
    mini?.dispose();
    mini = new SCENES[s.mini.kind](s.mini, miniCtx(s.mini));
    resize();
  } else if (!s.mini && mini) {
    mini.dispose();
    mini = null;
  }

  const inGame = s.phase !== 'lobby';
  $('lobby').classList.toggle('hidden', inGame);
  $('topbar').classList.toggle('hidden', !inGame || !!mini);
  $('chronicle').classList.toggle('hidden', !inGame || !!mini);
  $('miniHud').classList.toggle('hidden', !mini);
  $('gameover').classList.toggle('hidden', s.phase !== 'over');

  renderLobby(s);
  renderTop(s);
  renderLog(s);
  if (s.phase === 'over') {
    const w = s.players[s.winner];
    $('winTitle').textContent = `Long live King ${w?.name || ''}!`;
    $('winTitle').style.color = PLAYERS[s.winner]?.color || '';
    $('winText').textContent = s.winReason || '';
  }
  if (s.log.length !== prevLogLen && !mini) audio.chime();
}

function renderLobby(s) {
  $('slots').innerHTML = s.players.map((p, i) => `
    <div class="slot" style="border-color:${PLAYERS[i].color}">
      <div class="who" style="color:${PLAYERS[i].color}">${PLAYERS[i].house}</div>
      <div>${p.joined ? p.name : '<i>waiting for a lord…</i>'}</div>
      <div class="st">${!p.joined ? '' : !p.connected ? 'disconnected' : p.ready ? '✔ Ready' : 'not ready'}</div>
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
      <div class="name" style="color:${PLAYERS[i].color}">${p.name || PLAYERS[i].short}</div>
      <div class="meta">${PLAYERS[i].house} · ${owned}/${TERRITORIES.length} lands · ${p.gold} gold</div>
      ${badge}`;
  });
}

function renderLog(s) {
  $('log').innerHTML = s.log.slice(-8).map((l) => `<li>${l}</li>`).join('');
}

// ---------- input ----------
$('clickToStart').addEventListener('click', () => {
  audio.start(); audio.startMusic();
  $('clickToStart').classList.add('hidden');
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') audio.toggleMusic();
  if ((e.key === 'n' || e.key === 'N') && (state?.phase === 'over' || confirm('Abandon this campaign and start again?'))) net.send({ type: 'newGame' });
});

// ---------- loop ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  if (mini) { mini.update(dt); renderer.render(mini.scene, mini.camera); }
  else { mapScene.update(dt); renderer.render(mapScene.scene, mapScene.camera); }
  requestAnimationFrame(frame);
}
frame();

// Exposed for debugging in the browser console.
window.dotc = { get state() { return state; }, net };
