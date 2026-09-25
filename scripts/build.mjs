// 构建：src/ + vendor/ → dist/
// 上游是纯静态主题（无打包器），这里保持同样的思路——只是把源文件与本地化的
// 第三方资源（ECharts、字体）搬到 dist/，所以构建产物可逐文件对应回源码。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';

const SRC_FILES = ['index.html', 'styles.css', 'adapt.css', 'script.js', 'monitor.js'];
const SRC_DIRS = ['vendor'];
const VENDOR_FILES = ['echarts.min.js'];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

// 缺文件就直接失败：宁可构建报错，也不要产出一个少了脚本或字体的包
const missing = [];
for (const file of SRC_FILES) if (!existsSync(`src/${file}`)) missing.push(`src/${file}`);
for (const file of VENDOR_FILES) if (!existsSync(`vendor/${file}`)) missing.push(`vendor/${file}`);
for (const font of existsSync('vendor/fonts') ? readdirSync('vendor/fonts') : []) {
  if (!font.endsWith('.woff2')) missing.push(`vendor/fonts/${font}（只允许 woff2）`);
}
if (missing.length) throw new Error(`构建缺少文件：\n  ${missing.join('\n  ')}`);

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/vendor/fonts', { recursive: true });

for (const file of SRC_FILES) cpSync(`src/${file}`, `dist/${file}`);
for (const dir of SRC_DIRS) cpSync(`src/${dir}`, `dist/${dir}`, { recursive: true });
for (const file of VENDOR_FILES) cpSync(`vendor/${file}`, `dist/vendor/${file}`);
cpSync('vendor/fonts', 'dist/vendor/fonts', { recursive: true });

// 产物自检：引用到的本地资源必须都在包里，否则用户在浏览器里只会看到一个空白页
const html = readdirSync('dist');
if (!html.includes('index.html')) throw new Error('dist/index.html 没有生成');
for (const asset of ['vendor/echarts.min.js', 'vendor/fonts.css', 'adapt.css', 'monitor.js', 'script.js', 'styles.css']) {
  if (!existsSync(`dist/${asset}`)) throw new Error(`dist/${asset} 没有生成`);
}
const fonts = readdirSync('dist/vendor/fonts').filter((f) => f.endsWith('.woff2'));
if (fonts.length < 4) throw new Error(`dist/vendor/fonts 只有 ${fonts.length} 个字体文件，期望 4 个`);

const size = walk('dist').reduce((sum, f) => sum + statSync(f).size, 0);
console.log(`dist/ 构建完成：${walk('dist').length} 个文件，${(size / 1048576).toFixed(2)} MB`);
