const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const X = require('../xiangqi-engine.js');

function element() {
    const listeners = new Map(), attributes = new Map(), classes = new Set();
    return {
        children: [], dataset: {}, style: {}, value: '', textContent: '', disabled: false,
        previousElementSibling: {}, scrollHeight: 0,
        classList: {toggle(name, yes) { yes ? classes.add(name) : classes.delete(name); },
            add(name) { classes.add(name); }, remove(name) { classes.delete(name); }},
        append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; },
        setAttribute(name, value) { attributes.set(name, value); }, getAttribute(name) { return attributes.get(name); },
        addEventListener(name, fn) { listeners.set(name, fn); },
        click() { if (!this.disabled) listeners.get('click')?.({}); },
        getContext() { return new Proxy({}, {get: (_, key) => key === 'createRadialGradient' || key === 'createLinearGradient' ? () => ({addColorStop() {}}) : () => {}}); },
        getBoundingClientRect() { return {left: 0, top: 0, width: 552, height: 552}; }
    };
}
function surface() {
    const elements = new Map(), audio = [];
    const document = {getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
        createElement: element, createElementNS: element, querySelectorAll: () => [], addEventListener() {}};
    const window = {addEventListener() {}, devicePixelRatio: 1};
    const context = vm.createContext({document, window, GameAudio: {play: name => audio.push(name), stop() {}},
        setTimeout() {}, clearTimeout() {}, console});
    return {document, window, context, audio};
}
function xiangqi(start = X.initialBoard()) {
    const s = surface(); s.window.Xiangqi = {...X, initialBoard: () => start.slice()};
    s.document.getElementById('game-mode').value = 'pvp'; s.document.getElementById('human-side').value = 'r';
    vm.runInContext(fs.readFileSync(require.resolve('../xiangqi.js'), 'utf8'), s.context);
    s.move = (from, to) => { const squares = s.document.getElementById('board-grid').children; squares[from].click(); squares[to].click(); };
    return s;
}
test('real board interactions warn on second repetition, draw on third, and undo restores adjudication', () => {
    const s = xiangqi(), cycle = [[82, 65], [1, 20], [65, 82], [20, 1]], get = s.document.getElementById;
    for (const move of cycle) s.move(...move);
    assert.match(get('game-hint').textContent, /重复两次/);
    assert.equal(get('game-status').textContent, '红方走棋');
    for (const move of cycle) s.move(...move);
    assert.equal(get('game-status').textContent, '本局和棋'); assert.ok(s.audio.includes('draw'));
    get('undo').click(); assert.equal(get('game-status').textContent, '黑方走棋');
    assert.equal(get('move-count').textContent, '7 步');
    s.move(20, 1); assert.equal(get('game-status').textContent, '本局和棋');
});
test('actual move handlers declare perpetual check a loss, including after undo and replay', () => {
    const b = Array(90).fill(null); for (const [i, p] of [[4, 'bK'], [85, 'rK'], [49, 'rP'], [23, 'rR']]) b[i] = p;
    const s = xiangqi(b), cycle = [[23, 22], [4, 5], [22, 23], [5, 4]], get = s.document.getElementById;
    for (const move of [...cycle, ...cycle]) s.move(...move);
    assert.equal(get('game-status').textContent, '黑方获胜'); assert.match(get('game-hint').textContent, /红方.*长将判负/);
    assert.ok(s.audio.includes('check')); assert.ok(s.audio.includes('win')); assert.ok(!s.audio.includes('draw'));
    get('undo').click(); s.move(5, 4); assert.equal(get('game-status').textContent, '黑方获胜');
});
function gomoku() {
    const s = surface(); s.context.GomokuAI = require('../gomoku-engine.js');
    const html = fs.readFileSync(require.resolve('../gomoku.html'), 'utf8');
    vm.runInContext(html.match(/<script>\s*\/\/ ========== Game Constants ==========([\s\S]*?)<\/script>/)[1], s.context);
    s.run = code => vm.runInContext(code, s.context);
    return s;
}
test('gomoku handlers emit distinct stones and threat sounds, preserve wins, and undo scores', () => {
    const s = gomoku();
    s.run('placeStone(7, 4); placeStone(1, 1); placeStone(7, 5); placeStone(1, 2); placeStone(7, 6)');
    assert.ok(s.audio.includes('stone-black')); assert.ok(s.audio.includes('stone-white')); assert.ok(s.audio.includes('threat-three'));
    s.run('placeStone(1, 3); placeStone(7, 7)'); assert.ok(s.audio.includes('threat-four'));
    s.run('placeStone(1, 4); placeStone(7, 8)'); assert.ok(s.audio.includes('win')); assert.ok(!s.audio.includes('draw'));
    assert.equal(s.run('scoreBlack'), 1); assert.equal(s.run('gameOver'), true);
    s.run('undo()'); assert.equal(s.run('scoreBlack'), 0); assert.equal(s.run('gameOver'), false);
    s.run('placeStone(7, 8)'); assert.equal(s.run('scoreBlack'), 1);
});
test('occupied points never emit a successful move sound and bounds cannot corrupt the board', () => {
    const s = gomoku(); s.run('placeStone(7, 7)'); const count = s.audio.length;
    s.run('placeStone(7, 7); placeStone(-1, 2)');
    assert.deepEqual(s.audio.slice(count), ['invalid']); assert.equal(s.run('history.length'), 1);
});
test('online snapshots announce a new stone once, without replaying sound on reconnect', () => {
    const s = gomoku();
    vm.runInContext(fs.readFileSync(require.resolve('../gomoku-online.js'), 'utf8'), s.context);
    s.run(`mode = 'online'; roomCode = 'ABCDEF'; onlineRound = 1; onlineMoveNumber = 0;
        var snapshot = {color: 1, code: 'ABCDEF', round: 1, moves: 1,
            connected: {black: true, white: true}, board: board.map(row => [...row]),
            turn: 2, winner: null, draw: false, lastMove: [7,7], winLine: null,
            scores: {black: 0, white: 0}, hasGuest: true};
        snapshot.board[7][7] = 1; applyOnlineState(snapshot);`);
    assert.deepEqual(s.audio, ['stone-black']);
    s.run('applyOnlineState(snapshot)'); assert.deepEqual(s.audio, ['stone-black']);
});
test('full-board draws remain draws on rerender, while a final winning stone still wins', () => {
    const s = gomoku();
    // Each color's horizontal, vertical and diagonal runs are at most four.
    s.run('board = Array.from({length: 15}, (_, r) => Array.from({length: 15}, (_, c) => (r + 2*c) % 4 < 2 ? BLACK : WHITE)); board[14][14] = EMPTY; currentPlayer = BLACK; placeStone(14, 14)');
    assert.equal(s.run('gameOver'), true); assert.ok(s.audio.includes('draw')); assert.ok(!s.audio.includes('win'));
    s.run('updateStatus()'); assert.equal(s.document.getElementById('status-text').textContent, '平局！');
    const winner = gomoku();
    winner.run('board = Array.from({length: 15}, () => Array(15).fill(WHITE)); board[7].fill(BLACK); board[7][7] = EMPTY; placeStone(7, 7)');
    assert.ok(winner.audio.includes('win')); assert.ok(!winner.audio.includes('draw'));
});
test('audio synthesis schedules different stone pitches and respects mute and hidden pages', () => {
    const events = [], handlers = new Map(); let created = 0;
    const param = () => ({value: 0, setValueAtTime(v) { events.push(v); }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}});
    const node = () => ({gain: param(), frequency: param(), connect() {}, disconnect() {}, start() {}, stop() {}});
    class AudioContext {
        constructor() { created++; this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; }
        createGain() { return node(); } createOscillator() { return node(); }
        createBuffer(_, length) { return {getChannelData: () => new Float32Array(length)}; }
        createBufferSource() { return node(); } createBiquadFilter() { return node(); }
    }
    const document = {hidden: false, readyState: 'complete', querySelectorAll: () => [], addEventListener: (name, fn) => handlers.set(name, fn)};
    const context = {document, window: {AudioContext, addEventListener() {}}, localStorage: {getItem() { return null; }, setItem() {}}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../game-audio.js'), 'utf8'), context);
    const audio = context.window.GameAudio; assert.equal(created, 0); handlers.get('pointerdown')();
    audio.play('stone-black'); assert.ok(events.includes(1420));
    audio.play('stone-white'); assert.ok(events.includes(1760));
    for (const name of ['move', 'capture', 'check', 'threat-three', 'threat-four', 'invalid', 'win', 'lose', 'draw', 'undo']) {
        const before = events.length; audio.play(name); assert.ok(events.length > before, name + ' schedules audio');
    }
    audio.setMuted(true); const count = events.length; audio.play('win'); assert.equal(events.length, count);
    audio.setMuted(false); document.hidden = true; audio.play('stone-black'); assert.equal(events.length, count);
});
