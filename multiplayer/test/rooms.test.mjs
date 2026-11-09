import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const origin = 'https://fantasticmatrix.xyz';
let mf;
const clients = [];

before(() => {
  mf = new Miniflare({
    modules: true,
    scriptPath: fileURLToPath(new URL('../src/worker.js', import.meta.url)),
    compatibilityDate: '2026-07-01',
    durableObjects: { ROOMS: { className: 'GomokuRoom', useSQLite: true } },
    bindings: { ALLOWED_ORIGINS: origin },
  });
});
after(async () => {
  for (const client of clients) { try { client.socket.close(); } catch {} }
  await mf.dispose();
});

async function create() {
  const response = await mf.dispatchFetch('https://game/rooms', { method: 'POST', headers: { Origin: origin } });
  assert.equal(response.status, 201);
  return response.json();
}

async function connect(code, token, join = false) {
  const response = await mf.dispatchFetch('https://game/rooms/' + code, {
    headers: { Origin: origin, Upgrade: 'websocket' },
  });
  assert.equal(response.status, 101);
  const socket = response.webSocket;
  const messages = [];
  const waiters = [];
  socket.accept();
  socket.addEventListener('message', event => {
    if (event.data === 'pong') return;
    const data = JSON.parse(event.data);
    const index = waiters.findIndex(w => w.type === data.type && w.matches(data));
    if (index < 0) messages.push(data);
    else {
      const [waiter] = waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(data);
    }
  });
  const client = {
    socket,
    send(data) { socket.send(JSON.stringify(data)); },
    next(type, matches = () => true) {
      const index = messages.findIndex(data => data.type === type && matches(data));
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, matches, resolve };
        waiter.timer = setTimeout(() => reject(new Error('Timed out waiting for ' + type)), 4000);
        waiters.push(waiter);
      });
    },
  };
  clients.push(client);
  client.send({ type: 'hello', token, join });
  return client;
}

async function pair() {
  const room = await create();
  const host = await connect(room.code, room.token);
  await host.next('welcome');
  await host.next('state', s => !s.hasGuest);
  const guestToken = randomUUID();
  const guest = await connect(room.code, guestToken, true);
  await guest.next('welcome');
  const state = await host.next('state', s => s.connected.white);
  await guest.next('state', s => s.connected.black);
  return { room, host, guest, guestToken, state };
}

test('origin restrictions and room codes are enforced', async () => {
  const blocked = await mf.dispatchFetch('https://game/rooms', { method: 'POST', headers: { Origin: 'https://other.example' } });
  assert.equal(blocked.status, 403);
  const room = await create();
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(room.token.length, 36);
  const invalid = await mf.dispatchFetch('https://game/rooms/OOOOOO', { headers: { Origin: origin, Upgrade: 'websocket' } });
  assert.equal(invalid.status, 404);
  const missing = await connect('AAAAAA', randomUUID(), true);
  assert.equal((await missing.next('error')).code, 'room_not_found');
});

test('two players receive the same winning move and score; illegal and stale moves are rejected', async () => {
  const { room, host, guest, state } = await pair();
  assert.equal(state.color, 1);
  const third = await connect(room.code, randomUUID(), true);
  assert.equal((await third.next('error')).code, 'room_full');
  guest.send({ type: 'move', round: 1, move: 0, r: 0, c: 0 });
  assert.equal((await guest.next('error')).code, 'invalid_move');
  const moves = [[7, 3], [8, 3], [7, 4], [8, 4], [7, 5], [8, 5], [7, 6], [8, 6], [7, 7]];
  let last;
  for (let n = 0; n < moves.length; n++) {
    const [r, c] = moves[n];
    (n % 2 ? guest : host).send({ type: 'move', round: 1, move: n, r, c });
    const [a, b] = await Promise.all([host.next('state', s => s.moves === n + 1), guest.next('state', s => s.moves === n + 1)]);
    assert.deepEqual(a.board, b.board);
    last = a;
  }
  assert.equal(last.board[7][7], 1);
  assert.equal(last.winner, 1);
  assert.deepEqual(last.scores, { black: 1, white: 0 });
  host.send({ type: 'newgame', round: 1 });
  const reset = await guest.next('state', s => s.round === 2);
  assert.equal(reset.moves, 0);
  assert.equal(reset.scores.black, 1);
  host.send({ type: 'move', round: 1, move: 9, r: 0, c: 0 });
  assert.equal((await host.next('error')).code, 'stale_round');
  guest.send({ type: 'reset_score', round: 2 });
  assert.deepEqual((await host.next('state', s => s.round === 3)).scores, { black: 0, white: 0 });
});

test('disconnect pauses play, token reconnect preserves the board, and stale sockets cannot reset it', async () => {
  const { room, host, guest, guestToken } = await pair();
  host.send({ type: 'move', round: 1, move: 0, r: 4, c: 4 });
  await guest.next('state', s => s.moves === 1);
  guest.socket.close(1000, 'Network lost');
  await host.next('state', s => !s.connected.white);
  host.send({ type: 'newgame', round: 1 });
  assert.equal((await host.next('error')).code, 'opponent_offline');
  const resumed = await connect(room.code, guestToken);
  await resumed.next('welcome');
  const snapshot = await resumed.next('state', s => s.connected.white);
  assert.equal(snapshot.board[4][4], 1);
  assert.equal(snapshot.turn, 2);
  assert.equal(snapshot.moves, 1);
  resumed.send({ type: 'move', round: 1, move: 1, r: 4, c: 5 });
  assert.equal((await host.next('state', s => s.moves === 2)).board[4][5], 2);
  const replacement = await connect(room.code, guestToken);
  await replacement.next('welcome');
  assert.equal((await replacement.next('state')).moves, 2);
});

test('a guest can leave and be replaced; host leave closes the room', async () => {
  const { room, host, guest } = await pair();
  guest.send({ type: 'leave' });
  const waiting = await host.next('state', s => !s.hasGuest);
  assert.equal(waiting.round, 2);
  const nextGuest = await connect(room.code, randomUUID(), true);
  await nextGuest.next('welcome');
  await nextGuest.next('state');
  host.send({ type: 'leave' });
  assert.equal((await nextGuest.next('error')).code, 'room_closed');
  const expired = await connect(room.code, randomUUID(), true);
  assert.equal((await expired.next('error')).code, 'room_not_found');
});

test('simultaneous guest joins reserve exactly one seat and duplicate moves apply once', async () => {
  const room = await create();
  const host = await connect(room.code, room.token);
  await host.next('welcome');
  await host.next('state');
  const guests = await Promise.all([connect(room.code, randomUUID(), true), connect(room.code, randomUUID(), true)]);
  const outcomes = await Promise.all(guests.map(g => Promise.race([
    g.next('welcome').then(() => 'welcome'), g.next('error').then(() => 'error'),
  ])));
  assert.deepEqual(outcomes.sort(), ['error', 'welcome']);
  await host.next('state', s => s.connected.white);
  const move = { type: 'move', round: 1, move: 0, r: 5, c: 5 };
  host.send(move);
  host.send(move);
  assert.equal((await host.next('state', s => s.moves === 1)).board[5][5], 1);
  assert.equal((await host.next('error')).code, 'invalid_move');
});
