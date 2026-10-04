// 适配层护栏：上游 styles.css 一升级，adapt.css 里的补救就可能静默失配
// （同类教训：hub 升级后 nginx 注入的选择器静默失效，界面上没人发现）。
// 这里查八件事：
//   1. 上游所有声明了 Archivo Black 的选择器，adapt.css 的字体栈都得覆盖到；
//   2. adapt.css 引用的本地字体文件必须真的在 vendor/fonts/ 里；
//   3. index.html 里 adapt.css 必须排在 styles.css 之后（同优先级下顺序决定胜负）；
//   4. JS 用 hidden 属性开关的元素，adapt.css 必须有配套的 [hidden] { display: none }；
//   5. 移植版自己插进页面的节点（分组标签、延迟块、NETWORK 区的速度…）必须有配套样式；
//   6. 卡片排版依赖的上游类名（.net-totals / .net-total-item）必须还在；
//   7. 卡片 NETWORK 区那一行的结构与顺序（含「底部栏不该再出现」）；
//   8. .node-ping-value 与上游 .metric-value 的 font-size 必须一致（右列数字对齐）；
// 9. 分组展示的第三种取值 none 必须真的被 script.js 处理，且「列表显示运行时间」这个
//    开关不再出现在任何一处（按需求删除后不许悄悄回来）。
//  10. 成本卡片的「到期提醒」两种形态：JS 两份 DOM 都渲染，adapt.css 按宽度选一份。
//  11. 卡片名字必须单行省略（否则长名卡片与同行的短名卡片错位），印章文案是 TODAY / ND / EXPIRED。
//  12. 内置参考汇率表 FX_CNY：有 CNY: 1、常见机房货币够用、带日期与来源，且脚本里没有运行时汇率接口。
//  13. 详情页的节点备注：monitor.js 透传字段 → script.js 拆成小卡片（私有在前、公有在后）→
//      adapt.css 有样式；私有那几枚必须带「虚线边 + 锁图标」的标记。
import { existsSync, readFileSync } from 'node:fs';

const styles = readFileSync('src/styles.css', 'utf8');
const adapt = readFileSync('src/adapt.css', 'utf8');
const html = readFileSync('src/index.html', 'utf8');

