import { connect } from './net.js';
import { PLAYERS } from './shared/map.js';
import { createController } from './controller.js';

const $ = (id) => document.getElementById(id);
const app = $('app');

// ---------- identity ----------
const params = new URLSearchParams(location.search);
let room = (params.get('room') || '').toUpperCase();
let token = localStorage.getItem('dotc-token');
if (!token) { token = crypto.randomUUID?.() || String(Math.random()).slice(2); localStorage.setItem('dotc-token', token); }
let myName = localStorage.getItem('dotc-name') || '';

let net = null;

function toast(text) {
  const t = $('toast');
  t.textContent = text; t.classList.remove('hidden');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add('hidden'), 2600);
}
const buzz = (ms) => navigator.vibrate?.(ms);
const send = (o) => net?.send(o);

// ---------- join screen ----------
function showJoin() {
  app.innerHTML = `
    <div class="card">
      <h2 style="color:#5b1a14">Defender of the Crown</h2>
      <p>Enter the room code shown on the TV, and your name.</p>
      <h3>Room code</h3>
      <input id="roomIn" type="text" maxlength="4" autocapitalize="characters" value="${room}" placeholder="ABCD">
      <h3>Your name</h3>
      <input id="nameIn" type="text" maxlength="16" value="${myName}" placeholder="Sir …">
      <p><button id="joinBtn" class="house">Join the realm</button></p>
    </div>`;
  $('joinBtn').onclick = () => {
    const r = $('roomIn').value.trim().toUpperCase();
    const n = $('nameIn').value.trim();
    if (!/^[A-Z]{4}$/.test(r)) return toast('Room code is 4 letters');
    if (!n) return toast('Tell us your name, my lord');
    room = r; myName = n;
    localStorage.setItem('dotc-name', n);
    history.replaceState(null, '', `/play?room=${room}`);
    start();
  };
}

function start() {
  app.innerHTML = '<div class="card center"><p>Riding to the castle…</p></div>';
  net = connect(room, () => ({ role: 'phone', token, name: myName }), onMessage, (up) => { if (!up) toast('Reconnecting…'); });
}

const controller = createController({
  root: app,
  send: (o) => send(o),
  toast,
  onHeader(me, color, state) {
    document.documentElement.style.setProperty('--house', color);
    $('house').textContent = `${me.name} · ${PLAYERS[state.you].short}`;
    $('gold').textContent = state.phase === 'lobby' ? '' : `${me.gold} 🪙`;
  },
});

function onMessage(msg) {
  if (msg.type === 'state') {
    if (msg.state.you === null || msg.state.you === undefined) return;
    controller.setState(msg.state);
  }
  else if (msg.type === 'error') { toast(msg.message); buzz(80); }
  else if (msg.type === 'full') { controller.reset(); app.innerHTML = '<div class="card center"><h2>There is no free seat in this realm.</h2><p>Both banners are taken (or the computer lord holds one). Ask for a new room.</p></div>'; }
  else if (msg.type === 'cue') controller.cue(msg.miniId, msg.data);
}

// ---------- boot ----------
if (/^[A-Z]{4}$/.test(room) && myName) start();
else showJoin();
