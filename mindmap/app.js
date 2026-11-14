import { createMap, validateMap, addNode, removeNode, autoLayout, getDescendants, toMarkdown, toSVG } from './graph.js';

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const uid = () => crypto.randomUUID();
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const STORAGE = 'mindspace.workspace.v1';
let startupMessage = '';

function initialState() {
  const first = createMap();
  const project = createMap('一个新项目', 'blank');
  ['为什么想做？', '可以从哪里开始？', '还需要了解什么？'].forEach(text => addNode(project, project.nodes[0].id, { text }));
  autoLayout(project);
  const life = createMap('最近想做的事', 'blank');
  ['去一个没去过的地方', '留时间给自己', '学一点新东西'].forEach(text => addNode(life, life.nodes[0].id, { text }));
  autoLayout(life);
  return { maps: [first, project, life], activeId: first.id, inbox: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return initialState();
    const value = JSON.parse(raw);
    if (!Array.isArray(value.maps) || !value.maps.length || value.maps.length > 200) throw Error();
    const maps = value.maps.map(validateMap);
    if (new Set(maps.map(m => m.id)).size !== maps.length) throw Error();
    const inbox = Array.isArray(value.inbox) ? value.inbox.filter(i => i && typeof i.id === 'string' && typeof i.text === 'string').map(i => ({ id: i.id, text: i.text.slice(0, 300), createdAt: typeof i.createdAt === 'string' ? i.createdAt : new Date().toISOString() })).slice(0, 2000) : [];
    return { maps, inbox, activeId: maps.some(m => m.id === value.activeId) ? value.activeId : maps[0].id };
  } catch {
    startupMessage = '未能读取之前的记录，已打开示例导图。你可以导入备份。';
    return initialState();
  }
}

let state = loadState();
let selectedId = null;
let page = 'maps';
let view = 'map';
let tool = 'select';
let linkingFrom = null;
let editingId = null;
let spaceHeld = false;
let transform = { x: 0, y: 0, scale: 1 };
const transforms = new Map();
const histories = new Map();
let toastTimer;
let noteHistoryStarted = false;
let titleHistoryStarted = false;
let saveErrorShown = false;
let noteTimer;
const currentMap = () => state.maps.find(m => m.id === state.activeId) || state.maps[0];
const nodeById = id => currentMap().nodes.find(n => n.id === id);
const rootNode = () => currentMap().nodes.find(n => n.parentId === null);
const viewport = $('#map-viewport');
const world = $('#map-world');

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3400);
}

function save() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(state));
    $('#save-state').innerHTML = `${icon('check')}<span>已保存到本机</span>`;
    $('#save-state').classList.remove('save-error');
    saveErrorShown = false;
  } catch {
    $('#save-state').innerHTML = `${icon('help')}<span>请导出备份</span>`;
    $('#save-state').classList.add('save-error');
    if (!saveErrorShown) toast('本机存储空间不足或不可用，请导出 JSON 保存你的想法。');
    saveErrorShown = true;
  }
}

function history() {
  const id = currentMap().id;
  if (!histories.has(id)) histories.set(id, { undo: [], redo: [] });
  return histories.get(id);
}
function remember() {
  const h = history();
  h.undo.push(JSON.stringify(currentMap()));
  if (h.undo.length > 60) h.undo.shift();
  h.redo = [];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  $('#undo').disabled = !history().undo.length;
  $('#redo').disabled = !history().redo.length;
}
function changed({ sidebar = false } = {}) {
  currentMap().updatedAt = new Date().toISOString();
  save();
  renderMap();
  if (sidebar) renderSidebar();
  updateHistoryButtons();
}
function restoreHistory(direction) {
  finishEditing();
  const h = history();
  const source = h[direction];
  if (!source.length) return;
  h[direction === 'undo' ? 'redo' : 'undo'].push(JSON.stringify(currentMap()));
  state.maps[state.maps.findIndex(m => m.id === state.activeId)] = JSON.parse(source.pop());
  selectedId = null;
  closeNote();
  renderHeader();
  changed({ sidebar: true });
}

