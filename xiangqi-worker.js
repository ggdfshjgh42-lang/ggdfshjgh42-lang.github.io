'use strict';
importScripts('xiangqi-engine.js');
self.onmessage = function (event) {
    const {id, board, side, difficulty} = event.data;
    try {
        const options = difficulty === 'easy' ? {depth: 2, timeMs: 350, maxNodes: 15000} : {depth: 3, timeMs: 1100, maxNodes: 75000};
        self.postMessage({id, move: Xiangqi.findBestMove(board, side, options)});
    } catch (error) { self.postMessage({id, error: String(error)}); }
};
