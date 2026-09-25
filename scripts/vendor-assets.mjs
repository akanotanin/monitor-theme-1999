// 把上游在 CDN 上的第三方资源（ECharts、字体）抓进 vendor/，带 sha256 校验。
// 上游 index.html 是直接引 CDN 的：Google Fonts 在部分网络不可达，会静默退回系统字体；
// 打包进主题后离线可用，也免得访客的浏览器去第三方取资源。
//
//   npm run vendor        # 已有且校验通过就跳过
//   npm run vendor -- --force
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const CDN = 'https://cdn.jsdelivr.net/npm';

// 版本与哈希都钉死：内容变了必须显式更新这里，避免构建结果悄悄漂移
const ASSETS = [
  {
    path: 'vendor/echarts.min.js',
    url: `${CDN}/echarts@5.5.1/dist/echarts.min.js`,
    sha256: 'e84270bd0cd5bdf60fefc26d00c2a391cb2e81f4d26a7a9ee16185a54773a3cf'
  },
  {
    path: 'vendor/fonts/archivo-black-latin-400-normal.woff2',
    url: `${CDN}/@fontsource/archivo-black@5.2.6/files/archivo-black-latin-400-normal.woff2`,
    sha256: '25f33e61cf995abd6be62931cf03bf427286259177b43618cc410ee0157cfd30'
  },
  {
    path: 'vendor/fonts/space-grotesk-latin-400-normal.woff2',
    url: `${CDN}/@fontsource/space-grotesk@5.2.6/files/space-grotesk-latin-400-normal.woff2`,
    sha256: '7e743892abc0e91731cdf942c89e62ed86ca7ac4da2dd3f367734abdc099eb1f'
  },
  {
    path: 'vendor/fonts/space-grotesk-latin-500-normal.woff2',
    url: `${CDN}/@fontsource/space-grotesk@5.2.6/files/space-grotesk-latin-500-normal.woff2`,
    sha256: 'b44b71f623fcf4a4ed91b70539e6cf4439599a5e3c746871e17703aa1aad90f3'
  },
  {
    path: 'vendor/fonts/space-grotesk-latin-700-normal.woff2',
    url: `${CDN}/@fontsource/space-grotesk@5.2.6/files/space-grotesk-latin-700-normal.woff2`,
    sha256: '8640d7dcce31a093ed62b99472bf25c5159eb7d74f9f112f9b566dbe096a1222'
  }
];

const force = process.argv.includes('--force');

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

let downloaded = 0;
for (const asset of ASSETS) {
  if (!force && existsSync(asset.path) && digest(readFileSync(asset.path)) === asset.sha256) {
    console.log(`跳过（已是最新）：${asset.path}`);
    continue;
  }
  mkdirSync(asset.path.slice(0, asset.path.lastIndexOf('/')), { recursive: true });
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`下载失败 ${asset.url} → HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = digest(buffer);
  if (actual !== asset.sha256) {
    throw new Error(`${asset.path} 的 sha256 不匹配：期望 ${asset.sha256}，实际 ${actual}`);
  }
  writeFileSync(asset.path, buffer);
  console.log(`已写入：${asset.path} (${(buffer.length / 1024).toFixed(1)} KB)`);
  downloaded += 1;
}

console.log(downloaded ? `完成：更新了 ${downloaded} 个文件` : '完成：全部已是校验过的版本');