function renderSidebar() {
  $('#map-count').textContent = state.maps.length;
  $('#inbox-count').textContent = state.inbox.length;
  $('#map-list').innerHTML = state.maps.map((m, i) => `<button class="map-list-item ${m.id === state.activeId && page === 'maps' ? 'active' : ''}" data-map-id="${escapeHTML(m.id)}" title="${escapeHTML(m.title)}"><span class="map-dot" data-color="${['sage', 'peach', 'blue', 'lavender'][i % 4]}"></span><span>${escapeHTML(m.title)}</span>${m.id === state.activeId && page === 'maps' ? '<span class="map-active-mark"></span>' : ''}</button>`).join('');
  $$('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
}
function renderHeader() {
  const map = currentMap();
  $('#map-title').value = page === 'inbox' ? '灵感收集' : map.title;
  $('#map-title').readOnly = page === 'inbox';
  sizeTitle();
  $('#breadcrumb-title').textContent = page === 'inbox' ? '灵感收集' : map.title;
  $('.breadcrumb-parent').textContent = '← 网站首页';
  $('#workspace-subtitle').textContent = page === 'inbox' ? '让每个一闪而过的念头，都被好好接住。' : '不必急着找到答案，先让想法自由展开。';
  document.title = `${page === 'inbox' ? '灵感收集' : map.title} · 思维导图 · Fantastic Matrix`;
  $('.heading-actions').hidden = page === 'inbox';
  $('.title-menu').hidden = page === 'inbox';
  $('#export-open').hidden = page === 'inbox';
}
function sizeTitle() {
  const input = $('#map-title');
  const style = getComputedStyle(input);
  const canvas = sizeTitle.canvas ||= document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const width = context.measureText(input.value).width + [...input.value].length * (parseFloat(style.letterSpacing) || 0) + 16;
  input.style.width = `${Math.max(125, Math.min(540, width))}px`;
}

function visibleNodes() {
  const hidden = new Set();
  const map = currentMap();
  map.nodes.filter(n => n.collapsed).forEach(n => getDescendants(map, n.id).forEach(child => hidden.add(child.id)));
  return map.nodes.filter(n => !hidden.has(n.id));
}
function curve(from, to) {
  const dir = to.x >= from.x ? 1 : -1;
  const sx = from.x + dir * (from.parentId === null ? 95 : 74);
  const tx = to.x - dir * 74;
  const bend = Math.max(35, Math.abs(tx - sx) * .52);
  return `M ${sx} ${from.y} C ${sx + dir * bend} ${from.y}, ${tx - dir * bend} ${to.y}, ${tx} ${to.y}`;
}
function drawConnections() {
  const visible = visibleNodes();
  const byId = new Map(visible.map(n => [n.id, n]));
  $('#connections').innerHTML = visible.filter(n => n.parentId && byId.has(n.parentId)).map(n => `<path class="connection" data-color="${n.color}" d="${curve(byId.get(n.parentId), n)}"/>`).join('') + currentMap().links.filter(l => byId.has(l.from) && byId.has(l.to)).map(l => {
    const a = byId.get(l.from), b = byId.get(l.to);
    return `<path class="association" data-link-id="${escapeHTML(l.id)}" d="M ${a.x} ${a.y} Q ${(a.x + b.x) / 2} ${(a.y + b.y) / 2 - 85} ${b.x} ${b.y}"><title>想法关联（双击移除）</title></path>`;
  }).join('');
}
function renderMap() {
  if (editingId) return;
  const nodes = visibleNodes();
  if (selectedId && !nodes.some(n => n.id === selectedId)) selectedId = null;
  $('#nodes').innerHTML = nodes.map(n => {
    const children = currentMap().nodes.filter(c => c.parentId === n.id);
    const isRoot = n.parentId === null;
    return `<div class="map-node ${isRoot ? 'root' : ''} ${n.id === selectedId ? 'selected' : ''} ${n.collapsed ? 'collapsed' : ''} ${n.x < rootNode().x ? 'left' : ''}" data-id="${escapeHTML(n.id)}" data-color="${n.color}" style="left:${n.x}px;top:${n.y}px" role="button" tabindex="0" aria-label="${escapeHTML(n.text || '未命名想法')}" aria-pressed="${n.id === selectedId}"><span class="node-text" title="${escapeHTML(n.text)}">${escapeHTML(n.text || '未命名想法')}</span>${n.note ? `<span class="node-note-indicator" title="有笔记">${icon('note')}</span>` : ''}<button class="node-add" data-add="${escapeHTML(n.id)}" aria-label="延伸这个想法" title="添加子节点">+</button>${children.length ? `<button class="collapse-toggle ${n.collapsed ? 'collapsed' : ''}" data-collapse="${escapeHTML(n.id)}" aria-label="${n.collapsed ? '展开' : '折叠'}分支" title="${n.collapsed ? '展开' : '折叠'}分支">${n.collapsed ? children.length : '−'}</button>` : ''}</div>`;
  }).join('');
  drawConnections();
  $('#node-count').textContent = `${currentMap().nodes.length} 个想法，更多种可能`;
  updateSelection();
  if (view === 'outline') renderOutline();
}
function updateSelection() {
  $$('.map-node').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === selectedId);
    el.setAttribute('aria-pressed', String(el.dataset.id === selectedId));
  });
  const node = nodeById(selectedId);
  const toolbar = $('#node-toolbar');
  toolbar.hidden = !node || page !== 'maps' || view !== 'map' || !!editingId || !!linkingFrom;
  if (!toolbar.hidden) {
    const width = viewport.clientWidth;
    toolbar.style.left = `${Math.max(80, Math.min(width - 88, transform.x + node.x * transform.scale))}px`;
    toolbar.style.top = `${Math.max(58, transform.y + node.y * transform.scale - (node.parentId === null ? 31 : 23) * transform.scale - 52)}px`;
    $('[data-node-action="delete"]').disabled = node.parentId === null;
  }
  if (!$('#note-panel').hidden && node) {
    $('#note-node-name').textContent = node.text;
    if (document.activeElement !== $('#node-note')) $('#node-note').value = node.note;
    $$('#note-colors button').forEach(b => b.classList.toggle('active', b.dataset.color === node.color));
  }
}
function selectNode(id) {
  if (editingId && editingId !== id) finishEditing();
  selectedId = id;
  noteHistoryStarted = false;
  updateSelection();
}
function applyTransform() {
  world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
  viewport.style.backgroundPosition = `${transform.x}px ${transform.y}px`;
  viewport.style.backgroundSize = `${20 * transform.scale}px ${20 * transform.scale}px`;
  $('#zoom-value').textContent = `${Math.round(transform.scale * 100)}%`;
  transforms.set(state.activeId, { ...transform });
  updateSelection();
}
function fitMap({ initial = false } = {}) {
  const nodes = visibleNodes();
  const minX = Math.min(...nodes.map(n => n.x - (n.parentId === null ? 95 : 74)));
  const maxX = Math.max(...nodes.map(n => n.x + (n.parentId === null ? 95 : 74)));
  const minY = Math.min(...nodes.map(n => n.y - 31));
  const maxY = Math.max(...nodes.map(n => n.y + 31));
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  const pad = w < 600 ? 50 : 104;
  let scale = Math.max(.15, Math.min(1, (w - pad) / (maxX - minX), (h - 180) / (maxY - minY)));
  const focusRoot = initial && w < 600 && scale < .68;
  if (focusRoot) scale = .68;
  const cx = focusRoot ? rootNode().x : (minX + maxX) / 2;
  const cy = focusRoot ? rootNode().y : (minY + maxY) / 2;
  transform = { x: w / 2 - cx * scale, y: h / 2 - 10 - cy * scale, scale };
  applyTransform();
}
function zoomTo(scale, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
  scale = Math.min(2.4, Math.max(.15, scale));
  const ratio = scale / transform.scale;
  transform = { x: x - (x - transform.x) * ratio, y: y - (y - transform.y) * ratio, scale };
  applyTransform();
}
function bringIntoView(node, center = false) {
  const x = node.x * transform.scale + transform.x;
  const y = node.y * transform.scale + transform.y;
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (center || x < 110 || x > w - 110 || y < 110 || y > h - 120) {
    transform.x = w / 2 - node.x * transform.scale;
    transform.y = h / 2 - node.y * transform.scale;
    applyTransform();
  }
}

