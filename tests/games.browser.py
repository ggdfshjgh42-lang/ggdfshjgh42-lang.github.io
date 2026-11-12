#!/usr/bin/env python3
"""Run real-browser game, worker cancellation, fallback, and Web Audio checks.

python tests/games.browser.py [--artifacts-dir /tmp/games-qa]
Requires Playwright and Chromium; no game services or network access are used.
"""
import argparse
from contextlib import contextmanager
from functools import partial
import http.server
from pathlib import Path
import threading
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
AUDIO_PROBE = """(() => {
    window.audioNotes = 0;
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
        constructor(...args) {
            super(...args);
            window.audioContext = this;
            this.meter = this.createAnalyser();
            const create = this.createGain.bind(this);
            this.createGain = (...params) => {
                const node = create(...params), connect = node.connect.bind(node);
                node.connect = (destination, ...rest) => {
                    if (destination === this.destination) connect(this.meter);
                    return connect(destination, ...rest);
                };
                return node;
            };
        }
    };
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
        window.audioNotes++; return start.apply(this, args);
    };
})();"""


@contextmanager
def serve_site():
    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/favicon.ico':
                self.send_response(204); self.end_headers()
            else:
                super().do_GET()

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown(); server.server_close(); thread.join()


def gomoku_click(page, r, c):
    canvas = page.locator('#board')
    canvas.scroll_into_view_if_needed()
    bounds = canvas.bounding_box()
    canvas.click(position={'x': (24 + c * 36) / 552 * bounds['width'],
                           'y': (24 + r * 36) / 552 * bounds['height']})


def wait_gomoku(page, stones):
    page.wait_for_function(f'!aiThinking && history.length === {stones} && currentPlayer === BLACK')
    expect(page.locator('#status-text')).to_have_text('黑棋走')


