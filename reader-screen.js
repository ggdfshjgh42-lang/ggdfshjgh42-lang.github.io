/* Open the reader without a navigation so the book click can request fullscreen. */
(() => {
  'use strict';
  const button = document.getElementById('fullscreen-toggle');
  const origin = location.origin;
  const embedded = !!button && window.parent !== window && new URLSearchParams(location.search).get('embedded') === '1';
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
  function requestScreen(element) {
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    try { return Promise.resolve(request && (element.requestFullscreen ? request.call(element, { navigationUI: 'hide' }) : request.call(element))).catch(() => {}); }
    catch { return Promise.resolve(); }
  }
  function exitScreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    try { return Promise.resolve(exit && exit.call(document)).catch(() => {}); }
    catch { return Promise.resolve(); }
  }
  function updateButton(active) {
    if (!button) return;
    button.textContent = active ? '退出全屏' : '全屏';
    button.setAttribute('aria-pressed', String(active));
    button.title = active ? '退出全屏（Esc）' : '进入全屏';
  }
  if (button) {
    button.hidden = !(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
    button.addEventListener('click', () => {
      // Calling the parent directly retains the trusted click's user activation.
      if (embedded && window.parent.BookReaderScreen) window.parent.BookReaderScreen.toggle();
      else if (fullscreenElement()) exitScreen();
      else requestScreen(document.documentElement);
    });
    if (embedded) {
      document.querySelectorAll('a[href="bookshelf.html"]').forEach(link => link.addEventListener('click', event => {
        event.preventDefault();
        window.dispatchEvent(new Event('pagehide'));
        window.parent.postMessage({ type: 'fm-reader-close' }, origin);
      }));
      window.addEventListener('message', event => {
        if (event.origin === origin && event.source === window.parent && event.data?.type === 'fm-reader-screen') updateButton(event.data.active);
      });
      window.parent.postMessage({ type: 'fm-reader-ready' }, origin);
    } else {
      document.addEventListener('fullscreenchange', () => updateButton(!!fullscreenElement()));
      document.addEventListener('webkitfullscreenchange', () => updateButton(!!fullscreenElement()));
      updateButton(!!fullscreenElement());
    }
    return;
  }

  if (!document.getElementById('book-grid')) return;
  let active = null;
  function publishScreen() {
    if (active) active.frame.contentWindow?.postMessage({ type: 'fm-reader-screen', active: !!fullscreenElement() }, origin);
  }
  function removeReader() {
    const previous = active;
    if (!previous) return;
    active = null;
    // Persist even when the reader is closed with the browser's Back button.
    try { previous.frame.contentWindow.dispatchEvent(new Event('pagehide')); } catch { /* A failed frame can still be closed. */ }
    if (fullscreenElement() === previous.overlay) exitScreen();
    previous.overlay.remove();
    previous.siblings.forEach(([node, inert]) => { node.inert = inert; });
    document.body.style.overflow = previous.overflow;
    document.title = previous.title;
    window.dispatchEvent(new Event('reading-progress-updated'));
    // Shelf rendering replaces card nodes when it refreshes reading progress.
    const restoreFocus = () => {
      if (active) return;
      const triggerHref = previous.trigger?.getAttribute('href');
      const focusTarget = previous.trigger?.isConnected ? previous.trigger :
        [...document.querySelectorAll('a[href]')].find(link => triggerHref && link.getAttribute('href') === triggerHref) || document.getElementById('book-search');
      focusTarget?.focus({ preventScroll: true });
    };
    restoreFocus();
    // History traversal can restore focus again after the popstate callback.
    requestAnimationFrame(restoreFocus);
  }
  function openReader(url, trigger, push = true) {
    if (active) return;
    const overlay = document.createElement('div');
    overlay.className = 'reading-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '在线阅读');
    const frame = document.createElement('iframe');
    frame.title = '在线阅读器';
    frame.allow = 'fullscreen';
    const frameURL = new URL(url);
    frameURL.searchParams.set('embedded', '1');
    frame.src = frameURL.href;
    overlay.append(frame);
    const siblings = [...document.body.children].map(node => [node, node.inert]);
    active = { overlay, frame, siblings, trigger, overflow: document.body.style.overflow, title: document.title };
    document.body.append(overlay);
    siblings.forEach(([node]) => { node.inert = true; });
    document.body.style.overflow = 'hidden';
    if (push) history.pushState({ fmReader: true }, '', url);
    frame.addEventListener('load', () => { if (active?.frame === frame) { publishScreen(); frame.focus(); } });
    frame.focus();
    // The viewport overlay is also the fallback on phones without Fullscreen API.
    if (push) requestScreen(overlay).then(publishScreen);
  }
  window.BookReaderScreen = Object.freeze({
    toggle() { if (active) { if (fullscreenElement()) exitScreen(); else requestScreen(active.overlay).then(publishScreen); } }
  });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.download || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, location.href);
    const readerPath = new URL('reader.html', location.href).pathname;
    if (url.origin !== origin || url.pathname !== readerPath || !window.BookLibrary?.validPath(url.searchParams.get('book'))) return;
    event.preventDefault();
    openReader(url.href, link);
  });
  window.addEventListener('message', event => {
    if (!active || event.origin !== origin || event.source !== active.frame.contentWindow) return;
    if (event.data?.type === 'fm-reader-ready') publishScreen();
    else if (event.data?.type === 'fm-reader-close') history.back();
  });
  window.addEventListener('popstate', () => {
    if (active) removeReader();
    else if (history.state?.fmReader) openReader(location.href, null, false);
  });
  document.addEventListener('fullscreenchange', publishScreen);
  document.addEventListener('webkitfullscreenchange', publishScreen);
})();
