import { STEPS, NOTES, DRUMS, ROWS, normalizePattern, blankPattern, demoPattern, stepDuration, countNotes, createOutput, scheduleRow, renderWav } from './music-engine.js?v=20261116';

const $ = selector => document.querySelector(selector);
const board = $('#music-board');
const STORAGE_KEY = 'fantastic-matrix.music-board.v1';
const Audio = window.AudioContext || window.webkitAudioContext;
const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
const undoStack = [], redoStack = [];
let loadError = false, dirty = false;
let pattern;
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  pattern = raw ? normalizePattern(JSON.parse(raw)) : demoPattern();
} catch {
  pattern = demoPattern();
  loadError = true;
}

let context, output, playbackBus;
let playing = false, starting = false, transportToken = 0;
let schedulerTimer, animationFrame, nextStepTime = 0, nextStep = 0, currentStep = -1;
let visualQueue = [];
let saveTimer, toastTimer, rendering = false, stroke = null;
let lastPreview = { row: -1, time: 0 };
let focusCell = { row: 7, col: 0 };

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3600);
}

function save() {
  clearTimeout(saveTimer);
  if (loadError && !dirty) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pattern));
    $('#save-status').textContent = '已保存到本机';
    $('#save-status').classList.remove('error');
    $('.music-footnote').textContent = '旋律会自动留在当前浏览器里。下次打开，接着画。';
    loadError = false;
  } catch {
    $('#save-status').textContent = '当前浏览器未能保存';
    $('#save-status').classList.add('error');
    $('.music-footnote').textContent = '当前浏览器未能保存画板。喜欢这段旋律的话，可以下载音频。';
  }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 180); }
function snapshot() { return JSON.stringify(pattern); }
function pushHistory(value) {
  undoStack.push(value);
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
  renderHistory();
}
function renderHistory() { $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length; }

const toneColors = ['sage', 'sage', 'sage', 'blue', 'blue', 'blue', 'lavender', 'lavender', 'peach', 'peach'];
const rowLabel = row => row < NOTES.length ? `${NOTES[row].label} ${NOTES[row].name}` : DRUMS[row - NOTES.length].label;
function buildBoard() {
  let html = '<div class="board-row step-numbers" aria-hidden="true"><span>步</span>';
  for (let col = 0; col < STEPS; col++) html += `<span data-col="${col}" class="${col % 4 === 0 ? 'beat-number' : ''}">${col + 1}</span>`;
  html += '</div>';
  for (let row = 0; row < ROWS; row++) {
    if (row === NOTES.length) html += '<div class="drum-divider">节奏 · 加一点鼓点</div>';
    const drum = row >= NOTES.length;
    const label = drum ? DRUMS[row - NOTES.length].label : `${NOTES[row].label}<small>${NOTES[row].name}</small>`;
    html += `<div class="board-row ${drum ? 'drum-row' : ''}" data-tone="${drum ? 'peach' : toneColors[row]}"><button class="row-label" data-preview="${row}" type="button" title="试听${rowLabel(row)}" aria-label="试听${rowLabel(row)}">${label}</button>`;
    for (let col = 0; col < STEPS; col++) {
      html += `<button class="note-cell" data-cell data-row="${row}" data-col="${col}" data-beat="${col % 4 === 0}" type="button" tabindex="${row === focusCell.row && col === focusCell.col ? 0 : -1}" aria-label="${rowLabel(row)}，第 ${col + 1} 步" aria-pressed="false"></button>`;
    }
    html += '</div>';
  }
  board.innerHTML = html;
}
const cells = [];
function renderCells() {
  cells.forEach((row, r) => row.forEach((cell, col) => {
    cell.classList.toggle('is-on', pattern.grid[r][col]);
    cell.setAttribute('aria-pressed', String(pattern.grid[r][col]));
  }));
  renderCount();
}
function renderCount() {
  const count = countNotes(pattern);
  $('#note-count').textContent = `${count} 个音符`;
  $('#download').disabled = !Offline || !count || rendering;
}
function renderValues() {
  $('#tempo').value = pattern.bpm;
  $('#tempo-value').textContent = pattern.bpm;
  $('#tempo').setAttribute('aria-valuetext', `${pattern.bpm} 拍每分钟`);
  $('#timbre').value = pattern.timbre;
  $('#volume').value = Math.round(pattern.volume * 100);
  $('#volume-value').textContent = `${Math.round(pattern.volume * 100)}%`;
  if (output && context) output.gain.setTargetAtTime(pattern.volume * 0.7, context.currentTime, 0.015);
}
function focus(row, col, move = true) {
  cells[focusCell.row][focusCell.col].tabIndex = -1;
  focusCell = { row, col };
  cells[row][col].tabIndex = 0;
  if (move) cells[row][col].focus({ preventScroll: true });
}