function renderOutline() {
  const map = currentMap();
  const children = new Map();
  map.nodes.forEach(n => { if (!children.has(n.parentId)) children.set(n.parentId, []); children.get(n.parentId).push(n); });
  const rows = [];
  function visit(n, depth) {
    rows.push(`<div class="outline-row" style="--depth:${Math.min(depth, 10)}"><span class="outline-dot" data-color="${n.color}"></span><button class="outline-text" data-outline-id="${escapeHTML(n.id)}">${escapeHTML(n.text || '未命名想法')}</button><button class="outline-add icon-btn" data-add="${escapeHTML(n.id)}" title="添加子节点" aria-label="添加子节点">${icon('plus')}</button>${n.note ? `<p class="outline-note">${escapeHTML(n.note)}</p>` : ''}</div>`);
    (children.get(n.id) || []).forEach(c => visit(c, depth + 1));
  }
  visit(rootNode(), 0);
  $('#outline-view').innerHTML = `<div class="outline-document"><span class="eyebrow">THE SHAPE OF YOUR THOUGHTS</span><h2>${escapeHTML(map.title)}</h2><p class="outline-description">把发散的思绪，串成清晰的脉络。</p>${rows.join('')}</div>`;
}

function setView(next) {
  finishEditing();
  view = next;
  $('#map-viewport').hidden = view !== 'map' || page !== 'maps';
  $('#outline-view').hidden = view !== 'outline' || page !== 'maps';
  $('#inbox-view').hidden = page !== 'inbox';
  const showControls = page === 'maps' && view === 'map';
  $$('.zoom-controls, #canvas-toolbar, .canvas-bottom-right, .canvas-tip').forEach(el => { el.hidden = !showControls; });
  $('#canvas-label-text').textContent = page === 'inbox' ? '灵感收集盒' : view === 'outline' ? '思绪大纲' : '自由画布';
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#canvas-wrap').classList.toggle('document-mode', !showControls);
  closeNote();
  cancelLink();
  renderMap();
  if (page === 'inbox') renderInbox();
  if (showControls) requestAnimationFrame(() => transforms.has(state.activeId) ? applyTransform() : fitMap({ initial: true }));
}
function setPage(next) {
  page = next;
  selectedId = null;
  renderSidebar();
  renderHeader();
  setView(view);
  closeSidebar();
}
function switchMap(id) {
  finishEditing();
  if (!state.maps.some(m => m.id === id)) return;
  state.activeId = id;
  transform = transforms.get(id) || { x: 0, y: 0, scale: 1 };
  setPage('maps');
  updateHistoryButtons();
  save();
}

