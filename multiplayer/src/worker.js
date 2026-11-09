import { DurableObject } from 'cloudflare:workers';

const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const ROOM_TTL = 2 * 60 * 60 * 1000;
const BLACK = 1;
const WHITE = 2;

function newBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0));
}

function resetBoard(room) {
  Object.assign(room, {
    board: newBoard(), turn: BLACK, winner: 0, draw: false,
    lastMove: null, winLine: null, moves: 0, round: room.round + 1,
  });
}

function winningLine(board, r, c, color) {
  for (const [dr, dc] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const line = [[r, c]];
    for (const sign of [-1, 1]) {
      for (let n = 1; n < 15; n++) {
        const nr = r + sign * dr * n;
        const nc = c + sign * dc * n;
        if (board[nr]?.[nc] !== color) break;
        if (sign < 0) line.unshift([nr, nc]);
        else line.push([nr, nc]);
      }
    }
    if (line.length >= 5) return [line[0], line.at(-1)];
  }
  return null;
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), n => alphabet[n % 32]).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
    const headers = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      'Vary': 'Origin',
    };
    const json = (body, status = 200) => Response.json(body, { status, headers });

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ service: 'fantastic-matrix-gomoku', version: 1 });
    }
    if (!origin || !allowed.includes(origin)) return json({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (url.pathname === '/rooms' && request.method === 'POST') {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const response = await stub.fetch(new Request(`https://room/create?code=${code}`, { method: 'POST' }));
        if (response.status === 409) continue;
        return json(await response.json(), response.status);
      }
      return json({ error: '暂时无法创建房间，请重试' }, 503);
    }

    const match = url.pathname.match(/^\/rooms\/([A-Z2-9]{6})$/);
    if (match && CODE_PATTERN.test(match[1]) && request.method === 'GET') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return json({ error: 'WebSocket required' }, 426);
      }
      const stub = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
      return stub.fetch(request);
    }
    return json({ error: 'Not found' }, 404);
  },
};

