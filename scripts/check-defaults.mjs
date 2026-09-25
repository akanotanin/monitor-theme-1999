// 校验 theme.json 的配置项与 src/monitor.js 里的兜底默认值是否一致。
// 两处不一致的后果是「后台显示已开启、页面还是旧样子」：Hub 的默认值来自 theme.json，
// 而适配层在配置为空（{} 或老 Hub）时用自己的兜底值，谁写漏了都会静默跑偏。
import { readFileSync } from 'node:fs';

const theme = JSON.parse(readFileSync('theme.json', 'utf8'));
const source = readFileSync('src/monitor.js', 'utf8');

function extractObject(text, name) {
  const start = text.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`在 src/monitor.js 里找不到 var ${name} = {`);
  const end = text.indexOf('};', start);
  if (end < 0) throw new Error(`找不到 var ${name} 的结束位置`);
  const body = text.slice(start + `var ${name} = `.length, end + 1);
  return JSON.parse(JSON.stringify(new Function(`return ${body}`)()));
}

function extractArray(text, name) {
  const start = text.indexOf(`var ${name} = [`);
  if (start < 0) throw new Error(`在 src/monitor.js 里找不到 var ${name} = [`);
  const end = text.indexOf('];', start);
  return new Function(`return ${text.slice(start + `var ${name} = `.length, end + 1)}`)();
}

const defaults = extractObject(source, 'DEFAULTS');
const declared = {};
for (const item of theme.config || []) {
  if (item.key) declared[item.key] = item.default;
}

const problems = [];
for (const key of Object.keys(defaults)) {
  if (!(key in declared)) problems.push(`theme.json 缺少配置项 ${key}`);
  else if (JSON.stringify(defaults[key]) !== JSON.stringify(declared[key])) {
    problems.push(`${key}：theme.json default=${JSON.stringify(declared[key])}，monitor.js DEFAULTS=${JSON.stringify(defaults[key])}`);
  }
}
for (const key of Object.keys(declared)) {
  if (!(key in defaults)) problems.push(`src/monitor.js 的 DEFAULTS 缺少 ${key}（theme.json 有声明，页面端就没有兜底值）`);
}

// 选项列表也要对得上：适配层不认识的值会被丢掉，后台选了却看不到效果
const optionChecks = [
  ['accentColor', 'ACCENTS'],
  ['cardStyle', 'CARD_STYLES'],
  ['defaultViewMode', 'VIEW_MODES']
];
for (const [key, arrayName] of optionChecks) {
  const item = (theme.config || []).find((entry) => entry.key === key);
  if (!item || !item.options) continue;
  const fromTheme = item.options.map((option) => (typeof option === 'string' ? option : option.value));
  const fromSource = extractArray(source, arrayName);
  if (JSON.stringify(fromTheme) !== JSON.stringify(fromSource)) {
    problems.push(`${key} 的 options 不一致：theme.json=${JSON.stringify(fromTheme)}，monitor.js ${arrayName}=${JSON.stringify(fromSource)}`);
  }
}

if (problems.length) {
  console.error('配置默认值校验失败：');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`配置默认值校验通过：${Object.keys(defaults).length} 项，默认值与选项均一致`);
