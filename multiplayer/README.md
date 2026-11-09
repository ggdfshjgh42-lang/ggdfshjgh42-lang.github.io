# 五子棋联机服务

网页继续由 GitHub Pages 托管。这个 Cloudflare Worker 用 WebSocket 传递棋步，每个房间由一个 SQLite-backed Durable Object 管理。它不依赖 WebRTC、STUN 或 TURN。

服务端保存棋盘、回合及比分并校验落子。每个房间限两人；临时断线暂停对局，原标签页重新连接或刷新后可以恢复。房主主动退出会关闭房间；客人主动退出会空出座位并重开棋局。房间在最后一次棋局操作两小时后自动清理。

## 首次部署

1. 注册并登录 [Cloudflare](https://dash.cloudflare.com/sign-up)，使用 Workers Free 计划。此项目的 SQLite Durable Objects 和 WebSocket Hibernation 可使用免费额度；超额时服务会受限。不要为了部署选择付费计划。
2. 在本目录运行 `npm ci`（需 Node.js 22 或更新版本及 curl），再运行 `npx wrangler login`。远程环境可使用 `npx wrangler login --device --browser=false`，在自己的浏览器完成授权，密码或令牌不需要交给别人。
3. 运行 `npm test`，通过后运行 `npm run deploy`。
4. 部署脚本会检查服务并自动把公开地址写进仓库根目录的 `gomoku-config.js`。该文件只包含服务网址，不包含密钥。
5. 将 `gomoku.html`、`gomoku-online.js`、`gomoku-config.js` 发布到原 GitHub Pages 站点。两台设备分别选择「在线对战」，一方建房、一方输入六位房间码。

服务尚未部署、或 `gomoku-config.js` 地址为空时，在线模式会明确提示未启用，双人和人机模式可以正常使用。

如果 `workers.dev` 在玩家网络中无法访问，可以在 Cloudflare 为 Worker 绑定自己的子域名，然后将该 HTTPS 地址填入 `gomoku-config.js`。站点主域名仍可保留原来的 GitHub Pages 配置。

## 本地验证

在仓库根目录运行 `python -m http.server 8080`，在本目录另开终端运行 `npm run dev`。本地测试时将 `gomoku-config.js` 的地址临时设为 `http://127.0.0.1:8787`，然后用两个浏览器会话打开 `http://127.0.0.1:8080/gomoku.html`。发布前改回部署脚本写入的 HTTPS 地址。

`npm test` 使用真正的本地 Workers/Durable Objects 运行时验证建房、两人同步、最后一手获胜、非法操作、房间人数、掉线恢复和退出。

## 部署设置

- `wrangler.jsonc` 中的 `ALLOWED_ORIGINS` 限定可连接的网页来源；更换域名时一并修改并重新部署。
- 使用 SQLite migration 和 Hibernation API，等待落子时可休眠。免费额度见 [Cloudflare 官方定价](https://developers.cloudflare.com/durable-objects/platform/pricing/)。
- 玩家恢复凭据仅保存在当前标签页的 `sessionStorage`，不会放进网址或发送给对手。
- 更新后端时在本目录重新运行 `npm run deploy`。只修改网页不需要重部署 Worker。