function audioContext() {
  if (!Audio) throw new Error('当前浏览器暂不支持声音，请换用新版浏览器。');
  if (!context || context.state === 'closed') {
    context = new Audio();
    output = createOutput(context, pattern.volume);
    context.addEventListener('statechange', () => { if (context.state !== 'running' && playing) stop(); });
  }
  return context;
}
async function preview(row) {
  if (playing || starting || document.hidden) return;
  const now = performance.now();
  if (lastPreview.row === row && now - lastPreview.time < 90) return;
  lastPreview = { row, time: now };
  try {
    const audio = audioContext();
    if (audio.state === 'suspended') await audio.resume();
    if (!playing && !starting && !document.hidden && audio.state === 'running') scheduleRow(audio, output, row, audio.currentTime + 0.006, pattern.timbre);
  } catch (error) { toast(error.message || '未能播放声音，请重试。'); }
}

function showStep(step) {
  if (currentStep === step) return;
  board.querySelectorAll('.current-step').forEach(el => el.classList.remove('current-step'));
  currentStep = step;
  if (step >= 0) board.querySelectorAll(`[data-col="${step}"]`).forEach(el => el.classList.add('current-step'));
}
function animate() {
  if (!playing) return;
  let step = currentStep;
  while (visualQueue.length && visualQueue[0].time <= context.currentTime) step = visualQueue.shift().step;
  showStep(step);
  animationFrame = requestAnimationFrame(animate);
}
function schedule() {
  if (!playing || context.state !== 'running') return;
  const now = context.currentTime;
  // After a stalled frame, resume in time instead of playing a burst of missed notes.
  if (nextStepTime < now - 0.05) { nextStepTime = now + 0.03; visualQueue = []; }
  while (nextStepTime < now + 0.12) {
    pattern.grid.forEach((row, index) => { if (row[nextStep]) scheduleRow(context, playbackBus, index, nextStepTime, pattern.timbre); });
    visualQueue.push({ step: nextStep, time: nextStepTime });
    nextStepTime += stepDuration(pattern.bpm);
    nextStep = (nextStep + 1) % STEPS;
  }
}
function renderTransport() {
  const active = playing || starting;
  $('#play').setAttribute('aria-pressed', String(active));
  $('#play').setAttribute('aria-label', active ? '停止播放' : '播放旋律');
  $('#play use').setAttribute('href', active ? '#m-stop' : '#m-play');
  $('#play span').textContent = starting ? '准备中' : playing ? '停止' : '播放';
  $('#play-dot').classList.toggle('playing', playing);
  $('#play-status').textContent = starting ? '正在准备声音…' : playing ? '循环播放中，边听边画也可以' : '点一下播放，听听这段小曲子';
}
async function start() {
  const token = ++transportToken;
  starting = true;
  renderTransport();
  try {
    const audio = audioContext();
    await audio.resume();
    if (token !== transportToken || document.hidden) return;
    if (audio.state !== 'running') throw new Error('声音尚未开启，请再点一次播放。');
    playbackBus = audio.createGain();
    playbackBus.connect(output);
    nextStep = 0; nextStepTime = audio.currentTime + 0.04; visualQueue = [];
    playing = true; starting = false;
    renderTransport(); schedule();
    schedulerTimer = setInterval(schedule, 25);
    animationFrame = requestAnimationFrame(animate);
  } catch (error) {
    if (token === transportToken) { stop(); toast(error.message || '未能播放声音，请重试。'); }
  } finally {
    if (token === transportToken && starting) { starting = false; renderTransport(); }
  }
}
function stop() {
  ++transportToken;
  playing = false; starting = false;
  clearInterval(schedulerTimer); cancelAnimationFrame(animationFrame);
  visualQueue = [];
  if (playbackBus && context) {
    const old = playbackBus;
    old.gain.cancelScheduledValues(context.currentTime);
    old.gain.setTargetAtTime(0, context.currentTime, 0.008);
    setTimeout(() => old.disconnect(), 160);
    playbackBus = null;
  }
  showStep(-1);
  renderTransport();
}
function togglePlayback() { if (playing || starting) stop(); else start(); }

