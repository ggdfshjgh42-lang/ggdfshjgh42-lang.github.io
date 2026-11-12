(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Xiangqi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const ROWS = 10, COLS = 9, MATE = 100000;
    const VALUES = {K: 20000, R: 900, C: 450, N: 400, A: 200, B: 200, P: 100};
    const NAMES = {r: {K: '帅', R: '车', C: '炮', N: '马', A: '仕', B: '相', P: '兵'}, b: {K: '将', R: '车', C: '砲', N: '马', A: '士', B: '象', P: '卒'}};
    const other = side => side === 'r' ? 'b' : 'r';
    const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
    const palace = (r, c, side) => c >= 3 && c <= 5 && (side === 'r' ? r >= 7 && r <= 9 : r >= 0 && r <= 2);
    function initialBoard() {
        const b = Array(90).fill(null);
        const back = ['R', 'N', 'B', 'A', 'K', 'A', 'B', 'N', 'R'];
        back.forEach((p, c) => { b[c] = 'b' + p; b[81 + c] = 'r' + p; });
        [1, 7].forEach(c => { b[18 + c] = 'bC'; b[63 + c] = 'rC'; });
        [0, 2, 4, 6, 8].forEach(c => { b[27 + c] = 'bP'; b[54 + c] = 'rP'; });
        return b;
    }
    // Geometric moves, before filtering moves that expose one's own general.
    function pseudoMoves(board, from) {
        const p = board[from];
        if (!p) return [];
        const side = p[0], kind = p[1], r = Math.floor(from / 9), c = from % 9, out = [];
        function add(y, x) {
            if (!inside(y, x)) return;
            const to = y * 9 + x;
            if (!board[to] || board[to][0] !== side) out.push({from, to});
        }
        if (kind === 'R' || kind === 'C') {
            for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                let screen = false;
                for (let y = r + dy, x = c + dx; inside(y, x); y += dy, x += dx) {
                    const to = y * 9 + x, target = board[to];
                    if (kind === 'R') {
                        add(y, x);
                        if (target) break;
                    } else if (!screen) {
                        if (target) screen = true;
                        else add(y, x);
                    } else if (target) {
                        if (target[0] !== side) out.push({from, to});
                        break;
                    }
                }
            }
        } else if (kind === 'N') {
            for (const [dy, dx] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) {
                const legR = r + (Math.abs(dy) === 2 ? Math.sign(dy) : 0);
                const legC = c + (Math.abs(dx) === 2 ? Math.sign(dx) : 0);
                if (inside(legR, legC) && !board[legR * 9 + legC]) add(r + dy, c + dx);
            }
        } else if (kind === 'B') {
            for (const [dy, dx] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
                const y = r + dy, x = c + dx;
                if (inside(y, x) && (side === 'r' ? y >= 5 : y <= 4) && !board[(r + dy / 2) * 9 + c + dx / 2]) add(y, x);
            }
        } else if (kind === 'A' || kind === 'K') {
            const dirs = kind === 'A' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dy, dx] of dirs) if (palace(r + dy, c + dx, side)) add(r + dy, c + dx);
            if (kind === 'K') {
                for (const dy of [-1, 1]) {
                    for (let y = r + dy; inside(y, c); y += dy) {
                        const to = y * 9 + c;
                        if (!board[to]) continue;
                        if (board[to] === other(side) + 'K') out.push({from, to});
                        break;
                    }
                }
            }
        } else if (kind === 'P') {
            add(r + (side === 'r' ? -1 : 1), c);
            if (side === 'r' ? r <= 4 : r >= 5) { add(r, c - 1); add(r, c + 1); }
        }
        return out;
    }
    function inCheck(board, side) {
        const king = board.indexOf(side + 'K');
        if (king < 0) return true;
        const enemy = other(side), r = Math.floor(king / 9), c = king % 9;
        // Test attacks on the general directly, without generating every enemy move.
        for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            let screen = false;
            for (let y = r + dy, x = c + dx; inside(y, x); y += dy, x += dx) {
                const p = board[y * 9 + x];
                if (!p) continue;
                if (!screen) {
                    if (p === enemy + 'R' || p === enemy + 'K' && (dx === 0 || Math.abs(x - c) === 1 && palace(r, c, enemy))) return true;
                    screen = true;
                } else {
                    if (p === enemy + 'C') return true;
                    break;
                }
            }
        }
        for (const [dy, dx] of [[2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]]) {
            const y = r + dy, x = c + dx;
            if (!inside(y, x) || board[y * 9 + x] !== enemy + 'N') continue;
            const legR = y - (Math.abs(dy) === 2 ? Math.sign(dy) : 0);
            const legC = x - (Math.abs(dx) === 2 ? Math.sign(dx) : 0);
            if (!board[legR * 9 + legC]) return true;
        }
        const pawnR = r + (enemy === 'r' ? 1 : -1);
        if (inside(pawnR, c) && board[pawnR * 9 + c] === enemy + 'P') return true;
        if (enemy === 'r' ? r <= 4 : r >= 5) {
            for (const x of [c - 1, c + 1]) if (inside(r, x) && board[r * 9 + x] === enemy + 'P') return true;
        }
        for (const [dy, dx] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            if (inside(r + dy, c + dx) && palace(r, c, enemy) && board[(r + dy) * 9 + c + dx] === enemy + 'A') return true;
            const y = r + 2 * dy, x = c + 2 * dx;
            if (inside(y, x) && (enemy === 'r' ? r >= 5 : r <= 4) && board[y * 9 + x] === enemy + 'B' && !board[(r + dy) * 9 + c + dx]) return true;
        }
        return false;
    }
    function makeMove(board, move) {
        const captured = board[move.to];
        board[move.to] = board[move.from]; board[move.from] = null;
        return captured;
    }
    function unmakeMove(board, move, captured) {
        board[move.from] = board[move.to]; board[move.to] = captured;
    }
    function legalMoves(board, side, from) {
        const out = [];
        if (board.indexOf(side + 'K') < 0) return out;
        for (let i = 0; i < 90; i++) {
            if (from !== undefined && i !== from) continue;
            if (!board[i] || board[i][0] !== side) continue;
            for (const m of pseudoMoves(board, i)) {
                const captured = makeMove(board, m);
                const safe = !inCheck(board, side);
                unmakeMove(board, m, captured);
                if (safe) out.push(m);
            }
        }
        return out;
    }
    function applyMove(board, move) {
        const next = board.slice(); makeMove(next, move); return next;
    }
    function positionKey(board, turn) { return board.map(p => p || '--').join('') + turn; }
    function outcome(board, turn) {
        if (board.indexOf(turn + 'K') < 0) return {winner: other(turn), reason: 'capture'};
        if (!legalMoves(board, turn).length) return {winner: other(turn), reason: inCheck(board, turn) ? 'checkmate' : 'stalemate'};
        return null;
    }
    function evaluate(board, side) {
        let total = 0;
        const material = board.reduce((sum, p) => sum + (p && ['R', 'C', 'N'].includes(p[1]) ? VALUES[p[1]] : 0), 0);
        const endgame = 1 - Math.min(1, material / 5000);
        for (let i = 0; i < 90; i++) {
            const p = board[i]; if (!p) continue;
            const r = Math.floor(i / 9), c = i % 9, advance = p[0] === 'r' ? 9 - r : r;
            let value = VALUES[p[1]];
            const center = 4 - Math.abs(c - 4);
            if (p[1] === 'P') value += advance * 6 + (advance >= 5 ? 65 + center * 9 : center * 2) + endgame * 35;
            if (p[1] === 'N') value += center * 9 + Math.min(advance, 6) * 5 + endgame * 35;
            if (p[1] === 'C') value += center * 5 + Math.min(advance, 5) * 3 - endgame * 25;
            if (p[1] === 'R') value += Math.min(advance, 6) * 3;
            if (['R', 'C', 'N'].includes(p[1])) {
                const mobility = pseudoMoves(board, i);
                value += mobility.length * (p[1] === 'N' ? 5 : p[1] === 'R' ? 2 : 1);
                const enemyKing = board.indexOf(other(p[0]) + 'K');
                if (enemyKing >= 0) {
                    const kr = Math.floor(enemyKing / 9), kc = enemyKing % 9;
                    value += mobility.filter(m => Math.abs(Math.floor(m.to / 9) - kr) + Math.abs(m.to % 9 - kc) <= 2).length * 7;
                }
            }
            if (p[1] === 'K') value -= Math.abs(c - 4) * 12 + Math.min(advance, 2) * 8;
            total += p[0] === side ? value : -value;
        }
        return total;
    }
    function movePriority(board, m) {
        return (board[m.to] ? VALUES[board[m.to][1]] * 10 - VALUES[board[m.from][1]] : 0) + (4 - Math.abs(m.to % 9 - 4));
    }
    // Iterative deepening leaves a complete shallower result when the budget expires.
    function findBestMove(input, side, options) {
        const settings = Object.assign({depth: 4, timeMs: 1000, maxNodes: 180000}, options);
        const board = input.slice(), start = Date.now(), stop = {}, rootMoves = legalMoves(board, side);
        if (!rootMoves.length) return null;
        rootMoves.sort((a, b) => movePriority(board, b) - movePriority(board, a));
        const table = new Map(), killers = [], history = new Int32Array(90 * 90 * 2), repetitions = new Map();
        for (const key of settings.history || []) repetitions.set(key, (repetitions.get(key) || 0) + 1);
        if (!repetitions.has(positionKey(board, side))) repetitions.set(positionKey(board, side), 1);
        let best = rootMoves[0], bestScore = 0, completedDepth = 0, nodes = 0;
        const same = (a, b) => a && b && a.from === b.from && a.to === b.to;
        const historyIndex = (m, turn) => (turn === 'r' ? 0 : 8100) + m.from * 90 + m.to;
        function visit() {
            nodes++;
            if (nodes > settings.maxNodes || Date.now() - start >= settings.timeMs) throw stop;
        }
        function ordered(moves, turn, ply, preferred) {
            return moves.map(m => ({m, rank: same(m, preferred) ? 10000000 : board[m.to] ? 100000 + movePriority(board, m) :
                same(m, killers[ply]) ? 90000 : history[historyIndex(m, turn)] + movePriority(board, m)}))
                .sort((a, b) => b.rank - a.rank).map(item => item.m);
        }
        // Resolve captures and all check evasions before assessing a quiet position.
        function quiesce(turn, alpha, beta, ply, remaining) {
            visit();
            if (board.indexOf(turn + 'K') < 0) return -MATE + ply;
            const key = positionKey(board, turn), seen = repetitions.get(key) || 0;
            if (seen >= 2) return 0;
            const check = inCheck(board, turn), moves = legalMoves(board, turn);
            if (!moves.length) return -MATE + ply;
            const stand = evaluate(board, turn);
            if (ply >= 48 || remaining <= -4) return stand;
            if (!check) {
                if (stand >= beta) return stand;
                alpha = Math.max(alpha, stand);
                if (remaining <= 0) return alpha;
            }
            repetitions.set(key, seen + 1);
            try {
                for (const m of ordered(check ? moves : moves.filter(m => board[m.to]), turn, ply)) {
                    const captured = makeMove(board, m);
                    let score;
                    try { score = -quiesce(other(turn), -beta, -alpha, ply + 1, remaining - 1); }
                    finally { unmakeMove(board, m, captured); }
                    if (score >= beta) return score;
                    alpha = Math.max(alpha, score);
                }
                return alpha;
            } finally { if (seen) repetitions.set(key, seen); else repetitions.delete(key); }
        }
        // Mate values in the table are relative to the stored position, not root ply.
        const storeScore = (score, ply) => score > MATE - 100 ? score + ply : score < -MATE + 100 ? score - ply : score;
        const loadScore = (score, ply) => score > MATE - 100 ? score - ply : score < -MATE + 100 ? score + ply : score;
        function search(turn, depth, alpha, beta, ply) {
            if (depth <= 0) return quiesce(turn, alpha, beta, ply, 6);
            visit();
            if (board.indexOf(turn + 'K') < 0) return -MATE + ply;
            const key = positionKey(board, turn), seen = repetitions.get(key) || 0;
            if (seen >= 2) return 0;
            const originalAlpha = alpha, cached = table.get(key);
            if (!seen && cached && cached.depth >= depth) {
                const value = loadScore(cached.score, ply);
                if (cached.flag === 'exact') return value;
                if (cached.flag === 'lower' && value >= beta || cached.flag === 'upper' && value <= alpha) return value;
            }
            const moves = legalMoves(board, turn);
            if (!moves.length) return -MATE + ply;
            let value = -Infinity, chosen = null;
            repetitions.set(key, seen + 1);
            try {
                for (const m of ordered(moves, turn, ply, cached && cached.move)) {
                    const captured = makeMove(board, m);
                    let score;
                    try { score = -search(other(turn), depth - 1, -beta, -alpha, ply + 1); }
                    finally { unmakeMove(board, m, captured); }
                    if (score > value) { value = score; chosen = m; }
                    alpha = Math.max(alpha, score);
                    if (alpha >= beta) {
                        if (!captured) { killers[ply] = m; history[historyIndex(m, turn)] += depth * depth; }
                        break;
                    }
                }
            } finally { if (seen) repetitions.set(key, seen); else repetitions.delete(key); }
            if (!seen && table.size < 60000) table.set(key, {depth, score: storeScore(value, ply), move: chosen,
                flag: value <= originalAlpha ? 'upper' : value >= beta ? 'lower' : 'exact'});
            return value;
        }
        for (let depth = 1; depth <= settings.depth; depth++) {
            let iterationBest = best, alpha = -Infinity;
            try {
                const ordered = [best, ...rootMoves.filter(m => m.from !== best.from || m.to !== best.to)];
                for (const m of ordered) {
                    const captured = makeMove(board, m);
                    let score;
                    try { score = -search(other(side), depth - 1, -Infinity, -alpha, 1); }
                    finally { unmakeMove(board, m, captured); }
                    if (score > alpha) { alpha = score; iterationBest = m; }
                }
                best = iterationBest; bestScore = alpha; completedDepth = depth;
                if (alpha > MATE - 100) break;
            } catch (error) { if (error !== stop) throw error; break; }
        }
        return {from: best.from, to: best.to, depth: completedDepth, nodes, score: bestScore || 0};
    }
    const LEVELS = {
        easy: {depth: 2, timeMs: 280, maxNodes: 25000},
        normal: {depth: 4, timeMs: 1000, maxNodes: 180000},
        hard: {depth: 6, timeMs: 2200, maxNodes: 400000}
    };
    return {initialBoard, pseudoMoves, legalMoves, inCheck, applyMove, outcome, other, positionKey, findBestMove, NAMES, LEVELS};
});
