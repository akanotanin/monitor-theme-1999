// 打主题包：theme.json + LICENSE + dist/（+ preview.png，可选）
// 极简探针的主题包结构：Hub 只做静态文件伺服，dist/ 就是整站。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// 默认值必须与 src/monitor.js 的 DEFAULTS 同步，否则「面板显示已开启、页面还是旧样子」
execFileSync(process.execPath, ['scripts/check-defaults.mjs'], { stdio: 'inherit' });
// 适配层护栏：上游 styles.css 一升级，adapt.css 的补救可能静默失配
execFileSync(process.execPath, ['scripts/check-adapt.mjs'], { stdio: 'inherit' });

const meta = JSON.parse(readFileSync('theme.json', 'utf8'));
if (!/^[A-Za-z0-9_-]+$/.test(meta.short || '')) throw new Error(`theme.json 的 short 不合法: ${meta.short}`);
if (!existsSync('dist/index.html')) throw new Error('缺少 dist/index.html，先跑 npm run build');
if (!existsSync('LICENSE')) throw new Error('缺少 LICENSE');

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// 别把旧产物打进包里：逐个比对 dist/ 与源文件的哈希。
// （不用 mtime：Node 的 cpSync 会把源文件的修改时间一起带过去，改完源码时间戳仍相同。）
const distPairs = [
  ...['index.html', 'styles.css', 'adapt.css', 'script.js', 'monitor.js', 'vendor/fonts.css'].map((file) => [`src/${file}`, file]),
  ...['echarts.min.js', ...readdirSync('vendor/fonts').map((font) => `fonts/${font}`)].map((file) => [`vendor/${file}`, `vendor/${file}`])
];
const stale = distPairs.filter(([source, target]) => {
  if (!existsSync(`dist/${target}`)) return true;
  return hashFile(source) !== hashFile(`dist/${target}`);
});
if (stale.length) {
  throw new Error(
    `dist/ 与源码不一致（构建产物过期），先跑 npm run build 再打包：\n  ${stale.map(([s, t]) => `${t} ← ${s}`).join('\n  ')}`
  );
}

rmSync('release', { recursive: true, force: true });
const staging = 'release/staging';
mkdirSync(staging, { recursive: true });
const files = ['theme.json', 'LICENSE', 'dist'];
for (const file of files) cpSync(file, `${staging}/${file}`, { recursive: true });
if (existsSync('preview.png')) {
  cpSync('preview.png', `${staging}/preview.png`);
  files.push('preview.png');
} else {
  console.warn('提示：没有 preview.png，面板里这个主题不会有缩略图');
}

const archive = 'release/theme.tar.gz';
execFileSync('tar', ['--format=ustar', '-czf', archive, '-C', staging, ...files], { stdio: 'inherit' });
const size = statSync(archive).size;
console.log(`Theme package: ${archive} (${(size / 1048576).toFixed(2)} MB)`);

const versioned = `release/monitor-theme-${meta.short}-${meta.version}.tar.gz`;
cpSync(archive, versioned);
console.log(`Versioned copy: ${versioned}`);

// 校验和：发版页与回装复验都拿它比对
const digest = createHash('sha256').update(readFileSync(versioned)).digest('hex');
writeFileSync(`${versioned}.sha256`, `${digest}  ${versioned.split('/').pop()}\n`);
console.log(`sha256: ${digest}`);
