import { Match } from './match.js';
export { Match };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion

function newCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/new') {
      return Response.json({ room: newCode() });
    }

    if (url.pathname === '/ws') {
      const room = (url.searchParams.get('room') || '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(room)) return new Response('Bad room code', { status: 400 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const stub = env.MATCH.get(env.MATCH.idFromName(room));
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