function addIdea(sibling = false, text) {
  finishEditing();
  if (page !== 'maps') setPage('maps');
  const parent = selectedId || rootNode().id;
  remember();
  try {
    const node = addNode(currentMap(), parent, { sibling, ...(text ? { text } : {}) });
    selectedId = node.id;
    changed();
    if (view === 'outline') setView('map');
    bringIntoView(node);
    if (!text) requestAnimationFrame(() => editNode(node.id));
    return node;
  } catch (error) {
    history().undo.pop();
    updateHistoryButtons();
    toast(error.message);
  }
}
function editNode(id) {
  if (tool === 'hand' || linkingFrom) return;
  finishEditing();
  const node = nodeById(id);
  const el = $$('.map-node').find(e => e.dataset.id === id);
  if (!node || !el) return;
  selectNode(id);
  editingId = id;
  el.classList.add('editing');
  const input = document.createElement('input');
  input.className = 'node-editor';
  input.value = node.text;
  input.maxLength = 300;
  input.setAttribute('aria-label', '编辑想法');
  $('.node-text', el).hidden = true;
  el.appendChild(input);
  let done = false;
  function commit(cancel = false) {
    if (done) return;
    done = true;
    const value = input.value.trim() || '新的想法';
    editingId = null;
    if (!cancel && value !== node.text) { remember(); node.text = value; changed(); }
    else renderMap();
  }
  input.addEventListener('blur', () => commit());
  input.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.key === 'Enter') { e.preventDefault(); commit(); viewport.focus({ preventScroll: true }); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(true); viewport.focus({ preventScroll: true }); }
    if (e.key === 'Tab') { e.preventDefault(); commit(); addIdea(); }
  });
  updateSelection();
  input.focus({ preventScroll: true });
  input.select();
}
function finishEditing() { if (editingId) $('.node-editor')?.blur(); }
function deleteSelected() {
  const n = nodeById(selectedId);
  if (!n) return;
  if (n.parentId === null) { toast('中心主题是想法的起点，可以双击修改它。'); return; }
  remember();
  const parent = n.parentId;
  removeNode(currentMap(), n.id);
  selectedId = parent;
  closeNote();
  changed();
  toast('已移除这条分支，可以撤销恢复。');
}
function collapseNode(id) {
  const n = nodeById(id);
  remember();
  n.collapsed = !n.collapsed;
  changed();
}
function openNote() {
  if (!selectedId) { toast('先选择一个想法，再为它写下细节。'); return; }
  $('#note-panel').hidden = false;
  noteHistoryStarted = false;
  updateSelection();
  $('#node-note').focus();
}
function closeNote() { $('#note-panel').hidden = true; noteHistoryStarted = false; }

