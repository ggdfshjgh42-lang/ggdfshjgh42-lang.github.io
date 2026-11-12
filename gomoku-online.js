// The board is authoritative on the room service; this file manages transport and UI.
const ROOM_SESSION_KEY = 'gomoku-room-session-v1';
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
let onlineSocket = null;
let onlineSession = null;
let onlineConnectTimer = null;
let onlineRetryTimer = null;
let onlineHeartbeat = null;
let onlineMoveTimer = null;
let onlineRequest = null;
let onlineEpoch = 0;
let onlineRetries = 0;
let onlineLastSeen = 0;
let onlineAuthenticated = false;
let onlineRound = 0;
let onlineMoveNumber = 0;
let onlinePendingMove = false;
let onlineAnnouncedWin = '';

function serviceUrl() {
    if (!window.GOMOKU_SERVICE_URL) throw new Error('联机服务尚未启用，请稍后再试');
    const url = new URL(window.GOMOKU_SERVICE_URL);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
        url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new Error('联机服务地址配置有误，请联系网站维护者');
    }
    return url.origin;
}

function saveRoomSession() {
    try {
        if (onlineSession) sessionStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(onlineSession));
        else sessionStorage.removeItem(ROOM_SESSION_KEY);
    } catch { /* Playing remains possible if browser storage is unavailable. */ }
}

function updateConnStatus(status, text) {
    document.getElementById('conn-dot').className = 'conn-dot ' + status;
    document.getElementById('conn-text').textContent = text;
}

function updateOnlineControls(busy = false) {
    document.getElementById('create-room-button').disabled = busy || Boolean(onlineSession);
    document.getElementById('join-room-button').disabled = busy || Boolean(onlineSession);
    document.getElementById('room-input').disabled = busy || Boolean(onlineSession);
    document.getElementById('undo-button').disabled = mode === 'online';
    document.getElementById('new-game-button').disabled = mode === 'online' && !onlineConnected;
    document.getElementById('reset-score-button').disabled = mode === 'online' && !onlineConnected;
}

function resetOnlineUI() {
    document.getElementById('create-view').style.display = 'block';
    document.getElementById('room-view').style.display = 'none';
    document.getElementById('join-view').style.display = 'block';
    document.getElementById('online-game-view').style.display = 'none';
    document.getElementById('reconnect-button').hidden = true;
    document.getElementById('room-input').value = '';
    document.getElementById('copy-hint').style.display = 'none';
    updateConnStatus('', '请创建或加入房间');
    updateOnlineControls();
}

function stopOnlineTransport() {
    clearTimeout(onlineConnectTimer);
    clearTimeout(onlineRetryTimer);
    clearTimeout(onlineMoveTimer);
    clearInterval(onlineHeartbeat);
    onlineConnectTimer = onlineRetryTimer = onlineMoveTimer = onlineHeartbeat = null;
    onlineRequest?.abort();
    onlineRequest = null;
    if (onlineSocket) {
        onlineSocket.onclose = null;
        onlineSocket.onerror = null;
        onlineSocket.onmessage = null;
        onlineSocket.onopen = null;
        onlineSocket.close();
        onlineSocket = null;
    }
    onlineAuthenticated = false;
    onlineConnected = false;
    onlinePendingMove = false;
}

function clearRoomSession() {
    onlineEpoch++;
    stopOnlineTransport();
    onlineSession = null;
    roomCode = null;
    myColor = null;
    onlineRetries = 0;
    onlineAnnouncedWin = '';
    saveRoomSession();
}

function onlineFailure(message, terminal = false) {
    onlinePendingMove = false;
    clearTimeout(onlineMoveTimer);
    if (terminal) {
        clearRoomSession();
        resetOnlineUI();
        document.getElementById('winner-overlay').classList.remove('show');
    }
    updateConnStatus('red', message);
    updateOnlineControls();
    if (!onlineConnected) {
        document.getElementById('status-text').textContent = '在线对战';
        document.getElementById('turn-hint').textContent = message;
    }
}

function prepareOnlineMode() {
    resetOnlineUI();
    try {
        const saved = JSON.parse(sessionStorage.getItem(ROOM_SESSION_KEY) || 'null');
        if (saved && saved.service === serviceUrl() && ROOM_CODE_PATTERN.test(saved.code) &&
            typeof saved.token === 'string' && /^[a-f0-9-]{36}$/.test(saved.token)) {
            onlineSession = saved;
            roomCode = saved.code;
            connectRoomSocket();
        }
    } catch (error) {
        if (!window.GOMOKU_SERVICE_URL) onlineFailure(error.message);
    }
    updateOnlineControls();
}

