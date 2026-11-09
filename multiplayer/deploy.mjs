import { spawn, execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Wrangler handles OAuth locally; only the public endpoint is written to the site.
const wrangler = fileURLToPath(new URL('./node_modules/wrangler/bin/wrangler.js', import.meta.url));
const child = spawn(process.execPath, [wrangler, 'deploy'], {
  cwd: fileURLToPath(new URL('.', import.meta.url)),
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  stdio: ['inherit', 'pipe', 'inherit'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; process.stdout.write(chunk); });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', async code => {
  if (code !== 0) { process.exitCode = code || 1; return; }
  try {
    const matches = output.match(/https:\/\/fantastic-matrix-gomoku\.[a-z0-9-]+\.workers\.dev\b/g);
    if (!matches?.length) throw new Error('服务已部署，但未能自动获取地址。请从 Cloudflare 控制台复制地址到 gomoku-config.js。');
    const endpoint = matches.at(-1);
    // curl preserves the system proxy and CA settings on local and managed machines.
    const health = execFileSync('curl', ['--fail', '--silent', '--show-error', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', '--retry-max-time', '30', '--max-time', '15', endpoint + '/health'], { encoding: 'utf8' });
    if (JSON.parse(health).service !== 'fantastic-matrix-gomoku') {
      throw new Error('服务已部署，但健康检查未通过。请稍后检查 /health，再填写 gomoku-config.js。');
    }
    const config = '// Public room service endpoint; no account credentials belong in this file.\n' +
      'window.GOMOKU_SERVICE_URL = ' + JSON.stringify(endpoint) + ';\n';
    await writeFile(new URL('../gomoku-config.js', import.meta.url), config);
    console.log('\n联机服务已部署并通过检查：' + endpoint);
    console.log('已自动更新 gomoku-config.js。将网页修改发布到 GitHub Pages 后，朋友即可通过房间码联机。');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
});
