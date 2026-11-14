const COLORS = ['sage', 'blue', 'peach', 'lavender'];
const PALETTE = {
  sage: { fill: '#eef4ed', stroke: '#aac2aa', text: '#395642' },
  blue: { fill: '#edf2f8', stroke: '#a9bed8', text: '#3e5874' },
  peach: { fill: '#faf0e8', stroke: '#d7b8a0', text: '#805e45' },
  lavender: { fill: '#f1eef8', stroke: '#beb1d8', text: '#655483' }
};
const MAX_NODES = 2000;
const MAX_LINKS = 5000;
const now = () => new Date().toISOString();
const uid = () => globalThis.crypto?.randomUUID?.() || `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
const touch = map => { map.updatedAt = now(); };
const rootOf = map => map.nodes.find(node => node.parentId === null);
const validString = (value, label, max, empty = false) => {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) {
    throw new Error(`${label}格式不正确${max ? `（最多 ${max} 个字符）` : ''}`);
  }
  return value;
};
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

/** Create an independent map. Use template="blank" for a single root node. */
export function createMap(title = '自由生长的想法', template = 'starter') {
  const stamp = now();
  const root = { id: uid(), parentId: null, text: template === 'blank' ? title : '让想法自由生长', x: 0, y: 0, color: 'sage', note: '', collapsed: false };
  const map = { id: uid(), title, nodes: [root], links: [], createdAt: stamp, updatedAt: stamp };
  if (template === 'blank') return map;
  const branches = [
    { text: '探索新的可能', color: 'sage', x: 280, y: -140, children: ['想学的新技能', '一个大胆的尝试'] },
    { text: '把想法变成行动', color: 'blue', x: 280, y: 140, children: ['从一件小事开始', '给自己一点时间'] },
    { text: '收集生活灵感', color: 'peach', x: -280, y: -140, children: ['书里的一句话', '路上的小发现'] },
    { text: '留一点空白', color: 'lavender', x: -280, y: 140, children: ['还没想好的事', '也许可以试试…'] }
  ];
  branches.forEach(branch => {
    const parent = { id: uid(), parentId: root.id, text: branch.text, x: branch.x, y: branch.y, color: branch.color, note: '', collapsed: false };
    map.nodes.push(parent);
    branch.children.forEach((text, index) => map.nodes.push({ id: uid(), parentId: parent.id, text, x: Math.sign(branch.x) * 520, y: branch.y + (index ? 39 : -39), color: branch.color, note: '', collapsed: false }));
  });
  return map;
}

/** Validate untrusted import data and return a fresh, normalized plain object. */
export function validateMap(input) {
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { throw new Error('文件不是有效的 JSON'); }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('导图格式不正确');
  const title = validString(input.title, '导图名称', 160);
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > MAX_NODES) throw new Error(`导图需要包含 1–${MAX_NODES} 个节点`);
  const ids = new Set();
  const nodes = input.nodes.map(node => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error('节点格式不正确');
    const id = validString(node.id, '节点 ID', 128);
    if (ids.has(id)) throw new Error('节点 ID 不能重复');
    ids.add(id);
    const parentId = node.parentId == null ? null : validString(node.parentId, '父节点 ID', 128);
    const text = validString(node.text, '节点文字', 300, true);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 1000000 || Math.abs(node.y) > 1000000) throw new Error('节点坐标必须是有效数字');
    if (node.note != null && typeof node.note !== 'string') throw new Error('节点备注格式不正确');
    const note = validString(node.note ?? '', '节点备注', 10000, true);
    if (node.collapsed != null && typeof node.collapsed !== 'boolean') throw new Error('折叠状态格式不正确');
    return { id, parentId, text, x: node.x, y: node.y, color: COLORS.includes(node.color) ? node.color : 'sage', note, collapsed: node.collapsed === true };
  });
  if (nodes.filter(node => node.parentId === null).length !== 1) throw new Error('导图必须只有一个中心主题');
  const index = new Map(nodes.map(node => [node.id, node]));
  const visited = new Set();
  for (const node of nodes) {
    if (node.parentId !== null && !index.has(node.parentId)) throw new Error('节点的父节点不存在');
    const path = new Set();
    let cursor = node;
    while (cursor && !visited.has(cursor.id)) {
      if (path.has(cursor.id)) throw new Error('导图分支不能形成循环');
      path.add(cursor.id);
      cursor = cursor.parentId === null ? null : index.get(cursor.parentId);
    }
    path.forEach(id => visited.add(id));
  }
  const rawLinks = input.links ?? [];
  if (!Array.isArray(rawLinks) || rawLinks.length > MAX_LINKS) throw new Error('关联线格式不正确或数量过多');
  const linkIds = new Set();
  const pairs = new Set();
  const links = rawLinks.map(link => {
    if (!link || typeof link !== 'object') throw new Error('关联线格式不正确');
    const id = validString(link.id, '关联线 ID', 128);
    const from = validString(link.from, '关联线起点', 128);
    const to = validString(link.to, '关联线终点', 128);
    if (linkIds.has(id)) throw new Error('关联线 ID 不能重复');
    if (!index.has(from) || !index.has(to) || from === to) throw new Error('关联线需要连接两个存在的不同节点');
    const pair = [from, to].sort().join('\u0000');
    if (pairs.has(pair)) throw new Error('两个节点之间已有一条关联线');
    linkIds.add(id);
    pairs.add(pair);
    return { id, from, to };
  });
  const stamp = now();
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : stamp;
  return { id: typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 128 ? input.id : uid(), title, nodes, links, createdAt: date(input.createdAt), updatedAt: date(input.updatedAt) };
}

/** Return descendant node objects, excluding the requested node itself. */
export function getDescendants(map, id) {
  const children = new Map();
  map.nodes.forEach(node => {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  });
  const result = [];
  const pending = [...(children.get(id) || [])];
  const seen = new Set([id]);
  while (pending.length) {
    const node = pending.shift();
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    result.push(node);
    pending.push(...(children.get(node.id) || []));
  }
  return result;
}

/** Add a child, or a sibling of parentId when sibling=true. */
export function addNode(map, parentId, options = {}) {
  if (map.nodes.length >= MAX_NODES) throw new Error(`每张导图最多 ${MAX_NODES} 个节点`);
  let parent = map.nodes.find(node => node.id === parentId);
  if (!parent) throw new Error('请选择一个节点');
  const selected = parent;
  if (options.sibling && parent.parentId !== null) parent = map.nodes.find(node => node.id === parent.parentId);
  const root = rootOf(map);
  const siblings = map.nodes.filter(node => node.parentId === parent.id);
  let direction = Math.sign(parent.x - root.x);
  if (!direction) {
    if (options.sibling && selected.id !== root.id) direction = Math.sign(selected.x - root.x) || 1;
    else direction = siblings.filter(node => node.x >= root.x).length <= siblings.filter(node => node.x < root.x).length ? 1 : -1;
  }
  const x = Number.isFinite(options.x) ? options.x : parent.x + direction * (parent.id === root.id ? 280 : 240);
  let y = Number.isFinite(options.y) ? options.y : (options.sibling ? selected.y + 78 : parent.y);
  if (!Number.isFinite(options.y)) {
    while (map.nodes.some(node => Math.abs(node.x - x) < 160 && Math.abs(node.y - y) < 68)) y += 78;
  }
  const color = parent.id === root.id ? (options.sibling && selected.id !== root.id ? selected.color : COLORS[siblings.length % COLORS.length]) : parent.color;
  const node = { id: uid(), parentId: parent.id, text: typeof options.text === 'string' ? options.text.slice(0, 300) : '新的想法', x, y, color, note: '', collapsed: false };
  parent.collapsed = false;
  map.nodes.push(node);
  touch(map);
  return node;
}

/** Remove an entire branch and its related cross-links; root removal is ignored. */
export function removeNode(map, id) {
  const node = map.nodes.find(node => node.id === id);
  if (!node || node.parentId === null) return false;
  const removeIds = new Set([id, ...getDescendants(map, id).map(child => child.id)]);
  map.nodes = map.nodes.filter(child => !removeIds.has(child.id));
  map.links = map.links.filter(link => !removeIds.has(link.from) && !removeIds.has(link.to));
  touch(map);
  return true;
}

/** Arrange branches on both sides of the root, preserving each root branch's side. */
export function autoLayout(map) {
  const root = rootOf(map);
  if (!root) return map;
  root.x = 0;
  root.y = 0;
  const children = new Map();
  map.nodes.forEach(node => {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  });
  const branchHeight = node => {
    const nested = children.get(node.id) || [];
    return nested.length ? nested.reduce((sum, child) => sum + branchHeight(child), 0) : 78;
  };
  const place = (node, side, depth, top) => {
    const height = branchHeight(node);
    node.x = side * (280 + (depth - 1) * 240);
    node.y = top + height / 2;
    let cursor = top;
    for (const child of children.get(node.id) || []) {
      place(child, side, depth + 1, cursor);
      cursor += branchHeight(child);
    }
  };
  const branches = children.get(root.id) || [];
  const sides = { '-1': [], '1': [] };
  branches.forEach((node, index) => sides[Math.sign(node.x) || (index % 2 ? -1 : 1)].push(node));
  [-1, 1].forEach(side => {
    const group = sides[side];
    const gap = 88;
    const height = group.reduce((sum, node) => sum + branchHeight(node), 0) + Math.max(0, group.length - 1) * gap;
    let cursor = -height / 2;
    group.forEach(node => { place(node, side, 1, cursor); cursor += branchHeight(node) + gap; });
  });
  touch(map);
  return map;
}

/** Export the full hierarchy, including folded branches and node notes. */
export function toMarkdown(map) {
  const lines = [`# ${map.title.replace(/[\r\n]/g, ' ')}`, ''];
  const children = new Map();
  map.nodes.forEach(node => {
    if (!children.has(node.parentId)) children.set(node.parentId, []);
    children.get(node.parentId).push(node);
  });
  const visit = (node, depth) => {
    lines.push(`${'  '.repeat(depth)}- ${node.text.replace(/[\r\n]/g, ' ') || '未命名想法'}`);
    if (node.note) node.note.split(/\r?\n/).forEach(line => lines.push(`${'  '.repeat(depth + 1)}> ${line}`));
    (children.get(node.id) || []).forEach(child => visit(child, depth + 1));
  };
  const root = rootOf(map);
  if (root) visit(root, 0);
  if (map.links.length) {
    lines.push('', '## 关联', '');
    const names = new Map(map.nodes.map(node => [node.id, node.text.replace(/[\r\n]/g, ' ')]));
    map.links.forEach(link => lines.push(`- ${names.get(link.from)} ↔ ${names.get(link.to)}`));
  }
  return lines.join('\n') + '\n';
}

