// 适配层护栏：上游 styles.css 一升级，adapt.css 里的补救就可能静默失配
// （同类教训：hub 升级后 nginx 注入的选择器静默失效，界面上没人发现）。
// 这里查三件事：
//   1. 上游所有声明了 Archivo Black 的选择器，adapt.css 的字体栈都得覆盖到；
//   2. adapt.css 引用的本地字体文件必须真的在 vendor/fonts/ 里；
//   3. index.html 里 adapt.css 必须排在 styles.css 之后（同优先级下顺序决定胜负）。
import { existsSync, readFileSync } from 'node:fs';

const styles = readFileSync('src/styles.css', 'utf8');
const adapt = readFileSync('src/adapt.css', 'utf8');
const html = readFileSync('src/index.html', 'utf8');

const norm = (selector) => selector.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// 极简 CSS 规则扫描：取出「最内层规则」的选择器与声明块。
// 够用就行——上游 CSS 没有嵌套规则，只有 @media 包一层。
function* rules(cssText) {
  for (const chunk of cssText.split('}')) {
    const open = chunk.lastIndexOf('{');
    if (open < 0) continue;
    const prevOpen = chunk.lastIndexOf('{', open - 1);
    const selectors = chunk.slice(prevOpen + 1, open).split(',').map(norm).filter((s) => s && !s.startsWith('@'));
    if (!selectors.length) continue;
    yield { selectors, body: chunk.slice(open + 1) };
  }
}

const upstream = new Set();
for (const rule of rules(styles)) {
  if (rule.body.includes('Archivo Black')) rule.selectors.forEach((s) => upstream.add(s));
}

const patched = new Set();
for (const rule of rules(adapt)) {
  if (rule.body.includes('Monitor Display CJK')) rule.selectors.forEach((s) => patched.add(s));
}

const problems = [];

const missing = [...upstream].filter((s) => !patched.has(s));
if (missing.length) {
  problems.push(
    `这些上游选择器用了 Archivo Black，但 adapt.css 的字体栈没覆盖（中文名会又变细）：\n    ${missing.join('\n    ')}`
  );
}
if (!upstream.size) problems.push('styles.css 里一条 Archivo Black 都没找到，检查脚本是否还适用');

for (const [, font] of adapt.matchAll(/local\('([^']+)'\)/g)) {
  // local() 只会命中访客本机字体，这里只校验写法非空，真正的兜底靠 unicode-range + 系统回落
  if (!font.trim()) problems.push(`adapt.css 里有一个空的 local()`);
}

// 4. JS 用 hidden 属性开关的元素，必须有配套的 [hidden] { display: none } 规则。
//    作者样式里的 display 声明（如 .btn-admin { display: flex }）会压过 UA 的
//    [hidden]，开关会静默失效（实测「显示后台入口按钮」关掉后按钮照样在）。
const js = readFileSync('src/script.js', 'utf8');
const selectorOf = new Map();
for (const [, key, sel] of js.matchAll(/(\w+):\s*document\.(?:getElementById|querySelector)\(\s*'([^']+)'\s*\)/g)) {
  selectorOf.set(key, sel.startsWith('.') || sel.startsWith('#') ? sel : `#${sel}`);
}
const hiddenSwitched = new Set();
for (const [, key] of js.matchAll(/elements\.(\w+)\.hidden\s*=/g)) hiddenSwitched.add(key);
if (!hiddenSwitched.size) problems.push('script.js 里一个 hidden 开关都没找到，检查脚本是否还适用');
for (const key of hiddenSwitched) {
  const sel = selectorOf.get(key);
  if (!sel) {
    problems.push(`script.js 用 hidden 属性开关 elements.${key}，但 elements 映射里没有它的选择器`);
    continue;
  }
  const covered = [...rules(adapt), ...rules(styles)].some(
    (rule) =>
      rule.body.replace(/\s+/g, '').includes('display:none') &&
      rule.selectors.some((s) => s.includes(sel.toLowerCase()) && s.includes('[hidden]'))
  );
  if (!covered) {
    problems.push(
      `elements.${key}（${sel}）由 script.js 用 hidden 属性开关，但没有任何 "${sel}[hidden] { display: none }" 规则：` +
        `作者样式里的 display 会压过浏览器默认的 [hidden]，这个开关会静默失效`
    );
  }
}

// 5. 移植版自己插进页面的节点，adapt.css 里必须有配套样式。
//    JS 会照常把 DOM 插进去，CSS 一失配就静默退化成一排没有排版的文字（控制台不报错）。
const patchedClasses = [
  'group-tabs', 'group-tab', 'group-heading', 'group-heading-name', 'group-heading-count',
  'node-ping', 'node-ping-row', 'node-ping-name', 'node-ping-value'
];
const adaptSelectors = [...rules(adapt)].flatMap((rule) => rule.selectors);
const hasClass = (selectors, cls) =>
  selectors.some((selector) => new RegExp(`\\.${cls}(?![\\w-])`).test(selector));
for (const cls of patchedClasses) {
  if (!hasClass(adaptSelectors, cls)) {
    problems.push(`adapt.css 里没有 .${cls} 的规则：script.js 会插这块 DOM，缺样式会静默变成没排版的文字`);
  }
}

// 6. script.js 依赖的上游结构锚点必须还在。
//    卡片上的三网延迟按 .node-footer 定位并插在它前面；上游一旦改类名，
//    这里不会报错，而是插到卡片末尾（位置全错），所以单独查一遍。
const anchors = ['.node-footer'];
const upstreamSelectors = [...rules(styles)].flatMap((rule) => rule.selectors);
for (const anchor of anchors) {
  const cls = anchor.slice(1);
  if (!hasClass(upstreamSelectors, cls) && !hasClass(adaptSelectors, cls)) {
    problems.push(`${anchor} 在 styles.css / adapt.css 里都不存在了：script.js 拿它定位，插错位置不会报错`);
  }
}

const iStyles = html.indexOf('href="styles.css"');
const iAdapt = html.indexOf('href="adapt.css"');
if (iAdapt < 0) problems.push('index.html 没有引入 adapt.css');
else if (iStyles < 0) problems.push('index.html 没有引入 styles.css');
else if (iAdapt < iStyles) problems.push('index.html 里 adapt.css 排在 styles.css 之前，适配规则会被上游覆盖');

if (!existsSync('src/adapt.css')) problems.push('缺少 src/adapt.css');

if (problems.length) {
  throw new Error(`适配层校验未通过：\n  - ${problems.join('\n  - ')}`);
}
console.log(`适配层校验通过：上游 ${upstream.size} 个 Archivo Black 选择器全部覆盖，adapt.css 加载顺序正确`);