function setTool(next) {
  tool = next;
  $$('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === next));
  viewport.classList.toggle('hand-mode', next === 'hand');
  viewport.classList.toggle('link-mode', next === 'link');
  if (next !== 'link') cancelLink(false);
  else if (selectedId) startLink(selectedId);
  else toast('依次点击两个节点，连接它们。');
}
function startLink(id) {
  linkingFrom = id;
  $('#link-hint').hidden = false;
  updateSelection();
}
function cancelLink(resetTool = true) {
  linkingFrom = null;
  $('#link-hint').hidden = true;
  if (resetTool && tool === 'link') { tool = 'select'; $$('[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool)); viewport.classList.remove('link-mode'); }
  updateSelection();
}
function connectNode(id) {
  if (!linkingFrom) { selectNode(id); startLink(id); return; }
  if (id === linkingFrom) return;
  const links = currentMap().links;
  const existing = links.find(l => (l.from === linkingFrom && l.to === id) || (l.from === id && l.to === linkingFrom));
  if (existing) { toast('这两个想法已经有关联了。'); cancelLink(); return; }
  if (links.length >= 5000) { toast('当前导图的关联线已达上限。'); cancelLink(); return; }
  remember();
  links.push({ id: uid(), from: linkingFrom, to: id });
  cancelLink();
  selectedId = id;
  changed();
  toast('两个想法，产生了新的连接。');
}

let gesture = null;
const pointers = new Map();
viewport.addEventListener('pointerdown', e => {
  if (e.button !== 0 && e.button !== 1) return;
  if (e.target.closest('input,button')) return;
  if (e.target.closest('.association')) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const rect = viewport.getBoundingClientRect();
    const mid = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
    gesture = { type: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), scale: transform.scale, worldX: (mid.x - transform.x) / transform.scale, worldY: (mid.y - transform.y) / transform.scale };
    return;
  }
  const el = e.target.closest('.map-node');
  if (el && (tool === 'link' || linkingFrom)) { connectNode(el.dataset.id); return; }
  if (el && tool !== 'hand' && !spaceHeld && e.button === 0) {
    selectNode(el.dataset.id);
    const node = nodeById(el.dataset.id);
    const nodes = [node, ...getDescendants(currentMap(), node.id)];
    gesture = { type: 'node', pointerId: e.pointerId, x: e.clientX, y: e.clientY, nodes: nodes.map(n => ({ id: n.id, x: n.x, y: n.y })), started: false };
  } else {
    finishEditing();
    if (!spaceHeld && tool !== 'hand') { selectedId = null; closeNote(); updateSelection(); }
    gesture = { type: 'pan', pointerId: e.pointerId, x: e.clientX, y: e.clientY, initial: { ...transform }, started: false };
  }
});
document.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  if (gesture.type === 'pinch') {
    if (pointers.size !== 2) return;
    const [a, b] = [...pointers.values()];
    const rect = viewport.getBoundingClientRect();
    const scale = Math.max(.15, Math.min(2.4, gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(gesture.distance, 1)));
    transform = { scale, x: (a.x + b.x) / 2 - rect.left - gesture.worldX * scale, y: (a.y + b.y) / 2 - rect.top - gesture.worldY * scale };
    applyTransform();
    return;
  }
  if (gesture.pointerId !== e.pointerId) return;
  const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
  if (!gesture.started && Math.hypot(dx, dy) < 4) return;
  if (!gesture.started) {
    if (gesture.type === 'node') remember();
    gesture.started = true;
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add('dragging');
  }
  if (gesture.type === 'pan') {
    transform.x = gesture.initial.x + dx;
    transform.y = gesture.initial.y + dy;
    applyTransform();
  } else {
    gesture.nodes.forEach(initial => {
      const node = nodeById(initial.id);
      node.x = initial.x + dx / transform.scale;
      node.y = initial.y + dy / transform.scale;
      const el = $$('.map-node').find(el => el.dataset.id === node.id);
      if (el) { el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; }
    });
    drawConnections();
    updateSelection();
  }
});
function endGesture(e) {
  pointers.delete(e.pointerId);
  if (!gesture) return;
  if (gesture.type === 'node' && gesture.started) changed();
  if (viewport.hasPointerCapture(e.pointerId)) viewport.releasePointerCapture(e.pointerId);
  gesture = null;
  viewport.classList.remove('dragging');
}
document.addEventListener('pointerup', endGesture);
document.addEventListener('pointercancel', endGesture);
viewport.addEventListener('wheel', e => {
  if (editingId) return;
  e.preventDefault();
  const rect = viewport.getBoundingClientRect();
  zoomTo(transform.scale * Math.exp(-e.deltaY * (e.ctrlKey ? .008 : .0015)), e.clientX - rect.left, e.clientY - rect.top);
}, { passive: false });
viewport.addEventListener('dblclick', e => {
  const link = e.target.closest('[data-link-id]');
  if (link) { remember(); currentMap().links = currentMap().links.filter(l => l.id !== link.dataset.linkId); changed(); toast('已移除关联线'); return; }
  const node = e.target.closest('.map-node');
  if (node && !e.target.closest('button')) editNode(node.dataset.id);
});

$('#nodes').addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { selectNode(add.dataset.add); addIdea(); return; }
  const collapse = e.target.closest('[data-collapse]');
  if (collapse) collapseNode(collapse.dataset.collapse);
});
$('#node-toolbar').addEventListener('click', e => {
  const action = e.target.closest('[data-node-action]')?.dataset.nodeAction;
  if (action === 'child') addIdea();
  if (action === 'note') openNote();
  if (action === 'delete') deleteSelected();
  if (action === 'link') { setTool('link'); if (selectedId) startLink(selectedId); }
});
$('#outline-view').addEventListener('click', e => {
  const add = e.target.closest('[data-add]');
  if (add) { selectedId = add.dataset.add; addIdea(); return; }
  const node = e.target.closest('[data-outline-id]');
  if (node) {
    const n = nodeById(node.dataset.outlineId);
    let parent = nodeById(n.parentId);
    while (parent) { parent.collapsed = false; parent = nodeById(parent.parentId); }
    selectedId = n.id;
    setView('map');
    requestAnimationFrame(() => { bringIntoView(n, true); editNode(n.id); });
  }
});
$('#node-note').addEventListener('input', () => {
  const node = nodeById(selectedId);
  if (!node) return;
  if (!noteHistoryStarted) { remember(); noteHistoryStarted = true; }
  node.note = $('#node-note').value;
  currentMap().updatedAt = new Date().toISOString();
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { save(); renderMap(); }, 250);
});
$('#node-note').addEventListener('blur', () => { clearTimeout(noteTimer); save(); renderMap(); noteHistoryStarted = false; });
$('#note-close').addEventListener('click', closeNote);
$('#note-colors').addEventListener('click', e => {
  const color = e.target.closest('[data-color]')?.dataset.color;
  const n = nodeById(selectedId);
  if (!color || !n) return;
  remember();
  [n, ...getDescendants(currentMap(), n.id)].forEach(child => { child.color = color; });
  changed();
});