const norm = (selector) => selector.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// 从 monitor.js 里取一个 `var NAME = [...]` 数组字面量（只用在护栏自己要比对的白名单上）
function extractArray(text, name) {
  const start = text.indexOf(`var ${name} = [`);
  if (start < 0) throw new Error(`在 src/monitor.js 里找不到 var ${name} = [`);
  const end = text.indexOf('];', start);
  return new Function(`return ${text.slice(start + `var ${name} = `.length, end + 1)}`)();
}

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
  // 选择器里必须真的连着写 `sel[hidden]`：只看「包含 sel」+「包含 [hidden]」会被
  // 改名后的 #cost-card-XX[hidden] 这种规则骗过（实测漏检过一次）。
  const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase();
  const hiddenPattern = new RegExp(`${escaped}\\[hidden\\]`);
  const covered = [...rules(adapt), ...rules(styles)].some(
    (rule) =>
      rule.body.replace(/\s+/g, '').includes('display:none') &&
      rule.selectors.some((s) => hiddenPattern.test(s))
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
  'node-ping', 'node-ping-row', 'node-ping-name', 'node-ping-value', 'node-ping-loss',
  'net-rate', 'net-total-up', 'net-total-down',
  'cost-card', 'cost-block', 'cost-title', 'cost-amount', 'cost-divider', 'cost-chips',
  'cost-chip', 'cost-chip-blue', 'cost-chip-red', 'cost-clear', 'cost-meta',
  'cost-note', 'cost-foot', 'cost-alerts', 'cost-alert-full', 'cost-alert-compact',
  'cost-alert', 'cost-alert-list',
  // 详情页的节点备注（script.js 的 remarkChipsHTML 拼出来的）
  'modal-node-remark', 'remark-chip', 'remark-chip-text', 'remark-lock'
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
//    移植版把上行/下行速度并进了 NETWORK 区那一行（.net-totals / .net-total-item），
//    给两个合计加了 .net-total-up / .net-total-down 是为了脱离上游的 :first-child/:last-child
//    取色（4 个子元素后那两个伪类不再指向绿/蓝）。上游一改这些类名不会报错，而是整行塌掉，
//    所以这里按「上游样式表里必须还有」来查（不看 adapt.css，否则自己定义的规则会盖住这条）。
const anchors = ['.net-totals', '.net-total-item'];
const upstreamSelectors = [...rules(styles)].flatMap((rule) => rule.selectors);
for (const anchor of anchors) {
  const cls = anchor.slice(1);
  if (!hasClass(upstreamSelectors, cls)) {
    problems.push(`${anchor} 在上游 styles.css 里不存在了：script.js 的 NETWORK 区排版挂在它上面`);
  }
}

// 7. 卡片 NETWORK 区那一行的结构（速度已从底部栏搬进来）。
//    · 底部栏的标记不该再出现——半途回退会多出一栏空的 UP/DOWN SPEED；
//    · 四个元素的**顺序**决定上下行速度对调与否（错误不会报错，只是数字反了）。
const script = readFileSync('src/script.js', 'utf8');
if (script.includes('class="node-footer"')) {
  problems.push('script.js 的卡片模板里还有 class="node-footer"：速度已并入 NETWORK 区，底部栏应已移除');
}
const netRowStart = script.indexOf('class="net-totals"');
if (netRowStart < 0) {
  problems.push('script.js 里找不到 class="net-totals"：卡片 NETWORK 区的合计/速度行不见了');
} else {
  const rest = script.slice(netRowStart);
  const netRow = rest.slice(0, rest.indexOf('</div>'));
  const order = [...netRow.matchAll(/class="([^"]+)"/g)].map((m) => m[1]);
  const expected = ['net-totals', 'net-total-item net-total-up', 'net-rate', 'net-total-item net-total-down', 'net-rate'];
  if (JSON.stringify(order) !== JSON.stringify(expected)) {
    problems.push(`卡片 NETWORK 区这一行的结构变了：\n    实际 ${JSON.stringify(order)}\n    期望 ${JSON.stringify(expected)}（合计·速率 上，合计·速率 下）`);
  }
}

// 8. 「延迟值与指标值同号」是卡片排版改动的核心（同一列数字才成一条竖线）。
//    直接比对两份 CSS 里声明的字号：任何一边被单独改动都会在这里失败。
function fontSizeOf(cssText, selector) {
  for (const rule of rules(cssText)) {
    if (!rule.selectors.includes(selector)) continue;
    const matched = rule.body.match(/font-size\s*:\s*([^;]+)/);
    if (matched) return matched[1].trim();
  }
  return null;
}
const metricFontSize = fontSizeOf(styles, '.metric-value');
const pingFontSize = fontSizeOf(adapt, '.node-ping-value');
if (!metricFontSize || !pingFontSize) {
  problems.push('取不到 .metric-value / .node-ping-value 的 font-size，两者的对齐关系无法核对');
} else if (metricFontSize !== pingFontSize) {
  problems.push(
    `.node-ping-value 的 font-size（${pingFontSize}）与上游 .metric-value（${metricFontSize}）不一致：` +
      '延迟数字会比指标数字矮一截，同一列里对不齐'
  );
}

// 9. 站点可选值 / 已删开关的两条硬规矩。
//    · cardGroupView 多了 none 这一档：适配层认识它、但 script.js 没处理的话，站长选了
//      「不显示分组」页面毫无变化，而且不报错（本轮就是新增这个取值）。
//    · 「列表显示运行时间」（showUptime）按要求删除、列表强制显示：它一旦被谁加回来，
//      面板上会多出一个不该存在的开关。
// 先剥掉 JS 注释再查：注释里写一句「cardGroupView === 'none'」的说明不算处理过——
// 自测时这条护栏就被 script.js 自己的注释骗过（和 [hidden] 那条同类的坑）。
// `[^:]` 是为了放过 http:// 这类字符串里的双斜杠。
const stripJsComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const jsCode = stripJsComments(script);
if (!jsCode.includes("cardGroupView === 'none'")) {
  problems.push(
    "script.js 里没有 cardGroupView === 'none' 的分支：后台选「不显示分组」时页面不会有任何变化"
  );
}
// 「不显示分组」按需求在**两个视图**都生效：判断条件里不能再出现 viewMode
// （曾经写成只作用于卡片视图，被用户当场要求收紧）。
const noneLine = jsCode.split('\n').find((line) => line.includes("cardGroupView === 'none'"));
if (noneLine && /viewMode/.test(noneLine)) {
  problems.push(
    'cardGroupView === none 的判断里出现了 viewMode：这个取值要在两个视图都不显示分组标签行'
  );
}
for (const [label, source] of [
  ['src/script.js', jsCode],
  ['src/monitor.js', stripJsComments(readFileSync('src/monitor.js', 'utf8'))],
  ['theme.json', readFileSync('theme.json', 'utf8')]
]) {
  if (source.includes('showUptime')) {
    problems.push(`${label} 里又出现了 showUptime：这个开关已按要求删除，列表视图的运行时间强制显示`);
  }
}

// 10. 卡片延迟的横排（站点设置 cardPingLayout = columns）。
//     JS 拼给延迟块的类名、monitor.js 的取值白名单、adapt.css 的选择器，三处任何一处对不上
//     都不会报错：只是站长选了「横排」页面照样竖排（或反过来说横排样式永远不生效）。
//     所以按「白名单取值 → 类名 → adapt.css 里真有这条规则」串起来查。
const pingLayoutPrefix = "'node-ping ping-layout-'";
if (!jsCode.includes(pingLayoutPrefix)) {
  problems.push(
    `script.js 里找不到 ${pingLayoutPrefix} 这个类名前缀：卡片延迟块不再按 cardPingLayout 挂类名`
  );
}
if (!/cardPingLayout/.test(jsCode)) {
  problems.push('script.js 里没有读 cardPingLayout：这一档设置改了页面不会有任何变化');
}
const pingLayouts = extractArray(readFileSync('src/monitor.js', 'utf8'), 'CARD_PING_LAYOUTS');
if (!pingLayouts.includes('columns')) {
  problems.push('monitor.js 的 CARD_PING_LAYOUTS 里没有 columns：后台选了横排也会被适配层丢掉');
}
const columnsRule = [...rules(adapt)].find((rule) =>
  rule.selectors.some((s) => s === '.node-ping.ping-layout-columns')
);
if (!columnsRule) {
  problems.push(
    '.node-ping.ping-layout-columns 在 adapt.css 里没有规则：卡片延迟的横排（columns）会静默退回竖排'
  );
} else if (!/flex-direction\s*:\s*row/.test(columnsRule.body)) {
  problems.push('.node-ping.ping-layout-columns 的规则里没有 flex-direction: row：三列不会并排');
}
// 横排的两条视觉规矩（按要求加的）：每列内容居中 + 列间一条竖线隔开。
// 它们失配时页面照常渲染，只是「居中/竖条」不见了，所以一样要写进护栏。
const columnsRowRule = [...rules(adapt)].find((rule) =>
  rule.selectors.some((s) => s === '.node-ping.ping-layout-columns .node-ping-row')
);
if (!columnsRowRule) {
  problems.push('.node-ping.ping-layout-columns .node-ping-row 没有规则：横排的列没有自己的排版');
} else if (!/text-align\s*:\s*center/.test(columnsRowRule.body)) {
  problems.push(
    '.node-ping.ping-layout-columns .node-ping-row 里没有 text-align: center：三列的文字不会各自居中'
  );
}
const dividerRule = [...rules(adapt)].find((rule) =>
  rule.selectors.some((s) => s === '.node-ping.ping-layout-columns .node-ping-row + .node-ping-row::before')
);
const dividerBody = dividerRule ? dividerRule.body.toLowerCase().replace(/\s+/g, '') : '';
if (!dividerRule) {
  problems.push(
    '横排缺少列间竖条的规则（.node-ping-row + .node-ping-row::before）：三个数据之间不会再有竖线隔开'
  );
} else if (!dividerBody.includes('background:')) {
  problems.push('列间竖条的规则里没有 background：竖线不会画出来');
} else if (!dividerBody.includes('transform:translatex(-50%)')) {
  problems.push(
    '列间竖条的规则里没有 transform: translateX(-50%)：竖线会贴在右侧那一列上（两侧留白不对称）'
  );
}
if (columnsRowRule && !columnsRowRule.body.toLowerCase().replace(/\s+/g, '').includes('position:relative')) {
  problems.push(
    '.node-ping.ping-layout-columns .node-ping-row 没有 position: relative：列间竖条会相对别的元素定位'
  );
}

const iStyles = html.indexOf('href="styles.css"');
const iAdapt = html.indexOf('href="adapt.css"');
if (iAdapt < 0) problems.push('index.html 没有引入 adapt.css');
else if (iStyles < 0) problems.push('index.html 没有引入 styles.css');
else if (iAdapt < iStyles) problems.push('index.html 里 adapt.css 排在 styles.css 之前，适配规则会被上游覆盖');

// 10. 成本卡片的「到期提醒」两种形态（宽屏逐台列印章 / 窄屏汇总可点开）。
//     两份 DOM 同时渲染、由 CSS 按宽度选一份，任一处对不上都不会报错：要么手机上又冒出
//     十几枚红印章把卡片撑高（实测 493px，首屏一半），要么宽屏只剩一句「7 天内到期 4 台」、
//     名字再也看不见。
function mediaBlock(cssText, condition) {
  const start = cssText.indexOf(`@media ${condition}`);
  if (start < 0) return '';
  const open = cssText.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < cssText.length; i += 1) {
    if (cssText[i] === '{') depth += 1;
    else if (cssText[i] === '}') {
      depth -= 1;
      if (depth === 0) return cssText.slice(open, i + 1);
    }
  }
  return '';
}
const ruleBody = (cssText, selector) =>
  [...rules(cssText)]
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.body)
    .join(';')
    .toLowerCase()
    .replace(/\s+/g, '');
