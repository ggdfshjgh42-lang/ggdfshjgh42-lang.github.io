'use strict';
importScripts('xiangqi-engine.js?v=20261122-chess1');
self.onmessage = function (event) {
    const {id, board, side, difficulty, history} = event.data;
    try {
        const options = Object.assign({}, Xiangqi.LEVELS[difficulty] || Xiangqi.LEVELS.normal, {history});
        self.postMessage({id, move: Xiangqi.findBestMove(board, side, options)});
    } catch (error) { self.postMessage({id, error: String(error)}); }
};

