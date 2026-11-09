(function () {
    'use strict';
    const X = window.Xiangqi, $ = id => document.getElementById(id);
    const grid = $('board-grid'), cells = [], dialog = $('confirm-dialog');
    let board = X.initialBoard(), turn = 'r', selected = null, lastMove = null, history = [], result = null;
    let halfmove = 0, keys = [X.positionKey(board, turn)], mode = 'ai', human = 'r', flipped = false;
    let busy = false, worker = null, fallbackTimer = null, watchdog = null, job = 0, pendingAction = null;
    const sideName = side => side === 'r' ? '红方' : '黑方';
    const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    for (let i = 0; i < 90; i++) {
        const cell = document.createElement('button');
        cell.type = 'button'; cell.className = 'square'; cell.dataset.index = i; cell.tabIndex = i === 81 ? 0 : -1;
        cell.addEventListener('click', () => selectSquare(i));
        cell.addEventListener('focus', () => { for (const other of cells) other.tabIndex = other === cell ? 0 : -1; });
        cell.addEventListener('keydown', event => {
            if (event.key === 'Escape') { selected = null; render(); return; }
            const dirs = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]};
            if (!dirs[event.key]) return;
            event.preventDefault();
            const [dy, dx] = dirs[event.key], factor = flipped ? -1 : 1;
            const r = Math.floor(i / 9) + dy * factor, c = i % 9 + dx * factor;
            if (r >= 0 && r < 10 && c >= 0 && c < 9) cells[r * 9 + c].focus();
        });
        cells.push(cell); grid.append(cell);
    }
    // Corner registration marks beside the cannon and soldier starting points.
    const ns = 'http://www.w3.org/2000/svg';
    for (const [r, c] of [[2, 1], [2, 7], [7, 1], [7, 7], ...[0, 2, 4, 6, 8].flatMap(c => [[3, c], [6, c]])]) {
        const x = 30 + c * 60, y = 30 + r * 60, path = document.createElementNS(ns, 'path');
        let d = '';
        for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
            if (c === 0 && dx < 0 || c === 8 && dx > 0) continue;
            d += `M${x + dx * 12} ${y + dy * 5}H${x + dx * 5}V${y + dy * 12} `;
        }
        path.setAttribute('d', d); $('board-marks').append(path);
    }
    function cancelAI() {
        job++;
        if (worker) worker.terminate(); worker = null;
        clearTimeout(fallbackTimer); clearTimeout(watchdog); busy = false;
    }
    function playerLabel(side) { return sideName(side) + (mode === 'pvp' ? '' : side === human ? ' · 你' : ' · 电脑'); }
    function notation(move, piece) {
        const side = piece[0], kind = piece[1], fr = Math.floor(move.from / 9), fc = move.from % 9, tr = Math.floor(move.to / 9), tc = move.to % 9;
        const number = n => side === 'r' ? digits[n] : String(n);
        const file = c => number(side === 'r' ? 9 - c : c + 1);
        const peers = board.map((p, i) => p === piece && i % 9 === fc ? i : -1).filter(i => i >= 0).sort((a, b) => side === 'r' ? a - b : b - a);
        let prefix = X.NAMES[side][kind] + file(fc);
        if (peers.length === 2) prefix = (peers[0] === move.from ? '前' : '后') + X.NAMES[side][kind];
        const action = fr === tr ? '平' : (side === 'r' ? tr < fr : tr > fr) ? '进' : '退';
        return prefix + action + (fr === tr || ['N', 'B', 'A'].includes(kind) ? file(tc) : number(Math.abs(tr - fr)));
    }
    function apply(move) {
        if (result) return;
        const valid = X.legalMoves(board, turn, move.from).find(m => m.to === move.to);
        if (!valid) return;
        const piece = board[valid.from], captured = board[valid.to], label = notation(valid, piece);
        history.push({board: board.slice(), turn, halfmove, lastMove, move: valid, piece, captured, label});
        board = X.applyMove(board, valid); halfmove = captured ? 0 : halfmove + 1;
        turn = X.other(turn); lastMove = valid; selected = null; keys.push(X.positionKey(board, turn));
        result = X.outcome(board, turn);
        if (!result && keys.filter(key => key === keys[keys.length - 1]).length >= 3) result = {winner: null, reason: 'repetition'};
        if (!result && halfmove >= 120) result = {winner: null, reason: 'no-capture'};
        render(); scheduleAI();
    }
    function selectSquare(i) {
        if (result || busy || mode === 'ai' && turn !== human) return;
        if (selected === i) { selected = null; render(); return; }
        if (board[i] && board[i][0] === turn) { selected = i; render(); return; }
        if (selected === null) return;
        const move = X.legalMoves(board, turn, selected).find(m => m.to === i);
        if (move) apply(move);
        else $('game-hint').textContent = X.inCheck(board, turn) ? '正在被将军，请选择能解除将军的走法。' : '这里不能走。请选择提示落点，或换一枚棋子。';
    }
    function scheduleAI() {
        if (mode !== 'ai' || turn === human || result || busy) return;
        busy = true; const id = ++job; render();
        function finish(move) {
            if (id !== job || !busy) return;
            if (worker) worker.terminate(); worker = null; clearTimeout(watchdog);
            busy = false;
            const valid = move && X.legalMoves(board, turn, move.from).find(m => m.to === move.to);
            const chosen = valid || X.legalMoves(board, turn)[0];
            if (chosen) apply(chosen);
            else { result = X.outcome(board, turn); render(); }
        }
        function fallback() {
            if (id !== job || !busy) return;
            if (worker) worker.terminate(); worker = null; clearTimeout(watchdog);
            fallbackTimer = setTimeout(() => {
                if (id !== job || !busy) return;
                finish(X.findBestMove(board, turn, {depth: 2, timeMs: 250, maxNodes: 12000}));
            }, 30);
        }
        try {
            worker = new Worker('xiangqi-worker.js');
            worker.onmessage = event => {
                if (event.data.id !== id) return;
                if (event.data.error) fallback(); else finish(event.data.move);
            };
            worker.onerror = event => { event.preventDefault(); fallback(); };
            worker.postMessage({id, board, side: turn, difficulty: $('difficulty').value});
            watchdog = setTimeout(fallback, 4500);
        } catch (_) { fallback(); }
    }
    function renderHistory() {
        const scroll = $('move-history'); scroll.replaceChildren();
        if (!history.length) {
            const p = document.createElement('p'); p.className = 'empty-history'; p.textContent = '棋盘已摆好，等你落子。'; scroll.append(p);
        }
        for (let i = 0; i < history.length; i += 2) {
            const row = document.createElement('div'); row.className = 'move-row';
            const number = document.createElement('span'); number.textContent = String(i / 2 + 1).padStart(2, '0'); row.append(number);
            for (const entry of [history[i], history[i + 1]]) {
                const text = document.createElement('span');
                if (entry) { text.className = entry.turn === 'r' ? 'move-red' : 'move-black'; text.textContent = entry.label; }
                else text.textContent = '…'; row.append(text);
            }
            scroll.append(row);
        }
        $('move-count').textContent = history.length + ' 步'; scroll.scrollTop = scroll.scrollHeight;
    }
    function render() {
        const check = !result && X.inCheck(board, turn), hints = selected !== null && $('show-hints').checked ? X.legalMoves(board, turn, selected).map(m => m.to) : [];
        const king = board.indexOf(turn + 'K');
        for (let i = 0; i < 90; i++) {
            const cell = cells[i], p = board[i], display = flipped ? 89 - i : i;
            cell.style.gridRow = Math.floor(display / 9) + 1; cell.style.gridColumn = display % 9 + 1;
            cell.classList.toggle('selected', selected === i);
            cell.classList.toggle('legal', hints.includes(i)); cell.classList.toggle('capture', !!p && hints.includes(i));
            cell.classList.toggle('last-from', !!lastMove && lastMove.from === i); cell.classList.toggle('last-to', !!lastMove && lastMove.to === i);
            cell.classList.toggle('checked', !!check && i === king);
            cell.setAttribute('aria-pressed', String(selected === i));
            cell.setAttribute('aria-label', `${p ? sideName(p[0]) + X.NAMES[p[0]][p[1]] : '空位'}，从黑方起第${Math.floor(i / 9) + 1}行第${i % 9 + 1}列${hints.includes(i) ? '，可落子' : ''}`);
            cell.title = cell.getAttribute('aria-label');
            if (cell.dataset.piece !== (p || '')) {
                cell.replaceChildren(); cell.dataset.piece = p || '';
                if (p) { const span = document.createElement('span'); span.className = 'piece' + (p[0] === 'b' ? ' black' : ''); span.textContent = X.NAMES[p[0]][p[1]]; span.setAttribute('aria-hidden', 'true'); cell.append(span); }
            }
        }
        $('chess-board').classList.toggle('thinking', busy);
        $('chess-board').setAttribute('aria-busy', String(busy));
        $('chess-board').setAttribute('aria-label', `中国象棋棋盘，${flipped ? '黑方' : '红方'}在下。方向键移动，回车选择棋子和落点`);
        const top = flipped ? 'r' : 'b', bottom = X.other(top);
        $('top-player').textContent = playerLabel(top); $('bottom-player').textContent = playerLabel(bottom);
        $('top-player').previousElementSibling.className = 'player-dot ' + (top === 'r' ? 'red-dot' : 'black-dot');
        $('bottom-player').previousElementSibling.className = 'player-dot ' + (bottom === 'r' ? 'red-dot' : 'black-dot');
        for (const [place, side] of [['top', top], ['bottom', bottom]]) {
            const captured = history.filter(h => h.turn === side && h.captured).map(h => X.NAMES[h.captured[0]][h.captured[1]]).join(' ');
            $(place + '-captured').textContent = captured || '—'; $(place + '-captured').setAttribute('aria-label', sideName(side) + '已吃棋子：' + (captured || '无'));
        }
        $('round-label').textContent = '第 ' + (Math.floor(history.length / 2) + 1) + ' 回合';
        $('turn-indicator').className = 'player-dot ' + (turn === 'r' ? 'red-dot' : 'black-dot');
        if (result) {
            $('game-status').textContent = result.winner ? sideName(result.winner) + '获胜' : '本局和棋';
            const reasons = {capture: '将帅已被吃掉。', checkmate: '将死，对方已无法应将。', stalemate: '困毙，对方已无合法走法。', resign: sideName(X.other(result.winner)) + '认输。', repetition: '同一局面已出现三次。', 'no-capture': '双方连续 60 回合未吃子。'};
            $('game-hint').textContent = reasons[result.reason] + ' 可以悔棋复盘，或重新开局。';
        } else {
            $('game-status').textContent = busy ? '电脑思考中…' : check ? sideName(turn) + '被将军' : sideName(turn) + '走棋';
            $('game-hint').textContent = busy ? '正在斟酌下一步，请稍候。' : check ? '必须先解除将军，才能继续行棋。' : selected !== null ? '选择落点；再次点击当前棋子可取消。' : mode === 'ai' ? '你执' + (human === 'r' ? '红棋' : '黑棋') + '，选择一枚棋子开始。' : '在同一台设备上轮流走棋。';
        }
        $('undo').disabled = !history.length || mode === 'ai' && history.every(h => h.turn !== human);
        $('resign').disabled = !!result || busy;
        $('ai-settings').hidden = mode !== 'ai';
        renderHistory();
    }
    function startGame() {
        cancelAI(); mode = $('game-mode').value; human = $('human-side').value;
        board = X.initialBoard(); turn = 'r'; selected = null; lastMove = null; history = []; halfmove = 0; result = null;
        keys = [X.positionKey(board, turn)]; flipped = mode === 'ai' && human === 'b';
        render(); scheduleAI();
    }
    function confirmAction(title, description, label, action, cancel) {
        if (dialog.open) return;
        $('confirm-title').textContent = title; $('confirm-description').textContent = description; $('confirm-action').textContent = label;
        pendingAction = {action, cancel}; dialog.returnValue = ''; dialog.showModal();
    }
    dialog.addEventListener('close', () => {
        const pending = pendingAction; pendingAction = null;
        if (!pending) return;
        if (dialog.returnValue === 'confirm') pending.action(); else if (pending.cancel) pending.cancel();
    });
    $('restart').addEventListener('click', () => {
        if (!history.length || result) startGame();
        else confirmAction('重新开局？', '当前对局将结束，棋盘会重新摆好。', '重新开局', startGame);
    });
    function changeSettings() {
        if (!history.length || result) { startGame(); return; }
        confirmAction('开始新的对局？', '更换对战模式或执子后，当前棋局会重新开始。', '开始新对局', startGame, () => { $('game-mode').value = mode; $('human-side').value = human; });
    }
    $('game-mode').addEventListener('change', changeSettings); $('human-side').addEventListener('change', changeSettings);
    $('show-hints').addEventListener('change', render);
    $('flip').addEventListener('click', () => { flipped = !flipped; render(); });
    $('undo').addEventListener('click', () => {
        if ($('undo').disabled) return;
        cancelAI();
        let entry;
        do { entry = history.pop(); keys.pop(); } while (mode === 'ai' && entry.turn !== human && history.length);
        board = entry.board.slice(); turn = entry.turn; halfmove = entry.halfmove; lastMove = entry.lastMove; selected = null; result = null;
        render(); scheduleAI();
    });
    $('resign').addEventListener('click', () => confirmAction('确认认输？', sideName(turn) + '认输后，本局结束。', '确认认输', () => {
        cancelAI(); selected = null; result = {winner: X.other(turn), reason: 'resign'}; render();
    }));
    window.addEventListener('pagehide', cancelAI);
    window.addEventListener('pageshow', event => { if (event.persisted) { render(); scheduleAI(); } });
    startGame();
})();
