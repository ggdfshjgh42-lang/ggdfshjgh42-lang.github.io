# 给书架添加书籍

将 EPUB、PDF 或 TXT 文件上传到本目录，可建立子文件夹分类。提交到 `main`，等待 GitHub Pages 完成更新后，在书架点击「刷新」。网站现有的 Jekyll 发布流程会自动生成 `books/index.json` 书单，无需每次修改代码或填写书单，读者也不必连接 GitHub API。

文件名支持 `书名 - 作者.epub`。例如：`books/文学/一本书 - 一位作者.epub`。未提供作者时，只用文件名作为书名。TXT 建议保存为 UTF-8；阅读器也提供 GB18030 解码。EPUB 支持无 DRM 的 EPUB 2/3；PDF 保留固定页面，扫描版能看但无法自动变成可重排文字。

## 可选书籍资料

`catalog.json` 的 `books` 数组可以填写书名、作者、分类、简介、封面。在 GitHub 书单同步不可用时，它也作为备用书单，所以希望离线保留在书架中的书籍都可以加入这里。

```json
{
  "version": 1,
  "books": [
    {
      "path": "books/文学/一本书 - 一位作者.epub",
      "title": "一本书",
      "author": "一位作者",
      "category": "文学",
      "description": "我为什么想读这本书。",
      "cover": "books/covers/一本书.jpg"
    }
  ]
}
```

`path`、`cover` 均从仓库根目录开始，保留 `books/` 前缀，不以 `/` 开头。封面支持 JPG、PNG、WebP、AVIF、GIF。所有文字按纯文本显示。没有封面时，书架会自动生成文字封面。

网站直接从 GitHub Pages 读取书籍，所以提交后要等 Pages 部署完成。书单会在浏览器缓存 5 分钟，点击「刷新」可立即重新同步。`index.json` 的 Liquid 模板请保留；它会在 Pages 构建时扫描本目录及子目录。本地纯静态预览时，书架会回退至 GitHub 公开目录 API；同步不可用时，会显示已有缓存或 `catalog.json` 备用书单，并显示提示，不会请求读者输入令牌。

网站仓库是公开的，放入的书籍和资料也会公开。单文件请保持小于 GitHub 网页上传限制；较大文件需要通过 Git 提交。不要使用 Git LFS 存储这些在线阅读文件，Pages 无法直接读取 LFS 实际内容。

阅读进度只保存在当前浏览器，没有账号或跨设备同步。演示文件 `开始阅读.txt` 可以删除，同时移除 `catalog.json` 中的对应资料。
