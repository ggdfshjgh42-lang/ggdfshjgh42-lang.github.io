# Fantastic Matrix

个人博客和五子棋，托管在 GitHub Pages。

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
- `gomoku.html`：原有五子棋。
- `CNAME`：自定义域名。

本地预览：在此目录运行 `python -m http.server 8080`，然后打开 `http://localhost:8080/admin.html`。不要直接双击 HTML 文件，否则浏览器无法加载内容文件。

GitHub Pages 的发布分支应指向 `main`，目录为仓库根目录（Settings → Pages）。原有站点若使用 Actions，应保持原有发布流程能包含这些静态文件。

参考：[GitHub 内容 API](https://docs.github.com/en/rest/repos/contents)，[访问令牌管理](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。