def run(base, artifacts):
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        context.add_init_script(AUDIO_PROBE)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '/xiangqi.html')
        expect(page.locator('.square')).to_have_count(90)
        assert page.evaluate('typeof audioContext') == 'undefined', 'No audio is created on page load'
        expect(page.locator('#difficulty option')).to_have_count(3)
        page.locator('#difficulty').select_option('hard')
        page.locator('[data-index="58"]').click()
        page.locator('[data-index="49"]').click()
        expect(page.locator('#move-count')).to_have_text('1 步')
        # Controls remain interactive while the worker searches.
        page.locator('#flip').click()
        expect(page.locator('#top-player')).to_contain_text('红方')
        expect(page.locator('#move-count')).to_have_text('2 步', timeout=9000)
        assert page.evaluate('audioNotes') > 0
        page.locator('#undo').click()
        expect(page.locator('#move-count')).to_have_text('0 步')
        page.locator('[data-index="58"]').click()
        page.locator('[data-index="49"]').click()
        page.locator('#difficulty').select_option('normal')
        page.locator('#undo').click()
        expect(page.locator('#move-count')).to_have_text('0 步')
        page.wait_for_timeout(2400)
        expect(page.locator('#move-count')).to_have_text('0 步')
        # A real capture emits a sound, and mute persists into the other game.
        page.locator('#game-mode').select_option('pvp')
        notes = page.evaluate('audioNotes')
        page.locator('[data-index="64"]').click()
        page.locator('[data-index="1"]').click()
        expect(page.locator('.piece')).to_have_count(31)
        assert page.evaluate('audioNotes') > notes
        page.evaluate("GameAudio.play('win')")
        page.wait_for_function("""() => {
            const data = new Float32Array(audioContext.meter.fftSize);
            audioContext.meter.getFloatTimeDomainData(data);
            return data.some(sample => Math.abs(sample) > 0.001);
        }""")
        page.locator('[data-game-sound]').click()
        expect(page.locator('[data-game-sound]')).to_have_attribute('aria-pressed', 'false')
        notes = page.evaluate('audioNotes')
        page.evaluate("GameAudio.play('win')")
        assert page.evaluate('audioNotes') == notes

        page.goto(base + '/gomoku.html')
        expect(page.locator('[data-game-sound]')).to_have_attribute('aria-pressed', 'false')
        page.get_by_role('button', name='人机对战', exact=True).click()
        expect(page.locator('#gomoku-ai-settings')).to_be_visible()
        page.locator('#gomoku-difficulty').select_option('hard')
        gomoku_click(page, 7, 7)
        wait_gomoku(page, 2)
        # Undo during the next human move's pending timer returns to this position.
        point = page.evaluate('''() => {
            for (let r = 5; r < 10; r++) for (let c = 5; c < 10; c++)
                if (!board[r][c]) return [r,c];
        }''')
        gomoku_click(page, *point)
        page.locator('#undo-button').click()
        wait_gomoku(page, 2)
        page.wait_for_timeout(2300)
        wait_gomoku(page, 2)
        # Change difficulty during analysis: exactly one computer reply arrives.
        gomoku_click(page, *point)
        page.locator('#gomoku-difficulty').select_option('normal')
        wait_gomoku(page, 4)
        page.wait_for_timeout(350)
        wait_gomoku(page, 4)
        page.locator('#new-game-button').click()
        gomoku_click(page, 7, 7)
        page.locator('#new-game-button').click()
        wait_gomoku(page, 0)
        page.wait_for_timeout(2100)
        wait_gomoku(page, 0)
        # Re-enable on touch/click and verify synthesized audio actually produces samples.
        page.locator('[data-game-sound]').click()
        page.wait_for_function("audioContext.state === 'running'")
        page.evaluate("GameAudio.play('check')")
        page.wait_for_function("""() => {
            const data = new Float32Array(audioContext.meter.fftSize);
            audioContext.meter.getFloatTimeDomainData(data);
            return data.some(sample => Math.abs(sample) > 0.001);
        }""")
        # Server state replays must not duplicate move audio.
        page.get_by_role('button', name='在线对战', exact=True).click()
        page.evaluate("""() => {
            roomCode = 'ABCDEF'; onlineRound = 1; onlineMoveNumber = 0;
            window.snapshot = {color: 1, code: 'ABCDEF', round: 1, moves: 1,
                connected: {black: true, white: true}, board: board.map(row => [...row]),
                turn: 2, winner: null, draw: false, lastMove: [7,7], winLine: null,
                scores: {black: 0, white: 0}, hasGuest: true};
            snapshot.board[7][7] = 1;
            applyOnlineState(snapshot);
        }""")
        notes = page.evaluate('audioNotes')
        page.evaluate('applyOnlineState(snapshot)')
        assert page.evaluate('audioNotes') == notes
        page.get_by_role('button', name='双人对战', exact=True).click()
        # Verify outcome sounds through the actual game logic.
        page.evaluate("""() => {
            window.played = [];
            const play = GameAudio.play;
            GameAudio.play = (...args) => { played.push(args[0]); play(...args); };
            for (let c = 3; c < 7; c++) board[7][c] = BLACK;
            currentPlayer = BLACK; placeStone(7, 7);
        }""")
        expect(page.locator('#winner-overlay')).to_have_class('winner-overlay show')
        assert page.evaluate('played.includes("win")')
        page.get_by_role('button', name='再来一局', exact=True).click()
        # Mobile layouts, including controls below the board, stay within the screen.
        phone = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=1)
        mobile = phone.new_page()
        mobile.on('pageerror', lambda error: errors.append(str(error)))
        for game in ['xiangqi', 'gomoku']:
            mobile.goto(f'{base}/{game}.html')
            if game == 'gomoku':
                mobile.get_by_role('button', name='人机对战', exact=True).tap()
                mobile.locator('#gomoku-difficulty').select_option('hard')
                gomoku_click(mobile, 7, 7)
                wait_gomoku(mobile, 2)
            else:
                mobile.locator('#difficulty').select_option('hard')
            assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth'), game + ' must fit on phone'
            expect(mobile.locator('[data-game-sound]')).to_be_visible()
            if game == 'gomoku':
                link = mobile.locator('.back-link').bounding_box()
                panel = mobile.locator('.side-panel').bounding_box()
                assert link['y'] + link['height'] <= panel['y'], 'Back link must not cover game controls'
            if artifacts:
                mobile.screenshot(path=str(artifacts / f'{game}-phone.png'), full_page=True)
        phone.close()
        # Engines still work when Workers or browser audio are unavailable.
        fallback = browser.new_context()
        fallback.add_init_script("window.Worker = class {constructor() {throw new Error('Unavailable')}}; window.AudioContext = undefined; window.webkitAudioContext = undefined;")
        fb = fallback.new_page()
        fb.on('pageerror', lambda error: errors.append(str(error)))
        fb.goto(base + '/xiangqi.html')
        fb.locator('[data-index="58"]').click(); fb.locator('[data-index="49"]').click()
        expect(fb.locator('#move-count')).to_have_text('2 步', timeout=3000)
        fb.goto(base + '/gomoku.html')
        fb.get_by_role('button', name='人机对战', exact=True).click()
        gomoku_click(fb, 7, 7); wait_gomoku(fb, 2)
        fallback.close()
        assert not errors, errors
        browser.close()
        print('PASS: desktop + phone, both AI workers, cancellation, difficulty changes, fallback, persistent mute, audible waveform, online replay, win sound; no page errors')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifacts-dir', type=Path)
    args = parser.parse_args()
    if args.artifacts_dir:
        args.artifacts_dir.mkdir(parents=True, exist_ok=True)
    with serve_site() as base:
        run(base, args.artifacts_dir)
