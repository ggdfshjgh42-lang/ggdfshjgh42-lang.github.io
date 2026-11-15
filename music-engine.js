export const STEPS = 16;
export const NOTES = [
  { name: 'E5', label: '咪', midi: 76 }, { name: 'D5', label: '来', midi: 74 },
  { name: 'C5', label: '哆', midi: 72 }, { name: 'A4', label: '啦', midi: 69 },
  { name: 'G4', label: '嗦', midi: 67 }, { name: 'E4', label: '咪', midi: 64 },
  { name: 'D4', label: '来', midi: 62 }, { name: 'C4', label: '哆', midi: 60 },
  { name: 'A3', label: '啦', midi: 57 }, { name: 'G3', label: '嗦', midi: 55 }
];
export const DRUMS = [
  { name: 'kick', label: '低鼓' }, { name: 'snare', label: '军鼓' }, { name: 'hat', label: '踩镲' }
];
export const ROWS = NOTES.length + DRUMS.length;
export const TIMBRES = { piano: '柔和琴声', mallet: '轻盈木琴', synth: '电子波纹' };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function blankPattern() {
  return { version: 1, grid: Array.from({ length: ROWS }, () => Array(STEPS).fill(false)), bpm: 104, timbre: 'piano', volume: 0.6 };
}

export function normalizePattern(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.grid) || value.grid.length !== ROWS ||
    value.grid.some(row => !Array.isArray(row) || row.length !== STEPS || row.some(cell => typeof cell !== 'boolean'))) {
    throw new Error('画板记录格式不正确');
  }
  return {
    version: 1, grid: value.grid.map(row => [...row]),
    bpm: Number.isFinite(value.bpm) ? clamp(Math.round(value.bpm), 50, 180) : 104,
    timbre: Object.hasOwn(TIMBRES, value.timbre) ? value.timbre : 'piano',
    volume: Number.isFinite(value.volume) ? clamp(value.volume, 0, 1) : 0.6
  };
}

export function demoPattern(name = 'morning') {
  const pattern = blankPattern();
  const night = name === 'night';
  const melody = night ? [7, -1, 4, 2, 3, -1, 4, 5, 6, -1, 7, -1, 5, 4, 3, -1] : [7, -1, 5, 4, 3, -1, 4, -1, 5, -1, 6, 7, 8, -1, 7, -1];
  melody.forEach((row, step) => { if (row >= 0) pattern.grid[row][step] = true; });
  [0, 8].forEach(step => { pattern.grid[9][step] = true; pattern.grid[10][step] = true; });
  [4, 12].forEach(step => { pattern.grid[8][step] = true; pattern.grid[11][step] = true; });
  (night ? [0, 2, 4, 6, 8, 10, 12, 14] : [2, 6, 10, 14]).forEach(step => { pattern.grid[12][step] = true; });
  pattern.bpm = night ? 88 : 104;
  pattern.timbre = night ? 'mallet' : 'piano';
  return pattern;
}

export const stepDuration = bpm => 60 / clamp(Number.isFinite(bpm) ? bpm : 104, 50, 180) / 4;
export const countNotes = pattern => pattern.grid.reduce((sum, row) => sum + row.filter(Boolean).length, 0);

// The same voices are used for live playback and offline WAV rendering.
export function createOutput(context, volume) {
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  input.gain.value = volume * 0.7;
  compressor.threshold.value = -15;
  compressor.knee.value = 18;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;
  input.connect(compressor);
  compressor.connect(context.destination);
  return input;
}

function tone(context, output, frequency, when, duration, level, type = 'sine', endFrequency) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration * 0.7);
  envelope.gain.setValueAtTime(0, when);
  envelope.gain.linearRampToValueAtTime(level, when + 0.006);
  envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  oscillator.connect(envelope);
  envelope.connect(output);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  oscillator.start(when);
  oscillator.stop(when + duration + 0.02);
}

const noiseBuffers = new WeakMap();
function noise(context, output, when, duration, level, cutoff) {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.25), context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 123456789;
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data[i] = (seed >>> 0) / 2147483648 - 1;
    }
    noiseBuffers.set(context, buffer);
  }
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const envelope = context.createGain();
  source.buffer = buffer;
  filter.type = 'highpass';
  filter.frequency.value = cutoff;
  envelope.gain.setValueAtTime(level, when);
  envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  source.connect(filter); filter.connect(envelope); envelope.connect(output);
  source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  source.start(when); source.stop(when + duration + 0.01);
}

export function scheduleRow(context, output, row, when, timbre = 'piano') {
  if (!Number.isInteger(row) || row < 0 || row >= ROWS) throw new RangeError('无效的音轨');
  if (row < NOTES.length) {
    const frequency = 440 * 2 ** ((NOTES[row].midi - 69) / 12);
    if (timbre === 'mallet') {
      tone(context, output, frequency, when, 0.45, 0.105);
      tone(context, output, frequency * 2.76, when, 0.16, 0.025);
    } else if (timbre === 'synth') {
      tone(context, output, frequency, when, 0.56, 0.065, 'triangle');
      tone(context, output, frequency / 2, when, 0.48, 0.027);
    } else {
      tone(context, output, frequency, when, 0.84, 0.105);
      tone(context, output, frequency * 2, when, 0.31, 0.024);
    }
  } else if (row === NOTES.length) {
    tone(context, output, 145, when, 0.23, 0.26, 'sine', 43);
  } else if (row === NOTES.length + 1) {
    noise(context, output, when, 0.16, 0.13, 1700);
    tone(context, output, 185, when, 0.095, 0.052);
  } else {
    noise(context, output, when, 0.065, 0.065, 6500);
  }
}

/** Interleaved little-endian, 16-bit PCM WAV. Nonfinite samples become silence. */
export function encodeWav(channels, sampleRate) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2 || !channels[0]?.length ||
    channels.some(channel => !(channel instanceof Float32Array) || channel.length !== channels[0].length) ||
    !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('无效的音频数据');
  const length = channels[0].length, count = channels.length;
  const bytes = new ArrayBuffer(44 + length * count * 2);
  const view = new DataView(bytes);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, count, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true); view.setUint16(32, count * 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, length * count * 2, true);
  let offset = 44;
  for (let i = 0; i < length; i++) for (const channel of channels) {
    const sample = Number.isFinite(channel[i]) ? clamp(channel[i], -1, 1) : 0;
    view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
    offset += 2;
  }
  return bytes;
}

export async function renderWav(pattern, loops = 4) {
  const data = normalizePattern(pattern);
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Offline) throw new Error('当前浏览器暂不支持音频下载，可以换用新版浏览器。');
  if (!Number.isInteger(loops) || loops < 1 || loops > 16) throw new Error('无效的循环次数');
  const rate = 44100, step = stepDuration(data.bpm);
  const context = new Offline(1, Math.ceil((loops * STEPS * step + 1) * rate), rate);
  const output = createOutput(context, data.volume);
  for (let i = 0; i < loops * STEPS; i++) {
    data.grid.forEach((row, index) => { if (row[i % STEPS]) scheduleRow(context, output, index, 0.02 + i * step, data.timbre); });
  }
  const buffer = await context.startRendering();
  return encodeWav([buffer.getChannelData(0)], rate);
}