function setCell(row, col, value) {
  if (pattern.grid[row][col] === value) return;
  dirty = true;
  pattern.grid[row][col] = value;
  cells[row][col].classList.toggle('is-on', value);
  cells[row][col].setAttribute('aria-pressed', String(value));
  if (value) preview(row);
  renderCount(); scheduleSave();
}
function endStroke() {
  if (!stroke) return;
  const pointerId = stroke.pointerId;
  stroke = null;
  if (board.hasPointerCapture(pointerId)) board.releasePointerCapture(pointerId);
  save();
}
function paintAt(x, y) {
  const cell = document.elementFromPoint(x, y)?.closest('[data-cell]');
  if (stroke && cell && board.contains(cell)) setCell(Number(cell.dataset.row), Number(cell.dataset.col), stroke.value);
}
board.addEventListener('pointerdown', event => {
  const cell = event.target.closest('[data-cell]');
  if (!cell || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  endStroke();
  const row = Number(cell.dataset.row), col = Number(cell.dataset.col);
  pushHistory(snapshot());
  focus(row, col);
  stroke = { pointerId: event.pointerId, value: !pattern.grid[row][col], x: event.clientX, y: event.clientY };
  board.setPointerCapture(event.pointerId);
  setCell(row, col, stroke.value);
});
board.addEventListener('pointermove', event => {
  if (!stroke || stroke.pointerId !== event.pointerId) return;
  const { x, y } = stroke;
  const distance = Math.max(Math.abs(event.clientX - x), Math.abs(event.clientY - y));
  const samples = Math.min(150, Math.max(1, Math.ceil(distance / Math.max(3, cells[0][0].clientWidth / 2))));
  for (let i = 1; i <= samples; i++) paintAt(x + (event.clientX - x) * i / samples, y + (event.clientY - y) * i / samples);
  stroke.x = event.clientX; stroke.y = event.clientY;
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => board.addEventListener(type, event => {
  if (stroke?.pointerId === event.pointerId) endStroke();
}));
board.addEventListener('click', event => {
  const label = event.target.closest('[data-preview]');
  if (label) { preview(Number(label.dataset.preview)); return; }
  const cell = event.target.closest('[data-cell]');
  // Pointer strokes already changed the cell; native keyboard and AT clicks have detail=0.
  if (!cell || event.detail !== 0) return;
  const row = Number(cell.dataset.row), col = Number(cell.dataset.col);
  pushHistory(snapshot()); focus(row, col, false);
  setCell(row, col, !pattern.grid[row][col]); save();
});
board.addEventListener('keydown', event => {
  const cell = event.target.closest('[data-cell]');
  if (!cell || event.isComposing) return;
  const row = Number(cell.dataset.row), col = Number(cell.dataset.col);
  const movements = { ArrowUp: [Math.max(0, row - 1), col], ArrowDown: [Math.min(ROWS - 1, row + 1), col], ArrowLeft: [row, Math.max(0, col - 1)], ArrowRight: [row, Math.min(STEPS - 1, col + 1)], Home: [row, 0], End: [row, STEPS - 1] };
  if (movements[event.key]) { event.preventDefault(); focus(...movements[event.key]); }
  else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    if (event.repeat) return;
    pushHistory(snapshot()); setCell(row, col, !pattern.grid[row][col]); save();
  }
});

function restore(direction) {
  endStroke();
  const from = direction === 'undo' ? undoStack : redoStack;
  if (!from.length) return;
  const to = direction === 'undo' ? redoStack : undoStack;
  to.push(snapshot());
  pattern = normalizePattern(JSON.parse(from.pop()));
  dirty = true;
  renderCells(); renderValues(); renderHistory(); save();
}
$('#play').addEventListener('click', togglePlayback);
$('#undo').addEventListener('click', () => restore('undo'));
$('#redo').addEventListener('click', () => restore('redo'));
$('#clear').addEventListener('click', () => {
  endStroke();
  if (!countNotes(pattern)) return;
  pushHistory(snapshot()); stop();
  pattern.grid = blankPattern().grid;
  dirty = true;
  renderCells(); save(); toast('画板已清空，可以撤销恢复。');
});
document.querySelectorAll('[data-demo]').forEach(button => button.addEventListener('click', () => {
  endStroke(); pushHistory(snapshot()); stop();
  const next = demoPattern(button.dataset.demo);
  next.volume = pattern.volume;
  pattern = next;
  dirty = true;
  renderCells(); renderValues(); save();
  toast('示例已铺好，点一下播放，也可以接着改。');
}));

for (const [id, key, read] of [['tempo', 'bpm', value => Number(value)], ['volume', 'volume', value => Number(value) / 100], ['timbre', 'timbre', value => value]]) {
  const control = $(`#${id}`);
  let before = null;
  const update = () => {
    if (before === null) before = snapshot();
    pattern[key] = read(control.value);
    dirty = true;
    renderValues(); scheduleSave();
  };
  control.addEventListener('input', update);
  control.addEventListener('change', () => {
    update();
    if (before !== snapshot()) pushHistory(before);
    before = null; save();
  });
  control.addEventListener('blur', () => {
    if (before !== null && before !== snapshot()) pushHistory(before);
    before = null;
  });
}

$('#download').addEventListener('click', async () => {
  if (rendering || !countNotes(pattern)) return;
  if (pattern.volume === 0) { toast('现在的音量是 0，先调高一点再下载吧。'); return; }
  rendering = true;
  renderCount();
  $('#download span').textContent = '生成中…';
  $('#download').setAttribute('aria-busy', 'true');
  try {
    const bytes = await renderWav(pattern);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'fantastic-matrix-melody.wav';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    toast('已下载为 WAV，包含四次循环和自然收尾。');
  } catch (error) { toast(error.message || '下载没有完成，请再试一次。'); }
  finally {
    rendering = false;
    $('#download span').textContent = '下载音频';
    $('#download').removeAttribute('aria-busy');
    renderCount();
  }
});

document.addEventListener('keydown', event => {
  if (event.isComposing || event.target.closest('input,select,textarea,[contenteditable="true"]')) return;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); restore(event.shiftKey ? 'redo' : 'undo'); }
  else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); restore('redo'); }
  else if (event.code === 'Space' && !event.repeat && !event.target.closest('button,a')) { event.preventDefault(); togglePlayback(); }
  else if (event.key === 'Escape' && (playing || starting)) stop();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { endStroke(); stop(); save(); } });
window.addEventListener('pagehide', () => { endStroke(); stop(); save(); });

buildBoard();
for (let row = 0; row < ROWS; row++) cells.push(Array.from({ length: STEPS }, (_, col) => board.querySelector(`[data-row="${row}"][data-col="${col}"]`)));
renderCells(); renderValues(); renderHistory();
$('#play').disabled = !Audio;
if (!Audio) { $('#play-status').textContent = '当前浏览器不支持声音，可以继续涂画。'; $('#play').title = '请使用支持 Web Audio 的新版浏览器'; }
if (!Offline) $('#download').title = '当前浏览器暂不支持音频下载';
if (loadError) {
  $('#save-status').textContent = '先前记录未能读取';
  $('#save-status').classList.add('error');
  $('.music-footnote').textContent = '先前的记录未能恢复。修改画板后会尝试保存新的旋律。';
  toast('先前的记录未能读取，暂时打开示例。修改后会保存新的画板。');
} else save();
