(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.GomokuAI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const SIZE = 15, MATE = 10000000;
    const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
    const LEVELS = {
        easy: {depth: 2, timeMs: 220, width: 8, maxNodes: 5000},
        normal: {depth: 4, timeMs: 850, width: 12, maxNodes: 30000},
        hard: {depth: 6, timeMs: 1800, width: 16, maxNodes: 80000}
    };
    const THREE = ['001110', '011100', '010110', '011010'];
    const TWO = ['001100', '0010100', '001010', '010100'];
    function includesCenter(line, patterns) {
        return patterns.some(pattern => {
            let offset = line.indexOf(pattern);
            while (offset >= 0) {
                if (offset <= 5 && offset + pattern.length > 5) return true;
                offset = line.indexOf(pattern, offset + 1);
            }
            return false;
        });
    }
    // Evaluate all four lines through a hypothetical stone, including split threats.
    function profile(board, index, side) {
        const r = Math.floor(index / SIZE), c = index % SIZE;
        let fours = 0, threes = 0, twos = 0, minor = 0;
        const wins = new Set();
        for (const [dr, dc] of DIRS) {
            let line = '';
            for (let n = -5; n <= 5; n++) {
                const y = r + dr * n, x = c + dc * n;
                line += n === 0 ? '1' : !inside(y, x) ? '#' : board[y * SIZE + x] === side ? '1' : board[y * SIZE + x] ? '#' : '0';
            }
            let run = 1;
            for (let n = 4; n >= 0 && line[n] === '1'; n--) run++;
            for (let n = 6; n < 11 && line[n] === '1'; n++) run++;
            if (run >= 5) return {score: MATE, win: true, wins: 0};
            let directionFour = false;
            for (let start = 1; start <= 5; start++) {
                const window = line.slice(start, start + 5);
                if (window.includes('#') || window.split('1').length !== 5) continue;
                const offset = start + window.indexOf('0') - 5;
                wins.add((r + dr * offset) * SIZE + c + dc * offset);
                directionFour = true;
            }
            if (directionFour) fours++;
            else if (includesCenter(line, THREE)) threes++;
            else if (includesCenter(line, TWO)) twos++;
            // Favor connected stones even before a forcing threat has developed.
            minor += run * run * 6;
        }
        let score;
        if (wins.size >= 2) score = 1000000;
        else if (fours && threes) score = 800000;
        else if (threes >= 2) score = 160000;
        else score = fours * 70000 + threes * 10000 + twos * 600 + minor;
        return {score, win: false, wins: wins.size};
    }
    function candidates(board) {
        const empty = new Set();
        for (let i = 0; i < board.length; i++) {
            if (!board[i]) continue;
            const r = Math.floor(i / SIZE), c = i % SIZE;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                const y = r + dy, x = c + dx, target = y * SIZE + x;
                if (inside(y, x) && !board[target]) empty.add(target);
            }
        }
        return empty.size ? [...empty] : board.some(Boolean) ? [] : [112];
    }
    function findBestMove(input, side, options) {
        const settings = Object.assign({}, LEVELS.normal, options);
        const board = input.flat().slice(), enemy = 3 - side, start = Date.now(), stop = {}, table = new Map();
        let nodes = 0, completedDepth = 0;
        function visit() {
            nodes++;
            if (nodes > settings.maxNodes || Date.now() - start >= settings.timeMs) throw stop;
        }
        function rank(turn) {
            return candidates(board).map(index => {
                const attack = profile(board, index, turn), defense = profile(board, index, 3 - turn);
                const center = 14 - Math.abs(Math.floor(index / SIZE) - 7) - Math.abs(index % SIZE - 7);
                return {index, attack, defense, score: attack.score + defense.score * 1.08 + center};
            }).sort((a, b) => b.score - a.score || a.index - b.index);
        }
        function choices(ranked, width, preferred) {
            const wins = ranked.filter(m => m.attack.win);
            if (wins.length) return wins;
            const blocks = ranked.filter(m => m.defense.win);
            if (blocks.length) return blocks;
            const ordered = ranked.slice();
            const found = ordered.findIndex(m => m.index === preferred);
            if (found > 0) ordered.unshift(...ordered.splice(found, 1));
            return ordered.slice(0, width);
        }
        function evaluate(ranked) {
            const own = ranked.map(m => m.attack.score).sort((a, b) => b - a);
            const opp = ranked.map(m => m.defense.score).sort((a, b) => b - a);
            return Math.round((own[0] || 0) + (own[1] || 0) * 0.12 - (opp[0] || 0) * 1.04 - (opp[1] || 0) * 0.12);
        }
        function search(turn, depth, alpha, beta, ply, extension) {
            visit();
            const key = board.join('') + turn, cached = table.get(key), originalAlpha = alpha;
            if (depth > 0 && cached && cached.depth >= depth) {
                if (cached.flag === 'exact') return cached.score;
                if (cached.flag === 'lower' && cached.score >= beta || cached.flag === 'upper' && cached.score <= alpha) return cached.score;
            }
            const ranked = rank(turn);
            if (!ranked.length) return 0;
            if (ranked.some(m => m.attack.win)) return MATE - ply;
            const threats = ranked.filter(m => m.defense.win);
            if (threats.length > 1) return -MATE + ply + 1;
            let moves;
            if (depth <= 0) {
                if (extension >= 4) return evaluate(ranked);
                if (threats.length) moves = threats;
                else {
                    moves = ranked.filter(m => m.attack.wins >= 2 || m.attack.score >= 800000);
                    if (!moves.length) return evaluate(ranked);
                }
            } else moves = choices(ranked, Math.max(6, settings.width - ply * 2), cached && cached.index);
            let best = -Infinity, chosen = moves[0].index;
            for (const m of moves) {
                board[m.index] = turn;
                let value;
                try { value = -search(3 - turn, depth - 1, -beta, -alpha, ply + 1, extension + Number(depth <= 0)); }
                finally { board[m.index] = 0; }
                if (value > best) { best = value; chosen = m.index; }
                alpha = Math.max(alpha, value);
                if (alpha >= beta) break;
            }
            if (depth > 0 && table.size < 30000) table.set(key, {depth, score: best, index: chosen,
                flag: best <= originalAlpha ? 'upper' : best >= beta ? 'lower' : 'exact'});
            return best;
        }
        const ranked = rank(side);
        if (!ranked.length) return null;
        const finish = (index, score = 0) => ({r: Math.floor(index / SIZE), c: index % SIZE, depth: completedDepth, nodes, score});
        // Mandatory wins and defenses never depend on random selection or a search timeout.
        const win = ranked.find(m => m.attack.win);
        if (win) return finish(win.index, MATE);
        const blocks = ranked.filter(m => m.defense.win);
        if (blocks.length) return finish(blocks[0].index);
        const fork = ranked.find(m => m.attack.wins >= 2);
        if (fork) return finish(fork.index, MATE - 2);
        let best = ranked[0].index, bestScore = 0;
        const rootMoves = choices(ranked, settings.width);
        for (let depth = 1; depth <= settings.depth; depth++) {
            let iterationBest = best, alpha = -Infinity;
            const ordered = [rootMoves.find(m => m.index === best), ...rootMoves.filter(m => m.index !== best)].filter(Boolean);
            try {
                for (const m of ordered) {
                    board[m.index] = side;
                    let value;
                    try { value = -search(enemy, depth - 1, -Infinity, -alpha, 1, 0); }
                    finally { board[m.index] = 0; }
                    if (value > alpha) { alpha = value; iterationBest = m.index; }
                }
                best = iterationBest; bestScore = alpha; completedDepth = depth;
                if (alpha >= MATE - 100) break;
            } catch (error) { if (error !== stop) throw error; break; }
        }
        return finish(best, bestScore);
    }
    return {findBestMove, LEVELS};
});