async function createRoom() {
    if (onlineSession || onlineRequest) return;
    let base;
    try { base = serviceUrl(); } catch (error) { onlineFailure(error.message); return; }
    const epoch = ++onlineEpoch;
    const controller = new AbortController();
    onlineRequest = controller;
    updateOnlineControls(true);
    updateConnStatus('', '正在创建房间...');
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(base + '/rooms', { method: 'POST', signal: controller.signal });
        const data = await response.json();
        if (epoch !== onlineEpoch) return;
        if (!response.ok) throw new Error(data.error || '创建房间失败，请稍后重试');
        if (!ROOM_CODE_PATTERN.test(data.code) || typeof data.token !== 'string') throw new Error('房间服务返回异常，请稍后重试');
        onlineSession = { service: base, code: data.code, token: data.token, join: false };
        roomCode = data.code;
        saveRoomSession();
        connectRoomSocket();
    } catch (error) {
        if (epoch === onlineEpoch) onlineFailure(error.name === 'AbortError'
            ? '创建房间超时，请检查网络后重试' : error.message === 'Failed to fetch'
            ? '无法连接联机服务，请检查网络后重试' : error.message);
    } finally {
        clearTimeout(timeout);
        if (onlineRequest === controller) onlineRequest = null;
        updateOnlineControls();
    }
}

function joinRoom() {
    if (onlineSession || onlineRequest) return;
    const code = document.getElementById('room-input').value.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) {
        onlineFailure('请输入完整的 6 位房间码');
        return;
    }
    let base;
    try { base = serviceUrl(); } catch (error) { onlineFailure(error.message); return; }
    onlineSession = { service: base, code, token: crypto.randomUUID(), join: true };
    roomCode = code;
    onlineEpoch++;
    onlineRetries = 0;
    saveRoomSession();
    connectRoomSocket();
}

function retryRoomConnection() {
    if (!onlineSession) return;
    onlineRetries = 0;
    connectRoomSocket();
}

function scheduleRoomReconnect() {
    stopOnlineTransport();
    if (!onlineSession || mode !== 'online') return;
    updateOnlineControls();
    document.getElementById('reconnect-button').hidden = false;
    const message = onlineRetries >= 6 ? '连接已断开，请检查网络后点击重新连接'
        : `连接已断开，正在重连（${onlineRetries + 1}/6）...`;
    onlineFailure(message);
    if (onlineRetries >= 6) return;
    const delay = Math.min(1000 * 2 ** onlineRetries++, 10000);
    onlineRetryTimer = setTimeout(connectRoomSocket, delay);
}

function connectRoomSocket() {
    stopOnlineTransport();
    if (!onlineSession || mode !== 'online') return;
    const epoch = onlineEpoch;
    updateConnStatus('', '正在连接房间...');
    updateOnlineControls();
    const url = onlineSession.service.replace(/^http/, 'ws') + '/rooms/' + onlineSession.code;
    const socket = new WebSocket(url);
    onlineSocket = socket;
    onlineConnectTimer = setTimeout(() => {
        if (onlineSocket === socket) scheduleRoomReconnect();
    }, 12000);
    socket.onopen = () => {
        if (epoch !== onlineEpoch) return;
        socket.send(JSON.stringify({ type: 'hello', token: onlineSession.token, join: onlineSession.join }));
    };
    socket.onmessage = event => {
        if (epoch !== onlineEpoch || onlineSocket !== socket) return;
        onlineLastSeen = Date.now();
        if (event.data === 'pong') return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'welcome') {
            onlineSession.token = data.token;
            onlineSession.join = false;
            myColor = data.color;
            saveRoomSession();
        } else if (data.type === 'state') {
            clearTimeout(onlineConnectTimer);
            onlineAuthenticated = true;
            onlineRetries = 0;
            document.getElementById('reconnect-button').hidden = true;
            applyOnlineState(data);
            if (!onlineHeartbeat) {
                onlineHeartbeat = setInterval(() => {
                    if (Date.now() - onlineLastSeen > 45000) scheduleRoomReconnect();
                    else if (socket.readyState === WebSocket.OPEN) socket.send('ping');
                }, 20000);
            }
        } else if (data.type === 'error') {
            const terminal = ['room_not_found', 'room_closed', 'room_expired', 'room_full',
                'invalid_session', 'host_offline', 'rate_limited', 'unauthorized', 'invalid_message'].includes(data.code);
            onlineFailure(data.message || '连接失败，请重试', terminal);
        }
    };
    socket.onerror = () => { /* onclose or the connection deadline starts a bounded retry. */ };
    socket.onclose = event => {
        if (epoch !== onlineEpoch || onlineSocket !== socket) return;
        if (event.code === 4001) onlineFailure('此房间已在另一个页面打开', true);
        else scheduleRoomReconnect();
    };
}

