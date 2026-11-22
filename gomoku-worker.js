'use strict';
importScripts('gomoku-engine.js?v=20261122-chess1');
self.onmessage = function (event) {
    const {id, board, side, difficulty} = event.data;
    try {
        self.postMessage({id, move: GomokuAI.findBestMove(board, side, GomokuAI.LEVELS[difficulty] || GomokuAI.LEVELS.normal)});
    } catch (error) { self.postMessage({id, error: String(error)}); }
};