function renderInbox() {
  $('#inbox-count').textContent = state.inbox.length;
  $('#inbox-cards').innerHTML = state.inbox.length ? state.inbox.map(i => `<article class="idea-card"><span class="idea-card-mark">${icon('spark')}</span><p>${escapeHTML(i.text)}</p><time>${escapeHTML(new Date(i.createdAt).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' }))}</time><div class="idea-actions"><button data-idea-add="${escapeHTML(i.id)}" title="添加到当前导图">${icon('map')}放入导图</button><button class="icon-btn" data-idea-delete="${escapeHTML(i.id)}" title="移除灵感" aria-label="移除灵感">${icon('trash')}</button></div></article>`).join('') : '<div class="inbox-empty"><span>✧</span><h3>灵感来了，就在这里落笔。</h3><p>一句话、一个问题、一个天马行空的念头，都可以。</p></div>';
}
function captureIdea(text) {
  text = text.trim();
  if (!text) return false;
  if (state.inbox.length >= 2000) { toast('灵感盒已满，先把一些灵感放入导图吧。'); return false; }
  state.inbox.unshift({ id: uid(), text: text.slice(0, 300), createdAt: new Date().toISOString() });
  save();
  renderSidebar();
  renderInbox();
  toast('灵感已收好，随时回来继续想。');
  return true;
}
$('#capture-form').addEventListener('submit', e => {
  e.preventDefault();
  if (captureIdea($('#capture-input').value)) { $('#capture-input').value = ''; $('#capture-dialog').close(); }
});
$('#inbox-composer').addEventListener('submit', e => { e.preventDefault(); if (captureIdea($('#inbox-input').value)) $('#inbox-input').value = ''; });
$('#inbox-cards').addEventListener('click', e => {
  const add = e.target.closest('[data-idea-add]');
  if (add) {
    const idea = state.inbox.find(i => i.id === add.dataset.ideaAdd);
    selectedId = null;
    setPage('maps');
    if (addIdea(false, idea.text)) { state.inbox = state.inbox.filter(i => i.id !== idea.id); save(); renderSidebar(); toast(`已放入「${currentMap().title}」`); }
  }
  const del = e.target.closest('[data-idea-delete]');
  if (del) { state.inbox = state.inbox.filter(i => i.id !== del.dataset.ideaDelete); save(); renderSidebar(); renderInbox(); }
});

