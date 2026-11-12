/* Online reader. Book content is untrusted: keep it inside a script-free,
   network-free frame and construct its markup from an explicit allowlist. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const library = window.BookLibrary;
  const frame = $('reading-frame');
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { book: null, chapters: [], chapter: 0, ratio: 0, zip: null, pdf: null, page: 1, zoom: 1, textBytes: null, blobs: [], saving: false, ready: false, renderToken: 0, storageWarned: false };
  const savedSettings = library ? library.loadSettings() : {};
  const settings = { theme: ['paper','light','dark'].includes(savedSettings.theme) ? savedSettings.theme : 'paper', fontSize: clamp(savedSettings.fontSize || 18, 14, 30) };
  let saveTimer, toastTimer, resizeTimer, controlsTimer;
  let keyboardControls = false;
  const controlsHidden = () => document.body.classList.contains('reader-controls-hidden');
  const immersive = () => document.body.classList.contains('reader-immersive');
  const chrome = [$('reader-topbar'), $('reader-footer')];

  function scheduleControlsHide() {
    clearTimeout(controlsTimer);
    if (!immersive() || controlsHidden()) return;
    controlsTimer = setTimeout(() => {
      // A directory or a keyboard/text-input interaction must stay usable.
      if (!$('reader-sidebar').hidden || keyboardControls || document.activeElement?.matches('input, select, textarea')) return;
      setReaderControls(false);
    }, 4000);
  }
  function setReaderControls(visible) {
    if (!visible && !immersive()) return;
    clearTimeout(controlsTimer);
    if (!visible && [...chrome, $('reader-sidebar'), $('reader-controls-toggle')].some(node => node.contains(document.activeElement))) $('reader-stage').focus({preventScroll:true});
    document.body.classList.toggle('reader-controls-hidden', !visible);
    chrome.forEach(node => {
      node.inert = !visible;
      if (visible) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', 'true');
    });
    $('reader-controls-toggle').setAttribute('aria-expanded', String(visible));
    $('reader-controls-toggle').textContent = visible ? '收起阅读菜单' : '显示阅读菜单';
    if (visible) scheduleControlsHide();
    else closeDirectory();
  }
  function enterReadingMode() {
    if (immersive()) return;
    document.body.classList.add('reader-immersive');
    setReaderControls(false);
  }
  function bindReadingSurface(surface, selection) {
    let gesture;
    surface.addEventListener('pointerdown', event => {
      keyboardControls = false;
      gesture = event.isPrimary && event.button === 0 ? {id:event.pointerId, x:event.clientX, y:event.clientY, time:event.timeStamp, moved:false} : null;
    }, {passive:true});
    surface.addEventListener('pointermove', event => {
      if (gesture && event.pointerId === gesture.id && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 10) gesture.moved = true;
    }, {passive:true});
    surface.addEventListener('pointercancel', () => { if (gesture) gesture.moved = true; }, {passive:true});
    surface.addEventListener('click', event => {
      if (!immersive() || event.defaultPrevented || event.detail > 1 || event.target.closest('a, button, input, select, textarea, label, [contenteditable]')) return;
      if (event.detail && (!gesture || gesture.moved || event.timeStamp - gesture.time > 600)) return;
      if (selection()?.isCollapsed === false) return;
      setReaderControls(controlsHidden());
    });
    surface.addEventListener('scroll', () => {
      // Font changes and restoring progress also scroll the document. Only a
      // reading gesture should dismiss the menu during those operations.
      if (gesture?.moved) setReaderControls(false);
    }, {passive:true, capture:true});
    surface.addEventListener('wheel', () => setReaderControls(false), {passive:true});
  }

  function toast(message) {
    $('reader-toast').textContent = message;
    $('reader-toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('reader-toast').classList.remove('visible'), 3500);
  }
  function message(title, detail, retry = false) {
    setReaderControls(true);
    $('reader-message').hidden = false;
    $('message-title').textContent = title;
    $('message-detail').textContent = detail;
    $('reader-retry').hidden = !retry;
    frame.hidden = true;
    $('pdf-view').hidden = true;
  }
  function errorMessage(error) {
    console.error('Reading failed:', error);
    state.ready = false;
    $('previous-chapter').disabled = true;
    $('next-chapter').disabled = true;
    message('这本书暂时打不开', error && error.message ? error.message : '请检查书籍文件是否完整，再重新打开。', true);
  }
  function closeDirectory() {
    $('reader-sidebar').hidden = true;
    $('sidebar-backdrop').hidden = true;
    $('directory-toggle').setAttribute('aria-expanded', 'false');
    scheduleControlsHide();
  }
  function openDirectory() {
    setReaderControls(true);
    clearTimeout(controlsTimer);
    $('reader-sidebar').hidden = false;
    $('sidebar-backdrop').hidden = false;
    $('directory-toggle').setAttribute('aria-expanded', 'true');
  }
  function themeCSS() {
    const colors = settings.theme === 'dark' ? ['#202b23','#dce5d8','#a0af9f','#b3ce94','#3b493d'] : settings.theme === 'light' ? ['#fff','#292d29','#727872','#356344','#e0e4e0'] : ['#fffefa','#25372d','#667066','#356344','#dfe4d7'];
    return `:root{color-scheme:${settings.theme === 'dark' ? 'dark' : 'light'};background:${colors[0]};color:${colors[1]};font-size:${settings.fontSize}px}*{box-sizing:border-box}html{overflow-wrap:anywhere;scroll-behavior:auto;scrollbar-color:${colors[4]} ${colors[0]};scrollbar-width:none}html::-webkit-scrollbar{display:none}body{max-width:800px;margin:0 auto;padding:48px 54px 70px;font-family:"Noto Serif SC","Songti SC",SimSun,serif;line-height:2;letter-spacing:.02em}p{margin:0 0 1em}h1,h2,h3,h4,h5,h6{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-weight:600;line-height:1.6;margin:1.6em 0 1em}h1:first-child,h2:first-child{margin-top:0}h1{font-size:1.65em}h2{font-size:1.35em}h3{font-size:1.15em}a{color:${colors[3]};text-underline-offset:3px}img{max-width:100%;height:auto;display:block;margin:1.5em auto}figure{margin:1.5em 0}figcaption{font-size:.8em;color:${colors[2]};text-align:center}blockquote{border-left:3px solid ${colors[4]};padding-left:1em;margin:1.5em 0;color:${colors[2]}}pre{overflow-x:auto;white-space:pre-wrap;font-size:.8em;border:1px solid ${colors[4]};padding:1em;border-radius:8px}table{display:block;overflow-x:auto;border-collapse:collapse;font-size:.85em;margin:1.5em 0}td,th{border:1px solid ${colors[4]};padding:.45em .7em}hr{border:0;border-top:1px solid ${colors[4]};margin:2em 0}ul,ol{padding-left:1.5em}li{margin:.35em 0}ruby{ruby-align:center}rt{font-size:.55em}.txt-paragraph{text-indent:2em;white-space:pre-wrap}.reader-chapter-title{font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:1.4em;line-height:1.6;margin:0 0 2em}.reader-end{margin-top:3em;text-align:center;font-size:.75em;color:${colors[2]}}@media(max-width:600px){body{padding:30px 23px 55px;line-height:1.95}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;
  }
  function applySettings() {
    document.body.dataset.theme = settings.theme;
    $('font-size').textContent = settings.fontSize;
    document.querySelectorAll('[data-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.theme === settings.theme)));
    const style = frame.contentDocument && frame.contentDocument.getElementById('reader-theme');
    if (style) {
      const ratio = frameRatio();
      style.textContent = themeCSS();
      requestAnimationFrame(() => restoreRatio(ratio));
    }
    if (library) library.saveSettings(settings);
  }
  function frameRatio() {
    const doc = frame.contentDocument;
    if (!doc) return state.ratio;
    const scrolling = doc.scrollingElement || doc.documentElement;
    const distance = scrolling.scrollHeight - scrolling.clientHeight;
    // A complete chapter that fits on screen has been fully displayed. Keeping
    // its previous zero ratio would make short final chapters impossible to finish.
    return distance > 3 ? clamp(scrolling.scrollTop / distance, 0, 1) : doc.getElementById('reader-theme') ? 1 : state.ratio;
  }
  function restoreRatio(ratio) {
    const doc = frame.contentDocument;
    if (!doc) return;
    const scrolling = doc.scrollingElement || doc.documentElement;
    scrolling.scrollTop = clamp(ratio, 0, 1) * Math.max(0, scrolling.scrollHeight - scrolling.clientHeight);
  }
  function updateProgress(ratio = state.ratio) {
    let progress;
    if (state.pdf) progress = state.page / state.pdf.numPages;
    else progress = (state.chapter + clamp(ratio, 0, 1)) / Math.max(1, state.chapters.length);
    const percentage = Math.round(clamp(progress, 0, 1) * 100);
    $('reading-progress').setAttribute('aria-valuenow', percentage);
    $('reading-progress-fill').style.width = percentage + '%';
    $('progress-status').textContent = percentage + '% · 进度保存在当前设备';
    return progress;
  }
  function persist() {
    if (!state.ready || !state.book || !library) return;
    if (!state.pdf) state.ratio = frameRatio();
    const record = { title: state.book.title, format: state.book.format, chapter: state.chapter, scrollRatio: state.ratio, page: state.page, progress: updateProgress(), encoding: $('text-encoding').value };
    if (!library.saveProgress(state.book.path, record) && !state.storageWarned) {
      state.storageWarned = true;
      toast('浏览器未允许保存进度，本次阅读仍可继续。');
    }
  }
  function scheduleSave() {
    if (!state.ready) return;
    state.ratio = frameRatio();
    updateProgress();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 300);
  }
  function updateButtons() {
    const current = state.pdf ? state.page - 1 : state.chapter;
    const count = state.pdf ? state.pdf.numPages : state.chapters.length;
    $('previous-chapter').disabled = current <= 0;
    $('next-chapter').disabled = current >= count - 1;
    document.querySelectorAll('#chapter-list button').forEach((button, i) => {
      if (i === current) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    });
  }
  function fillDirectory() {
    const list = $('chapter-list');
    list.replaceChildren();
    const items = state.pdf ? Array.from({length:state.pdf.numPages}, (_, i) => ({title:'第 ' + (i + 1) + ' 页'})) : state.chapters;
    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.title || '第 ' + (index + 1) + ' 章';
      button.addEventListener('click', () => { persist(); (state.pdf ? showPDFPage(index + 1) : showChapter(index)).catch(errorMessage); closeDirectory(); setReaderControls(false); });
      li.append(button); fragment.append(li);
    });
    list.append(fragment);
    $('directory-info').textContent = items.length + (state.pdf ? ' 页 · 点击跳转' : ' 个章节 · 点击阅读');
    updateButtons();
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src; script.onload = resolve;
      script.onerror = () => reject(new Error('阅读组件未能载入，请刷新页面后重试。'));
      document.head.append(script);
    });
  }
  async function fetchBytes() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
    try {
      const response = await fetch(library.urlFor(state.book.path), {signal:controller.signal});
      if (!response.ok) throw new Error(response.status === 404 ? '没有找到书籍文件。刚上传的书籍请等待网站发布完成后再试。' : '书籍加载失败，请检查网络后重试。');
      if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024) throw new Error('这本书超过 100 MB，建议用原文件入口打开。');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 100 * 1024 * 1024) throw new Error('这本书超过 100 MB，建议用原文件入口打开。');
      return bytes;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('加载书籍超时，请检查网络后重试。');
      throw error;
    } finally { clearTimeout(timer); }
  }

  function xml(text) {
    const parsed = new DOMParser().parseFromString(text.replace(/<!DOCTYPE[\s\S]*?>/gi, ''), 'application/xml');
    if (parsed.querySelector('parsererror')) throw new Error('书籍目录数据不完整，无法解析。');
    return parsed;
  }
  const all = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));
  function archivePath(base, href) {
    if (typeof href !== 'string' || !href || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return null;
    try {
      const url = new URL(href, new URL(base, 'https://book.invalid/'));
      if (url.origin !== 'https://book.invalid' || url.search) return null;
      return { path: decodeURIComponent(url.pathname.slice(1)), hash: decodeURIComponent(url.hash.slice(1)) };
    } catch { return null; }
  }
  async function zipText(path) {
    const entry = state.zip.file(path);
    if (!entry) throw new Error('EPUB 内缺少所需文件：' + path);
    const text = await entry.async('string');
    if (text.length > 12 * 1024 * 1024) throw new Error('书籍的单个章节过大，建议使用本地阅读器。');
    return text;
  }
  async function loadEPUB(bytes) {
    if (!window.JSZip) await loadScript('vendor/jszip.min.js');
    try { state.zip = await window.JSZip.loadAsync(bytes); }
    catch { throw new Error('EPUB 文件无法解压，请检查文件是否完整。'); }
    const entries = Object.values(state.zip.files);
    if (entries.length > 12000 || entries.reduce((total, entry) => total + (entry._data && entry._data.uncompressedSize || 0), 0) > 200 * 1024 * 1024) throw new Error('EPUB 解压后的内容过大，建议使用本地阅读器。');
    if (state.zip.file('META-INF/encryption.xml')) {
      const encrypted = await zipText('META-INF/encryption.xml');
      if (/EncryptedData/i.test(encrypted) && !/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/i.test(encrypted)) throw new Error('这本 EPUB 含有受保护的内容，请使用其授权阅读器。');
    }
    const container = xml(await zipText('META-INF/container.xml'));
    const root = all(container, 'rootfile')[0];
    const packagePath = root && root.getAttribute('full-path');
    if (!packagePath) throw new Error('EPUB 缺少内容索引。');
    const opf = xml(await zipText(packagePath));
    const manifest = new Map(all(opf, 'item').map(item => [item.getAttribute('id'), item]));
    const title = all(opf, 'title')[0];
    if (title && title.textContent.trim()) {
      state.book.title = title.textContent.trim(); $('book-title').textContent = state.book.title;
      document.title = state.book.title + ' · 在线阅读';
    }
    const labels = new Map();
    const nav = Array.from(manifest.values()).find(item => /(?:^|\s)nav(?:\s|$)/.test(item.getAttribute('properties') || ''));
    if (nav) {
      const navPath = archivePath(packagePath, nav.getAttribute('href'));
      if (navPath) {
        const template = document.createElement('template');
        template.innerHTML = await zipText(navPath.path);
        template.content.querySelectorAll('a[href]').forEach(a => { const target = archivePath(navPath.path, a.getAttribute('href')); if (target && !labels.has(target.path)) labels.set(target.path, a.textContent.trim()); });
      }
    } else {
      const ncx = Array.from(manifest.values()).find(item => item.getAttribute('media-type') === 'application/x-dtbncx+xml');
      if (ncx) {
        const ncxPath = archivePath(packagePath, ncx.getAttribute('href'));
        if (ncxPath) {
          const doc = xml(await zipText(ncxPath.path));
          all(doc, 'navPoint').forEach(point => { const content = all(point, 'content')[0], label = all(point, 'text')[0]; const target = content && archivePath(ncxPath.path, content.getAttribute('src')); if (target && label && !labels.has(target.path)) labels.set(target.path, label.textContent.trim()); });
        }
      }
    }
    state.chapters = all(opf, 'itemref').filter(ref => ref.getAttribute('linear') !== 'no').map(ref => {
      const item = manifest.get(ref.getAttribute('idref'));
      if (!item || !/html|xhtml/.test(item.getAttribute('media-type') || '')) return null;
      const resolved = archivePath(packagePath, item.getAttribute('href'));
      return resolved && { path: resolved.path, title: labels.get(resolved.path) || '', kind:'epub' };
    }).filter(Boolean);
    if (!state.chapters.length) throw new Error('这本 EPUB 没有可阅读的章节。');
    state.chapters.forEach((chapter, i) => { if (!chapter.title) chapter.title = '第 ' + (i + 1) + ' 节'; });
  }

  const allowedTags = new Set('p div span section article header footer main aside h1 h2 h3 h4 h5 h6 strong b em i u s del sup sub br hr blockquote pre code ul ol li dl dt dd table thead tbody tfoot tr th td caption figure figcaption ruby rt rp small mark a img'.split(' '));
  const droppedTags = new Set('script style title iframe frame frameset object embed form input button select textarea link meta base noscript template svg math video audio source track canvas'.split(' '));
  async function sanitizeEPUB(text, chapterPath) {
    // Template contents stay inert while being inspected: even image and frame
    // resources cannot load before the allowlisted output is constructed.
    const source = document.createElement('template');
    source.innerHTML = text;
    const output = document.implementation.createHTMLDocument('');
    const body = output.createElement('div');
    const imageJobs = [];
    function walk(node, parent) {
      if (node.nodeType === Node.TEXT_NODE) { parent.append(output.createTextNode(node.textContent)); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.localName.toLowerCase();
      if (droppedTags.has(tag)) return;
      if (!allowedTags.has(tag)) { Array.from(node.childNodes).forEach(child => walk(child, parent)); return; }
      const clean = output.createElement(tag);
      const id = node.getAttribute('id');
      if (id && id.length < 300) clean.id = id;
      if (node.getAttribute('lang')) clean.lang = node.getAttribute('lang').slice(0, 24);
      if (node.getAttribute('dir') === 'rtl') clean.dir = 'rtl';
      if (tag === 'td' || tag === 'th') for (const attribute of ['colspan','rowspan']) { const count = clamp(node.getAttribute(attribute), 1, 100); if (count > 1) clean.setAttribute(attribute, count); }
      if (tag === 'a') {
        const destination = archivePath(chapterPath, node.getAttribute('href'));
        if (destination) { clean.href = '#'; clean.dataset.bookPath = destination.path; clean.dataset.bookHash = destination.hash; }
      }
      if (tag === 'img') {
        clean.alt = node.getAttribute('alt') || '';
        const sourcePath = archivePath(chapterPath, node.getAttribute('src'));
        if (!sourcePath || !/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(sourcePath.path)) return;
        const entry = state.zip.file(sourcePath.path);
        if (!entry || (entry._data && entry._data.uncompressedSize > 20 * 1024 * 1024)) return;
        imageJobs.push(entry.async('uint8array').then(bytes => {
          if (bytes.length > 20 * 1024 * 1024) return;
          const extension = sourcePath.path.split('.').pop().toLowerCase();
          const type = extension === 'jpg' ? 'image/jpeg' : 'image/' + extension;
          const url = URL.createObjectURL(new Blob([bytes], {type})); state.blobs.push(url); clean.src = url;
        }));
      }
      parent.append(clean);
      Array.from(node.childNodes).forEach(child => walk(child, clean));
    }
    Array.from(source.content.childNodes).forEach(node => walk(node, body));
    await Promise.all(imageJobs);
    return body.innerHTML;
  }

  function decodeText(bytes, encoding) {
    if (encoding !== 'auto') return new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, '');
    if (bytes[0] === 255 && bytes[1] === 254) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 254 && bytes[1] === 255) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes).replace(/^\uFEFF/, ''); }
    catch { return new TextDecoder('gb18030').decode(bytes); }
  }
  function loadTXT(bytes, encoding) {
    const text = decodeText(bytes, encoding).replace(/\r\n?/g, '\n');
    if (!text.trim()) throw new Error('这个 TXT 文件暂时没有文字。');
    const lines = text.split('\n');
    const heading = line => /^(?:第[零〇一二三四五六七八九十百千万两\d]{1,15}[章节卷回部篇集]|(?:chapter|part|book)\s+[\divxlc]+\b|序言$|前言$|后记$|尾声$|楔子$)/i.test(line.trim()) && line.trim().length < 100;
    const chapters = [];
    let current = {title:'正文', lines:[], kind:'txt'}, count = 0;
    function push() { if (current.lines.some(line => line.trim())) { chapters.push(current); current = {title:'正文 · ' + (chapters.length + 1), lines:[], kind:'txt'}; count = 0; } }
    for (const line of lines) {
      if (heading(line)) { push(); current.title = line.trim(); }
      else if (count > 24000 && !heading(current.title)) push();
      current.lines.push(line); count += line.length;
    }
    push(); state.chapters = chapters;
  }
  function textMarkup(chapter) {
    return '<h1 class="reader-chapter-title">' + escape(chapter.title) + '</h1>' + chapter.lines.map((line, index) => index === 0 && line.trim() === chapter.title ? '' : line.trim() ? '<p class="txt-paragraph">' + escape(line) + '</p>' : '').join('');
  }

  async function showChapter(index, ratio = 0, hash = '') {
    const token = ++state.renderToken;
    state.ready = false;
    state.blobs.forEach(url => URL.revokeObjectURL(url));
    state.blobs = [];
    index = clamp(index, 0, state.chapters.length - 1);
    state.chapter = index; state.ratio = clamp(ratio, 0, 1);
    const chapter = state.chapters[index];
    let content;
    if (chapter.kind === 'txt') content = textMarkup(chapter);
    else content = await sanitizeEPUB(await zipText(chapter.path), chapter.path);
    if (token !== state.renderToken) return;
    $('reader-message').hidden = true; frame.hidden = false; $('pdf-view').hidden = true;
    $('chapter-status').textContent = chapter.title + ' · ' + (index + 1) + ' / ' + state.chapters.length;
    const documentText = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; img-src blob:; style-src \'unsafe-inline\'; font-src \'none\'; connect-src \'none\'; form-action \'none\'; base-uri \'none\'"><meta name="referrer" content="no-referrer"><style id="reader-theme">' + themeCSS() + '</style><title>' + escape(chapter.title) + '</title></head><body>' + content + '<p class="reader-end">✳ · 本节结束</p></body></html>';
    await new Promise(resolve => {
      frame.onload = () => {
        if (token !== state.renderToken) { resolve(); return; }
        const doc = frame.contentDocument;
        bindReadingSurface(doc, () => doc.getSelection());
        enterReadingMode();
        const restore = () => { restoreRatio(state.ratio); if (hash) { const target = doc.getElementById(hash); if (target) target.scrollIntoView(); } };
        restore(); requestAnimationFrame(restore);
        doc.addEventListener('scroll', scheduleSave, {passive:true});
        doc.addEventListener('click', event => {
          const anchor = event.target.closest('a');
          if (!anchor) return;
          event.preventDefault();
          const path = anchor.dataset.bookPath, targetHash = anchor.dataset.bookHash;
          if (!path) return;
          if (path === chapter.path && targetHash) { const target = doc.getElementById(targetHash); if (target) target.scrollIntoView(); return; }
          const targetChapter = state.chapters.findIndex(item => item.path === path);
          if (targetChapter >= 0) { persist(); showChapter(targetChapter, 0, targetHash).catch(errorMessage); }
        });
        doc.addEventListener('keydown', keyboard);
        state.ready = true; updateButtons(); updateProgress(state.ratio); persist(); resolve();
      };
      frame.srcdoc = documentText;
    });
  }

  async function loadPDF() {
    let pdfjs;
    // The legacy build includes the compatibility code needed by both the page
    // and its worker. Keep their versions together when a browser has cached
    // the previous reader assets.
    try { pdfjs = await import('./vendor/pdfjs/pdf.mjs?v=5.6.205-legacy-1'); }
    catch (error) {
      console.error('PDF component failed:', error);
      throw new Error('PDF 阅读组件未能载入。请刷新后重试，或通过上方「原文件」打开。');
    }
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.mjs?v=5.6.205-legacy-1', location.href).href;
    let task, timer;
    try {
      task = pdfjs.getDocument({url:library.urlFor(state.book.path),isEvalSupported:false,enableXfa:false,useSystemFonts:true,cMapUrl:new URL('vendor/pdfjs/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('vendor/pdfjs/standard_fonts/',location.href).href,wasmUrl:new URL('vendor/pdfjs/wasm/',location.href).href});
      task.onProgress = ({loaded, total}) => {
        $('message-detail').textContent = total > 0 ? '正在载入 PDF：' + Math.min(100, Math.round(loaded / total * 100)) + '%' : '正在载入 PDF，请稍等。';
      };
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error('加载 PDF 超时，请检查网络后重新打开。');
          error.name = 'TimeoutError';
          reject(error);
        }, 90000);
      });
      state.pdf = await Promise.race([task.promise, timeout]);
    } catch (error) {
      console.error('PDF loading failed:', error);
      if (task) task.destroy().catch(() => {});
      if (error.name === 'PasswordException') throw new Error('这份 PDF 需要密码，请通过「原文件」在支持密码的阅读器中打开。');
      if (error.name === 'TimeoutError') throw error;
      if (error.status === 404 || error.name === 'MissingPDFException') throw new Error('没有找到 PDF 文件。刚上传的书籍请等待网站发布完成后再试。');
      if (error.name === 'InvalidPDFException') throw new Error('这份文件不是有效的 PDF，或文件已损坏。请检查原文件后重新上传。');
      throw new Error('PDF 未能载入，请检查网络后重试，也可以通过「原文件」打开。');
    } finally { clearTimeout(timer); }
    $('font-tools').hidden = true; $('pdf-tools').hidden = false; $('page-label').hidden = false;
    $('chapter-status').hidden = true;
    $('page-total').textContent = state.pdf.numPages;
    $('page-number').max = state.pdf.numPages;
    $('previous-chapter').querySelector('span').textContent = '上一页';
    $('next-chapter').querySelector('span').textContent = '下一页';
    fillDirectory();
  }
  let pdfRenderTask;
  async function showPDFPage(pageNumber) {
    const token = ++state.renderToken;
    const targetPage = Math.floor(clamp(pageNumber, 1, state.pdf.numPages));
    // Record the requested destination immediately so a zoom/resize arriving
    // while cancellation is pending keeps the reader on that destination.
    state.page = targetPage;
    state.ready = false;
    try {
      // Several fast page/zoom changes may be waiting for the same old render.
      // Only the newest request may resize and reuse the shared canvas.
      const previousTask = pdfRenderTask;
      if (previousTask) {
        previousTask.cancel();
        try { await previousTask.promise; } catch {}
        if (pdfRenderTask === previousTask) pdfRenderTask = null;
      }
      if (token !== state.renderToken) return;
      const page = await state.pdf.getPage(targetPage);
      if (token !== state.renderToken) return;
      $('reader-message').hidden = true; frame.hidden = true; $('pdf-view').hidden = false;
      enterReadingMode();
      const viewport = page.getViewport({scale:1});
      // Read the actual padding: immersive mode removes the old PDF surround.
      const padding = getComputedStyle($('pdf-view'));
      const available = $('pdf-view').clientWidth - parseFloat(padding.paddingLeft) - parseFloat(padding.paddingRight);
      const width = Math.max(240, Math.min(available, 850)) * state.zoom;
      const scaled = page.getViewport({scale:width / viewport.width});
      // Stay within common mobile canvas limits, including unusually long pages.
      const density = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(16 * 1024 * 1024 / (scaled.width * scaled.height)), 8192 / scaled.width, 8192 / scaled.height);
      const canvas = $('pdf-canvas');
      canvas.width = Math.max(1, Math.floor(scaled.width * density)); canvas.height = Math.max(1, Math.floor(scaled.height * density));
      canvas.style.width = Math.ceil(scaled.width) + 'px'; canvas.style.height = Math.ceil(scaled.height) + 'px';
      canvas.setAttribute('aria-label', state.book.title + '，第 ' + targetPage + ' 页');
      const renderTask = page.render({canvas,viewport:scaled,transform:density === 1 ? null : [density,0,0,density,0,0]});
      pdfRenderTask = renderTask;
      try { await renderTask.promise; }
      finally { if (pdfRenderTask === renderTask) pdfRenderTask = null; }
      if (token !== state.renderToken) return;
      $('pdf-view').scrollTop = 0;
      $('page-number').value = targetPage;
      $('pdf-zoom').textContent = Math.round(state.zoom * 100) + '%';
      state.ready = true; updateButtons(); persist();
      $('pdf-text').textContent = '';
      try {
        const text = await page.getTextContent();
        if (token === state.renderToken) $('pdf-text').textContent = text.items.map(item => item.str).join(' ');
      } catch (error) { console.warn('PDF text could not be extracted:', error); }
    } catch (error) {
      if (token !== state.renderToken || error.name === 'RenderingCancelledException') return;
      throw error;
    }
  }
  function keyboard(event) {
    if (event.key === 'Tab' && immersive()) {
      keyboardControls = true;
      if (controlsHidden()) {
        event.preventDefault();
        setReaderControls(true);
        $('reader-controls-toggle').focus({preventScroll:true});
      }
      return;
    }
    if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key)) setReaderControls(false);
    if (event.key === 'Escape') { closeDirectory(); setReaderControls(false); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); $('next-chapter').click(); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); $('previous-chapter').click(); }
  }
  async function start() {
    applySettings();
    if (!library) throw new Error('书架组件未载入，请刷新后重试。');
    const path = new URLSearchParams(location.search).get('book');
    if (!path) { message('今天，想读哪一本？','从书架挑一本喜欢的书，就可以开始阅读。'); return; }
    state.book = await library.resolveBook(path);
    const book = state.book;
    $('book-title').textContent = book.title;
    $('book-format').textContent = book.format.toUpperCase() + ' / FANTASTIC MATRIX';
    document.title = book.title + ' · 在线阅读';
    $('original-link').href = library.urlFor(book.path); $('original-link').hidden = false;
    const saved = library.readProgress(book.path) || {};
    if (book.format === 'pdf') {
      await loadPDF(); await showPDFPage(saved.page || 1);
    } else {
      const bytes = await fetchBytes();
      if (book.format === 'epub') await loadEPUB(bytes);
      else if (book.format === 'txt') {
        state.textBytes = bytes;
        $('encoding-tool').hidden = false;
        $('text-encoding').value = ['auto','utf-8','gb18030','utf-16le'].includes(saved.encoding) ? saved.encoding : 'auto';
        loadTXT(bytes, $('text-encoding').value);
      } else throw new Error('请选择 EPUB、PDF 或 TXT 格式的书籍。');
      fillDirectory(); await showChapter(saved.chapter || 0, saved.scrollRatio || 0);
    }
  }
  $('directory-toggle').addEventListener('click', () => { $('reader-sidebar').hidden ? openDirectory() : closeDirectory(); });
  $('directory-close').addEventListener('click', closeDirectory);
  $('sidebar-backdrop').addEventListener('click', closeDirectory);
  $('font-smaller').addEventListener('click', () => { settings.fontSize = clamp(settings.fontSize - 1,14,30); applySettings(); });
  $('font-larger').addEventListener('click', () => { settings.fontSize = clamp(settings.fontSize + 1,14,30); applySettings(); });
  document.querySelectorAll('[data-theme]').forEach(button => button.addEventListener('click', () => { settings.theme = button.dataset.theme; applySettings(); }));
  $('previous-chapter').addEventListener('click', () => { persist(); (state.pdf ? showPDFPage(state.page - 1) : showChapter(state.chapter - 1)).catch(errorMessage); });
  $('next-chapter').addEventListener('click', () => { persist(); (state.pdf ? showPDFPage(state.page + 1) : showChapter(state.chapter + 1)).catch(errorMessage); });
  $('text-encoding').addEventListener('change', () => {
    const index = state.chapter, ratio = frameRatio();
    try { loadTXT(state.textBytes, $('text-encoding').value); fillDirectory(); showChapter(index,ratio).catch(errorMessage); }
    catch (error) { errorMessage(error); }
  });
  $('page-number').addEventListener('change', () => { if (state.pdf) showPDFPage($('page-number').value).catch(errorMessage); });
  $('zoom-in').addEventListener('click', () => { state.zoom = clamp(state.zoom + .25,.5,2); if (state.pdf) showPDFPage(state.page).catch(errorMessage); });
  $('zoom-out').addEventListener('click', () => { state.zoom = clamp(state.zoom - .25,.5,2); if (state.pdf) showPDFPage(state.page).catch(errorMessage); });
  $('reader-retry').addEventListener('click', () => location.reload());
  $('reader-controls-hide').addEventListener('click', () => setReaderControls(false));
  $('reader-controls-toggle').addEventListener('focus', () => { keyboardControls = true; setReaderControls(true); });
  $('reader-controls-toggle').addEventListener('click', () => setReaderControls(controlsHidden()));
  document.addEventListener('pointerdown', () => { keyboardControls = false; }, {passive:true});
  chrome.forEach(node => {
    node.addEventListener('pointerdown', scheduleControlsHide, {passive:true});
    node.addEventListener('click', scheduleControlsHide);
    node.addEventListener('input', scheduleControlsHide);
    node.addEventListener('focusout', scheduleControlsHide);
  });
  bindReadingSurface($('pdf-view'), () => document.getSelection());
  document.addEventListener('keydown', keyboard);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
  window.addEventListener('pagehide', persist);
  window.addEventListener('resize', () => {
    if (state.pdf && state.ready) { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => showPDFPage(state.page).catch(errorMessage),250); }
    else if (state.ready) restoreRatio(state.ratio);
  });
  start().catch(errorMessage);
})();
