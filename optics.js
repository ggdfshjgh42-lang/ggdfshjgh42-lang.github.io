(function () {
    'use strict';
    const course = window.OpticsCourse;
    const content = document.getElementById('week-content');
    if (!course || course.weeks.length !== 8) {
        content.textContent = '课程暂时无法加载，请刷新页面重试。';
        content.setAttribute('role', 'alert');
        return;
    }
    const weeks = course.weeks;
    const totalDays = weeks.reduce((sum, week) => sum + week.days.length, 0);
    const progressKey = 'optics-roadmap-2026-v1';
    const notesKey = 'optics-roadmap-notes-2026-v1';
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const allowedIds = new Set(weeks.flatMap((week, wi) => week.days.map((_, di) => wi + '-' + di)));
    const esc = value => String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
    let storageAvailable = true;
    let saveTimer = 0;
    let toastTimer = 0;
    let selectedWeek = 0;
    let selectedDay = 0;
    let renderedId = null;

    function readRecord(key, type) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || '{}');
            if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
            return Object.fromEntries(Object.entries(value).filter(([id, item]) => allowedIds.has(id) && typeof item === type));
        } catch (error) {
            if (!(error instanceof SyntaxError)) storageAvailable = false;
            return {};
        }
    }
    let progress = readRecord(progressKey, 'boolean');
    const notes = readRecord(notesKey, 'string');

    function notify(message) {
        const status = document.getElementById('status-message');
        status.textContent = message;
        status.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => status.classList.remove('show'), 3500);
    }
    function updateStorageNotice() {
        if (!storageAvailable) document.getElementById('storage-note').textContent = '浏览器无法持久保存；当前记录暂存在本页。离开前请导出学习记录。';
    }
    function writeRecord(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            storageAvailable = false;
            updateStorageNotice();
            return false;
        }
    }
    function saveNotes() {
        clearTimeout(saveTimer);
        const field = document.getElementById('lesson-note');
        if (!field || !renderedId) return;
        notes[renderedId] = field.value;
        const saved = writeRecord(notesKey, notes);
        const status = document.getElementById('note-status');
        if (status) status.textContent = saved ? '已保存在此浏览器' : '暂存于本页，请导出';
    }
    function firstUnfinished(weekIndex) {
        for (let wi = weekIndex ?? 0; wi < (weekIndex === undefined ? weeks.length : weekIndex + 1); wi++) {
            const di = weeks[wi].days.findIndex((_, index) => !progress[wi + '-' + index]);
            if (di !== -1) return [wi, di];
        }
        return [weekIndex ?? 0, 0];
    }
    function sourceLink(id) {
        const resource = course.resources[id];
        return resource ? `<a href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer">${esc(resource.title)} <span aria-hidden="true">↗</span></a>` : '';
    }
    function updateProgress() {
        let total = 0;
        document.getElementById('weekNav').innerHTML = weeks.map((week, wi) => {
            const count = week.days.filter((_, di) => progress[wi + '-' + di]).length;
            total += count;
            return `<a class="week-link" href="#week${wi + 1}" data-week="${wi}" ${wi === selectedWeek ? 'aria-current="step"' : ''}><span class="week-number">${String(wi + 1).padStart(2, '0')}</span><span class="week-label">${esc(week.short)}</span><span class="week-tally" aria-label="已完成 ${count} 课，共 7 课">${count === 7 ? '✓' : count + '/7'}</span></a>`;
        }).join('');
        const percent = Math.round(total / totalDays * 100);
        document.getElementById('progress-percent').innerHTML = percent + '<small>%</small>';
        document.getElementById('progressFill').style.width = percent + '%';
        document.getElementById('doneCount').textContent = total + ' / ' + totalDays + ' 课已完成';
        const bar = document.getElementById('course-progress');
        bar.setAttribute('aria-valuenow', total);
        bar.setAttribute('aria-valuemax', totalDays);
        bar.setAttribute('aria-valuetext', `已完成 ${total} 课，共 ${totalDays} 课`);
        document.getElementById('resume-learning').firstChild.textContent = total === totalDays ? '全部完成，再复盘一遍 ' : '继续未完成的课程 ';
        updateStorageNotice();
    }
    function renderLesson(moveFocus = false) {
        const week = weeks[selectedWeek];
        const lesson = week.days[selectedDay];
        const id = selectedWeek + '-' + selectedDay;
        const number = selectedWeek * 7 + selectedDay + 1;
        const completed = week.days.filter((_, di) => progress[selectedWeek + '-' + di]).length;
        content.innerHTML = `
            <section class="week" id="week${selectedWeek + 1}" aria-labelledby="week-title">
                <header class="week-header"><div class="week-topline"><span class="week-badge">WEEK ${String(selectedWeek + 1).padStart(2, '0')} <span class="phase-label">/ ${esc(week.phase)}</span></span><span class="week-mini-progress">${completed} / 7 完成</span></div><h2 id="week-title">${esc(week.name)}</h2><p>${esc(week.why)}</p><p class="core-topics"><span>本周关键词</span> · ${esc(week.core)}</p></header>
                <nav class="day-tabs" aria-label="本周的七节课">${week.days.map((day, di) => {
                    const done = Boolean(progress[selectedWeek + '-' + di]);
                    return `<button type="button" class="day-tab ${done ? 'is-complete' : ''}" data-select-day="${di}" ${selectedDay === di ? 'aria-current="step"' : ''} aria-label="第 ${selectedWeek * 7 + di + 1} 天：${esc(day.title)}，${done ? '已完成' : '未完成'}"><span>DAY</span><b>${String(selectedWeek * 7 + di + 1).padStart(2, '0')}</b><small>${done ? '✓ 完成' : di === 6 ? '周复盘' : '学习'}</small></button>`;
                }).join('')}</nav>
                <article class="lesson-card" aria-labelledby="lesson-title"><div class="lesson-eyebrow"><span>LESSON ${String(number).padStart(2, '0')} / 56</span><span class="lesson-time">约 120 分钟 · 自主完成</span></div><h3 id="lesson-title" class="lesson-title" tabindex="-1">${esc(lesson.title)}</h3>
                    <ul class="lesson-goals">${lesson.goals.map(goal => '<li>' + esc(goal) + '</li>').join('')}</ul>
                    <div class="equation">${esc(lesson.formula)}</div>
                    <section class="lesson-section"><h4 class="section-kicker"><span>01</span>先学这部分</h4><p class="reading-target">${esc(lesson.reading)}</p><div class="source-links">${lesson.resources.map(sourceLink).join('')}</div></section>
                    <section class="lesson-section"><h4 class="section-kicker"><span>02</span>关掉资料，动手做</h4><p class="practice">${esc(lesson.practice)}</p><details class="solution"><summary>做完再看：解题过程与对照要点 <span aria-hidden="true">+</span></summary><div class="solution-body">${esc(lesson.answer)}</div></details><p class="pitfall"><b>容易踩的坑</b> · ${esc(lesson.mistake)}</p></section>
                    <div class="deliverable"><span aria-hidden="true">↗</span><div><b>今天带走的成果</b>${esc(lesson.output)}</div></div>
                    <div class="note-heading"><label for="lesson-note">留一点自己的理解</label><span id="note-status">${notes[id] ? '已保存在此浏览器' : '仅保存在此浏览器'}</span></div><textarea id="lesson-note" maxlength="20000" placeholder="我的计算与结论：\n还没想明白的地方：\n下次回来先核查什么："></textarea>
                    <div class="lesson-actions"><label class="completion-label"><input type="checkbox" data-day="${id}" ${progress[id] ? 'checked' : ''}>我已独立完成，并核对了结果</label><button type="button" class="next-button" id="next-lesson">${number === totalDays ? '回到第一课复盘' : '下一课'} <span aria-hidden="true">→</span></button></div>
                </article>
                <details class="checkpoint"><summary>第 ${selectedWeek + 1} 周验收 · 我能独立做到什么？</summary><p>${esc(week.test)}</p><p class="checkpoint-note">闭卷解释 → 改一个参数先预测 → 用计算或仿真核查。第 7 天优先用于自检与补漏。</p></details>
            </section>`;
        renderedId = id;
        document.getElementById('lesson-note').value = notes[id] || '';
        updateProgress();
        if (moveFocus) {
            document.getElementById('lesson-title').focus({preventScroll: true});
            content.scrollIntoView({behavior: motion.matches ? 'instant' : 'smooth', block: 'start'});
        }
    }
    function activateTab(name) {
        document.querySelectorAll('[data-tab]').forEach(tab => {
            const active = tab.dataset.tab === name;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            document.getElementById('panel-' + tab.dataset.tab).hidden = !active;
        });
    }
    function route(initial = false) {
        saveNotes();
        const hash = location.hash.slice(1);
        if (['lab', 'formulas', 'resources'].includes(hash)) {
            activateTab(hash);
            if (hash === 'lab') updateLab();
            if (!initial) document.querySelector('.workspace-tabs').scrollIntoView({behavior: motion.matches ? 'instant' : 'smooth', block: 'start'});
            return;
        }
        const match = /^week([1-8])(?:-day([1-7]))?$/.exec(hash);
        if (match) {
            selectedWeek = Number(match[1]) - 1;
            selectedDay = match[2] ? Number(match[2]) - 1 : firstUnfinished(selectedWeek)[1];
        } else if (initial) {
            [selectedWeek, selectedDay] = firstUnfinished();
        }
        activateTab('course');
        renderLesson(!initial && hash !== 'workspace');
        if (initial && match) requestAnimationFrame(() => content.scrollIntoView({block: 'start', behavior: 'instant'}));
    }
    function navigateLesson(wi, di) {
        saveNotes();
        const hash = '#week' + (wi + 1) + '-day' + (di + 1);
        if (location.hash === hash) {
            activateTab('course');
            renderLesson(true);
        } else location.hash = hash;
    }
    document.getElementById('weekNav').addEventListener('click', event => {
        const link = event.target.closest('[data-week]');
        if (!link) return;
        event.preventDefault();
        const [wi, di] = firstUnfinished(Number(link.dataset.week));
        navigateLesson(wi, di);
    });
    content.addEventListener('click', event => {
        const day = event.target.closest('[data-select-day]');
        if (day) navigateLesson(selectedWeek, Number(day.dataset.selectDay));
        if (event.target.closest('#next-lesson')) {
            const next = (selectedWeek * 7 + selectedDay + 1) % totalDays;
            navigateLesson(Math.floor(next / 7), next % 7);
        }
    });
    content.addEventListener('change', event => {
        const checkbox = event.target.closest('[data-day]');
        if (!checkbox || !allowedIds.has(checkbox.dataset.day)) return;
        saveNotes();
        progress[checkbox.dataset.day] = checkbox.checked;
        const saved = writeRecord(progressKey, progress);
        // Keep focus on the checkbox instead of replacing the lesson DOM.
        updateProgress();
        const count = weeks[selectedWeek].days.filter((_, di) => progress[selectedWeek + '-' + di]).length;
        content.querySelector('.week-mini-progress').textContent = count + ' / 7 完成';
        const button = content.querySelector(`[data-select-day="${selectedDay}"]`);
        button.classList.toggle('is-complete', checkbox.checked);
        button.querySelector('small').textContent = checkbox.checked ? '✓ 完成' : selectedDay === 6 ? '周复盘' : '学习';
        button.setAttribute('aria-label', `第 ${selectedWeek * 7 + selectedDay + 1} 天：${weeks[selectedWeek].days[selectedDay].title}，${checkbox.checked ? '已完成' : '未完成'}`);
        if (!saved) notify('进度暂存在本页，请在离开前导出记录。');
    });
    content.addEventListener('input', event => {
        if (event.target.id !== 'lesson-note') return;
        document.getElementById('note-status').textContent = '正在保存…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveNotes, 350);
    });
    document.getElementById('resume-learning').addEventListener('click', () => navigateLesson(...firstUnfinished()));
    document.getElementById('start-learning').addEventListener('click', event => {
        event.preventDefault();
        navigateLesson(...firstUnfinished());
    });
    document.getElementById('resetBtn').addEventListener('click', () => {
        if (!confirm('清空 56 课的完成勾选？学习笔记会保留。建议先导出学习记录。')) return;
        saveNotes();
        progress = {};
        writeRecord(progressKey, progress);
        renderLesson();
        notify('完成进度已重置，学习笔记已保留。');
    });
    document.getElementById('export-records').addEventListener('click', () => {
        saveNotes();
        const lines = ['# 我的光学学习记录', '', '导出时间：' + new Date().toISOString(), '', '勾选表示完成任务，不等同于已经理解。', ''];
        weeks.forEach((week, wi) => {
            lines.push('## 第 ' + (wi + 1) + ' 周 · ' + week.name, '');
            week.days.forEach((day, di) => {
                const id = wi + '-' + di;
                lines.push('### ' + (progress[id] ? '[x]' : '[ ]') + ' Day ' + (wi * 7 + di + 1) + ' · ' + day.title, '', notes[id] || '（暂无笔记）', '');
            });
        });
        const url = URL.createObjectURL(new Blob([lines.join('\n')], {type: 'text/markdown;charset=utf-8'}));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'optics-study-records-' + new Date().toISOString().slice(0, 10) + '.md';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify('学习进度和笔记已导出为 Markdown 文件。');
    });
    const tabs = document.querySelector('.workspace-tabs');
    tabs.addEventListener('click', event => {
        const tab = event.target.closest('[data-tab]');
        if (!tab) return;
        if (tab.dataset.tab === 'course') navigateLesson(selectedWeek, selectedDay);
        else if (location.hash === '#' + tab.dataset.tab) activateTab(tab.dataset.tab);
        else location.hash = tab.dataset.tab;
    });
    tabs.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const items = Array.from(tabs.querySelectorAll('[role=tab]'));
        const current = items.indexOf(document.activeElement);
        if (current === -1) return;
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
        items[index].focus();
        items[index].click();
    });

    const formulas = [
        ['波长与频率', 'ν = c/λ₀；λ介质 = λ₀/n', 'λ₀ 是真空波长，ν 单位 Hz，n 为该频率的折射率。', '静止界面两侧频率不变；介质中的相速度为 c/n。', 0, 1],
        ['单光子能量', 'E = hν = hc/λ₀', 'h ≈ 6.626×10⁻³⁴ J·s；hc ≈ 1240 eV·nm。', '波长取真空值；用 nm 代入 1240 时结果为 eV。', 0, 1],
        ['斯涅尔定律', 'n₁ sin θ₁ = n₂ sin θ₂', '角度均相对界面法线，n 按所用波长取值。', '均匀各向同性介质间的界面；先检查是否全反射。', 0, 2],
        ['全反射临界角', 'θc = arcsin(n₂/n₁)', '从 n₁ 较高的介质进入 n₂ 较低的介质。', '只有 n₁ > n₂ 且 θ₁ > θc 才发生此处的全反射。', 0, 3],
        ['薄透镜与放大率', '1/f = 1/u + 1/v；m = −v/u', '实物 u > 0，实像 v > 0，会聚透镜 f > 0。', '空气、理想薄透镜、近轴；u = f 时没有有限像距。', 1, 1],
        ['F 数与光量', 'N = f/D入瞳；E像面约 ∝ 1/N²', 'D 是入瞳直径，不是随意选取的镜片直径。', '光量比较须固定物体、透射、成像条件，忽略渐晕等变化。', 1, 3],
        ['双缝条纹间距', 'Δy ≈ λL/d', 'L 是屏距，d 是两缝间距；与单缝宽度 a 区分。', '相干、同偏振分量；远场、小角度近似。', 2, 1],
        ['单缝中央峰全宽', 'W中央 ≈ 2λL/a', 'a 为单缝宽，L 为屏距；全宽是两侧第一暗纹之间。', '夫琅禾费远场、小角度模型；勿把半宽报成全宽。', 2, 4],
        ['艾里斑与角分辨率', 'd首暗环 ≈ 2.44λN；θR ≈ 1.22λ/D', '前式为像面首暗环直径；后式为两点瑞利角判据。', '无像差、圆孔、空气与远物近似；有限共轭应检查工作 F 数。', 3, 4],
        ['马吕斯定律', 'I出 = I入 cos²θ', 'θ 是线偏振入射电场与检偏轴的夹角。', '理想检偏器；非偏振光先过第一片时另乘平均 1/2。', 3, 1],
        ['MTF 与采样', 'MTF = C像/C物；νN = 1/(2p)', 'C = (Imax−Imin)/(Imax+Imin)；p 用 mm 则 νN 为 lp/mm。', '采样边界不保证实际可分辨；还需光学、像元响应及 SNR。', 3, 5],
        ['光电响应', 'R = ηqλ₀/(hc)；I光 = RP', 'η 无量纲，R 单位 A/W，P 为入射光功率。', '无额外内部增益的平均光电流模型；暗电流另计。', 4, 2],
        ['探测信噪比', 'SNR = S/√(S + D + σr²)', 'S、D 是平均信号/暗电子计数，σr 是读出噪声 rms 电子数。', '独立噪声，光子与暗电子按泊松统计；未计其他噪声项。', 4, 4],
        ['理想高斯光束', 'zR = πw₀²/λ；θ ≈ λ/(πw₀)', 'w₀ 为 1/e² 强度半径；θ 为远场发散半角。', '空气、理想 M² = 1、近轴；真实光束须核查束宽定义和 M²。', 5, 1],
        ['光纤数值孔径', 'NA = √(n芯²−n包²) = n外 sin θmax', 'θmax 是外介质中的接受半角。', '理想阶跃光纤的子午光线模型；不保证实际模式耦合效率。', 5, 3],
        ['损耗与一阶色散', 'P出/P入 = 10^(−αL/10)；Δτ ≈ |D|ΔλL', 'α 取 dB/长度；D、Δλ、L 的单位必须匹配。', '第一式是功率比；第二式未计啁啾、高阶或模式色散。', 5, 4],
        ['照度与均匀度', 'Eavg = ηΦv/A；U₀ = Emin/Eavg', 'Φv 用 lm，面积 A 用 m²，照度用 lx；η 为目标通量利用率。', '明确接收面积及采样口径；光度量与辐射量需按光谱加权区分。', 6, 1],
        ['光栅与干涉位移', 'd sin θ = mλ；Δx = N条纹λ₀/2', '前式 d 为刻线间距；后式 N条纹是完整周期数。', '光栅式为正入射；位移式为正常入射迈克耳孙、空气近似。', 6, 5]
    ];
    document.getElementById('formula-list').innerHTML = formulas.map(([title, formula, variables, scope, wi, di]) => `<article class="formula-card"><h3>${esc(title)}</h3><div class="equation">${esc(formula)}</div><p>${esc(variables)}</p><p class="formula-scope">适用条件 · ${esc(scope)}</p><a href="#week${wi + 1}-day${di + 1}">回到第 ${wi * 7 + di + 1} 课重做例题 ↗</a></article>`).join('');
    document.getElementById('resource-list').innerHTML = Object.values(course.resources).map((resource, index) => `<a class="resource-card" href="${esc(resource.url)}" target="_blank" rel="noopener noreferrer"><span class="resource-number">${String(index + 1).padStart(2, '0')}</span><div class="resource-copy"><h3>${esc(resource.title)}</h3><p>${esc(new URL(resource.url).hostname)}</p></div><span aria-hidden="true">↗</span></a>`).join('');

    // The ray diagram and reported numbers share one thin-lens model. Dashed
    // backwards extensions are drawn only for virtual images. Near-focus images
    // may be outside the viewport; finite values are still reported accurately.
    function updateLab() {
        const f = Number(document.getElementById('focal-length').value);
        const u = Number(document.getElementById('object-distance').value);
        const atFocus = Math.abs(u - f) < 1e-9;
        const v = atFocus ? Infinity : f * u / (u - f);
        const m = atFocus ? Infinity : -v / u;
        document.getElementById('focal-output').textContent = f + ' mm';
        document.getElementById('object-output').textContent = u + ' mm';
        const scale = Math.min(3, 300 / Math.max(u, 1.7 * f, atFocus ? 0 : Math.min(Math.abs(v), Math.max(2.5 * u, 3 * f))));
        const lx = 400, axis = 165;
        const objectX = lx - u * scale;
        const height = atFocus ? 40 : Math.min(44, 75 / Math.max(1, Math.abs(m)));
        const objectY = axis - height;
        const imageX = lx + v * scale;
        const imageY = axis - m * height;
        const clipped = !atFocus && (imageX < 22 || imageX > 778);
        let drawing = `<defs><clipPath id="ray-clip"><rect x="12" y="30" width="776" height="260"/></clipPath><marker id="object-tip" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#6b8b4d"/></marker><marker id="image-tip" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#af8647"/></marker></defs><path d="M18 ${axis}H782" stroke="#bec8b1" stroke-dasharray="4 5"/><path d="M400 40Q365 165 400 290Q435 165 400 40Z" fill="#dae7c3" fill-opacity=".55" stroke="#8fa675"/><text x="400" y="22" fill="#687263" font-size="11" text-anchor="middle">理想会聚薄透镜</text>`;
        for (const [x, label] of [[lx - f * scale, 'F'], [lx + f * scale, 'F′']]) {
            drawing += `<path d="M${x} ${axis - 4}V${axis + 4}" stroke="#889978"/><text x="${x}" y="${axis + 22}" fill="#889978" font-size="11" text-anchor="middle">${label}</text>`;
        }
        const rayEnd = 775;
        const ray1EndY = objectY + height / (f * scale) * (rayEnd - lx);
        const ray2EndY = axis + height / (u * scale) * (rayEnd - lx);
        drawing += `<g clip-path="url(#ray-clip)"><path d="M${objectX} ${objectY}H${lx}L${rayEnd} ${ray1EndY}" fill="none" stroke="#8baca0" stroke-width="1.5"/><path d="M${objectX} ${objectY}L${rayEnd} ${ray2EndY}" fill="none" stroke="#91a56c" stroke-width="1.5"/>`;
        if (!atFocus && v < 0) drawing += `<path d="M${lx} ${objectY}L${imageX} ${imageY}M${lx} ${axis}L${imageX} ${imageY}" stroke="#af8647" stroke-width="1.2" stroke-dasharray="5 5"/>`;
        drawing += `<path d="M${objectX} ${axis}V${objectY}" stroke="#6b8b4d" stroke-width="3" marker-end="url(#object-tip)"/>`;
        if (!atFocus) drawing += `<path d="M${imageX} ${axis}V${imageY}" stroke="#af8647" stroke-width="3" marker-end="url(#image-tip)"/>`;
        drawing += `</g><text x="${objectX}" y="${axis + 43}" text-anchor="middle" font-size="12" fill="#6b8b4d">物</text>`;
        if (!atFocus && !clipped) drawing += `<text x="${imageX}" y="${axis + (v > 0 ? 58 : 43)}" text-anchor="middle" font-size="12" fill="#af8647">${v > 0 ? '实像' : '虚像'}</text>`;
        if (atFocus) drawing += '<text x="590" y="66" text-anchor="middle" font-size="13" fill="#687263">两条出射光线平行 · 像在无穷远</text>';
        drawing += '<text x="400" y="312" text-anchor="middle" font-size="10" fill="#7a8770">示意图自动缩放，横纵比例不相同；同图物/像高度比与 m 一致</text>';
        document.getElementById('diagram-content').innerHTML = drawing;
        const property = atFocus ? '物在焦点 · 平行出射' : v > 0 ? '倒立实像' : '正立虚像';
        const size = atFocus ? '' : Math.abs(m) > 1.001 ? ' · 放大' : Math.abs(m) < 0.999 ? ' · 缩小' : ' · 等大';
        document.getElementById('lab-result').innerHTML = atFocus ? `<b>${property}</b><p>像距 v：<strong>无有限值（∞）</strong><br>放大率：<strong>无有限值</strong></p><small>分母 u−f = 0，不能在有限距离放置清晰像面。</small>` : `<b>${property}${size}</b><p>像距 v：<strong>${v.toFixed(2)} mm</strong><br>横向放大率 m：<strong>${m.toFixed(3)}</strong></p><small>${clipped ? '像在当前画幅之外，以数值为准。' : v > 0 ? 'v > 0，实际光线在透镜另一侧会聚。' : 'v < 0，反向延长线在物侧会聚。'}</small>`;
        document.getElementById('diagram-desc').textContent = `${f} mm 焦距，${u} mm 物距；${property}${size}。${atFocus ? '出射光线平行。' : '像距 ' + v.toFixed(2) + ' mm，放大率 ' + m.toFixed(3) + '。'}图中虚线是反向延长线。`;
    }
    document.getElementById('focal-length').addEventListener('input', updateLab);
    document.getElementById('object-distance').addEventListener('input', updateLab);
    document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
        document.getElementById('focal-length').value = 50;
        document.getElementById('object-distance').value = {real: 150, virtual: 30, infinity: 50}[button.dataset.preset];
        updateLab();
    }));
    window.addEventListener('hashchange', () => route());
    window.addEventListener('beforeunload', saveNotes);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNotes(); });
    route(true);
    updateLab();
})();
