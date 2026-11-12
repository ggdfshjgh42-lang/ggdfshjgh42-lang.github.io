(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const library = window.BookLibrary;
  const state = { books: [], status: 'all', loaded: false };
  const palettes = [['#d6e1bd','#435a35'],['#355844','#edf3db'],['#e5d6b5','#67583f'],['#dce2d8','#4d6155'],['#bacab5','#344c3e'],['#e5ddc9','#625843']];
  const statusLabels = { unread: '未读', reading: '在读', finished: '已读完' };
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  const readerURL = path => 'reader.html?book=' + encodeURIComponent(path);
  const progress = record => Math.max(0, Math.min(1, Number(record?.progress) || 0));
  // Reserve 100% and the finished filter for actual completed records.
  const percent = record => progress(record) === 1 ? 100 : Math.floor(progress(record) * 100);
  const readingStatus = record => !record ? 'unread' : progress(record) >= 1 ? 'finished' : 'reading';
  const readTime = record => Math.max(0, Number(record?.updatedAt) || 0);
  const compareTitle = (a, b) => a.book.title.localeCompare(b.book.title, 'zh-CN', { numeric: true });

  function makeCard(item, index) {
    const { book, record } = item;
    const status = readingStatus(record);
    const card = el('a', 'book-card'); card.href = readerURL(book.path);
    card.setAttribute('aria-label', (status === 'unread' ? '阅读：' : status === 'finished' ? '再次打开：' : '继续阅读：') + book.title + (record ? '，已读 ' + percent(record) + '%' : ''));
    const visual = el('div', 'book-visual'); visual.setAttribute('aria-hidden', 'true');
    let hash = 0; for (const char of book.title) hash = (hash + char.codePointAt(0)) % palettes.length;
    visual.style.setProperty('--cover-bg', palettes[hash][0]); visual.style.setProperty('--cover-ink', palettes[hash][1]);
    const cover = el('div', 'cover-content'); cover.append(el('span', 'cover-number', 'FM / ' + String(index + 1).padStart(2,'0')), el('span', 'cover-title', book.title), el('span', 'cover-rule'), el('span', 'cover-author', book.author || 'FANTASTIC MATRIX'));
    visual.append(cover);
    if (book.cover) { const image = el('img'); image.src = library.urlFor(book.cover); image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', () => image.remove(), { once: true }); visual.append(image); }
    visual.append(el('span', 'cover-format', book.format.toUpperCase()));
    const copy = el('div', 'book-copy'); copy.append(el('h3', '', book.title), el('p', 'book-author', book.author || book.category));
    const bottom = el('div', 'book-bottom'); bottom.append(el('span', '', book.author ? book.category : book.format.toUpperCase() + (book.size ? ' · ' + sizeText(book.size) : '')), el('span', 'book-reading-state is-' + status, record ? statusLabels[status] + ' · ' + percent(record) + '%' : '未读 · 翻开看看 ↗')); copy.append(bottom);
    if (record) { const meter = el('div', 'book-meter'); meter.setAttribute('aria-hidden', 'true'); const fill = el('span'); fill.style.width = percent(record) + '%'; meter.append(fill); copy.append(meter); }
    card.append(visual, copy); return card;
  }
  function sizeText(size) { return size < 1024 * 1024 ? Math.max(1, Math.round(size / 1024)) + ' KB' : (size / (1024 * 1024)).toFixed(1) + ' MB'; }
  function resetFilters() {
    $('#book-search').value = ''; $('#format-filter').value = 'all'; $('#category-filter').value = 'all';
    state.status = 'all';
    render(); $('#book-search').focus();
  }
  function render() {
    if (!library) return;
    const query = $('#book-search').value.trim().toLocaleLowerCase();
    const format = $('#format-filter').value;
    const category = $('#category-filter').value;
    const items = state.books.map(book => ({ book, record: library.readProgress(book.path) }));
    const counts = { all: items.length, unread: 0, reading: 0, finished: 0 };
    items.forEach(item => counts[readingStatus(item.record)]++);
    document.querySelectorAll('[data-status-count]').forEach(node => { node.textContent = counts[node.dataset.statusCount]; });
    document.querySelectorAll('[data-reading-status]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.readingStatus === state.status)));
    const filtered = items.filter(({ book, record }) => (state.status === 'all' || readingStatus(record) === state.status) && (format === 'all' || book.format === format) && (category === 'all' || book.category === category) && (!query || [book.title,book.author,book.category,book.description].join(' ').toLocaleLowerCase().includes(query)));
    const sorting = $('#book-sort').value;
    filtered.sort((a, b) => (sorting === 'recent' ? readTime(b.record) - readTime(a.record) : sorting === 'progress' ? progress(b.record) - progress(a.record) : 0) || compareTitle(a, b));
    $('#book-grid').replaceChildren(...filtered.map(makeCard));
    const filtering = query || format !== 'all' || category !== 'all' || state.status !== 'all';
    $('#shelf-count').textContent = filtering ? '显示 ' + filtered.length + ' / ' + state.books.length + ' 本' : state.books.length + ' 本 · ' + counts.reading + ' 本在读 · ' + counts.finished + ' 本读完';
    $('#empty-shelf').hidden = filtered.length > 0;
    const empty = state.books.length === 0;
    $('#empty-title').textContent = empty ? '书架，等你放上第一本书。' : '这里暂时没有匹配的书。';
    $('#empty-detail').textContent = empty ? '导入喜欢的书，再从这里慢慢读。' : '换个关键词、格式、分类或阅读状态，也可以清除筛选。';
    $('#empty-action').textContent = empty ? '看看怎么加书 ↗' : '清除筛选，显示全部 →';
    $('#empty-action').href = empty ? '#add-books' : '#my-books';
    $('#empty-action').onclick = empty ? () => { $('#add-books').open = true; } : event => { event.preventDefault(); resetFilters(); };
  }
  function resume() {
    const recent = state.books.map(book => ({ book, record: library.readProgress(book.path) })).filter(item => item.record).sort((a,b) => Number(readingStatus(a.record) === 'finished') - Number(readingStatus(b.record) === 'finished') || readTime(b.record) - readTime(a.record))[0];
    $('#continue-reading').hidden = !recent;
    if (recent) {
      const finished = readingStatus(recent.record) === 'finished';
      $('#resume-title').textContent = recent.book.title;
      $('#resume-detail').textContent = [recent.book.author, finished ? '已读完，随时可以回来翻阅' : '已读 ' + percent(recent.record) + '%', '进度保存在当前浏览器'].filter(Boolean).join(' · ');
      const link = $('#resume-book'); link.href = readerURL(recent.book.path); link.replaceChildren(document.createTextNode(finished ? '再次打开 ' : '继续阅读 '));
      const arrow = el('span', '', '→'); arrow.setAttribute('aria-hidden', 'true'); link.append(arrow);
    }
  }
  function updateReadingState() {
    if (!state.loaded) return;
    const focused = document.activeElement;
    const focusHref = focused?.matches('.book-card, #resume-book') ? focused.getAttribute('href') : null;
    render(); resume();
    // Progress events from the child frame can arrive after the reader closes.
    // Preserve focus when that refresh replaces the card just focused on return.
    if (focusHref && !focused.isConnected) {
      const selector = focused.id === 'resume-book' ? '#resume-book' : '.book-card';
      const target = [...document.querySelectorAll(selector)].find(link => link.getAttribute('href') === focusHref) || $('#book-search');
      target.focus({ preventScroll: true });
    }
  }
  async function load(refresh = false) {
    $('#refresh-books').disabled = true;
    $('#shelf-status').textContent = refresh ? '正在刷新书架…' : '正在整理书架，请稍等…';
    $('#book-grid').setAttribute('aria-busy', 'true');
    try {
      if (!library) throw new Error('书架组件未载入');
      const result = await library.load({ refresh }); state.books = result.books; state.loaded = true;
      $('#shelf-warning').hidden = !result.warning; $('#shelf-warning').textContent = result.warning || '';
      const selected = $('#category-filter').value;
      const all = el('option', '', '全部分类'); all.value = 'all';
      $('#category-filter').replaceChildren(all, ...[...new Set(state.books.map(book => book.category))].sort((a,b) => a.localeCompare(b,'zh-CN')).map(name => { const option = el('option','',name); option.value = name; return option; }));
      $('#category-filter').value = [...$('#category-filter').options].some(o => o.value === selected) ? selected : 'all';
      render(); resume(); $('#shelf-status').textContent = '';
    } catch { $('#shelf-status').textContent = '暂时无法打开书架，请点击刷新再试。'; }
    finally { $('#refresh-books').disabled = false; $('#book-grid').setAttribute('aria-busy', 'false'); }
  }
  $('#book-search').addEventListener('input', render);
  $('#format-filter').addEventListener('change', render);
  $('#category-filter').addEventListener('change', render);
  $('#book-sort').addEventListener('change', render);
  document.querySelectorAll('[data-reading-status]').forEach(button => button.addEventListener('click', () => { state.status = button.dataset.readingStatus; render(); }));
  $('#refresh-books').addEventListener('click', () => load(true));
  window.addEventListener('pageshow', updateReadingState);
  window.addEventListener('focus', updateReadingState);
  window.addEventListener('reading-progress-updated', updateReadingState);
  window.addEventListener('storage', event => { if (event.key === null || event.key?.startsWith('fm-reading:')) updateReadingState(); });
  if (location.hash === '#add-books') $('#add-books').open = true;
  load();
})();
