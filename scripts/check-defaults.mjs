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

// 字段类型与默认值必须对得上：Hub 面板用 configForm() 逐项过滤，其中 fits() 会按类型
// 校验默认值，不合法的那一项**静默不出现在面板上**（没有报错、页面也不报错，只是站长
// 看不到这个选项）。同类硬规则：select 的 options 里不能有空值（'' 就过不了），
// 所以「留空=自动」这种选项不能用 select 表达，只能给 string/text 让站长自己留空。
const expectedType = (value) =>
  typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
const typeFits = (fieldType, expected) =>
  (fieldType === 'number' && expected === 'number') ||
  (fieldType === 'boolean' && expected === 'boolean') ||
  ((fieldType === 'select' || fieldType === 'string' || fieldType === 'text') && expected === 'string');
for (const item of theme.config || []) {
  if (!item || !item.key) continue;
  if (item.type === 'title') continue;
  const expected = expectedType(declared[item.key]);
  if (!typeFits(item.type, expected)) {
    problems.push(
      `${item.key} 声明为 ${item.type}，默认值却是 ${expected}：Hub 的 fits() 判定它不合法，` +
        '这一项会静默从后台面板里消失'
    );
  }
  if (item.type === 'select') {
    const values = (item.options || []).map((option) => (typeof option === 'string' ? option : option.value));
    if (values.some((value) => value === '')) {
      problems.push(`${item.key} 的 options 里有空值：Hub 的 configForm 要求选项非空，否则整项不显示在面板上`);
    }
  }
}

// 选项列表也要对得上：适配层不认识的值会被丢掉，后台选了却看不到效果
const optionChecks = [
  ['accentColor', 'ACCENTS'],
  ['cardStyle', 'CARD_STYLES'],
  ['defaultViewMode', 'VIEW_MODES'],
  ['cardGroupView', 'CARD_GROUP_VIEWS']
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
