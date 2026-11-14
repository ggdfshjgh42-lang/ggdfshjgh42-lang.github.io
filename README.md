# Fantastic Matrix

个人博客、光学学习室与小游戏（五子棋、中国象棋），托管在 GitHub Pages。

## 不用改代码，直接编辑文章

部署本次更新后，打开 **https://fantasticmatrix.xyz/admin.html**，或点击首页底部的「内容管理」。

1. 选择已有文章，或点击「新建文章」。修改标题、日期、摘要、标签和正文；正文可以加粗、插入小标题、引用、列表、链接和图片地址。
2. 点击「预览文章」检查效果。「网站设置」可以修改网站名称、首页标题和简介。
3. 编辑内容自动保存到当前浏览器。刷新页面可以恢复，但这些草稿尚未更新到网站。可用「导出备份」保存 JSON 文件，或在另一台设备「导入备份」。不要在公共电脑上保留个人草稿。
4. 点击「连接 GitHub」，按页面提示创建 fine-grained personal access token：仓库仅选 `ggdfshjgh42-lang.github.io`，添加 **Contents: Read and write** 权限。生成时设置合适的到期时间。
5. 把令牌输入编辑页，然后点击「发布全部修改」并确认。令牌只在当前页面内存中使用，不会保存到草稿、仓库或浏览器存储中；刷新后需要重新连接。
6. 修改提交到 `main` 的 `content.json` 后，等待 GitHub Pages 部署完成，再刷新首页。

Chrome 中已登录 GitHub，并不会自动为其他网站提供 API 授权。令牌应只输入你自己的编辑页，不要发送到聊天或写入仓库。

「发布全部修改」提交整个文章列表及网站设置，包括新增、删除和更改。编辑页没有私密文章功能，发布后的内容保存在公开仓库。读者能打开管理页，但没有仓库写入权限的令牌无法改变网站。

如果另一台设备先发布了内容，编辑器会拒绝覆盖新版本。先导出自己的草稿，点击「载入已发布版本」，再把需要的修改合并后发布。该按钮读取 GitHub 已提交的内容，即使 Pages 仍在部署。

## 文件

- `index.html` / `blog.js`：博客首页和文章路由，原有 `#post-...` 链接继续有效。
- `content.json`：四篇原有文章及网站文字，编辑器只更新这个文件。
- `content.js`：共享的数据校验、正文清理及 GitHub 编码。
- `admin.html` / `admin.css` / `admin.js`：浏览器中的内容管理页。
- `optics-roadmap.html` / `optics.css` / `optics.js` / `optics-data.js`：光学学习室，含 8 周 56 课、例题解析、薄透镜实验与公式速查。原有学习进度自动保留；学习笔记保存在当前浏览器，可导出 Markdown 记录。
- `gomoku.html` / `gomoku-online.js`：五子棋及 WebSocket 联机界面。
- `gomoku-engine.js` / `gomoku-worker.js`：五子棋多步搜索、成五优先、防守跳四和双重威胁；在 Worker 中运行。
- `xiangqi.html` / `xiangqi.js` / `xiangqi-engine.js` / `xiangqi-worker.js`：中国象棋、走法提示及人机搜索；包含吃子延伸、局面缓存、走法排序及重复局面判断。
- `game-audio.js` / `game-audio.css`：两种棋共用的落子、吃子、将军与胜负音效，以及静音按钮；浏览器本地合成，无外部音频依赖。
- `gomoku-config.js`：公开的联机服务地址。
- `multiplayer/`：免费计划可用的 Cloudflare 房间服务、测试及部署说明，详见 [联机服务部署](multiplayer/README.md)。
- `CNAME`：自定义域名。

本地预览：在此目录运行 `python -m http.server 8080`，然后打开 `http://localhost:8080/admin.html`。不要直接双击 HTML 文件，否则浏览器无法加载内容文件。

GitHub Pages 的发布分支应指向 `main`，目录为仓库根目录（Settings → Pages）。原有站点若使用 Actions，应保持原有发布流程能包含这些静态文件。

