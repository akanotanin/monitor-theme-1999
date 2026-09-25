// 本地预览：静态伺服 dist/，可把 /api 反代到一台真实的 Hub。
//
//   npm run preview                       # 只伺服静态文件（页面会显示连接失败）
//   MONITOR_HUB=https://komari.im npm run preview
//   npm run preview -- --hub https://komari.im --port 9911
//
// 极简探针的接口没有 CORS 头，所以预览必须走这里的同源代理，浏览器直连 Hub 会被拦。
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
function argOf(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

const port = Number(argOf('port', process.env.PORT || 9911));
const hub = (argOf('hub', process.env.MONITOR_HUB) || '').replace(/\/+$/, '');
const root = 'dist';

if (!existsSync(join(root, 'index.html'))) {
  console.error('缺少 dist/index.html，先跑 npm run build');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

// 反代 /api/*：保留原始方法、请求头与 body，只换目标地址
async function proxy(req, res) {
  const target = hub + req.url;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['accept-encoding']; // 免得为解压再加一层依赖
  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined
  });
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') || 'application/octet-stream'
  });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      if (!hub) {
        res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('未设置 Hub：用 MONITOR_HUB=https://<域名> npm run preview 才能取到数据\n');
        return;
      }
      await proxy(req, res);
      return;
    }
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, relative);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) file = join(root, 'index.html'); // 主题是单页
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`预览服务出错：${error.message}\n`);
  }
}).listen(port, () => {
  console.log(`预览地址：http://127.0.0.1:${port}/`);
  console.log(hub ? `接口反代到：${hub}` : '未设置 Hub，只伺服静态文件');
});