function showDialog(id) { finishEditing(); $('#map-options').hidden = true; $(id).showModal(); }
$$('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach(dialog => dialog.addEventListener('click', e => {
  if (e.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
}));
function openNewMap() { $('#new-title').value = ''; showDialog('#new-dialog'); requestAnimationFrame(() => $('#new-title').focus()); }
$('#new-map').addEventListener('click', openNewMap);
$('#new-map-small').addEventListener('click', openNewMap);
$('#new-form').addEventListener('submit', e => {
  e.preventDefault();
  const title = $('#new-title').value.trim();
  if (!title) return;
  if (state.maps.length >= 200) { toast('当前空间最多保存 200 张导图，请先导出并整理。'); return; }
  const map = createMap(title, $('input[name="template"]:checked').value);
  state.maps.unshift(map);
  $('#new-dialog').close();
  switchMap(map.id);
  toast('新的思维空间，准备好了。');
});
$('#map-list').addEventListener('click', e => { const b = e.target.closest('[data-map-id]'); if (b) switchMap(b.dataset.mapId); });
$$('[data-page]').forEach(b => b.addEventListener('click', () => setPage(b.dataset.page)));
$$('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
$$('[data-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#add-branch').addEventListener('click', () => addIdea());
$('#toolbar-add').addEventListener('click', () => addIdea());
$('#undo').addEventListener('click', () => restoreHistory('undo'));
$('#redo').addEventListener('click', () => restoreHistory('redo'));
$('#zoom-in').addEventListener('click', () => zoomTo(transform.scale * 1.2));
$('#zoom-out').addEventListener('click', () => zoomTo(transform.scale / 1.2));
$('#zoom-value').addEventListener('click', () => zoomTo(1));
$('#fit-map').addEventListener('click', fitMap);
$('#auto-layout').addEventListener('click', () => { remember(); autoLayout(currentMap()); changed(); fitMap(); toast('想法已整理，思路更清晰一点。'); });
$('#link-cancel').addEventListener('click', () => cancelLink());
$('#export-open').addEventListener('click', () => showDialog('#export-dialog'));
$('#help-open').addEventListener('click', () => showDialog('#help-dialog'));
$('#shortcuts-open').addEventListener('click', () => showDialog('#help-dialog'));
$('#capture-open').addEventListener('click', () => { showDialog('#capture-dialog'); $('#capture-input').focus(); });

$('#map-title').addEventListener('focus', () => { titleHistoryStarted = false; });
$('#map-title').addEventListener('input', () => {
  if (page !== 'maps') return;
  if (!titleHistoryStarted) { remember(); titleHistoryStarted = true; }
  currentMap().title = $('#map-title').value.trim() || '未命名导图';
  sizeTitle();
  $('#breadcrumb-title').textContent = currentMap().title;
  currentMap().updatedAt = new Date().toISOString();
  document.title = `${currentMap().title} · 思维导图 · Fantastic Matrix`;
  renderSidebar();
  save();
});
$('#map-title').addEventListener('blur', () => { renderHeader(); if (view === 'outline') renderOutline(); });
$('#map-title').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) $('#map-title').blur(); });
$('#map-options-open').addEventListener('click', e => {
  e.stopPropagation();
  const menu = $('#map-options');
  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.left = `${Math.min(window.innerWidth - 180, rect.left)}px`;
  menu.style.top = `${rect.bottom + 8}px`;
  menu.hidden = !menu.hidden;
});
document.addEventListener('click', e => { if (!e.target.closest('#map-options,#map-options-open')) $('#map-options').hidden = true; });
$('#rename-map').addEventListener('click', () => { $('#map-options').hidden = true; $('#map-title').focus(); $('#map-title').select(); });
$('#duplicate-map').addEventListener('click', () => {
  if (state.maps.length >= 200) { toast('当前空间最多保存 200 张导图。'); return; }
  const copy = structuredClone(currentMap());
  copy.id = uid();
  copy.title = `${copy.title.slice(0, 53)} · 副本`;
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  state.maps.unshift(copy);
  switchMap(copy.id);
  $('#map-options').hidden = true;
  toast('已复制，可以放心探索另一种可能。');
});
let confirmCallback = null;
$('#delete-map').addEventListener('click', () => {
  const map = currentMap();
  $('#confirm-title').textContent = '删除这张导图？';
  $('#confirm-description').textContent = `「${map.title}」会从当前浏览器移除。你可以先导出一份备份。`;
  confirmCallback = () => {
    state.maps = state.maps.filter(m => m.id !== map.id);
    histories.delete(map.id);
    transforms.delete(map.id);
    if (!state.maps.length) state.maps.push(createMap('新的想法', 'blank'));
    switchMap(state.maps[0].id);
    toast('导图已删除');
  };
  showDialog('#confirm-dialog');
});
$('#confirm-action').addEventListener('click', () => { $('#confirm-dialog').close(); confirmCallback?.(); confirmCallback = null; });

function download(text, type, extension) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentMap().title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')}.${extension}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$$('[data-export]').forEach(b => b.addEventListener('click', () => {
  const format = b.dataset.export;
  const map = currentMap();
  if (format === 'json') download(JSON.stringify(map, null, 2), 'application/json;charset=utf-8', 'json');
  if (format === 'svg') download(toSVG(map), 'image/svg+xml;charset=utf-8', 'svg');
  if (format === 'md') download(toMarkdown(map), 'text/markdown;charset=utf-8', 'md');
  $('#export-dialog').close();
  toast('想法已打包，下载开始了。');
}));
$('#import-btn').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (file.size > 8 * 1024 * 1024) throw new Error('文件过大，请选择小于 8MB 的 JSON 导图。');
    if (state.maps.length >= 200) throw new Error('当前空间最多保存 200 张导图。');
    const map = validateMap(await file.text());
    map.id = uid();
    state.maps.unshift(map);
    switchMap(map.id);
    toast('导图已导入，继续你的想法。');
  } catch (error) { toast(`导入失败：${error.message}`); }
});