参考：[GitHub 内容 API](https://docs.github.com/en/rest/repos/contents)，[访问令牌管理](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。

两种棋均提供入门、普通、挑战三档难度，可以在对局中切换。搜索有时间与节点上限，取最后一轮完整搜索的结果；Worker 不可用时回退到短时本地搜索。音效在首次点击或按键后启用，静音选择保存在当前浏览器并在两种棋间共用，不播放背景音乐。

规则与战术测试：`node --test tests/xiangqi.test.cjs tests/gomoku.test.cjs`。浏览器回归：安装 Playwright 和 Chromium 后运行 `python tests/games.browser.py`，覆盖桌面和手机、Worker 取消、回退、难度切换、静音保存、音频波形及联机状态重播。象棋采用休闲和棋规则（三次重复局面或连续 60 回合无吃子），不裁定竞赛中的长将、长捉。

## 在线书架

打开 [书架](https://fantasticmatrix.xyz/bookshelf.html)，可以在线阅读 EPUB、PDF 和 TXT。把书籍上传到仓库 `books/` 文件夹并提交到 `main`，等待 Pages 更新后刷新书架即可。支持子文件夹分类、书名与作者搜索、格式及未读／在读／读完筛选，支持按书名、最近阅读和进度排序。继续阅读会优先选择尚未读完的书。书籍资料和上传方法见 [添加书籍说明](books/README.md)。

EPUB/TXT 支持章节目录、字号与阅读主题；PDF 保留固定版式，整本连续上下滚动，支持页码跳转、双指缩放、加减缩放（50%–400%）及「适宽」。电脑可用鼠标拖动页面、Ctrl＋滚轮缩放；放大后可左右平移。「锁定缩放」固定当前比例并禁用缩放操作，仍可上下滚动；轻点正文呼出菜单后可解锁。当前页、页内位置、缩放比例和缩放锁定状态保存在当前浏览器。PDF 仅渲染屏幕附近页面，远处页保留占位，限制画布像素和并发渲染数量。阅读进度和偏好不会跨设备自动同步。现有 Jekyll 发布流程自动生成 `books/index.json` 书单，本地预览时可回退至 GitHub 公开目录；同步错误时保留缓存及 `books/catalog.json` 备用书单。不需要向读者索取 GitHub 令牌。

在书架点击书籍或「继续阅读」会直接打开全屏阅读器。正文就绪后，书名、设置、目录、进度与翻页栏全部收起，正文铺满窗口，不保留悬浮按钮或滚动条。轻点／单击正文可呼出或收起菜单；滚动阅读、点击「收起」或停止操作约 4 秒后自动收起。菜单浮在正文上方，不改变书页大小或阅读位置。打开目录、输入页码及使用键盘操作时，菜单会保持可用；按 Tab 可找回菜单，按 Esc 收起。

在菜单点击「书架」可返回并更新进度。浏览器支持时会同时进入原生全屏，并请求隐藏浏览器导航栏；可按 Esc 或点击「退出全屏」退出。不支持原生全屏时仍以整个网页窗口阅读，网页无法强制隐藏浏览器或操作系统保留的栏。直接打开阅读链接时，先轻点正文呼出菜单，再点击「全屏」。PDF 使用与网站一起托管的 PDF.js 兼容构建，支持缺少较新 Promise 接口的浏览器；主模块及 Worker 版本需保持一致。

阅读器浏览器回归：安装 Python Playwright（`pip install playwright`，`playwright install chromium`）后运行 `python tests/reader.browser.py`；也可加 `--browser /usr/bin/chromium` 使用已有浏览器。测试启动临时本地服务并生成书单，检查三种格式、阅读状态、全屏及返回、进度保存和手机布局，不访问外部服务。

PDF 布局与缩放单元测试：`node --test tests/pdf-reader.test.cjs`，检查连续页定位、不同纸张比例、缩放中心保持、长书渲染窗口、画布内存上限和缩放锁定。

## 思维导图

打开 [思维导图](https://fantasticmatrix.xyz/mindmap/)，或点击首页与各栏目导航中的「思维导图」。组件的静态文件位于 `mindmap/`，与网站一起发布，无需额外服务。支持自由分支、节点关联、笔记、大纲、灵感收集和 JSON／SVG／Markdown 导出。

导图与灵感自动保存在当前浏览器，不会上传到仓库或自动跨设备同步。可导出 JSON 备份，并在另一台设备导入。`mindmap/` 的导入、导出与保存不会修改博客文章或其他组件的数据。

