const {test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../gomoku-engine.js');
function fixture(entries = []) {
    const board = Array.from({length: 15}, () => Array(15).fill(0));
    for (const [r, c, side] of entries) board[r][c] = side;
    return board;
}
const choose = (b, side = 2, options = {}) => G.findBestMove(b, side, {depth: 3, timeMs: 1500, width: 12, ...options});
test('opens at the center, returns null on a full board, and never modifies input', () => {
    const b = fixture(), original = structuredClone(b), m = choose(b, 1);
    assert.equal(m.r, 7); assert.equal(m.c, 7); assert.deepEqual(b, original);
    assert.equal(choose(Array.from({length: 15}, () => Array(15).fill(1))), null);
});
test('takes a winning move even when the opponent is also threatening five', () => {
    const b = fixture([[7, 3, 1], ...[4, 5, 6, 7].map(c => [7, c, 2]), [3, 3, 2], ...[4, 5, 6, 7].map(c => [3, c, 1])]);
    const m = choose(b, 2, {timeMs: 0, maxNodes: 1});
    assert.deepEqual([m.r, m.c], [7, 8]);
});
test('blocks the only winning point, including with an exhausted search budget', () => {
    const b = fixture([[7, 3, 2], ...[4, 5, 6, 7].map(c => [7, c, 1])]);
    const m = choose(b, 2, {timeMs: 0}); assert.deepEqual([m.r, m.c], [7, 8]);
});
test('finds split-four wins and defenses in all four orientations', () => {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) for (const threat of [1, 2]) {
        const b = fixture([0, 1, 3, 4].map(n => [4 + dr * n, 7 + dc * n, threat]));
        const m = choose(b);
        assert.deepEqual([m.r, m.c], [4 + dr * 2, 7 + dc * 2]);
    }
});
test('recognizes a winning point at the boundary and treats the edge as closed', () => {
    const b = fixture([0, 1, 2, 3].map(c => [0, c, 1]));
    assert.deepEqual([choose(b).r, choose(b).c], [0, 4]);
});
test('creates an open four with two independent winning points', () => {
    const b = fixture([[7, 5, 2], [7, 6, 2], [7, 7, 2], [3, 3, 1]]), m = choose(b);
    assert.equal(m.r, 7); assert.ok([4, 8].includes(m.c));
});
test('builds a double-three fork rather than extending only one line', () => {
    const b = fixture([[7, 5, 2], [7, 6, 2], [5, 7, 2], [6, 7, 2], [3, 3, 1]]);
    const m = choose(b, 2, {depth: 4}); assert.deepEqual([m.r, m.c], [7, 7]);
});
test('defends an open three before developing a low-threat pair', () => {
    const b = fixture([[7, 4, 1], [7, 5, 1], [7, 6, 1], [3, 3, 2], [3, 4, 2]]);
    const m = choose(b); assert.equal(m.r, 7); assert.ok([3, 7].includes(m.c));
});
test('timed-out analysis always returns a legal point and preserves the caller board', () => {
    const b = fixture([[7, 7, 1], [7, 8, 2], [6, 7, 1]]), original = structuredClone(b);
    const m = choose(b, 2, {depth: 8, maxNodes: 1});
    assert.ok(m.r >= 0 && m.r < 15 && m.c >= 0 && m.c < 15); assert.equal(b[m.r][m.c], 0);
    assert.deepEqual(b, original);
});
