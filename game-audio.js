(function () {
    'use strict';
    const KEY = 'fantastic-matrix-game-muted';
    let muted = false, context = null, master = null;
    const playing = new Set();
    try { muted = localStorage.getItem(KEY) === '1'; } catch (_) { /* Storage is optional. */ }
    function stop() {
        for (const source of playing) { try { source.stop(); } catch (_) { /* Already ended. */ } }
        playing.clear();
    }
    function unlock() {
        if (muted || document.hidden) return;
        try {
            const Audio = window.AudioContext || window.webkitAudioContext;
            if (!Audio) return;
            if (!context) {
                context = new Audio(); master = context.createGain();
                master.gain.value = 0.24; master.connect(context.destination);
            }
            if (context.state === 'suspended') context.resume().catch(() => {});
        } catch (_) { /* Audio must never prevent a move. */ }
    }
    function note(frequency, time, duration, volume, type = 'sine', endFrequency) {
        const osc = context.createOscillator(), envelope = context.createGain();
        osc.type = type; osc.frequency.setValueAtTime(frequency, time);
        if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
        envelope.gain.setValueAtTime(0, time);
        envelope.gain.linearRampToValueAtTime(volume, time + 0.004);
        envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
        osc.connect(envelope); envelope.connect(master); playing.add(osc);
        osc.onended = () => { playing.delete(osc); osc.disconnect(); envelope.disconnect(); };
        osc.start(time); osc.stop(time + duration + 0.01);
    }
    function tap(time, capture) {
        note(capture ? 380 : 720, time, 0.09, 0.7, 'triangle', capture ? 160 : 310);
        note(capture ? 170 : 1180, time, 0.055, 0.25);
        // A short filtered noise transient gives the tap a wooden attack.
        const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.035), context.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.006));
        const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
        source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = capture ? 1200 : 2400; gain.gain.value = 0.45;
        source.connect(filter); filter.connect(gain); gain.connect(master); playing.add(source);
        source.onended = () => { playing.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
        source.start(time);
    }
    function play(name, delay = 0) {
        if (muted || document.hidden || !context || context.state !== 'running') return;
        try {
            const time = context.currentTime + Math.max(0, delay);
            if (name === 'move' || name === 'capture') tap(time, name === 'capture');
            else if (name === 'check') [660, 880].forEach((f, i) => note(f, time + i * 0.13, 0.17, 0.35));
            else if (name === 'win') [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, time + i * 0.11, 0.3, 0.32));
            else if (name === 'lose') [392, 329.63, 261.63].forEach((f, i) => note(f, time + i * 0.14, 0.3, 0.28));
            else if (name === 'draw') [440, 523.25, 440].forEach((f, i) => note(f, time + i * 0.12, 0.2, 0.25));
            else if (name === 'undo') note(600, time, 0.12, 0.2, 'sine', 340);
            else if (name === 'select') note(860, time, 0.035, 0.1);
        } catch (_) { /* Unsupported audio still leaves a fully playable board. */ }
    }
    function render() {
        document.querySelectorAll('[data-game-sound]').forEach(button => {
            button.textContent = muted ? '🔇 音效：关' : '🔊 音效：开';
            button.setAttribute('aria-pressed', String(!muted));
            button.setAttribute('aria-label', muted ? '开启游戏音效' : '关闭游戏音效');
            button.title = muted ? '开启落子和胜负音效' : '关闭所有游戏音效';
        });
    }
    function setMuted(value) {
        muted = Boolean(value);
        try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (_) { /* Storage is optional. */ }
        if (muted) stop(); else unlock();
        render();
    }
    function bind() {
        render();
        document.querySelectorAll('[data-game-sound]').forEach(button => button.addEventListener('click', () => {
            setMuted(!muted); if (!muted) play('move');
        }));
    }
    document.addEventListener('pointerdown', unlock, {capture: true, passive: true});
    document.addEventListener('keydown', unlock, {capture: true});
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    window.addEventListener('pagehide', stop);
    window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) {
        try { muted = localStorage.getItem(KEY) === '1'; } catch (_) { return; }
        if (muted) stop(); render();
    } });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, {once: true}); else bind();
    window.GameAudio = {play, stop, unlock, setMuted, isMuted: () => muted};
})();
