const test = require('node:test');
const assert = require('node:assert/strict');
const {Viewer, pageAt, pageWindow, layoutPages, anchorAt, anchorScroll, canvasScale} = require('../pdf-reader.js');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('continuous page lookup handles mixed paper sizes, gaps and document ends', () => {
  const layout = layoutPages([1.4, .7, 2], 400);
  assert.deepEqual(layout, [{top:0,height:560}, {top:572,height:280}, {top:864,height:800}]);
  assert.equal(pageAt(layout, -100), 0);
  assert.equal(pageAt(layout, 559), 0);
  assert.equal(pageAt(layout, 565), 1);
  assert.equal(pageAt(layout, 864), 2);
  assert.equal(pageAt(layout, 100000), 2);
});

test('zoom keeps the same point of a page beneath the pinch or pointer center', () => {
  const before = layoutPages([1.4, .7, 2], 400);
  const after = layoutPages([1.4, .7, 2], 800);
  const point = {x:130, y:200};
  const anchor = anchorAt(before, 400, {x:80,y:800,inset:0}, point);
  assert.equal(anchor.page, 2);
  const scroll = anchorScroll(after, 800, 0, anchor);
  const restored = anchorAt(after, 800, {x:scroll.x,y:scroll.y,inset:0}, point);
  assert.equal(restored.page, anchor.page);
  close(restored.ratio, anchor.ratio); close(restored.xRatio, anchor.xRatio);
});

test('zoom also preserves anchors on pages centered within a wider viewport', () => {
  const small = layoutPages([1.4,1.4], 400);
  const anchor = anchorAt(small, 400, {x:0,y:100,inset:250}, {x:450,y:200});
  const large = layoutPages([1.4,1.4], 800);
  const position = anchorScroll(large, 800, 50, anchor);
  const restored = anchorAt(large, 800, {x:position.x,y:position.y,inset:50}, anchor.point);
  close(restored.ratio, anchor.ratio); close(restored.xRatio, anchor.xRatio);
});

test('a long book renders a nearby window rather than hundreds of canvases', () => {
  const layout = layoutPages(Array(600).fill(1.414), 390);
  const indices = pageWindow(layout, layout[300].top + 100, 844);
  assert.ok(indices.includes(300)); assert.ok(indices.includes(301));
  assert.ok(indices.length <= 5);
  assert.deepEqual(pageWindow(layout, 0, 400), [0,1]);
});

test('high zoom, dense screens and extremely long PDF pages respect canvas limits', () => {
  for (const [width,height,count] of [[1560,2206,4],[3400,4808,3],[400,100000,3],[100,100,50]]) {
    const density = canvasScale(width,height,3,count);
    assert.ok(width * height * density * density <= Math.min(2 * 1024 * 1024, 8 * 1024 * 1024 / count) + 1);
    assert.ok(width * density <= 8192 && height * density <= 8192);
  }
});

test('zoom lock rejects scaling while keeping position and navigation methods available', async () => {
  const viewer = Object.create(Viewer.prototype);
  Object.assign(viewer, {zoom:1.75,locked:true,layout:[{top:0,height:600}]});
  viewer.measure = () => assert.fail('a locked zoom must not change the layout');
  await viewer.setZoom(3);
  assert.equal(viewer.zoom, 1.75);
  assert.equal(typeof viewer.goTo, 'function'); assert.equal(typeof viewer.position, 'function');
});