let searchItems = [];
function renderSearch() {
  const query = $('#search-input').value.trim().toLocaleLowerCase();
  searchItems = [];
  if (query) {
    for (const map of state.maps) {
      if (map.title.toLocaleLowerCase().includes(query)) searchItems.push({ type: 'map', mapId: map.id, text: map.title, detail: '思维导图' });
      for (const node of map.nodes) if ((node.text + ' ' + node.note).toLocaleLowerCase().includes(query)) searchItems.push({ type: 'node', mapId: map.id, nodeId: node.id, text: node.text, detail: map.title });
    }
    for (const idea of state.inbox) if (idea.text.toLocaleLowerCase().includes(query)) searchItems.push({ type: 'idea', text: idea.text, detail: '灵感收集' });
  } else searchItems = state.maps.map(m => ({ type: 'map', mapId: m.id, text: m.title, detail: '思维导图' }));
  searchItems = searchItems.slice(0, 40);
  $('#search-results').innerHTML = searchItems.length ? `<span class="search-section-label">${query ? `${searchItems.length} 个相关想法` : '我的导图'}</span>` + searchItems.map((r, i) => `<button class="search-result" data-result="${i}">${icon(r.type === 'idea' ? 'bulb' : 'map')}<span><strong>${escapeHTML(r.text)}</strong><small>${escapeHTML(r.detail)}</small></span>${icon('chevron')}</button>`).join('') : '<div class="search-empty">还没找到，换个词再试试？</div>';
}
function openSearch() { showDialog('#search-dialog'); $('#search-input').value = ''; renderSearch(); $('#search-input').focus(); }
$('#search-trigger').addEventListener('click', openSearch);
$('#search-input').addEventListener('input', renderSearch);
$('#search-results').addEventListener('click', e => {
  const button = e.target.closest('[data-result]');
  if (!button) return;
  const item = searchItems[Number(button.dataset.result)];
  $('#search-dialog').close();
  if (item.type === 'idea') { setPage('inbox'); return; }
  switchMap(item.mapId);
  if (item.nodeId) {
    const n = nodeById(item.nodeId);
    let parent = nodeById(n.parentId);
    while (parent) { parent.collapsed = false; parent = nodeById(parent.parentId); }
    setView('map');
    selectedId = n.id;
    renderMap();
    requestAnimationFrame(() => bringIntoView(n, true));
  }
});
$('#search-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) $('[data-result="0"]')?.click(); if (e.key === 'ArrowDown') { e.preventDefault(); $('[data-result="0"]')?.focus(); } });
$('#search-results').addEventListener('keydown', e => {
  if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return;
  e.preventDefault();
  const results = $$('[data-result]');
  const i = results.indexOf(document.activeElement);
  results[(i + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length]?.focus();
});

function closeSidebar() { $('#sidebar').classList.remove('open'); $('#sidebar-backdrop').classList.remove('visible'); }
$('#mobile-menu').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#sidebar-backdrop').classList.toggle('visible'); });
$('#sidebar-backdrop').addEventListener('click', closeSidebar);
$('.brand').addEventListener('click', e => { e.preventDefault(); setPage('maps'); });
if (!/Mac|iPhone|iPad/.test(navigator.platform)) $('.search-trigger kbd').textContent = 'Ctrl K';

document.addEventListener('keydown', e => {
  if (e.isComposing) return;
  const typing = e.target.closest('input,textarea,[contenteditable="true"]');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); if (!$('#search-dialog').open) openSearch(); return; }
  if ($('dialog[open]')) return;
  if (e.key === 'Escape') { cancelLink(); closeNote(); closeSidebar(); selectedId = null; updateSelection(); return; }
  if (typing) return;
  if (page !== 'maps') return;
  const canvasKey = e.target === document.body || e.target === viewport || e.target.closest('.map-node');
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); restoreHistory(e.shiftKey ? 'redo' : 'undo'); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); restoreHistory('redo'); return; }
  if (e.key === 'Tab' && !e.shiftKey && selectedId && view === 'map' && canvasKey) { e.preventDefault(); addIdea(); return; }
  if (e.key === 'Enter' && canvasKey) {
    const focused = e.target.closest('.map-node');
    if (focused) { e.preventDefault(); selectNode(focused.dataset.id); }
    if (selectedId) { e.preventDefault(); addIdea(true); }
    return;
  }
  if (e.key === 'F2' && selectedId) { e.preventDefault(); editNode(selectedId); }
  if (e.key === 'Delete' || e.key === 'Backspace') { if (selectedId) { e.preventDefault(); deleteSelected(); } }
  if (e.code === 'Space' && view === 'map' && canvasKey) { e.preventDefault(); spaceHeld = true; viewport.classList.add('hand-mode'); }
  if (!mod && e.key.toLowerCase() === 'v') setTool('select');
  if (!mod && e.key.toLowerCase() === 'h') setTool('hand');
  if (!mod && e.key.toLowerCase() === 'l') setTool('link');
  if (e.key === '?' && !mod) showDialog('#help-dialog');
});
document.addEventListener('keyup', e => { if (e.code === 'Space') { spaceHeld = false; viewport.classList.toggle('hand-mode', tool === 'hand'); } });
window.addEventListener('blur', () => { spaceHeld = false; viewport.classList.toggle('hand-mode', tool === 'hand'); });
window.addEventListener('beforeunload', () => { finishEditing(); save(); });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (page === 'maps' && view === 'map') fitMap({ initial: true }); }, 100); });

renderSidebar();
renderHeader();
setView('map');
updateHistoryButtons();
if (!startupMessage) save();
else toast(startupMessage);