/** Export the currently visible map as a standalone, script-free SVG. */
export function toSVG(map) {
  const hidden = new Set();
  map.nodes.filter(node => node.collapsed).forEach(node => getDescendants(map, node.id).forEach(child => hidden.add(child.id)));
  const nodes = map.nodes.filter(node => !hidden.has(node.id));
  const index = new Map(nodes.map(node => [node.id, node]));
  const minX = Math.min(...nodes.map(node => node.x - (node.parentId === null ? 95 : 74))) - 70;
  const maxX = Math.max(...nodes.map(node => node.x + (node.parentId === null ? 95 : 74))) + 70;
  const minY = Math.min(...nodes.map(node => node.y - 31)) - 70;
  const maxY = Math.max(...nodes.map(node => node.y + 31)) + 70;
  const width = maxX - minX;
  const height = maxY - minY;
  const curve = (from, to) => {
    const direction = to.x >= from.x ? 1 : -1;
    const sx = from.x + direction * (from.parentId === null ? 95 : 74);
    const tx = to.x - direction * 74;
    const bend = Math.max(35, Math.abs(tx - sx) * .52);
    return `M ${sx} ${from.y} C ${sx + direction * bend} ${from.y}, ${tx - direction * bend} ${to.y}, ${tx} ${to.y}`;
  };
  const paths = nodes.filter(node => node.parentId !== null && index.has(node.parentId)).map(node => `<path d="${curve(index.get(node.parentId), node)}" fill="none" stroke="${PALETTE[node.color].stroke}" stroke-width="1.5"/>`).join('');
  const links = map.links.filter(link => index.has(link.from) && index.has(link.to)).map(link => {
    const from = index.get(link.from), to = index.get(link.to);
    return `<path d="M ${from.x} ${from.y} Q ${(from.x + to.x) / 2} ${(from.y + to.y) / 2 - 80} ${to.x} ${to.y}" fill="none" stroke="#a9adb6" stroke-width="1.3" stroke-dasharray="5 5"/>`;
  }).join('');
  const boxes = nodes.map(node => {
    const root = node.parentId === null;
    const palette = PALETTE[node.color];
    const w = root ? 190 : 148, h = root ? 62 : 46;
    const chars = [...(node.text || '未命名想法')];
    const maxChars = root ? 11 : 9;
    const label = chars.length > maxChars ? chars.slice(0, maxChars).join('') + '…' : chars.join('');
    return `<g><title>${esc(node.text)}</title><rect x="${node.x - w / 2}" y="${node.y - h / 2}" width="${w}" height="${h}" rx="${root ? 16 : 12}" fill="${root ? '#536d59' : palette.fill}" stroke="${root ? '#536d59' : palette.stroke}" stroke-width="${root ? 0 : .7}"/><text x="${node.x}" y="${node.y + 1}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, -apple-system, 'Microsoft YaHei', sans-serif" font-size="${root ? 16 : 13}" font-weight="${root ? 600 : 400}" fill="${root ? '#ffffff' : palette.text}">${esc(label)}</text>${node.collapsed ? `<circle cx="${node.x + w / 2}" cy="${node.y}" r="8" fill="#ffffff" stroke="${palette.stroke}"/><text x="${node.x + w / 2}" y="${node.y + 1}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="${palette.text}">+</text>` : ''}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" role="img"><title>${esc(map.title)}</title><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="#fafbf9"/>${links}${paths}${boxes}</svg>`;
}