export class GomokuRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.room = null;
    this.queue = Promise.resolve();
    ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get('room') || null;
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // Serialize state changes across storage awaits, including simultaneous joins.
  run(operation) {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => {});
    return next;
  }

  async fetch(request) {
    return this.run(async () => {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/create') {
        if (this.room && this.room.expiresAt > Date.now()) return Response.json({}, { status: 409 });
        for (const ws of this.ctx.getWebSockets()) ws.close(4000, 'Room expired');
        this.room = {
          code: url.searchParams.get('code'), hostToken: crypto.randomUUID(), guestToken: null,
          scores: { black: 0, white: 0 }, round: 0,
        };
        resetBoard(this.room);
        await this.save();
        return Response.json({ code: this.room.code, token: this.room.hostToken }, { status: 201 });
      }

      // Discard abandoned handshakes before admitting another connection.
      for (const ws of this.ctx.getWebSockets()) {
        const info = ws.deserializeAttachment();
        if (!info?.color && Date.now() - (info?.createdAt || 0) > 15000) ws.close(4000, 'Handshake timeout');
      }
      if (this.ctx.getWebSockets().filter(ws => ws.readyState === 1).length >= 6) {
        return new Response('Too many connections', { status: 429 });
      }
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ color: null, createdAt: Date.now(), windowAt: Date.now(), count: 0 });
      return new Response(null, { status: 101, webSocket: client });
    });
  }

  async save() {
    this.room.expiresAt = Date.now() + ROOM_TTL;
    await this.ctx.storage.put('room', this.room);
    await this.ctx.storage.setAlarm(this.room.expiresAt);
  }

  players(exclude) {
    const active = this.ctx.getWebSockets().filter(ws => ws !== exclude && ws.readyState === 1);
    return {
      black: active.some(ws => ws.deserializeAttachment()?.color === BLACK),
      white: active.some(ws => ws.deserializeAttachment()?.color === WHITE),
    };
  }

  send(ws, message) {
    try { ws.send(JSON.stringify(message)); } catch { /* The close event updates presence. */ }
  }

  fail(ws, code, message, close = false) {
    this.send(ws, { type: 'error', code, message });
    if (close) ws.close(4000, code);
  }

  broadcast(exclude) {
    if (!this.room) return;
    const { board, turn, winner, draw, lastMove, winLine, scores, round, moves, code, guestToken } = this.room;
    const connected = this.players(exclude);
    for (const ws of this.ctx.getWebSockets()) {
      const color = ws.deserializeAttachment()?.color;
      if (ws === exclude || ws.readyState !== 1 || !color) continue;
      this.send(ws, {
        type: 'state', board, turn, winner, draw, lastMove, winLine, scores, round, moves,
        code, color, connected, hasGuest: Boolean(guestToken),
      });
    }
  }

  async webSocketMessage(ws, raw) {
    return this.run(async () => {
      if (ws.readyState !== 1) return;
      if (typeof raw !== 'string' || raw.length > 2048) {
        return this.fail(ws, 'invalid_message', '消息格式不正确', true);
      }
      let message;
      try { message = JSON.parse(raw); } catch { return this.fail(ws, 'invalid_message', '消息格式不正确', true); }
      if (!message || typeof message !== 'object') return this.fail(ws, 'invalid_message', '消息格式不正确', true);
      if (!this.room || this.room.expiresAt <= Date.now()) {
        return this.fail(ws, 'room_not_found', '房间不存在或已过期，请重新创建', true);
      }
      const info = ws.deserializeAttachment();
      if (!info) return;
      if (Date.now() - info.windowAt > 5000) Object.assign(info, { windowAt: Date.now(), count: 0 });
      info.count++;
      ws.serializeAttachment(info);
      if (info.count > 30) return this.fail(ws, 'rate_limited', '操作太频繁，请稍后重试', true);

      if (message.type === 'hello') {
        if (info.color) return;
        let color;
        let token = message.token;
        if (token === this.room.hostToken) color = BLACK;
        else if (this.room.guestToken && token === this.room.guestToken) color = WHITE;
        else if (!this.room.guestToken && message.join === true &&
            typeof token === 'string' && /^[a-f0-9-]{36}$/.test(token)) {
          if (!this.players().black) return this.fail(ws, 'host_offline', '房主暂时离线，请稍后再加入', true);
          color = WHITE;
          this.room.guestToken = token;
          await this.save();
        } else if (message.join) return this.fail(ws, 'room_full', '房间已有两位玩家', true);
        else return this.fail(ws, 'invalid_session', '房间身份已失效，请重新加入', true);

        // A resumed tab replaces its previous socket; stale close events cannot pause it.
        for (const old of this.ctx.getWebSockets()) {
          if (old !== ws && old.deserializeAttachment()?.color === color) old.close(4001, 'Session replaced');
        }
        ws.serializeAttachment({ ...info, color });
        this.send(ws, { type: 'welcome', code: this.room.code, color, token });
        this.broadcast();
        return;
      }
      if (!info.color) return this.fail(ws, 'unauthorized', '请先加入房间', true);

      if (message.type === 'leave') {
        if (info.color === BLACK) {
          for (const socket of this.ctx.getWebSockets()) {
            this.fail(socket, 'room_closed', '房主已退出，请重新创建或加入房间', true);
          }
          this.room = null;
          await this.ctx.storage.deleteAll();
          await this.ctx.storage.deleteAlarm();
        } else {
          this.room.guestToken = null;
          resetBoard(this.room);
          ws.serializeAttachment({ ...info, color: null });
          ws.close(1000, 'Left room');
          await this.save();
          this.broadcast(ws);
        }
        return;
      }

      const connected = this.players();
      if (!connected.black || !connected.white) return this.fail(ws, 'opponent_offline', '等待对手连接后继续');
      if (message.round !== this.room.round) {
        this.fail(ws, 'stale_round', '棋局已更新');
        this.broadcast();
        return;
      }
      if (message.type === 'newgame' || message.type === 'reset_score') {
        if (message.type === 'reset_score') this.room.scores = { black: 0, white: 0 };
        resetBoard(this.room);
        await this.save();
        this.broadcast();
        return;
      }
      if (message.type !== 'move') return this.fail(ws, 'invalid_message', '不支持的操作');

      const { r, c } = message;
      if (this.room.winner || this.room.draw || this.room.turn !== info.color ||
          message.move !== this.room.moves || !Number.isInteger(r) || !Number.isInteger(c) ||
          r < 0 || r >= 15 || c < 0 || c >= 15 || this.room.board[r][c] !== 0) {
        this.fail(ws, 'invalid_move', '请等待轮到你后，在空位落子');
        this.broadcast();
        return;
      }
      this.room.board[r][c] = info.color;
      this.room.lastMove = [r, c];
      this.room.moves++;
      this.room.winLine = winningLine(this.room.board, r, c, info.color);
      if (this.room.winLine) {
        this.room.winner = info.color;
        this.room.scores[info.color === BLACK ? 'black' : 'white']++;
      } else if (this.room.moves === 225) this.room.draw = true;
      else this.room.turn = info.color === BLACK ? WHITE : BLACK;
      await this.save();
      this.broadcast();
    });
  }

  async webSocketClose(ws) {
    return this.run(() => this.broadcast(ws));
  }

  async webSocketError(ws) {
    ws.close(1011, 'Connection error');
    return this.run(() => this.broadcast(ws));
  }

  async alarm() {
    return this.run(async () => {
      for (const ws of this.ctx.getWebSockets()) this.fail(ws, 'room_expired', '房间已过期，请重新创建', true);
      this.room = null;
      await this.ctx.storage.deleteAll();
    });
  }
}