function sendOnlineAction(type, extra = {}) {
    if (!onlineAuthenticated || !onlineConnected || onlineSocket?.readyState !== WebSocket.OPEN) return;
    if (type === 'move' && onlinePendingMove) return;
    onlineSocket.send(JSON.stringify({ type, round: onlineRound, move: onlineMoveNumber, ...extra }));
    if (type === 'move') {
        onlinePendingMove = true;
        onlineMoveTimer = setTimeout(scheduleRoomReconnect, 8000);
    }
}

function applyOnlineState(data) {
    const moved = roomCode === data.code && onlineRound === data.round && data.moves === onlineMoveNumber + 1;
    clearTimeout(onlineMoveTimer);
    onlinePendingMove = false;
    myColor = data.color;
    roomCode = data.code;
    onlineRound = data.round;
    onlineMoveNumber = data.moves;
    onlineConnected = data.connected.black && data.connected.white;
    board = data.board;
    currentPlayer = data.winner || data.turn;
    gameOver = Boolean(data.winner || data.draw);
    winLine = data.winLine;
    lastMove = data.lastMove;
    aiThinking = false;
    history = [];
    scoreBlack = data.scores.black;
    scoreWhite = data.scores.white;
    updateScores();
    document.getElementById('create-view').style.display = 'none';
    document.getElementById('join-view').style.display = 'none';
    document.getElementById('room-view').style.display = data.hasGuest ? 'none' : 'block';
    document.getElementById('online-game-view').style.display = data.hasGuest ? 'block' : 'none';
    document.getElementById('room-code-display').textContent = roomCode;
    document.getElementById('room-code-active').textContent = roomCode;
    document.getElementById('my-color-display').textContent = myColor === BLACK ? '⚫ 黑棋（先手）' : '⚪ 白棋（后手）';
    updateStatus(data.draw ? 'draw' : undefined);
    if (onlineConnected) updateConnStatus('green', '已连接');
    else {
        const text = data.hasGuest ? '对手暂时离线，等待重新连接...' : '等待对手加入...';
        updateConnStatus('', text);
        document.getElementById('turn-hint').textContent = text;
    }
    updateOnlineControls();
    draw();
    if (moved) {
        GameAudio.play('move');
        if (data.winner) GameAudio.play(data.winner === myColor ? 'win' : 'lose', 0.12);
        else if (data.draw) GameAudio.play('draw', 0.12);
    }
    const winKey = roomCode + ':' + data.round;
    if (data.winner && onlineAnnouncedWin !== winKey) {
        onlineAnnouncedWin = winKey;
        showWinner(data.winner);
    } else if (!gameOver) document.getElementById('winner-overlay').classList.remove('show');
}

async function copyRoomCode() {
    if (!roomCode) return;
    try {
        await navigator.clipboard.writeText(roomCode);
    } catch {
        const input = document.createElement('textarea');
        input.value = roomCode;
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) { updateConnStatus('', '请手动复制房间码：' + roomCode); return; }
    }
    document.getElementById('copy-hint').style.display = 'block';
    setTimeout(() => { document.getElementById('copy-hint').style.display = 'none'; }, 3000);
}

function leaveRoom() {
    if (onlineAuthenticated && onlineSocket?.readyState === WebSocket.OPEN) {
        onlineSocket.send(JSON.stringify({ type: 'leave' }));
    }
    clearRoomSession();
    resetOnlineUI();
    mode = 'pvp';
    document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.toggle('active', btn.textContent.includes('双人')));
    document.getElementById('room-panel').classList.remove('show');
    updateOnlineControls();
    newGame();
}

document.getElementById('room-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') joinRoom();
});
