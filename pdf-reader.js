/* Continuous PDF pages with bounded canvas memory and reader-local zoom. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PDFReading = api;
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';
  const GAP = 12;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number(n) || 0));
  function pageAt(layout, y) {
    let lo = 0, hi = layout.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (layout[mid].top <= y) lo = mid; else hi = mid - 1;
    }
    return y >= layout[lo].top + layout[lo].height && lo < layout.length - 1 ? lo + 1 : lo;
  }
  function pageWindow(layout, top, height) {
    const first = Math.max(0, pageAt(layout, top) - 1);
    const last = Math.min(layout.length - 1, pageAt(layout, top + height) + 1);
    return Array.from({length:last - first + 1}, (_, i) => first + i);
  }
  function layoutPages(ratios, width) {
    let top = 0;
    return ratios.map(ratio => {
      const page = {top, height:width * ratio};
      top += page.height + GAP;
      return page;
    });
  }
  function anchorAt(layout, width, scroll, point) {
    const page = pageAt(layout, scroll.y + point.y);
    return {page, ratio:clamp((scroll.y + point.y - layout[page].top) / layout[page].height, 0, 1), xRatio:(scroll.x + point.x - scroll.inset) / width, point};
  }
  function anchorScroll(layout, width, inset, anchor) {
    return {y:layout[anchor.page].top + anchor.ratio * layout[anchor.page].height - anchor.point.y, x:inset + anchor.xRatio * width - anchor.point.x};
  }
  function canvasScale(width, height, density, count) {
    const budget = Math.min(2 * 1024 * 1024, 8 * 1024 * 1024 / Math.max(1, count));
    return Math.min(2, density || 1, Math.sqrt(budget / (width * height)), 8192 / width, 8192 / height);
  }

  class Viewer {
    constructor({pdf, container, pages, text, title, zoom = 1, locked = false, onChange, onGesture, onError}) {
      Object.assign(this, {pdf, container, pages, text, title, onChange, onGesture, onError});
      this.zoom = clamp(zoom, .5, 4);
      this.locked = !!locked;
      this.current = 0;
      this.generation = 0;
      this.running = 0;
      this.metrics = [];
      this.layout = [];
      this.rendering = new Map();
      this.waiters = new Map();
      this.wanted = new Set();
      this.events = new AbortController();
      this.ignoreClickUntil = 0;
      this.listen(container, 'scroll', () => {
        if (!this.scrollRAF) this.scrollRAF = requestAnimationFrame(() => { this.scrollRAF = 0; this.update(); });
      }, {passive:true});
      this.bindGestures();
    }
    listen(node, type, callback, options = {}) {
      node.addEventListener(type, callback, {...options, signal:this.events.signal});
    }
    async open(page = 1, offset = 0, horizontal = 0) {
      const first = await this.pdf.getPage(1);
      const viewport = first.getViewport({scale:1});
      const ratio = viewport.height / viewport.width;
      this.metrics = Array.from({length:this.pdf.numPages}, (_, i) => {
        const box = document.createElement('div');
        box.className = 'pdf-page';
        box.dataset.page = i + 1;
        box.style.aspectRatio = String(1 / ratio);
        box.style.setProperty('--pdf-page-ratio', String(ratio));
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', '第 ' + (i + 1) + ' 页');
        box.setAttribute('aria-busy', 'true');
        return {box, ratio, canvas:null, generation:-1, page:null};
      });
      this.pages.replaceChildren(...this.metrics.map(item => item.box));
      this.measure();
      return this.goTo(page, offset, horizontal);
    }
    inset() { return Math.max(0, (this.container.clientWidth - this.width) / 2); }
    capture(point = {x:this.container.clientWidth / 2, y:this.container.clientHeight / 2}) {
      return anchorAt(this.layout, this.width, {x:this.container.scrollLeft, y:this.container.scrollTop, inset:this.inset()}, point);
    }
    measure(anchor) {
      this.width = Math.max(120, Math.min(this.container.clientWidth, 850) * this.zoom);
      this.layout = layoutPages(this.metrics.map(item => item.ratio), this.width);
      this.pages.style.setProperty('--pdf-page-width', this.width + 'px');
      // Let even a short final page be positioned at the top by a page jump.
      this.pages.style.paddingBottom = Math.max(0, this.container.clientHeight - this.layout.at(-1).height) + 'px';
      if (anchor) {
        const position = anchorScroll(this.layout, this.width, this.inset(), anchor);
        this.container.scrollTop = position.y;
        this.container.scrollLeft = position.x;
        this.rememberAdjustment();
      }
    }
    rememberAdjustment() {
      this.adjustment = {top:this.container.scrollTop, left:this.container.scrollLeft};
    }
    isPositionAdjustment() {
      const position = this.adjustment;
      if (position && Math.abs(position.top - this.container.scrollTop) < 1 && Math.abs(position.left - this.container.scrollLeft) < 1) return true;
      this.adjustment = null;
      return false;
    }
    position() {
      if (!this.layout.length) return {page:1, offset:0, horizontal:0};
      const index = pageAt(this.layout, this.container.scrollTop + 1);
      return {page:index + 1, offset:clamp((this.container.scrollTop - this.layout[index].top) / this.layout[index].height, 0, 1), horizontal:this.container.scrollLeft / Math.max(1, this.container.scrollWidth - this.container.clientWidth), zoom:this.zoom, locked:this.locked};
    }
    async goTo(page, offset = 0, horizontal = null) {
      const index = Math.floor(clamp(page, 1, this.metrics.length)) - 1;
      this.container.scrollTop = this.layout[index].top + clamp(offset, 0, 1) * this.layout[index].height;
      if (horizontal !== null) this.container.scrollLeft = clamp(horizontal, 0, 1) * Math.max(0, this.container.scrollWidth - this.container.clientWidth);
      this.rememberAdjustment();
      this.update();
      return this.waitFor(this.current);
    }
    setZoom(value, point) {
      value = Math.round(clamp(value, .5, 4) * 100) / 100;
      if (this.locked || value === this.zoom || !this.layout.length) return Promise.resolve();
      const anchor = this.capture(point);
      this.zoom = value;
      this.measure(anchor);
      this.invalidate();
      this.update();
      return this.waitFor(this.current);
    }
    setLocked(locked) {
      if (this.pinch) this.finishPinch();
      this.locked = !!locked;
      this.emit();
    }
    resize() {
      if (!this.layout.length || this.pinch) return;
      const position = this.position();
      this.measure();
      this.invalidate();
      this.goTo(position.page, position.offset, position.horizontal);
    }
    emit() { this.onChange?.(this.position()); }
    invalidate() {
      this.generation++;
      for (const item of this.rendering.values()) item.task?.cancel();
      for (const resolve of this.waiters.values()) resolve(false);
      this.waiters.clear();
    }
    waitFor(index) {
      if (this.metrics[index]?.generation === this.generation) return Promise.resolve(true);
      const key = this.generation + ':' + index;
      if (!this.waiters.has(key)) {
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        resolve.promise = promise;
        this.waiters.set(key, resolve);
      }
      return this.waiters.get(key).promise;
    }
    settle(index, generation, result) {
      const key = generation + ':' + index;
      this.waiters.get(key)?.(result);
      this.waiters.delete(key);
    }
    syncCanvas() {
      this.container.querySelector('#pdf-canvas')?.removeAttribute('id');
      if (this.metrics[this.current]?.canvas) this.metrics[this.current].canvas.id = 'pdf-canvas';
    }
    update() {
      if (!this.layout.length || this.destroyed || this.pinch) return;
      this.current = pageAt(this.layout, this.container.scrollTop + 1);
      const indices = pageWindow(this.layout, this.container.scrollTop, this.container.clientHeight);
      const previous = new Set([...this.wanted, ...this.rendering.keys()]);
      this.wanted = new Set(indices);
      for (const i of previous) {
        if (this.wanted.has(i)) continue;
        const item = this.metrics[i];
        this.rendering.get(i)?.task?.cancel();
        item.canvas?.remove(); item.canvas = null; item.generation = -1;
        item.box.setAttribute('aria-busy', 'true');
        if (!this.rendering.has(i)) { item.page?.cleanup(); item.page = null; }
        this.settle(i, this.generation, false);
      }
      this.syncCanvas(); this.emit(); this.pump();
    }
    pump() {
      if (this.destroyed) return;
      const queue = [...this.wanted].sort((a,b) => Math.abs(a - this.current) - Math.abs(b - this.current));
      for (const index of queue) {
        if (this.running >= 2) break;
        if (this.metrics[index].generation === this.generation || this.rendering.has(index)) continue;
        const info = {generation:this.generation, task:null};
        this.rendering.set(index, info); this.running++;
        this.render(index, info).catch(error => {
          if (error.name !== 'RenderingCancelledException' && info.generation === this.generation && this.wanted.has(index) && !this.destroyed) {
            this.settle(index, info.generation, false);
            this.failed = true; this.onError?.(error);
          }
        }).finally(() => {
          this.running--;
          if (this.rendering.get(index) === info) this.rendering.delete(index);
          if (!this.wanted.has(index)) { this.metrics[index].page?.cleanup(); this.metrics[index].page = null; }
          if (!this.failed) this.pump();
        });
      }
    }
    async render(index, info) {
      const item = this.metrics[index];
      const page = await this.pdf.getPage(index + 1);
      item.page = page;
      if (this.destroyed || info.generation !== this.generation || !this.wanted.has(index)) return;
      const original = page.getViewport({scale:1});
      const ratio = original.height / original.width;
      if (Math.abs(ratio - item.ratio) > .0001) {
        const anchor = this.capture();
        item.ratio = ratio; item.box.style.aspectRatio = String(1 / ratio); item.box.style.setProperty('--pdf-page-ratio', String(ratio));
        this.measure(anchor);
      }
      const viewport = page.getViewport({scale:this.width / original.width});
      const density = canvasScale(viewport.width, viewport.height, window.devicePixelRatio, this.wanted.size);
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-page-canvas'; canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', this.title + '，第 ' + (index + 1) + ' 页');
      canvas.width = Math.max(1, Math.floor(viewport.width * density));
      canvas.height = Math.max(1, Math.floor(viewport.height * density));
      info.task = page.render({canvas, viewport, transform:density === 1 ? null : [density,0,0,density,0,0]});
      await info.task.promise;
      if (this.destroyed || info.generation !== this.generation || !this.wanted.has(index)) return;
      item.canvas?.remove(); item.canvas = canvas; item.generation = info.generation;
      item.box.append(canvas); item.box.setAttribute('aria-busy', 'false');
      this.syncCanvas(); this.settle(index, info.generation, true);
      if (index === this.current) {
        try {
          const text = await page.getTextContent();
          if (index === this.current && !this.destroyed) this.text.textContent = text.items.map(part => part.str).join(' ');
        } catch { /* The raster page can still be read. */ }
      }
    }
    localPoint(x, y) {
      const box = this.container.getBoundingClientRect();
      return {x:x - box.left, y:y - box.top};
    }
    bindGestures() {
      const distance = touches => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
      const midpoint = touches => this.localPoint((touches[0].clientX + touches[1].clientX) / 2, (touches[0].clientY + touches[1].clientY) / 2);
      this.listen(this.container, 'touchstart', event => {
        if (event.touches.length < 2 || !this.layout.length) return;
        event.preventDefault(); this.ignoreClickUntil = Date.now() + 500; this.onGesture?.();
        if (!this.locked) this.pinch = {distance:Math.max(1, distance(event.touches)), zoom:this.zoom, anchor:this.capture(midpoint(event.touches))};
      }, {passive:false});
      this.listen(this.container, 'touchmove', event => {
        if (event.touches.length < 2) return;
        event.preventDefault();
        if (!this.pinch) return;
        this.zoom = Math.round(clamp(this.pinch.zoom * distance(event.touches) / this.pinch.distance, .5, 4) * 100) / 100;
        this.pinch.anchor.point = midpoint(event.touches);
        this.measure(this.pinch.anchor); this.emit();
      }, {passive:false});
      for (const type of ['touchend','touchcancel']) this.listen(this.container, type, event => { if (event.touches.length < 2) this.finishPinch(); }, {passive:true});
      this.listen(this.container, 'wheel', event => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault(); this.onGesture?.();
        if (!this.locked) this.setZoom(this.zoom * Math.exp(-event.deltaY * .01), this.localPoint(event.clientX, event.clientY));
      }, {passive:false});
      this.listen(this.container, 'pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button === 0) this.drag = {id:event.pointerId, x:event.clientX, y:event.clientY, left:this.container.scrollLeft, top:this.container.scrollTop, moved:false};
      }, {passive:true});
      this.listen(this.container, 'pointermove', event => {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.id || !(event.buttons & 1)) return;
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5 && !drag.moved) return;
        if (!drag.moved) { drag.moved = true; this.container.setPointerCapture(event.pointerId); this.onGesture?.(); }
        this.container.classList.add('pdf-dragging');
        this.container.scrollLeft = drag.left - (event.clientX - drag.x);
        this.container.scrollTop = drag.top - (event.clientY - drag.y);
      }, {passive:true});
      for (const type of ['pointerup','pointercancel']) this.listen(this.container, type, event => {
        if (this.drag?.moved) this.ignoreClickUntil = Date.now() + 400;
        if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId);
        this.drag = null; this.container.classList.remove('pdf-dragging');
      }, {passive:true});
      this.listen(this.container, 'click', event => {
        if (Date.now() < this.ignoreClickUntil || this.pinch) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, {capture:true});
    }
    finishPinch() {
      if (!this.pinch) return;
      this.pinch = null; this.ignoreClickUntil = Date.now() + 400;
      this.invalidate(); this.update();
    }
    destroy() {
      this.destroyed = true; this.events.abort(); this.invalidate();
      cancelAnimationFrame(this.scrollRAF);
      this.pages.replaceChildren();
    }
  }
  return Object.freeze({Viewer, pageAt, pageWindow, layoutPages, anchorAt, anchorScroll, canvasScale});
});