if (!jsCode.includes('cost-alert-full') || !jsCode.includes('cost-alert-compact')) {
  problems.push(
    'script.js 没有同时渲染 cost-alert-full / cost-alert-compact：成本卡片的到期提醒会只剩一种形态'
  );
}
if (!ruleBody(adapt, '.cost-alert-compact').includes('display:none')) {
  problems.push('.cost-alert-compact 没有 display: none：宽屏下汇总与逐台印章会同时冒出来');
}
const narrow = mediaBlock(adapt, '(max-width: 768px)');
if (!narrow) {
  problems.push('adapt.css 里找不到 @media (max-width: 768px)：成本卡片的窄屏形态没有落点');
} else {
  if (!ruleBody(narrow, '.cost-alert-full').includes('display:none')) {
    problems.push('窄屏没有把 .cost-alert-full 收起来：手机上会逐台列出红印章、把卡片撑得很高');
  }
  if (!ruleBody(narrow, '.cost-alert-compact').includes('display:flex')) {
    problems.push('窄屏没有把 .cost-alert-compact 显示出来：手机上看不到到期汇总');
  }
}

// 11. 卡片上的节点名必须单行省略（否则长名卡片会把名字以下的区块推下去、与同行的短名卡片错开），
//     以及到期印章不再用 (0D) 这种读起来像打错的写法。
const nameBody = ruleBody(adapt, '.node-name');
if (!nameBody.includes('text-overflow:ellipsis') || !nameBody.includes('white-space:nowrap')) {
  problems.push('.node-name 没有单行省略：长名字会把卡片的名字以下整体推下去，和同行的短名卡片错开');
}
if (!ruleBody(adapt, '.node-header > div:first-child').includes('min-width:0')) {
  problems.push(
    '.node-header > div:first-child 没有 min-width: 0：flex 子项会被不可断行的长名字撑开，省略号根本不生效'
  );
}
const infoBody = ruleBody(adapt, '.node-info');
if (!infoBody.includes('-webkit-line-clamp:2')) {
  problems.push('.node-info 没有两行截断：长 CPU 型号会把卡片撑高、与同一排的卡片错开');
}
if (!/min-height:2\.7em/.test(infoBody)) {
  problems.push('.node-info 没有预留两行高度：同一排里 1 行与 2 行的卡片会差一行（实测 74 vs 91px）');
}
if (!jsCode.includes("'TODAY'") || !jsCode.includes("'EXPIRED'")) {
  problems.push('到期印章的文案不是 TODAY / ND / EXPIRED：卡片上的标签统一用大写英文，中文天数会跟其余标签混排');
}
if (/\(0D\)|\(今天\)|\(已过期\)/.test(jsCode)) {
  problems.push('到期印章的文案退回了 (0D) 或中文天数：口径是 TODAY / ND / EXPIRED');
}

