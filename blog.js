(async function () {
    'use strict';
    const list = document.getElementById('blog-list');
    try {
        const {data} = await MatrixContent.loadContent();
        document.title = data.site.name + ' | Fantastic Matrix';
        document.querySelector('meta[name="description"]').content = data.site.description;
        document.querySelector('.nav-logo').textContent = data.site.name;
        document.querySelector('.section-title').textContent = data.site.heading;
        document.getElementById('site-footer').textContent = '© ' + new Date().getFullYear() + ' fantasticmatrix.xyz — ' + data.site.name;
        list.replaceChildren();
        for (const post of data.posts) {
            const card = document.createElement('a');
            card.className = 'blog-card';
            card.href = '#post-' + post.slug;
            card.style.cssText = 'text-decoration:none;color:inherit;display:block';
            for (const [tag, className, value] of [['div', 'blog-card-date', post.date], ['h3', 'blog-card-title', post.title], ['p', 'blog-card-excerpt', post.excerpt]]) {
                const el = document.createElement(tag); el.className = className; el.textContent = value; card.append(el);
            }
            const tags = document.createElement('div'); tags.className = 'blog-card-tags';
            post.tags.forEach(text => { const tag = document.createElement('span'); tag.className = 'blog-tag'; tag.textContent = text; tags.append(tag); });
            card.append(tags); list.append(card);
        }
        if (!data.posts.length) list.textContent = '还没有文章，过段时间再来看看吧。';
        function route() {
            const slug = location.hash.startsWith('#post-') ? location.hash.slice(6) : null;
            const post = data.posts.find(p => p.slug === slug);
            list.classList.toggle('hidden', Boolean(post));
            document.getElementById('blog-post').classList.toggle('active', Boolean(post));
            if (post) {
                document.getElementById('post-title').textContent = post.title;
                document.getElementById('post-date').textContent = post.date;
                document.getElementById('post-tags-display').textContent = post.tags.join(' · ');
                document.getElementById('post-body').innerHTML = post.body;
            }
        }
        document.querySelectorAll('.post-back').forEach(link => {
            link.href = '#';
            link.addEventListener('click', () => window.scrollTo({top: 0, behavior: 'smooth'}));
        });
        window.addEventListener('hashchange', () => { route(); window.scrollTo({top: 0, behavior: 'smooth'}); });
        route();
    } catch (error) {
        list.textContent = error.message || '文章加载失败，请刷新页面重试。';
        list.setAttribute('role', 'alert');
    }
})();
