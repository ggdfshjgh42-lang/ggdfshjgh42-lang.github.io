const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const engine = import(pathToFileURL(path.join(__dirname, '../music-engine.js')).href);

test('saved compositions round-trip without sharing mutable cells', async () => {
  const { demoPattern, normalizePattern, countNotes } = await engine;
  const original = demoPattern('night');
  original.bpm = 136; original.volume = 0.27; original.timbre = 'synth';
  const restored = normalizePattern(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(restored, original);
  assert(countNotes(restored) > 20);
  restored.grid[0][0] = !restored.grid[0][0];
  assert.notEqual(restored.grid[0][0], original.grid[0][0]);
  assert.equal(original.grid[1][0], false);
});

test('malformed saved records are rejected, settings are bounded', async () => {
  const { blankPattern, normalizePattern } = await engine;
  for (const value of [null, {}, { ...blankPattern(), version: 2 }, { ...blankPattern(), grid: [] }]) assert.throws(() => normalizePattern(value));
  const malformed = blankPattern(); malformed.grid[0][0] = '<script>';
  assert.throws(() => normalizePattern(malformed));
  const value = blankPattern(); value.bpm = 10000; value.volume = -2; value.timbre = '__proto__';
  const safe = normalizePattern(value);
  assert.equal(safe.bpm, 180); assert.equal(safe.volume, 0); assert.equal(safe.timbre, 'piano');
});

test('a 16-step loop lasts four quarter-note beats at each supported tempo', async () => {
  const { STEPS, stepDuration } = await engine;
  for (const bpm of [50, 88, 104, 136, 180]) assert(Math.abs(STEPS * stepDuration(bpm) - 4 * 60 / bpm) < 1e-12);
});

test('WAV headers describe correctly interleaved, clipped stereo PCM', async () => {
  const { encodeWav } = await engine;
  const bytes = encodeWav([new Float32Array([-2, 0, 2]), new Float32Array([0.5, -0.5, NaN])], 44100);
  const data = new DataView(bytes);
  assert.equal(Buffer.from(bytes, 0, 4).toString(), 'RIFF');
  assert.equal(Buffer.from(bytes, 8, 4).toString(), 'WAVE');
  assert.equal(Buffer.from(bytes, 36, 4).toString(), 'data');
  assert.equal(data.getUint32(4, true), bytes.byteLength - 8);
  assert.equal(data.getUint16(20, true), 1);
  assert.equal(data.getUint16(22, true), 2);
  assert.equal(data.getUint32(24, true), 44100);
  assert.equal(data.getUint32(28, true), 176400);
  assert.equal(data.getUint16(32, true), 4);
  assert.equal(data.getUint16(34, true), 16);
  assert.equal(data.getUint32(40, true), 12);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => data.getInt16(44 + i * 2, true)), [-32768, 16384, 0, -16384, 32767, 0]);
});

test('WAV encoder rejects mismatched channels and invalid sample rates', async () => {
  const { encodeWav } = await engine;
  assert.throws(() => encodeWav([], 44100));
  assert.throws(() => encodeWav([new Float32Array(2), new Float32Array(3)], 44100));
  assert.throws(() => encodeWav([new Float32Array(2)], 0));
});
