# 网站风格备份

## 米色柔和版 · 2026-11-17

- 备份分支：`backup/warm-style-2026-11-17`
- 对应提交：`769a9b3befc1c262c95805ddb38149436794b5c6`
- 备份范围：当时完整网站，包括首页、博客、阅读、学习、游戏、脑图及资源文件。
- 分支链接：https://github.com/ggdfshjgh42-lang/ggdfshjgh42-lang.github.io/tree/backup/warm-style-2026-11-17

此前手绘版以 `sketch.css` 覆盖 `theme.css` 的视觉样式。恢复米色版时，可撤销引入手绘样式的提交；如果只恢复视觉而保留后来新增的文章或功能，应恢复对应 HTML 和样式文件，不要直接覆盖新的 `content.json`、书籍或用户数据。

备份分支保持在以上提交，不跟随主分支更新。浏览器内的阅读进度、导图和学习记录保存在原有位置；本次风格切换不迁移或清除这些数据。

## 手绘笔记本版 · 2026-11-17

- 备份分支：`backup/sketch-style-2026-11-17`
- 对应提交：`d5a77a5aea44e8574bc1e5dd114c574bbf99f309`
- 备份范围：本次改版前的完整网站，含手绘风格、七篇文章及全部应用。
- 分支链接：https://github.com/ggdfshjgh42-lang/ggdfshjgh42-lang.github.io/tree/backup/sketch-style-2026-11-17

当前「保持好奇」版参考 TYO 招聘站的奶油画布、品牌橙、彩色大字与几何构图，以 `visual.css` 统一导航和首页，以 `interiors.css` 统一功能页。插画保存在 `assets/curiosity-playground.svg`，无外部字体、动画库或图片请求。`theme.css` 和各页面原有样式保留为功能布局基础，`sketch.css` 保留供恢复参考。

恢复视觉时应撤销本次改版提交或恢复样式及对应 HTML；不要覆盖之后更新的 `content.json`、书籍或浏览器中的阅读、学习和脑图记录。现有 GitHub Pages 与自定义域名保持原发布方式。
