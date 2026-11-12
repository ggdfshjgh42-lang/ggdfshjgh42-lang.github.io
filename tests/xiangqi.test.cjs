const {test} = require('node:test');
const assert = require('node:assert/strict');
const X = require('../xiangqi-engine.js');
const at = (r, c) => r * 9 + c;
function fixture(entries) {
    const b = Array(90).fill(null);
    for (const [r, c, p] of entries) b[at(r, c)] = p;
    return b;
}
const kings = [[0, 4, 'bK'], [9, 4, 'rK'], [5, 4, 'rP']];
const has = (moves, r, c) => moves.some(m => m.to === at(r, c));
test('initial setup has 32 pieces, 44 legal red moves, and 1920 two-ply positions', () => {
    const b = X.initialBoard(), original = b.slice();
    assert.equal(b.filter(Boolean).length, 32);
    assert.equal(X.inCheck(b, 'r'), false); assert.equal(X.inCheck(b, 'b'), false);
    const moves = X.legalMoves(b, 'r'); assert.equal(moves.length, 44);
    assert.equal(moves.reduce((n, m) => n + X.legalMoves(X.applyMove(b, m), 'b').length, 0), 1920);
    assert.deepEqual(b, original, 'move generation must not mutate the caller board');
});
test('horse legs block exactly the corresponding two jumps', () => {
    const b = fixture([...kings, [6, 2, 'rN'], [5, 2, 'rP']]);
    const moves = X.pseudoMoves(b, at(6, 2));
    assert.equal(has(moves, 4, 1), false); assert.equal(has(moves, 4, 3), false);
    assert.equal(has(moves, 8, 1), true); assert.equal(has(moves, 5, 4), false); // allied blocker at destination
    assert.equal(has(moves, 7, 4), true);
});
test('elephant eyes and river restrictions', () => {
    const b = fixture([...kings, [5, 2, 'rB'], [6, 3, 'rP']]);
    const moves = X.pseudoMoves(b, at(5, 2));
    assert.equal(has(moves, 3, 0), false); assert.equal(has(moves, 3, 4), false);
    assert.equal(has(moves, 7, 4), false); assert.equal(has(moves, 7, 0), true);
    const black = fixture([...kings, [4, 2, 'bB']]);
    assert.equal(has(X.pseudoMoves(black, at(4, 2)), 6, 4), false);
});
test('advisors and generals remain in their palaces', () => {
    const b = fixture([...kings, [7, 3, 'rA']]);
    assert.deepEqual(X.pseudoMoves(b, at(7, 3)).map(m => m.to), [at(8, 4)]);
    const g = fixture([[7, 3, 'rK'], [0, 4, 'bK']]);
    const moves = X.pseudoMoves(g, at(7, 3));
    assert.equal(has(moves, 6, 3), false); assert.equal(has(moves, 7, 2), false);
    assert.equal(has(moves, 7, 4), true);
});
test('cannon needs exactly one screen for a capture and none to move', () => {
    const b = fixture([...kings, [7, 1, 'rC'], [5, 1, 'rP'], [2, 1, 'bN']]);
    const moves = X.pseudoMoves(b, at(7, 1));
    assert.equal(has(moves, 6, 1), true); assert.equal(has(moves, 4, 1), false);
    assert.equal(has(moves, 2, 1), true); assert.equal(has(moves, 5, 1), false);
    b[at(5, 1)] = null;
    assert.equal(has(X.pseudoMoves(b, at(7, 1)), 2, 1), false);
    b[at(5, 1)] = 'rP'; b[at(4, 1)] = 'bP';
    assert.equal(has(X.pseudoMoves(b, at(7, 1)), 2, 1), false);
});
test('rook cannot pass an occupied intersection or take a friendly piece', () => {
    const b = fixture([...kings, [7, 0, 'rR'], [5, 0, 'rP'], [7, 3, 'bP']]);
    const moves = X.pseudoMoves(b, at(7, 0));
    assert.equal(has(moves, 5, 0), false); assert.equal(has(moves, 4, 0), false);
    assert.equal(has(moves, 7, 3), true); assert.equal(has(moves, 7, 4), false);
});
test('soldiers gain lateral moves after crossing and can never retreat', () => {
    for (const [side, row, forward, crossed] of [['r', 6, 5, false], ['r', 4, 3, true], ['b', 3, 4, false], ['b', 5, 6, true]]) {
        const b = fixture([[row, 2, side + 'P']]), moves = X.pseudoMoves(b, at(row, 2));
        assert.equal(has(moves, forward, 2), true); assert.equal(has(moves, row, 1), crossed);
        assert.equal(has(moves, row - (forward - row), 2), false);
    }
    assert.equal(X.pseudoMoves(fixture([[0, 2, 'rP']]), at(0, 2)).length, 2);
});
test('generals facing each other is check; cannot expose the file between them', () => {
    const b = fixture([[0, 4, 'bK'], [9, 4, 'rK'], [5, 4, 'rR']]);
    assert.equal(X.inCheck(b, 'r'), false);
    assert.equal(has(X.legalMoves(b, 'r', at(5, 4)), 5, 3), false);
    b[at(5, 4)] = null;
    assert.equal(X.inCheck(b, 'r'), true); assert.equal(X.inCheck(b, 'b'), true);
});
test('pinned pieces cannot expose their general, and check must be answered', () => {
    const b = fixture([[0, 3, 'bK'], [9, 4, 'rK'], [0, 4, 'bR'], [8, 4, 'rR'], [6, 0, 'rP']]);
    assert.equal(has(X.legalMoves(b, 'r', at(8, 4)), 8, 5), false);
    b[at(8, 4)] = null;
    assert.equal(X.inCheck(b, 'r'), true);
    assert.equal(X.legalMoves(b, 'r', at(6, 0)).length, 0);
    assert.ok(X.legalMoves(b, 'r').every(m => !X.inCheck(X.applyMove(b, m), 'r')));
});
test('checkmate and stalemate both lose, with separate reasons', () => {
    const base = [[0, 4, 'bK'], [9, 4, 'rK'], [5, 4, 'rP'], [2, 3, 'rR'], [2, 5, 'rR']];
    const stalemate = fixture([...base, [1, 0, 'rR']]);
    assert.equal(X.inCheck(stalemate, 'b'), false);
    assert.deepEqual(X.outcome(stalemate, 'b'), {winner: 'r', reason: 'stalemate'});
    const mate = fixture([...base, [1, 4, 'rR'], [1, 0, 'rR']]);
    assert.equal(X.inCheck(mate, 'b'), true);
    assert.deepEqual(X.outcome(mate, 'b'), {winner: 'r', reason: 'checkmate'});
});
test('applyMove copies input and captures only the destination', () => {
    const b = fixture([...kings, [7, 0, 'rR'], [6, 0, 'bN']]), original = b.slice();
    const next = X.applyMove(b, {from: at(7, 0), to: at(6, 0)});
    assert.deepEqual(b, original); assert.equal(next[at(7, 0)], null); assert.equal(next[at(6, 0)], 'rR');
    assert.notEqual(X.positionKey(b, 'r'), X.positionKey(b, 'b'));
});
test('AI returns a legal move without mutating input, including timed-out searches', () => {
    const b = X.initialBoard(), original = b.slice();
    for (const options of [{depth: 2, timeMs: 1500}, {depth: 5, timeMs: 1, maxNodes: 1}]) {
        const m = X.findBestMove(b, 'b', options);
        assert.ok(X.legalMoves(b, 'b').some(p => p.from === m.from && p.to === m.to));
        assert.deepEqual(b, original);
    }
});
test('AI finds mate in one and handles terminal positions', () => {
    const b = fixture([[0, 4, 'bK'], [9, 4, 'rK'], [5, 4, 'rP'], [2, 3, 'rR'], [2, 5, 'rR'], [1, 0, 'rR']]);
    const m = X.findBestMove(b, 'r', {depth: 2, timeMs: 2000});
    assert.equal(X.outcome(X.applyMove(b, m), 'b').winner, 'r');
    assert.equal(X.findBestMove(b, 'b'), null);
});
test('deterministic playouts preserve piece counts, both generals, and legality', () => {
    let b = X.initialBoard(), turn = 'r', seed = 43;
    for (let ply = 0; ply < 120; ply++) {
        const moves = X.legalMoves(b, turn); if (!moves.length) break;
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const m = moves[seed % moves.length], count = b.filter(Boolean).length, capture = !!b[m.to];
        b = X.applyMove(b, m);
        assert.equal(X.inCheck(b, turn), false); assert.equal(b.filter(Boolean).length, count - Number(capture));
        assert.ok(b.includes('rK') && b.includes('bK'));
        turn = X.other(turn);
    }
});
test('direct check detection agrees with geometric attacks over randomized legal games', () => {
    let seed = 101;
    for (let game = 0; game < 8; game++) {
        let b = X.initialBoard(), turn = 'r';
        for (let ply = 0; ply < 100; ply++) {
            for (const side of ['r', 'b']) {
                const king = b.indexOf(side + 'K');
                const attacked = king < 0 || b.some((p, i) => p && p[0] !== side && X.pseudoMoves(b, i).some(m => m.to === king));
                assert.equal(X.inCheck(b, side), attacked, `${game}:${ply}:${side}`);
            }
            const moves = X.legalMoves(b, turn); if (!moves.length) break;
            seed = (seed * 1664525 + 1013904223) >>> 0;
            b = X.applyMove(b, moves[seed % moves.length]); turn = X.other(turn);
        }
    }
});
test('capture continuation sees a poisoned pawn beyond a one-ply horizon', () => {
    const b = fixture([[0, 3, 'bK'], [9, 4, 'rK'], [7, 0, 'rR'], [4, 0, 'bP'], [4, 2, 'bR']]), original = b.slice();
    const m = X.findBestMove(b, 'r', {depth: 1, timeMs: 2000});
    assert.notDeepEqual([m.from, m.to], [at(7, 0), at(4, 0)], 'a pawn is not worth losing a rook on the next capture');
    assert.deepEqual(b, original);
});
test('search respects supplied repetition history and does not mutate it', () => {
    const b = X.initialBoard();
    const history = [X.positionKey(b, 'r')];
    for (const m of X.legalMoves(b, 'r')) {
        const key = X.positionKey(X.applyMove(b, m), 'b'); history.push(key, key);
    }
    const original = history.slice(), m = X.findBestMove(b, 'r', {depth: 2, timeMs: 1000, history});
    assert.equal(m.score, 0); assert.equal(m.depth, 2); assert.deepEqual(history, original);
});
