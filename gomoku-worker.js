'use strict';
importScripts('gomoku-engine.js?v=20261112-ai2');
self.onmessage = function (event) {
    const {id, board, side, difficulty} = event.data;
    try {
        self.postMessage({id, move: GomokuAI.findBestMove(board, side, GomokuAI.LEVELS[difficulty] || GomokuAI.LEVELS.normal)});
    } catch (error) { self.postMessage({id, error: String(error)}); }
};
