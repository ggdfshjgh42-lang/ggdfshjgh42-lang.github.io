/* Shared catalog and local reading state. No GitHub credentials are required. */
(() => {
  'use strict';
  const repository = 'ggdfshjgh42-lang/ggdfshjgh42-lang.github.io';
  const branch = 'main';
  const cacheKey = 'fm-books-index-v1';
  const cacheAge = 5 * 60 * 1000;
  const formats = new Set(['epub', 'pdf', 'txt']);
  let current = null;
  let catalogPromise;
  const readLocal = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const writeLocal = (key, data) => { try { localStorage.setItem(key, JSON.stringify(data)); return true; } catch { return false; } };
  function validPath(path) {
    return typeof path === 'string' && path.startsWith('books/') && !/[\\\u0000-\u001f\u007f]/.test(path) && path.split('/').every(part => part && part !== '.' && part !== '..');
  }
  function urlFor(path) {
    if (!validPath(path)) throw new Error('书籍路径无效，请从书架重新选择。');
    return new URL(path.split('/').map(encodeURIComponent).join('/'), new URL('.', location.href)).href;
  }
  function normalize(entry) {
    if (!entry || !validPath(entry.path)) return null;
    const format = entry.path.split('.').pop().toLowerCase();
    if (!formats.has(format)) return null;
    const filename = entry.path.split('/').pop().replace(/\.[^.]+$/, '');
    const parts = filename.split(' - ');
    const folder = entry.path.slice(6).split('/').slice(0, -1).join(' / ');
    return {
      id: entry.path, path: entry.path,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : parts[0],
      author: typeof entry.author === 'string' ? entry.author.trim() : parts.slice(1).join(' - '),
      category: typeof entry.category === 'string' && entry.category.trim() ? entry.category.trim() : folder || '未分类',
      description: typeof entry.description === 'string' ? entry.description : '',
      cover: validPath(entry.cover) && /\.(png|jpe?g|webp|avif|gif)$/i.test(entry.cover) ? entry.cover : '',
      size: Math.max(0, Number(entry.size) || 0), format
    };
  }
  async function getJSON(url, timeout = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-cache', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        const error = new Error(response.status === 403 || response.status === 429 ? '书单同步暂时受限，请稍后再试。' : '暂时无法同步书单，请稍后再试。');
        error.status = response.status;
        throw error;
      }
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function catalog(refresh = false) {
    if (!catalogPromise || refresh) catalogPromise = getJSON(new URL('books/catalog.json', new URL('.', location.href)), 6000).then(data => {
      if (!data || !Array.isArray(data.books)) throw new Error('书籍资料格式有误。');
      return data.books.map(normalize).filter(Boolean);
    }).catch(() => []);
    return catalogPromise;
  }
  async function discover() {
    // GitHub Pages' existing Jekyll build emits this alongside the books.
    // The API fallback also allows a plain local server to preview the site.
    try {
      const generated = await getJSON(new URL('books/index.json', new URL('.', location.href)), 6000);
      if (generated.version !== 1 || !Array.isArray(generated.books)) throw new Error('书单尚未生成。');
      return { books: generated.books.map(normalize).filter(Boolean), warning: '' };
    } catch { /* An unprocessed Liquid template is expected during local previews. */ }
    const result = await getJSON(`https://api.github.com/repos/${repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    if (!Array.isArray(result.tree)) throw new Error('书单格式有误。');
    return { books: result.tree.filter(item => item.type === 'blob').map(normalize).filter(Boolean), warning: result.truncated ? '书单较大，目前只显示已同步的部分书籍。' : '' };
  }
  async function load({ refresh = false } = {}) {
    if (current && !refresh) return current;
    const cached = readLocal(cacheKey);
    const extrasPromise = catalog(refresh);
    let discovered;
    let warning = '';
    if (!refresh && cached && Array.isArray(cached.books) && Date.now() - cached.time < cacheAge) {
      discovered = cached.books.map(normalize).filter(Boolean);
    } else {
      try {
        const result = await discover();
        discovered = result.books;
        warning = result.warning;
        writeLocal(cacheKey, { time: Date.now(), books: discovered });
      } catch (error) {
        warning = error.name === 'AbortError' ? '书单同步超时，正在显示已保存的书籍。可以稍后刷新。' : (error.message || '书单同步失败。') + ' 正在显示已保存的书籍。';
        discovered = cached && Array.isArray(cached.books) ? cached.books.map(normalize).filter(Boolean) : null;
      }
    }
    const extras = await extrasPromise;
    const metadata = new Map(extras.map(book => [book.path, book]));
    const books = (discovered || extras).map(book => {
      const extra = metadata.get(book.path);
      return extra ? { ...book, ...extra, size: book.size || extra.size } : book;
    }).sort((a, b) => a.title.localeCompare(b.title, 'zh-CN', { numeric: true }));
    current = { books, warning };
    return current;
  }
  async function resolveBook(path) {
    const book = normalize({ path });
    if (!book) throw new Error('请选择 EPUB、PDF 或 TXT 书籍。');
    const extras = await catalog();
    return extras.find(item => item.path === path) || book;
  }
  function readProgress(path) {
    if (!validPath(path)) return null;
    const value = readLocal('fm-reading:' + path);
    return value && typeof value === 'object' && value.path === path ? value : null;
  }
  function saveProgress(path, data) {
    if (!validPath(path) || !data || typeof data !== 'object') return false;
    const old = readProgress(path) || {};
    return writeLocal('fm-reading:' + path, { ...old, ...data, path, progress: Math.max(0, Math.min(1, Number(data.progress ?? old.progress) || 0)), updatedAt: Date.now() });
  }
  window.BookLibrary = Object.freeze({
    repository, branch, load, normalize, validPath, urlFor, resolveBook, readProgress, saveProgress,
    loadSettings: () => readLocal('fm-reader-settings-v1') || {},
    saveSettings: settings => writeLocal('fm-reader-settings-v1', settings)
  });
})();