// 12. 内置参考汇率（FX_CNY）：站长没填的币种靠它折算，缺了就是整台机器的钱不进合计。
//     主题是离线静态包，所以脚本里**不许**出现运行时汇率接口地址；表里必须有 CNY: 1、
//     常见机房货币要够用，并且日期与来源要能自报家门（提示里要写出来，不能被当成实时汇率）。
if (!/FX_CNY\s*=\s*\{/.test(jsCode)) {
  problems.push('script.js 里找不到内置汇率表 FX_CNY：站长没填的币种会整台机器不计入合计');
} else {
  const start = jsCode.indexOf('FX_CNY = {');
  const table = jsCode.slice(start, jsCode.indexOf('};', start));
  if (!/CNY:\s*1/.test(table)) {
    problems.push('内置汇率表里没有 CNY: 1：这张表以人民币为基准，缺了它整张表都换算不了');
  }
  const codes = [...table.matchAll(/^\s*([A-Z]{3}):/gm)].map((m) => m[1]);
  if (codes.length < 10) {
    problems.push(`内置汇率表只有 ${codes.length} 个币种：常见机房货币（USD / EUR / GBP / HKD / AUD…）要够用`);
  }
  if (!codes.includes('HKD') || !codes.includes('AUD')) {
    problems.push('内置汇率表缺 HKD / AUD：这两种是机房账单里最常见的（实测最容易漏折算的就是它们）');
  }
}
if (!/FX_DATE\s*=\s*'/.test(jsCode) || !/FX_SOURCE\s*=\s*'/.test(jsCode)) {
  problems.push('内置汇率表没有 FX_DATE / FX_SOURCE：提示里没法自报「取自哪一天、哪个来源」，会被当成实时汇率');
}
if (/https?:\/\/[^'"\s]*(er-api|frankfurter|exchangerate)/i.test(jsCode)) {
  problems.push('script.js 里出现了运行时汇率接口地址：主题是离线静态包，访客端不该请求外部接口');
}
if (!/builtin\.delete\(code\)/.test(jsCode)) {
  problems.push('站长填的汇率表没有覆盖内置值：他填的汇率不会生效（内置值会一直压在上面）');
}

// 13. 详情页的节点备注（公开 + 私有）。
//     三处必须串起来：monitor.js 透传字段 → script.js 拆成小卡片 → adapt.css 有样式。
//     任一处断了都不报错、也不白屏：备注要么整个不出现，要么私有那几枚丢掉「虚线 + 锁」的标记
//     （管理员就分不出哪几条是「仅自己可见」了）。拆法本身也有硬规矩——私有那条必须认三种行尾，
//     hub 对它没有单行约束，只按 \n 拆会把 CRLF 的历史数据粘成一枚。
const monitorJs = stripJsComments(readFileSync('src/monitor.js', 'utf8'));
if (!/public_remark\s*:/.test(monitorJs) || !/\bremark\s*:/.test(monitorJs)) {
  problems.push('monitor.js 的 mapClient 没有透传 public_remark / remark：详情页里的节点备注永远不会出现');
}
if (!jsCode.includes('function remarkChips(') || !jsCode.includes('remarkChipsHTML(node)')) {
  problems.push('script.js 里没有 remarkChips / remarkChipsHTML 的调用：详情页的备注块没接上');
}
if (!/split\(\/\\r\\n\|\\r\|\\n\//.test(jsCode)) {
  problems.push('私有备注的切分没有同时认 CRLF / LF / 单独的 CR：hub 不校验这个字段，老数据会粘成一枚');
}
if (!/remark-chip\$\{chip\.own \? ' own' : ''\}/.test(jsCode) || !jsCode.includes('REMARK_LOCK_SVG')) {
  problems.push('私有备注的小卡片没有「own + 锁图标」的标记：管理员看不出哪几条是仅自己可见');
}
if (!/仅自己可见/.test(jsCode)) {
  problems.push('私有备注的小卡片没有「仅自己可见」的悬停提示');
}
// 站点开关：关掉后详情页里这一块不该出现（数据照旧在 node 上）。
if (!/state\.settings\.showRemark === false/.test(jsCode)) {
  problems.push('script.js 没有读 showRemark：后台关掉「详情页显示节点备注」后详情页照旧显示');
}
const remarkBlockBody = ruleBody(adapt, '.modal-node-remark');
if (!remarkBlockBody.includes('flex-wrap:wrap')) {
  problems.push('.modal-node-remark 没有 flex-wrap: wrap：多枚备注不会换行、会把详情页撑出横向滚动');
}
// 站长口径：私有那几枚的版式与公开**完全一致**，区分只靠锁图标 —— 所以这里反过来查：
// .remark-chip.own 里不许出现另一种边框 / 底色 / 阴影（加回来就与公开那几枚长得不一样了）。
const ownChipBody = ruleBody(adapt, '.remark-chip.own');
for (const forbidden of ['border-style:dashed', 'background:var(--bg)', 'box-shadow:none']) {
  if (ownChipBody.includes(forbidden)) {
    problems.push(`.remark-chip.own 里出现了 ${forbidden}：私有备注的版式要与公开一致，区分只靠锁图标`);
  }
}
if (!ruleBody(adapt, '.remark-lock').includes('width')) {
  problems.push('.remark-lock 没有尺寸：那枚小锁图标不会显示出来（私有备注就与公开分不开了）');
}
if (!existsSync('src/adapt.css')) problems.push('缺少 src/adapt.css');

if (problems.length) {
  throw new Error(`适配层校验未通过：\n  - ${problems.join('\n  - ')}`);
}
console.log(`适配层校验通过：上游 ${upstream.size} 个 Archivo Black 选择器全部覆盖，adapt.css 加载顺序正确`);
