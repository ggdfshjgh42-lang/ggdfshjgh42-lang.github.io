(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const library = window.BookLibrary;
  const state = { books: [] };
  const palettes = [['#d6e1bd','#435a35'],['#355844','#edf3db'],['#e5d6b5','#67583f'],['#dce2d8','#4d6155'],['#bacab5','#344c3e'],['#e5ddc9','#625843']];
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  const readerURL = path => 'reader.html?book=' + encodeURIComponent(path);
  function percent(record) { return Math.round(Math.max(0, Math.min(1, Number(record?.progress) || 0)) * 100); }
  function makeCard(book, index) {
    const record = library.readProgress(book.path);
    const card = el('a', 'book-card'); card.href = readerURL(book.path); card.setAttribute('aria-label', (record ? '继续阅读：' : '阅读：') + book.title);
    const visual = el('div', 'book-visual'); visual.setAttribute('aria-hidden', 'true');
    let hash = 0; for (const char of book.title) hash = (hash + char.codePointAt(0)) % palettes.length;
    visual.style.setProperty('--cover-bg', palettes[hash][0]); visual.style.setProperty('--cover-ink', palettes[hash][1]);
    const cover = el('div', 'cover-content'); cover.append(el('span', 'cover-number', 'FM / ' + String(index + 1).padStart(2,'0')), el('span', 'cover-title', book.title), el('span', 'cover-rule'), el('span', 'cover-author', book.author || 'FANTASTIC MATRIX'));
    visual.append(cover);
    if (book.cover) { const image = el('img'); image.src = library.urlFor(book.cover); image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => image.remove(), { once: true }); visual.append(image); }
    visual.append(el('span', 'cover-format', book.format.toUpperCase()));
    const copy = el('div', 'book-copy'); copy.append(el('h3', '', book.title), el('p', 'book-author', book.author || book.category));
    const bottom = el('div', 'book-bottom'); bottom.append(el('span', '', book.author ? book.category : book.format.toUpperCase() + (book.size ? ' · ' + sizeText(book.size) : '')), el('span', '', record ? '已读 ' + percent(record) + '%' : '翻开看看 ↗')); copy.append(bottom);
    if (record) { const meter = el('div', 'book-meter'); const fill = el('span'); fill.style.width = percent(record) + '%'; meter.append(fill); copy.append(meter); }
    card.append(visual, copy); return card;
  }
  function sizeText(size) { return size < 1024 * 1024 ? Math.max(1, Math.round(size / 1024)) + ' KB' : (size / (1024 * 1024)).toFixed(1) + ' MB'; }
  function render() {
    const query = $('#book-search').value.trim().toLocaleLowerCase();
    const format = $('#format-filter').value;
    const category = $('#category-filter').value;
    const filtered = state.books.filter(book => (format === 'all' || book.format === format) && (category === 'all' || book.category === category) && (!query || [book.title,book.author,book.category,book.description].join(' ').toLocaleLowerCase().includes(query)));
    $('#book-grid').replaceChildren(...filtered.map(makeCard));
    $('#shelf-count').textContent = query || format !== 'all' || category !== 'all' ? filtered.length + ' / ' + state.books.length + ' 本' : state.books.length + ' 本，慢慢读';
    $('#empty-shelf').hidden = filtered.length > 0;
    const empty = state.books.length === 0;
    $('#empty-title').textContent = empty ? '书架，等你放上第一本书。' : '这次，还没找到这本书。';
    $('#empty-detail').textContent = empty ? '导入喜欢的书，再从这里慢慢读。' : '换个关键词，或者试试其他格式和分类。';
    $('#empty-action').textContent = empty ? '看看怎么加书 ↗' : '显示全部书籍 →';
    $('#empty-action').href = empty ? '#add-books' : '#my-books';
    $('#empty-action').onclick = empty ? () => { $('#add-books').open = true; } : event => { event.preventDefault(); $('#book-search').value = ''; $('#format-filter').value = 'all'; $('#category-filter').value = 'all'; render(); $('#book-search').focus(); };
  }
  function resume() {
    const recent = state.books.map(book => ({ book, record: library.readProgress(book.path) })).filter(item => item.record).sort((a,b) => (Number(b.record.updatedAt) || 0) - (Number(a.record.updatedAt) || 0))[0];
    $('#continue-reading').hidden = !recent;
    if (recent) { $('#resume-title').textContent = recent.book.title; $('#resume-detail').textContent = [recent.book.author, '已读 ' + percent(recent.record) + '%', '进度保存在当前浏览器'].filter(Boolean).join(' · '); $('#resume-book').href = readerURL(recent.book.path); }
  }
  async function load(refresh = false) {
    $('#refresh-books').disabled = true;
    $('#shelf-status').textContent = refresh ? '正在刷新书架…' : '正在整理书架，请稍等…';
    try {
      const result = await library.load({ refresh }); state.books = result.books;
      $('#shelf-warning').hidden = !result.warning; $('#shelf-warning').textContent = result.warning || '';
      const selected = $('#category-filter').value;
      const all = el('option', '', '全部分类'); all.value = 'all';
      $('#category-filter').replaceChildren(all, ...[...new Set(state.books.map(book => book.category))].sort((a,b) => a.localeCompare(b,'zh-CN')).map(name => { const option = el('option','',name); option.value = name; return option; }));
      $('#category-filter').value = [...$('#category-filter').options].some(o => o.value === selected) ? selected : 'all';
      render(); resume(); $('#shelf-status').textContent = '';
    } catch { $('#shelf-status').textContent = '暂时无法打开书架，请点击刷新再试。'; }
    finally { $('#refresh-books').disabled = false; }
  }
  $('#book-search').addEventListener('input', render);
  $('#format-filter').addEventListener('change', render);
  $('#category-filter').addEventListener('change', render);
  $('#refresh-books').addEventListener('click', () => load(true));
  window.addEventListener('pageshow', event => { if (event.persisted) { render(); resume(); } });
  window.addEventListener('storage', event => { if (event.key?.startsWith('fm-reading:')) { render(); resume(); } });
  if (location.hash === '#add-books') $('#add-books').open = true;
  load();
})();
