(async function () {
    'use strict';
    const list = document.getElementById('blog-list');
    const article = document.getElementById('blog-post');
    const navbar = document.getElementById('navbar');
    const progress = document.getElementById('reading-progress-bar');
    const backToTop = document.getElementById('back-to-top');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    let reading = false;
    let frame = 0;
    let pointerFrame = 0;

    function scrollToTop() {
        window.scrollTo({top: 0, behavior: motion.matches ? 'instant' : 'smooth'});
    }
    function updateScroll() {
        frame = 0;
        navbar.classList.toggle('is-scrolled', window.scrollY > 12);
        backToTop.hidden = window.scrollY < 420;
        if (reading) {
            const body = document.getElementById('post-body');
            const end = body.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
            const amount = end > 0 ? window.scrollY / end : 1;
            progress.style.transform = 'scaleX(' + Math.max(0, Math.min(1, amount)) + ')';
        } else progress.style.transform = 'scaleX(0)';
    }
    function queueScroll() {
        if (!frame) frame = requestAnimationFrame(updateScroll);
    }
    window.addEventListener('scroll', queueScroll, {passive: true});
    window.addEventListener('resize', queueScroll);
    backToTop.addEventListener('click', scrollToTop);
    if ('ResizeObserver' in window) new ResizeObserver(queueScroll).observe(article);
    updateScroll();

    // Observe only when supported; content remains usable with reduced motion.
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const card = entry.target;
            card.classList.remove('reveal-pending');
            if (!motion.matches) card.classList.add('reveal-in');
            observer.unobserve(card);
        }
    }, {threshold: 0.08}) : null;
    function showAllCards() {
        list.querySelectorAll('.blog-card').forEach(card => {
            card.classList.remove('reveal-pending', 'reveal-in');
            if (observer) observer.unobserve(card);
        });
    }
    motion.addEventListener('change', showAllCards);
    list.addEventListener('focusin', event => {
        const card = event.target.closest('.blog-card');
        if (card) {
            card.classList.remove('reveal-pending', 'reveal-in');
            if (observer) observer.unobserve(card);
        }
    });
    list.addEventListener('animationend', event => {
        if (event.animationName === 'enter') event.target.classList.remove('reveal-in');
    });
    // One delegated listener and one frame for the pointer glow.
    list.addEventListener('pointermove', event => {
        if (motion.matches || !finePointer.matches) return;
        const card = event.target.closest('.blog-card');
        if (!card) return;
        const x = event.clientX, y = event.clientY;
        if (pointerFrame) cancelAnimationFrame(pointerFrame);
        pointerFrame = requestAnimationFrame(() => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--pointer-x', (x - rect.left) + 'px');
            card.style.setProperty('--pointer-y', (y - rect.top) + 'px');
            pointerFrame = 0;
        });
    }, {passive: true});
    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function readingTime(post) {
        const doc = new DOMParser().parseFromString(post.body, 'text/html');
        const length = doc.body.textContent.replace(/\s/g, '').length;
        return '约 ' + Math.max(1, Math.ceil(length / 350)) + ' 分钟阅读';
    }
    try {
        const {data} = await MatrixContent.loadContent();
        const siteTitle = data.site.name + ' | Fantastic Matrix';
        document.title = siteTitle;
        document.querySelector('meta[name="description"]').content = data.site.description;
        document.querySelector('.nav-logo').textContent = data.site.name;
        document.querySelector('.section-title').textContent = data.site.heading;
        document.getElementById('site-description').textContent = data.site.description;
        document.getElementById('site-footer').textContent = '© ' + new Date().getFullYear() + ' fantasticmatrix.xyz — ' + data.site.name;
        document.getElementById('notes-count').textContent = String(data.posts.length).padStart(2, '0') + ' 篇文章 / 慢慢更新';
        const fragment = document.createDocumentFragment();
        data.posts.forEach((post, index) => {
            const card = element('a', 'blog-card');
            card.href = '#post-' + post.slug;
            const titleId = 'card-title-' + post.id;
            card.setAttribute('aria-labelledby', titleId);
            const meta = element('div', 'card-meta');
            const date = element('time', 'blog-card-date', post.date.replaceAll('-', '.'));
            date.dateTime = post.date;
            meta.append(date, element('span', '', '/'), element('span', '', readingTime(post)));
            if (index === 0) {
                meta.append(element('span', 'card-featured', '✳ 最新一篇'));
                const number = element('span', 'card-index', '01');
                number.setAttribute('aria-hidden', 'true');
                card.append(number);
            }
            const title = element('h3', 'blog-card-title', post.title);
            title.id = titleId;
            card.append(meta, title, element('p', 'blog-card-excerpt', post.excerpt));
            const bottom = element('div', 'card-bottom');
            const tags = element('div', 'blog-card-tags');
            post.tags.forEach(text => tags.append(element('span', 'blog-tag', text)));
            const arrow = element('span', 'card-arrow', '↗');
            arrow.setAttribute('aria-hidden', 'true');
            bottom.append(tags, arrow);
            card.append(bottom);
            if (observer && !motion.matches) {
                card.classList.add('reveal-pending');
                card.style.setProperty('--reveal-delay', (index % 2) * 70 + 'ms');
                observer.observe(card);
            }
            fragment.append(card);
        });
        list.replaceChildren(fragment);
        if (!data.posts.length) list.append(element('p', 'list-message', '还没有文章，过段时间再来看看吧。'));
        let previousPost = null;
        function route(moveFocus = false) {
            const slug = location.hash.startsWith('#post-') ? location.hash.slice(6) : null;
            const post = data.posts.find(p => p.slug === slug);
            reading = Boolean(post);
            document.body.classList.toggle('is-reading', reading);
            list.classList.toggle('hidden', reading);
            article.hidden = !reading;
            article.classList.toggle('active', reading);
            document.title = post ? post.title + ' | ' + data.site.name : siteTitle;
            if (post) {
                const title = document.getElementById('post-title');
                title.textContent = post.title;
                const date = document.getElementById('post-date');
                date.textContent = post.date.replaceAll('-', '.');
                date.dateTime = post.date;
                document.getElementById('post-reading-time').textContent = readingTime(post);
                document.getElementById('post-tags-display').textContent = post.tags.join(' · ');
                document.getElementById('post-body').innerHTML = post.body;
                if (!motion.matches && typeof article.animate === 'function') {
                    article.animate([{opacity: 0, transform: 'translateY(12px)'}, {opacity: 1, transform: 'translateY(0)'}], {duration: 450, easing: 'cubic-bezier(.22,1,.36,1)'});
                }
                if (moveFocus) title.focus({preventScroll: true});
                previousPost = post;
            } else if (moveFocus && previousPost) {
                showAllCards();
                const card = document.getElementById('card-title-' + previousPost.id)?.closest('a');
                if (card) card.focus({preventScroll: true});
            }
            queueScroll();
        }
        document.querySelectorAll('.post-back').forEach(link => link.addEventListener('click', scrollToTop));
        window.addEventListener('hashchange', () => {
            route(true);
            if (!location.hash || location.hash.startsWith('#post-')) scrollToTop();
        });
        route();
    } catch (error) {
        list.replaceChildren(element('p', 'list-message', error.message || '文章加载失败，请刷新页面重试。'));
        list.setAttribute('role', 'alert');
        document.getElementById('notes-count').textContent = '暂时无法加载';
    }
})();
