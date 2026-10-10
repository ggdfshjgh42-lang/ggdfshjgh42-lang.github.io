/* Shared content format for the public blog and its editor. */
(function () {
    'use strict';
    const tags = new Set(['P', 'DIV', 'BR', 'H2', 'H3', 'H4', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'A', 'IMG', 'PRE', 'CODE', 'HR', 'FIGURE', 'FIGCAPTION']);
    const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'TEMPLATE', 'LINK', 'META']);

    function safeUrl(value, image = false) {
        try {
            if (!String(value).trim()) return null;
            const url = new URL(value, location.href);
            const protocols = image ? ['https:', 'http:'] : ['https:', 'http:', 'mailto:'];
            return protocols.includes(url.protocol) ? url.href : null;
        } catch { return null; }
    }

    function sanitizeHtml(html) {
        const doc = new DOMParser().parseFromString(String(html), 'text/html');
        function clean(parent) {
            for (const node of Array.from(parent.childNodes)) {
                if (node.nodeType === 8) { node.remove(); continue; }
                if (node.nodeType !== 1) continue;
                if (blocked.has(node.tagName)) { node.remove(); continue; }
                clean(node);
                if (!tags.has(node.tagName)) { node.replaceWith(...node.childNodes); continue; }
                const href = node.tagName === 'A' ? safeUrl(node.getAttribute('href') || '') : null;
                const src = node.tagName === 'IMG' ? safeUrl(node.getAttribute('src') || '', true) : null;
                const alt = node.getAttribute('alt') || '';
                for (const attribute of Array.from(node.attributes)) node.removeAttribute(attribute.name);
                if (node.tagName === 'A' && href) { node.setAttribute('href', href); node.setAttribute('rel', 'noopener noreferrer'); }
                if (node.tagName === 'IMG') {
                    if (!src) { node.remove(); continue; }
                    node.setAttribute('src', src); node.setAttribute('alt', alt); node.setAttribute('loading', 'lazy');
                }
            }
        }
        clean(doc.body);
        return doc.body.innerHTML;
    }

    function validateContent(data, complete = true) {
        if (!data || data.version !== 1 || !data.site || !Array.isArray(data.posts)) throw new Error('这不是有效的网站内容文件。');
        const text = (value, label, max, required = false) => {
            if (typeof value !== 'string' || value.length > max || (complete && required && !value.trim())) throw new Error(label + '为空或超过长度限制。');
            return value;
        };
        if (data.posts.length > 500) throw new Error('文章数量超过 500 篇，请先减少文章数量。');
        const site = {
            name: text(data.site.name, '网站名称', 80, true),
            description: text(data.site.description, '网站简介', 300),
            heading: text(data.site.heading, '首页标题', 100, true)
        };
        const ids = new Set(), slugs = new Set();
        const posts = data.posts.map((post, i) => {
            const label = '第 ' + (i + 1) + ' 篇文章';
            if (!post || !Number.isSafeInteger(post.id) || post.id < 1 || ids.has(post.id)) throw new Error(label + '的编号无效或重复。');
            if (typeof post.slug !== 'string' || post.slug.length > 120 || (complete && (!/^[a-z0-9-]{1,120}$/.test(post.slug) || slugs.has(post.slug)))) throw new Error(label + '的链接标识无效或重复。');
            if (typeof post.date !== 'string' || post.date.length > 10 || (complete && (!/^\d{4}-\d{2}-\d{2}$/.test(post.date) || !Number.isFinite(Date.parse(post.date)) || new Date(post.date).toISOString().slice(0, 10) !== post.date))) throw new Error(label + '的日期无效。');
            if (!Array.isArray(post.tags) || (complete && post.tags.length > 20)) throw new Error(label + '的标签无效。');
            ids.add(post.id); slugs.add(post.slug);
            const body = sanitizeHtml(text(post.body, label + '正文', 200000, true));
            if (complete && !new DOMParser().parseFromString(body, 'text/html').body.textContent.trim() && !body.includes('<img')) throw new Error(label + '还没有正文。');
            return {id: post.id, slug: post.slug, title: text(post.title, label + '标题', 150, true), date: post.date,
                excerpt: text(post.excerpt, label + '摘要', 1000), tags: post.tags.map(t => text(t, '标签', complete ? 40 : 1000)), body};
        });
        return {version: 1, site, posts};
    }

    async function gitBlobSha(source) {
        const bytes = new TextEncoder().encode(source);
        const header = new TextEncoder().encode('blob ' + bytes.length + '\0');
        const blob = new Uint8Array(header.length + bytes.length);
        blob.set(header); blob.set(bytes, header.length);
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', blob)), b => b.toString(16).padStart(2, '0')).join('');
    }
    async function loadContent() {
        const response = await fetch('content.json', {cache: 'no-store'});
        if (!response.ok) throw new Error('文章加载失败，请刷新页面重试。');
        const source = await response.text();
        return {data: validateContent(JSON.parse(source)), sha: await gitBlobSha(source)};
    }
    function encodeBase64(source) {
        const bytes = new TextEncoder().encode(source);
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        return btoa(binary);
    }
    function decodeBase64(source) {
        return new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(atob(source.replace(/\s/g, '')), c => c.charCodeAt(0)));
    }
    window.MatrixContent = {sanitizeHtml, safeUrl, validateContent, gitBlobSha, loadContent, encodeBase64, decodeBase64};
})();
