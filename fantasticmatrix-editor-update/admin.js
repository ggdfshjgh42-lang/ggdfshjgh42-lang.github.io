(async function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const repo = 'ggdfshjgh42-lang/ggdfshjgh42-lang.github.io';
    const branch = 'main';
    const endpoint = 'https://api.github.com/repos/' + repo;
    const draftKey = 'fantasticmatrix-content-draft-v1';
    let data, baseSha, baseline, selectedId, token = '', busy = false, insertMode, savedRange;

    function status(message, error = false) {
        $('status').textContent = message;
        $('status').classList.toggle('error', error);
    }
    function hasChanges() { return data && JSON.stringify(data) !== baseline; }
    function updateControls() {
        for (const id of ['new-post', 'site-settings', 'export', 'import', 'reload']) $(id).disabled = !data || busy;
        $('publish').disabled = !data || !token || busy || !hasChanges();
        $('connect').disabled = busy;
        $('connect').textContent = token ? '断开连接' : '连接 GitHub';
        $('connection-status').textContent = token ? '已连接 GitHub' : '尚未连接';
        $('connection-status').classList.toggle('connected', Boolean(token));
        $('workspace').setAttribute('aria-busy', String(busy || !data));
    }
    function saveDraft() {
        updateControls();
        if (!data) return;
        try {
            localStorage.setItem(draftKey, JSON.stringify({data, baseSha, baseline, savedAt: Date.now()}));
            status(hasChanges() ? '草稿已保存到当前浏览器 · 尚未发布' : '当前内容与已发布版本一致。');
        } catch { status('浏览器无法保存草稿，请导出备份，以免刷新后丢失修改。', true); }
    }
    function currentPost() { return data?.posts.find(post => post.id === selectedId); }
    function renderList() {
        $('post-count').textContent = data.posts.length + ' 篇';
        $('post-list').replaceChildren();
        const query = $('search').value.trim().toLowerCase();
        for (const post of data.posts.filter(p => (p.title + ' ' + p.tags.join(' ')).toLowerCase().includes(query))) {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'post-item'; button.classList.toggle('selected', post.id === selectedId);
            button.setAttribute('aria-pressed', String(post.id === selectedId));
            const title = document.createElement('strong'); title.textContent = post.title || '未命名文章';
            const date = document.createElement('span'); date.textContent = post.date;
            button.append(title, date); button.addEventListener('click', () => selectPost(post.id));
            $('post-list').append(button);
        }
        if (!$('post-list').children.length) $('post-list').textContent = query ? '没有找到文章。' : '还没有文章，点击上方新建。';
    }
    function selectPost(id) {
        selectedId = id;
        savedRange = null;
        const post = currentPost();
        $('settings-form').hidden = true;
        $('post-form').hidden = !post;
        $('empty-state').hidden = Boolean(post);
        if (post) {
            $('post-title').value = post.title; $('post-date').value = post.date;
            $('post-tags').value = post.tags.join('，'); $('post-excerpt').value = post.excerpt;
            $('post-slug').value = post.slug; $('post-body').innerHTML = MatrixContent.sanitizeHtml(post.body);
            $('editor-heading').textContent = post.title || '未命名文章';
            updateWordCount();
        }
        renderList();
    }
    function updateWordCount() { $('word-count').textContent = $('post-body').textContent.replace(/\s/g, '').length + ' 字'; }
    function syncPost() {
        const post = currentPost();
        if (!post) return;
        Object.assign(post, {
            title: $('post-title').value, date: $('post-date').value,
            tags: $('post-tags').value.split(/[,，]/).map(t => t.trim()).filter(Boolean),
            excerpt: $('post-excerpt').value, slug: $('post-slug').value,
            body: MatrixContent.sanitizeHtml($('post-body').innerHTML)
        });
        $('editor-heading').textContent = post.title || '未命名文章';
        updateWordCount(); renderList(); saveDraft();
    }
    function showSettings() {
        selectedId = null; renderList();
        $('post-form').hidden = true; $('empty-state').hidden = true; $('settings-form').hidden = false;
        $('site-name').value = data.site.name; $('site-heading').value = data.site.heading; $('site-description').value = data.site.description;
    }
    async function api(path, options = {}, credential = token) {
        const response = await fetch(endpoint + path, {
            ...options,
            headers: {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
                ...(credential ? {Authorization: 'Bearer ' + credential} : {}),
                ...(options.body ? {'Content-Type': 'application/json'} : {})}, cache: 'no-store'
        });
        let result;
        try { result = await response.json(); } catch { throw new Error('GitHub 返回了异常响应，请稍后重试。'); }
        if (!response.ok) {
            const messages = {401: '授权令牌无效或已过期，请重新连接 GitHub。',
                403: 'GitHub 拒绝访问。请检查令牌的仓库选择、Contents 读写权限及 API 使用限额。',
                404: '无法访问仓库内容，请确认令牌已授权此仓库，并且 content.json 已上传。',
                409: '线上内容已发生变化，本次修改没有提交。请导出草稿，再载入已发布版本。',
                422: 'GitHub 未接受修改，请检查仓库分支保护规则及令牌的 Contents 写入权限。'};
            throw new Error(messages[response.status] || 'GitHub 请求失败（' + response.status + '），请稍后重试。');
        }
        return result;
    }
    function download(content, filename) {
        const url = URL.createObjectURL(new Blob([content], {type: 'application/json;charset=utf-8'}));
        const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function rememberRange() {
        const selection = window.getSelection();
        if (selection.rangeCount && $('post-body').contains(selection.getRangeAt(0).commonAncestorContainer)) savedRange = selection.getRangeAt(0).cloneRange();
    }
    function restoreRange() {
        $('post-body').focus();
        if (!savedRange || !$('post-body').contains(savedRange.commonAncestorContainer)) {
            savedRange = document.createRange(); savedRange.selectNodeContents($('post-body')); savedRange.collapse(false);
        }
        const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(savedRange);
    }
    function openInsert(mode) {
        rememberRange(); insertMode = mode;
        $('insert-heading').textContent = mode === 'image' ? '插入图片' : '插入链接';
        $('insert-text-label').textContent = mode === 'image' ? '图片说明' : '显示文字';
        $('insert-url').value = ''; $('insert-text').value = mode === 'link' && savedRange ? savedRange.toString() : '';
        $('insert-message').textContent = ''; $('insert-dialog').showModal(); $('insert-url').focus();
    }
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
    $('post-form').addEventListener('submit', event => event.preventDefault());
    $('settings-form').addEventListener('submit', event => event.preventDefault());
    $('post-form').addEventListener('input', syncPost);
    $('settings-form').addEventListener('input', () => {
        Object.assign(data.site, {name: $('site-name').value, heading: $('site-heading').value, description: $('site-description').value}); saveDraft();
    });
    $('search').addEventListener('input', () => { if (data) renderList(); });
    $('site-settings').addEventListener('click', showSettings);
    $('new-post').addEventListener('click', () => {
        const id = Math.max(0, ...data.posts.map(p => p.id)) + 1;
        const date = new Date().toLocaleDateString('sv-SE');
        const slug = 'article-' + crypto.randomUUID().slice(0, 8);
        data.posts.unshift({id, slug, title: '', date, excerpt: '', tags: [], body: ''});
        $('search').value = ''; selectPost(id); saveDraft(); $('post-title').focus();
    });
    $('delete-post').addEventListener('click', () => {
        const post = currentPost();
        if (post && confirm('从当前草稿删除“' + (post.title || '未命名文章') + '”？发布后才会从网站移除。')) {
            data.posts = data.posts.filter(p => p.id !== selectedId); selectPost(data.posts[0]?.id); saveDraft();
        }
    });
    document.querySelectorAll('[data-command]').forEach(button => {
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', () => {
            restoreRange(); document.execCommand(button.dataset.command, false, button.dataset.value || null); rememberRange(); syncPost();
        });
    });
    $('post-body').addEventListener('keyup', rememberRange);
    $('post-body').addEventListener('mouseup', rememberRange);
    $('post-body').addEventListener('input', rememberRange);
    // Normalize pasted content before it enters the live editor; no pasted scripts or handlers are retained.
    $('post-body').addEventListener('paste', event => {
        event.preventDefault();
        const html = event.clipboardData.getData('text/html');
        if (html) document.execCommand('insertHTML', false, MatrixContent.sanitizeHtml(html));
        else document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
        syncPost(); rememberRange();
    });
    $('post-body').addEventListener('drop', event => event.preventDefault());
    $('insert-link').addEventListener('click', () => openInsert('link'));
    $('insert-image').addEventListener('click', () => openInsert('image'));
    $('insert-form').addEventListener('submit', event => {
        event.preventDefault();
        const url = MatrixContent.safeUrl($('insert-url').value, insertMode === 'image');
        if (!url) { $('insert-message').textContent = '请输入有效的网页地址。'; return; }
        const node = document.createElement(insertMode === 'image' ? 'img' : 'a');
        if (insertMode === 'image') { node.src = url; node.alt = $('insert-text').value; }
        else { node.href = url; node.textContent = $('insert-text').value || url; node.rel = 'noopener noreferrer'; }
        $('insert-dialog').close(); restoreRange();
        document.execCommand('insertHTML', false, node.outerHTML); rememberRange(); syncPost();
    });
    $('preview').addEventListener('click', () => {
        syncPost();
        const post = currentPost();
        $('preview-title').textContent = post.title || '未命名文章';
        $('preview-meta').textContent = post.date + ' · ' + post.tags.join(' · ');
        $('preview-body').innerHTML = MatrixContent.sanitizeHtml(post.body);
        $('preview-dialog').showModal();
    });
    $('export').addEventListener('click', () => {
        download(JSON.stringify(data, null, 2) + '\n', 'fantasticmatrix-backup-' + new Date().toLocaleDateString('sv-SE') + '.json');
        status('备份已导出，其中不包含 GitHub 授权令牌。');
    });
    $('import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async () => {
        const file = $('import-file').files[0];
        if (!file) return;
        try {
            if (file.size > 1000000) throw new Error('备份文件超过 1 MB，请缩小后重试。');
            const imported = MatrixContent.validateContent(JSON.parse(await file.text()), false);
            if (!confirm('用备份替换当前草稿？这一步不会修改线上网站。')) return;
            data = imported; selectPost(data.posts[0]?.id); saveDraft();
        } catch (error) { status('导入失败：' + error.message, true); }
        finally { $('import-file').value = ''; }
    });
    $('reload').addEventListener('click', async () => {
        if (hasChanges() && !confirm('载入已发布版本会丢弃当前草稿，请先导出需要保留的修改。继续？')) return;
        busy = true; updateControls();
        try {
            const remote = await api('/contents/content.json?ref=' + branch);
            if (remote.encoding !== 'base64' || !remote.content) throw new Error('无法读取线上内容文件。');
            data = MatrixContent.validateContent(JSON.parse(MatrixContent.decodeBase64(remote.content)));
            baseSha = remote.sha; baseline = JSON.stringify(data);
            $('search').value = ''; selectPost(data.posts[0]?.id); saveDraft();
            status('已载入 GitHub 中最新的已发布内容。');
        } catch (error) { status(error.message, true); }
        finally { busy = false; updateControls(); }
    });
    $('connect').addEventListener('click', () => {
        if (token) { token = ''; updateControls(); status('已断开 GitHub 连接，草稿继续保留。'); return; }
        $('github-token').value = ''; $('connect-message').textContent = ''; $('connect-dialog').showModal();
    });
    $('connect-form').addEventListener('submit', async event => {
        event.preventDefault();
        const candidate = $('github-token').value.trim();
        $('github-token').value = ''; $('connect-submit').disabled = true;
        $('connect-message').textContent = '正在验证仓库访问权限…';
        try {
            const repository = await api('', {}, candidate);
            if (!repository.permissions?.push) throw new Error('此授权账号没有仓库写入权限，请使用仓库所有者账号生成令牌。');
            await api('/contents/content.json?ref=' + branch, {}, candidate);
            token = candidate; $('connect-dialog').close(); updateControls(); status('GitHub 已连接。编辑完成后，点击“发布全部修改”。');
        } catch (error) { $('connect-message').textContent = error.message; }
        finally { $('connect-submit').disabled = false; }
    });
    $('connect-dialog').addEventListener('close', () => { $('github-token').value = ''; });
    $('publish').addEventListener('click', () => {
        try {
            MatrixContent.validateContent(data);
            $('publish-summary').textContent = '准备发布 ' + data.posts.length + ' 篇文章，以及当前网站设置。';
            $('publish-message').textContent = ''; $('publish-dialog').showModal();
        } catch (error) { status(error.message, true); }
    });
    $('publish-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    $('confirm-publish').addEventListener('click', async () => {
        if (!token || busy) return;
        busy = true; updateControls(); $('workspace').inert = true; $('connect').disabled = true;
        $('confirm-publish').disabled = true; $('publish-dialog').querySelector('[data-close]').disabled = true;
        $('publish-message').textContent = '正在检查线上版本并提交修改…';
        let submittedSha, submittedData;
        try {
            submittedData = MatrixContent.validateContent(data);
            const source = JSON.stringify(submittedData, null, 2) + '\n';
            if (new TextEncoder().encode(source).length > 900000) throw new Error('内容超过发布大小限制，请减少文章内容或拆分后发布。');
            submittedSha = await MatrixContent.gitBlobSha(source);
            const remote = await api('/contents/content.json?ref=' + branch);
            if (remote.sha !== baseSha) throw new Error('GitHub 中已有更新，本次修改没有提交。请先导出草稿，再点击“载入已发布版本”后合并修改。');
            const result = await api('/contents/content.json', {method: 'PUT', body: JSON.stringify({
                message: 'Update blog content through the web editor', content: MatrixContent.encodeBase64(source), sha: remote.sha, branch
            })});
            if (!result.content?.sha) throw new Error('GitHub 未返回提交结果，请查看仓库确认是否成功。');
            baseSha = result.content.sha; data = submittedData; baseline = JSON.stringify(data);
            saveDraft(); $('publish-dialog').close();
            status('修改已提交到 GitHub。请等待 Pages 部署完成后刷新网站查看。');
        } catch (error) {
            // A network interruption after PUT can hide a successful commit. Check content before reporting failure.
            let recovered = false;
            if (submittedSha) {
                try {
                    const remote = await api('/contents/content.json?ref=' + branch);
                    if (remote.sha === submittedSha) {
                        baseSha = remote.sha; data = submittedData; baseline = JSON.stringify(data); saveDraft();
                        $('publish-dialog').close(); status('已确认修改提交成功。请等待 Pages 部署完成后刷新网站。'); recovered = true;
                    }
                } catch { /* Preserve the draft and let the user check the repository. */ }
            }
            if (!recovered) { $('publish-message').textContent = error.message; status('尚未确认发布成功。草稿已保留：' + error.message, true); }
        } finally {
            busy = false; $('workspace').inert = false; $('confirm-publish').disabled = false;
            $('publish-dialog').querySelector('[data-close]').disabled = false; updateControls();
        }
    });
    try {
        const loaded = await MatrixContent.loadContent();
        data = loaded.data; baseSha = loaded.sha; baseline = JSON.stringify(data);
        let draft;
        try { draft = JSON.parse(localStorage.getItem(draftKey) || 'null'); } catch { /* Storage can be disabled. */ }
        if (draft?.data && typeof draft.baseSha === 'string' && typeof draft.baseline === 'string') {
            try { data = MatrixContent.validateContent(draft.data, false); baseSha = draft.baseSha; baseline = draft.baseline; } catch { status('旧草稿格式有误，已载入线上版本。', true); }
        }
        selectPost(data.posts[0]?.id); updateControls();
        status(hasChanges() ? '已恢复上次的本地草稿 · 尚未发布' : '选择文章开始编辑，或点击“新建文章”。');
    } catch (error) { status('加载失败：' + error.message + ' 请通过网站地址或本地 HTTP 服务打开编辑页。', true); }
})();
