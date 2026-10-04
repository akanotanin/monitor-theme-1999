// 版式护栏：成本卡片（月度预算 / 剩余价值）与卡片上的节点名。
//   node scripts/verify-layout.mjs [--chrome <路径>]
//
// 做法：静态伺服本仓库 dist/，/api/* 全部由本文件里的固定夹具回答（不碰任何真实 Hub），
// 用 headless Chrome 在 1440 / 1000 / 390 三个机位各渲染一遍，按 DOM 断言而不是看图。
//
// 为什么要有它：这两块都改过一次「静默失效」的毛病——
//   · 缺汇率的货币只挂一个「?」，手机上连 hover 都没有，合计少算一截没人看得出来；
//   · 卡片名字没有截断，长名卡片把名字以下的区块整体推下去、与同行的短名卡片错开；
//   · 到期印章逐台列出，手机上把这张卡撑到近 500px（首屏全被它吃掉）。
// 这些都不会报错、也不会白屏，只有断言抓得住。
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = 'dist';
const CHROME = process.argv.includes('--chrome')
  ? process.argv[process.argv.indexOf('--chrome') + 1]
  : process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('缺少 dist/index.html，先跑 npm run build');
  process.exit(1);
}

/* ------------------------------- 夹具 ------------------------------- */
function node(id, over) {
  const base = {
    id, name: 'Node ' + id, os: 'Debian GNU/Linux 13 (trixie)', cpu_name: 'AMD EPYC 9654 96-Core Processor',
    cpu_cores: 1, arch: 'x86_64', mem_total: 2147483648, disk_total: 27917287424, swap_total: 0,
    country: 'JP', group: '', sort: id, traffic_limit: 1099511627776, traffic_mode: 'sum', virt: 'kvm',
    kernel: '6.1.0-53-cloud-amd64', online: true, price: 0, currency: 'CNY', billing_cycle: '',
    expires_at: '', expires_in: null, public_remark: ''
  };
  const out = Object.assign(base, over);
  out.metrics = {
    cpu: 12.5, mem_used: 1181116006, mem_total: out.mem_total, disk_used: 10844792422, disk_total: out.disk_total,
    load: [0.1, 0.2, 0.3], net_rx: 173400, net_tx: 165400, month_rx: 346030080000, month_tx: 175100000000,
    total_rx: 760000000000, total_tx: 391000000000, uptime: 4320000, procs: 76, swap_used: 0, swap_total: 0, tcp: 16, udp: 3
  };
  return out;
}
// 中性夹具：城市名 + 演示金额，用来复刻「多币种 / 今天到期 / 已过期 / 一次性 / 超长名字」这几种形状
const LONG_NAME = '达拉斯 · 一个名字特别特别特别长的节点用来测试三行以上的截断效果';
const MAIN = [
  // 这台名字与 CPU 名都超长：验证两者都收在各自的行数里、悬停能看全
  node(1, { name: LONG_NAME, country: 'US', price: 349, currency: 'CNY', billing_cycle: 'yearly', expires_in: 290, cpu_name: 'AMD EPYC 9654 96-Core Processor · 2 sockets · 192 threads · 384 MB L3 · engineering sample rev B2' }),
  // 这台故意给个短 CPU 名：验证「系统 · CPU」那行也固定占两行（短的一行、长的两行 → 同一排仍齐平）
  node(2, { name: '法兰克福', country: 'DE', price: 299, currency: 'CNY', billing_cycle: 'yearly', expires_in: 313, cpu_name: 'AMD EPYC Processor' }),
  node(3, { name: '东京 · CMI', country: 'JP', price: 120, currency: 'HKD', billing_cycle: 'monthly', expires_in: 0 }),
  node(4, { name: '东京 · CMI 2', country: 'JP', price: 120, currency: 'HKD', billing_cycle: 'monthly', expires_in: 0 }),
  node(5, { name: '东京 · CMI 3', country: 'JP', price: 120, currency: 'HKD', billing_cycle: 'monthly', expires_in: 0 }),
  node(6, { name: '新加坡', country: 'SG', price: 17, currency: 'AUD', billing_cycle: 'monthly', expires_in: -3 }),
  node(7, { name: '新加坡 2', country: 'SG', price: 17, currency: 'AUD', billing_cycle: 'monthly', expires_in: -30 }),
  node(8, { name: '新加坡 3', country: 'SG', price: 17, currency: 'AUD', billing_cycle: 'monthly', expires_in: -1 }),
  node(9, { name: 'V.PS 东京', country: 'JP', price: 11.11, currency: 'EUR', billing_cycle: 'yearly', expires_in: 37 }),
  node(10, { name: 'V.PS 东京 Gen 2', country: 'JP', price: 299.95, currency: 'EUR', billing_cycle: 'yearly', expires_in: 347 }),
  node(11, { name: 'GreenCloud 东京', country: 'JP', price: 12.12, currency: 'USD', billing_cycle: 'yearly', expires_in: 206 }),
  node(12, { name: 'RackNerd 阿什本', country: 'US', price: 10.6, currency: 'USD', billing_cycle: 'yearly', expires_in: 186 }),
  node(13, { name: '伦敦', country: 'GB', price: 5.42, currency: 'GBP', billing_cycle: 'monthly', expires_in: 120 }),
  node(14, { name: '伦敦 2', country: 'GB', price: 43.36, currency: 'GBP', billing_cycle: 'yearly', expires_in: 300 }),
  node(15, { name: '孟买', country: 'IN', price: 89.7, currency: 'CNY', billing_cycle: 'quarterly', expires_in: 60 }),
  node(16, { name: '首尔', country: 'KR', price: 32.16, currency: 'USD', billing_cycle: 'semiannual', expires_in: 45 }),
  node(17, { name: '一次性买断机', country: 'US', price: 50, currency: 'USD', billing_cycle: 'once', expires_in: 900 }),
  node(18, { name: '悉尼', country: 'AU', price: 11.33, currency: 'AUD', billing_cycle: 'yearly', expires_in: 5 }),
  node(19, { name: '未填价格的机器', country: 'JP', price: 0, currency: 'CNY', billing_cycle: 'yearly', expires_in: 100 }),
  // 两张汇率表里都没有的币种：唯一会走到「未计入 …」那行的情况
  node(20, { name: '测试币种机', country: 'US', price: 100, currency: 'XYZ', billing_cycle: 'yearly', expires_in: 100 })
];
// 带分组的夹具：验证「汇总卡片 → 分组标签 → 节点列表」这个顺序在页面上真的成立，
// 以及**切分组后页头统计与成本卡片跟着该分组重算**（第 ④ 组断言）。
// 东京组两台：一台普通、一台 3 天内到期且 CPU 特别高 —— 于是「平均 CPU」「到期印章」
// 在「全部」与「东京」两档下必然不同，统计到底有没有按分组算一眼可判。
const G_TOKYO_1 = node(40, { name: '东京一号', country: 'JP', price: 120, currency: 'HKD', billing_cycle: 'monthly', expires_in: 100, group: '东京' });
const G_TOKYO_2 = node(43, { name: '东京二号', country: 'JP', price: 60, currency: 'CNY', billing_cycle: 'monthly', expires_in: 3, group: '东京' });
G_TOKYO_2.metrics.cpu = 60;
const G_EUROPE = node(41, { name: '法兰克福一号', country: 'DE', price: 299, currency: 'CNY', billing_cycle: 'yearly', expires_in: 300, group: '欧洲' });
const G_UNGROUPED = node(42, { name: '没有分组的机器', country: 'US', price: 20, currency: 'USD', billing_cycle: 'yearly', expires_in: 200, group: '' });
const GROUPS = [G_TOKYO_1, G_TOKYO_2, G_EUROPE, G_UNGROUPED];
const B = MAIN[1];
const D = MAIN[12];
const A = MAIN[2];
const E = MAIN[18];
// 边界形态：每一条都是「静默失效」的常见落点
const SCENARIOS = [
  { key: 'main', nodes: MAIN, cfg: {} },
  { key: 'only-month', nodes: [A, B, D], cfg: { showCostCard: false }, want: { blocks: 1, notes: 0, reds: 0, divider: false } },
  { key: 'only-resid', nodes: [A, B, D], cfg: { showCostMonthCard: false }, want: { blocks: 1, notes: 0, reds: 1, divider: false } },
  { key: 'no-alerts', nodes: [B, D], cfg: {}, want: { blocks: 2, notes: 0, reds: 0, clear: 'ALL CLEAR ✓', divider: true } },
  { key: 'all-rated', nodes: [B, D, node(30, { name: '首尔', country: 'KR', price: 32.16, currency: 'USD', billing_cycle: 'semiannual', expires_in: 45 })], cfg: {}, want: { blocks: 2, notes: 0, reds: 0, clear: 'ALL CLEAR ✓', divider: true } },
  { key: 'with-groups', nodes: GROUPS, cfg: {}, want: { blocks: 2, notes: 0, reds: 1, divider: true, tabs: true } },
  { key: 'user-override', nodes: MAIN, cfg: { costRates: 'HKD=1' }, want: { blocks: 2, notes: 2, reds: 7, divider: true, month: '¥1007.68', hkdStar: false } },
  { key: 'no-price', nodes: [E], cfg: {}, want: { hidden: true } },
  { key: 'no-expiry', nodes: [node(21, { name: '无到期机', price: 20, currency: 'USD', billing_cycle: 'yearly', expires_in: null })], cfg: {}, want: { blocks: 2, notes: 0, reds: 0, clear: 'NO EXPIRY SET', divider: true } }
];

// 备注夹具：公开那条（随公开视图下发、匿名也拿得到）+ 私有那条（只在登录态下发）。
// 私有里故意带换行与半角/全角逗号混用，公开里带全角逗号——拆法见 script.js 的 remarkChips。
const NOTES_PUB = node(50, { name: '带公开备注的机器', country: 'JP', public_remark: '公开备注一，公开备注二' });
const NOTES_BOTH = node(51, { name: '公开与私有都有', country: 'DE', public_remark: '公开甲,公开乙', remark: '私有甲\n私有乙' });
const NOTES_NONE = node(52, { name: '没写备注的机器', country: 'US' });
const NOTES_BLANK = node(53, { name: '备注只有空白', country: 'US', public_remark: '   ', remark: ' , \n ' });
// 详情页备注的场景：admin 决定桩要不要下发私有字段（真 hub 也只对登录的管理员下发）
const REMARK_SCENARIOS = [
  { key: 'remark-public', nodes: [NOTES_PUB], cfg: {}, admin: false, want: { chips: 2, own: 0 } },
  { key: 'remark-both', nodes: [NOTES_BOTH], cfg: {}, admin: true, want: { chips: 4, own: 2 } },
  { key: 'remark-none', nodes: [NOTES_NONE], cfg: {}, admin: false, want: { chips: 0, own: 0 } },
  { key: 'remark-blank', nodes: [NOTES_BLANK], cfg: {}, admin: true, want: { chips: 0, own: 0 } },
  // 站点把「详情页显示节点备注」关掉：备注数据都在，这一块也不该出现
  { key: 'remark-off', nodes: [NOTES_BOTH], cfg: { showRemark: false }, admin: true, want: { chips: 0, own: 0 } }
];

/* --------------------------- 伺服 + 浏览器 --------------------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
let current = SCENARIOS[0];
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const json = (obj) => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  if (path === '/api/me') return json({ authed: false, github: false, history_days: 30, public_page: true, site: 'fixture', site_name: '1999 夹具' });
  if (path === '/api/nodes') return json({
    admin: !!current.admin,
    // 匿名视图里没有 remark 这个键（真 hub 只把私有备注下发给登录的管理员）
    nodes: current.nodes.map((n) => { const copy = { ...n }; if (!current.admin) delete copy.remark; return copy; })
  });
  if (path === '/api/themes/1999/config') return json(current.cfg);
  if (/^\/api\/nodes\/[^/]+\/metrics$/.test(path)) return json({ metrics: [], ping: [], probes: {}, loss: {} });
  const rel = normalize(decodeURIComponent(path)).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, rel);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) file = join(ROOT, 'index.html');   // 单页主题：未知路径回落入口
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(9916, r));

const port = 9540 + Math.floor(Math.random() * 9);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${process.env.TEMP || '.'}/m1999-verify-${Date.now()}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' });
await sleep(2500);
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); });
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

const PROBE = `(() => {
  const card = document.querySelector('#cost-card');
  const txt = (el) => el ? el.textContent.trim() : null;
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) }; };
  const chips = card ? [...card.querySelectorAll('.cost-chip-blue')].map(txt) : [];
  const names = [...document.querySelectorAll('.node-card')].map((c) => {
    const nm = c.querySelector('.node-name'), hd = c.querySelector('.node-header'), st = c.querySelector('.node-status'), inf = c.querySelector('.node-info');
    return { name: nm.textContent, title: nm.getAttribute('title'), nameH: Math.round(nm.getBoundingClientRect().height),
      infoText: inf.textContent, infoTitle: inf.getAttribute('title'), infoH: Math.round(inf.getBoundingClientRect().height),
      infoClipped: inf.scrollHeight > inf.clientHeight + 1,
      headerH: Math.round(hd.getBoundingClientRect().height), cardH: Math.round(c.getBoundingClientRect().height),
      clipped: nm.scrollWidth > nm.clientWidth + 1, rightGap: Math.round(st.getBoundingClientRect().right - c.getBoundingClientRect().right) };
  });
  return {
    viewport: { w: innerWidth, docScrollW: document.documentElement.scrollWidth },
    hidden: card ? card.hidden : null, cardBox: card ? box(card) : null,
    blocks: card ? [...card.querySelectorAll('.cost-block')].map(box) : [],
    titles: card ? [...card.querySelectorAll('.cost-title')].map(txt) : [],
    amounts: card ? [...card.querySelectorAll('.cost-amount')].map(txt) : [],
    chips, zeroChips: chips.filter((t) => /^[^0-9]*0\\.00/.test(t)), questionChips: chips.filter((t) => t.endsWith('?')),
    chipTitles: card ? Object.fromEntries([...card.querySelectorAll('.cost-chip-blue')].map((c) => [c.textContent.trim(), c.getAttribute('title') || ''])) : {},
    metaTitles: card ? [...card.querySelectorAll('.cost-meta span')].map((s) => s.getAttribute('title') || '') : [],
    notes: card ? [...card.querySelectorAll('.cost-note')].map(txt) : [],
    noteTitle: card ? (card.querySelector('.cost-note') || {}).title || null : null,
    reds: card ? [...card.querySelectorAll('.cost-alert-full .cost-chip-red')].map(txt) : [],
    compact: card ? [...card.querySelectorAll('.cost-alert-compact summary')].map(txt) : [],
    clear: card ? txt(card.querySelector('.cost-clear')) : null,
    meta: card ? txt(card.querySelector('.cost-meta')) : null,
    foot: card && card.querySelector('.cost-foot') ? box(card.querySelector('.cost-foot')) : null,
    dividerVisible: card ? vis(card.querySelector('.cost-divider')) : null,
    fullVisible: card ? vis(card.querySelector('.cost-alert-full')) : null,
    compactVisible: card ? vis(card.querySelector('.cost-alert-compact')) : null,
    tabsVisible: (() => { const t = document.querySelector('#group-tabs'); return !!t && getComputedStyle(t).display !== 'none' && t.getBoundingClientRect().height > 0; })(),
    tabsBox: (() => { const t = document.querySelector('#group-tabs'); if (!t || t.hidden || getComputedStyle(t).display === 'none') return null; const r = t.getBoundingClientRect(); return { y: Math.round(r.y), bottom: Math.round(r.bottom), h: Math.round(r.height) }; })(),
    mainOrder: [...document.querySelector('.main').children].map((el) => el.id || el.className),
    // 页头那排统计 + 卡片数 + 分组标签：第 ④ 组（切分组）断言用
    stats: {
      nodes: txt(document.getElementById('stat-nodes')), online: txt(document.getElementById('stat-online')),
      cpu: txt(document.getElementById('stat-cpu')), ram: txt(document.getElementById('stat-ram')),
      down: txt(document.getElementById('stat-net-in')), up: txt(document.getElementById('stat-net-out'))
    },
    cardCount: document.querySelectorAll('.node-card').length,
    tabLabels: [...document.querySelectorAll('.group-tab')].map((b) => b.textContent.trim()),
    activeTab: (() => { const a = document.querySelector('.group-tab.active'); return a ? a.textContent.trim() : null; })(),
    costBottom: card ? Math.round(card.getBoundingClientRect().bottom) : null,
    firstCardTop: (() => { const c = document.querySelector('.node-card'); return c ? Math.round(c.getBoundingClientRect().top) : null; })(),
    names
  };
})()`;

// 详情页（弹窗）探针：备注块的位置、小卡片的拆法、私有/公开的区分、有没有溢出
const MODAL_PROBE = `(() => {
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0;
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
  const header = document.querySelector('.modal-node-header');
  const meta = document.querySelector('.modal-node-meta');
  const block = document.querySelector('.modal-node-remark');
  const content = document.querySelector('.modal-content');
  const chips = block ? [...block.querySelectorAll('.remark-chip')] : [];
  return {
    modalOpen: vis(document.querySelector('.modal-overlay')),
    nodeName: (document.querySelector('.modal-node-name') || {}).textContent || '',
    hasBlock: vis(block),
    chips: chips.map((c) => ({
      text: ((c.querySelector('.remark-chip-text') || {}).textContent || '').trim(),
      own: c.classList.contains('own'),
      title: c.getAttribute('title') || '',
      border: getComputedStyle(c).borderStyle,
      bg: getComputedStyle(c).backgroundColor,
      shadow: getComputedStyle(c).boxShadow,
      lock: !!c.querySelector('.remark-lock'),
      lockW: (() => { const l = c.querySelector('.remark-lock'); return l ? Math.round(l.getBoundingClientRect().width) : 0; })()
    })),
    blockBox: block ? box(block) : null,
    metaBox: meta ? box(meta) : null,
    headerBox: header ? box(header) : null,
    firstSectionTop: (() => { const s = document.querySelector('.modal-info-section'); return s ? Math.round(s.getBoundingClientRect().top) : null; })(),
    contentRight: content ? Math.round(content.getBoundingClientRect().right) : null,
    chipOverflow: chips.length && content ? Math.max(...chips.map((c) => Math.round(c.getBoundingClientRect().right))) - Math.round(content.getBoundingClientRect().right) : null,
    viewport: { w: innerWidth, docScrollW: document.documentElement.scrollWidth }
  };
})()`;

const checks = [];
const ck = (scope, label, ok, detail) => checks.push({ scope, label, ok: !!ok, detail });

async function load(scenario, width, height, mobile) {
  current = scenario;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await send('Page.navigate', { url: `http://127.0.0.1:9916/?s=${scenario.key}&w=${width}` });
  for (let i = 0; i < 60; i++) { await sleep(400); if (await evaluate(`document.querySelectorAll('.node-card').length > 0`)) break; }
  await sleep(900);
  return evaluate(PROBE);
}

// 打开第一张卡片的详情页（备注块只在详情页里）
async function loadModal(scenario, width, height, mobile) {
  current = scenario;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
  await send('Page.navigate', { url: `http://127.0.0.1:9916/?s=${scenario.key}&modal=1` });
  for (let i = 0; i < 60; i++) { await sleep(400); if (await evaluate(`document.querySelectorAll('.node-card').length > 0`)) break; }
  await sleep(600);
  await evaluate(`document.querySelector('.node-card').click()`);
  for (let i = 0; i < 40; i++) { await sleep(300); if (await evaluate(`!!document.querySelector('.modal-node-name') && document.querySelectorAll('.modal-info-section').length >= 4`)) break; }
  await sleep(500);
  return evaluate(MODAL_PROBE);
}

// ① 主夹具：三个机位
const wide = await load(SCENARIOS[0], 1440, 900, false);
const mid = await load(SCENARIOS[0], 1000, 760, false);
const phone = await load(SCENARIOS[0], 390, 844, true);

ck('1440', '成本卡片渲染出来了', !!wide.cardBox && wide.blocks.length === 2, wide.titles);
ck('1440', '没有 0 值币种标签（到期当天那种 0.00 HKD）', wide.zeroChips.length === 0, wide.zeroChips);
ck('1440', '币种标签行里没有未折算的「?」', wide.questionChips.length === 0, wide.questionChips);
ck('1440', '站长没填汇率的 HKD / AUD 也被折算进合计（内置参考汇率兜底）', wide.chips.includes('360.00 HKD') && wide.chips.includes('51.93 AUD'), wide.chips);
ck('1440', '月度合计 = 各币种按汇率折成人民币后的和', wide.amounts[0] === '¥956.06', wide.amounts);
ck('1440', '剩余价值合计同理（XYZ 那台不在其中）', wide.amounts[1] === '¥3408.36', wide.amounts);
ck('1440', '两张表都没有的币种（XYZ）才走「未计入 …」', wide.notes.length === 2 && /未计入 8\.22 XYZ/.test(wide.notes[0]) && /未计入 27\.40 XYZ/.test(wide.notes[1]), wide.notes);
ck('1440', '「未计入」的悬停提示指向两张汇率表', /汇率表/.test(wide.noteTitle || ''), wide.noteTitle);
ck('1440', '用内置汇率折的币种在悬停里自报日期（人民币那枚不报）', /2026-10-04/.test(wide.chipTitles['360.00 HKD'] || '') && !/2026-10-04/.test(wide.chipTitles['¥83.16'] || ''), wide.chipTitles);
ck('1440', 'RATE 那一行给内置汇率打 * 并挂上日期与来源', /HKD 0\.8566\*/.test(wide.meta || '') && wide.metaTitles.some((t) => /open\.er-api\.com/.test(t)), [wide.meta, wide.metaTitles]);
ck('1440', '到期印章逐台列出、文案是 TODAY / ND / EXPIRED', wide.reds.length === 7 && wide.reds.some((t) => /TODAY/.test(t)) && wide.reds.some((t) => /\(5D\)/.test(t)) && wide.reds.some((t) => /EXPIRED/.test(t)) && !wide.reds.some((t) => /今天|已过期/.test(t)), wide.reds);
ck('1440', '宽屏显示逐台印章、隐藏汇总', wide.fullVisible === true && wide.compactVisible === false, [wide.fullVisible, wide.compactVisible]);
ck('1440', '口径小字固定在卡片底一条里', !!wide.foot && /PAID/.test(wide.meta || ''), [wide.foot, wide.meta]);
ck('1440', '两栏等宽（竖线落在卡片中线）', Math.abs((wide.blocks[1].x - wide.blocks[0].x) - (wide.cardBox.w - 40) / 2) <= 24, wide.blocks);
ck('1440', 'main 里的顺序是 汇总卡片 → 分组标签 → 节点列表', JSON.stringify(wide.mainOrder) === JSON.stringify(['cost-card', 'group-tabs', 'nodes-container']), wide.mainOrder);
ck('1000', '两栏仍然是并排（窄一档不塌）', mid.blocks.length === 2 && mid.blocks[1].x > mid.blocks[0].x, mid.blocks);
ck('1000', '没有横向溢出', mid.viewport.docScrollW <= 1000, mid.viewport);
ck('390', '窄屏隐藏逐台印章、显示汇总', phone.fullVisible === false && phone.compactVisible === true, [phone.fullVisible, phone.compactVisible]);
ck('390', '窄屏汇总是两枚：7 天内到期 / 已过期', phone.compact.length === 2 && /4 台/.test(phone.compact[0]) && /3 台/.test(phone.compact[1]), phone.compact);
ck('390', '窄屏成本卡片收在 420px 内（旧口径 493px，这一版还多折了 HKD/AUD 两枚标签）', phone.cardBox.h <= 420, phone.cardBox.h);
ck('390', '窄屏没有横向溢出（布局宽度就是 390）', phone.viewport.w === 390 && phone.viewport.docScrollW <= 390, phone.viewport);

const long = wide.names[0], short = wide.names[1];
ck('名字', '长名卡片的名字收成 1 行', long.nameH <= 30, long.nameH);
ck('名字', '长名被省略号截断', long.clipped, long.clipped);
ck('名字', '长名挂了 title（悬停看全名）', long.title === long.name, long.title);
ck('名字', '长名与短名卡片的头部等高（区块对齐）', long.headerH === short.headerH, [long.headerH, short.headerH]);
ck('名字', '长名与短名卡片等高', long.cardH === short.cardH, [long.cardH, short.cardH]);
ck('名字', '名字没有溢出卡片（右上角状态方块仍在卡片内）', long.rightGap <= 0 && short.rightGap <= 0, [long.rightGap, short.rightGap]);
ck('名字', '窄屏长名同样 1 行且被截断', phone.names[0].nameH <= 30 && phone.names[0].clipped, [phone.names[0].nameH, phone.names[0].clipped]);
const infoHeights = [...new Set(wide.names.map((n) => n.infoH))];
ck('系统行', '每张卡片的「系统 · CPU」都占满两行（短名也预留）', infoHeights.length === 1 && infoHeights[0] >= 30, infoHeights);
ck('系统行', '短 CPU 名的那台不再把指标行顶上去（所有 header 等高）', new Set(wide.names.map((n) => n.headerH)).size === 1, wide.names.map((n) => n.headerH));
ck('系统行', '长 CPU 名被两行截断', wide.names[0].infoClipped === true, [wide.names[0].infoText, wide.names[0].infoH]);
ck('系统行', '「系统 · CPU」挂了 title（悬停看全）', wide.names[0].infoTitle === wide.names[0].infoText, wide.names[0].infoTitle);
ck('系统行', '短 CPU 名那台没有被截断', wide.names[1].infoClipped === false, [wide.names[1].infoText, wide.names[1].infoClipped]);
ck('系统行', '窄屏同样两行且等高', new Set(phone.names.map((n) => n.infoH)).size === 1 && new Set(phone.names.map((n) => n.headerH)).size === 1, [phone.names.map((n) => n.infoH), phone.names.map((n) => n.headerH)]);

// ② 边界形态
for (const scenario of SCENARIOS.slice(1)) {
  errors.length = 0;
  const p = await load(scenario, 1440, 900, false);
  const want = scenario.want;
  if (want.hidden) {
    ck(scenario.key, '一台都没填价格 → 整块卡片收起、不留空位', p.hidden === true && p.cardBox.h === 0, p.hidden);
  } else {
    ck(scenario.key, `渲染出 ${want.blocks} 栏`, p.blocks.length === want.blocks, p.titles);
    ck(scenario.key, '没有 JS 异常 / 控制台错误', errors.length === 0, errors);
    ck(scenario.key, `竖线${want.divider ? '' : '不'}出现`, p.dividerVisible === want.divider, p.dividerVisible);
    ck(scenario.key, `「未计入」说明 ${want.notes} 条`, p.notes.length === want.notes, p.notes);
    ck(scenario.key, `到期印章 ${want.reds} 枚`, p.reds.length === want.reds, p.reds);
    if (want.clear) ck(scenario.key, `没有告警时显示 ${want.clear}`, p.clear === want.clear, p.clear);
    if (want.month) ck(scenario.key, `月度合计 = ${want.month}`, p.amounts[0] === want.month, p.amounts);
    if (want.tabs) {
      ck(scenario.key, '分组标签行渲染出来了', p.tabsVisible, p.tabsBox);
      ck(scenario.key, '分组标签在汇总卡片下面、节点列表上面',
        !!p.tabsBox && p.tabsBox.y >= p.costBottom && p.tabsBox.bottom <= p.firstCardTop,
        [p.tabsBox, p.costBottom, p.firstCardTop]);
    }
    if (want.hkdStar === false) {
      ck(scenario.key, '站长填的 HKD 覆盖内置值（悬停不再自报日期、RATE 行也不打 *）',
        !/2026-10-04/.test(p.chipTitles['360.00 HKD'] || '') && !/HKD [0-9.]+\*/.test(p.meta || ''),
        [p.chipTitles['360.00 HKD'], p.meta]);
    }
  }
}

// ③ 详情页备注
const pubModal = await loadModal(REMARK_SCENARIOS[0], 1440, 900, false);
ck('备注', '详情页打开了（备注断言的前提）', pubModal.modalOpen === true && pubModal.nodeName.length > 0, [pubModal.modalOpen, pubModal.nodeName]);
ck('备注', '公开备注按逗号拆成 2 枚（全角逗号也认）', pubModal.chips.length === 2 && pubModal.chips.map((c) => c.text).join('|') === '公开备注一|公开备注二', pubModal.chips);
ck('备注', '匿名视图里一枚私有备注都不出现', pubModal.chips.every((c) => !c.own), pubModal.chips);
ck('备注', '公开那几枚是实线边、不带锁图标', pubModal.chips.every((c) => !c.dashed && !c.lock), pubModal.chips);
ck('备注', '公开那几枚的悬停提示就是备注原文', pubModal.chips.every((c) => c.title === c.text), pubModal.chips.map((c) => c.title));

const bothModal = await loadModal(REMARK_SCENARIOS[1], 1440, 900, false);
ck('备注', '私有在前、公有在后（4 枚）', JSON.stringify(bothModal.chips.map((c) => c.text)) === JSON.stringify(['私有甲', '私有乙', '公开甲', '公开乙']), bothModal.chips.map((c) => c.text));
ck('备注', '私有备注里的换行也拆（hub 对它没有单行约束）', bothModal.chips.some((c) => c.text === '私有乙'), bothModal.chips.map((c) => c.text));
// 站长口径：私有那几枚的版式与公开**完全一致**（实线边 + 白底 + 硬阴影），区分只靠多出来的一枚小锁
const ownChips = bothModal.chips.filter((c) => c.own);
const pubChips = bothModal.chips.filter((c) => !c.own);
ck('备注', '私有那几枚：实线边 + 白底 + 硬阴影，与公开同版式', ownChips.length === 2 && ownChips.every((c) => c.border === 'solid' && c.bg === pubChips[0].bg && c.shadow === pubChips[0].shadow), [ownChips.map((c) => [c.border, c.bg]), pubChips.map((c) => [c.border, c.bg])]);
ck('备注', '私有那几枚多一枚小锁图标（唯一的区分）', ownChips.every((c) => c.lock && c.lockW > 0) && pubChips.every((c) => !c.lock), [ownChips.map((c) => [c.lock, c.lockW]), pubChips.map((c) => c.lock)]);
ck('备注', '私有那几枚的悬停写「仅自己可见：…」', ownChips.every((c) => /^仅自己可见：/.test(c.title)) && pubChips.every((c) => c.title === c.text), [ownChips.map((c) => c.title), pubChips.map((c) => c.title)]);
ck('备注', '备注块落在页头里：系统行下面、第一个区块上面', bothModal.hasBlock && bothModal.blockBox.y >= bothModal.metaBox.bottom - 2 && bothModal.blockBox.bottom <= bothModal.headerBox.bottom + 1 && bothModal.blockBox.bottom < bothModal.firstSectionTop, [bothModal.blockBox, bothModal.metaBox, bothModal.headerBox, bothModal.firstSectionTop]);
ck('备注', '备注块在宽屏里收在一行内（4 枚并排）', !!bothModal.blockBox && bothModal.blockBox.h <= 40, bothModal.blockBox);

const noneModal = await loadModal(REMARK_SCENARIOS[2], 1440, 900, false);
ck('备注', '两个字段都没写 → 整块不渲染（零占位）', noneModal.hasBlock === false && noneModal.blockBox === null, noneModal.hasBlock);
const blankModal = await loadModal(REMARK_SCENARIOS[3], 1440, 900, false);
ck('备注', '只有空白 / 逗号 → 同样一枚都不渲染', blankModal.hasBlock === false && blankModal.blockBox === null, [blankModal.hasBlock, blankModal.chips]);

const offModal = await loadModal(REMARK_SCENARIOS[4], 1440, 900, false);
ck('备注', '站点关掉「详情页显示节点备注」→ 整块不渲染（数据都在也不显示）', offModal.hasBlock === false && offModal.blockBox === null && offModal.chips.length === 0, [offModal.hasBlock, offModal.chips]);

const phoneModal = await loadModal(REMARK_SCENARIOS[1], 390, 844, true);
ck('备注', '窄屏小卡片不越过内容区右边缘', phoneModal.chipOverflow !== null && phoneModal.chipOverflow <= 0, [phoneModal.chipOverflow, phoneModal.contentRight]);
ck('备注', '窄屏整页没有横向溢出', phoneModal.viewport.docScrollW <= 390, phoneModal.viewport);
// 用 (x || {}).h 兜底：备注块整个不见了时这里要报 FAIL，而不是把护栏自己搞崩
ck('备注', '窄屏会换行（4 枚放不下 → 块变高）', ((phoneModal.blockBox || {}).h || 0) > ((bothModal.blockBox || {}).h || 0), [phoneModal.blockBox, bothModal.blockBox]);

/* ④ 切分组：页头那排统计与成本卡片跟着当前分组重算 -----------------------------
   口径来自参考站（monitor 内置 default 主题）：它的概览四格就是拿**筛选后的节点**算的
   （`let c = group===null ? nodes : nodes.filter(...)` → `<Summary nodes={c}/>`）。
   本站的等价物是页头 stats-bar 与成本卡片。判据不用硬编码金额：拿「只放该分组的节点」
   的场景当对照，两者必须逐字相同（算法以后改了也不会假红）。 */

// 点某个分组标签，等翻牌动画（400ms）落定再读数：只等固定毫秒会取到乱码，
// 所以判据是「两次读数相同 + 形状合法（数字/百分比/速率/货币各自过一遍字符白名单）」。
// ★这个窗口（0.7s + 0.25s）**故意远短于轮询间隔**（站点设置的刷新间隔，最少 1s、夹具用 3s）：
//   判的就是「点完立刻就得跟上」，等下一轮 HTTP 轮询才更新是不合格的——那段时间页头写着旧数字。
//   所以别把等待时间放宽，否则这条护栏会退化成「反正轮询会追上」的假绿。
async function clickTab(label) {
  const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('.group-tab')].find((x) => x.textContent.trim() === ${JSON.stringify(label)}); if (!b) return 'missing'; b.click(); return 'ok'; })()`);
  // 找不到标签也回一份探针：让断言自己报 FAIL，而不是把护栏整轮带走
  if (clicked !== 'ok') return Object.assign(await evaluate(PROBE), { clicked });
  await sleep(700);
  const SETTLE = `(() => {
    // 页头那两格速率是「数值 + 换行 + 单位」（script.js 里把空格换成了换行），先拍平再判形状
    const plain = (t) => t.split(String.fromCharCode(10)).join(' ');
    const digits = '0123456789.';
    const g = (id) => plain((document.getElementById(id) || {}).textContent || '');
    const onlyDigits = (t) => t.length > 0 && [...t].every((c) => digits.indexOf(c) >= 0);
    const pct = (t) => t.length > 1 && t[t.length - 1] === '%' && onlyDigits(t.slice(0, -1));
    const speed = (t) => t.indexOf('B/s') > 0 && [...t].every((c) => digits.indexOf(c) >= 0 || 'KMG Bs/'.indexOf(c) >= 0);
    const money = (t) => t.length > 3 && '¥$€£'.indexOf(t[0]) >= 0 && onlyDigits(t.slice(1));
    const amounts = [...document.querySelectorAll('#cost-card .cost-amount')].map((e) => e.textContent.trim());
    const ok = onlyDigits(g('stat-nodes')) && onlyDigits(g('stat-online')) && pct(g('stat-cpu')) && pct(g('stat-ram'))
      && speed(g('stat-net-in')) && speed(g('stat-net-out')) && amounts.length > 0 && amounts.every(money);
    return { ok: ok, key: [g('stat-nodes'), g('stat-online'), g('stat-cpu'), g('stat-ram'), g('stat-net-in'), g('stat-net-out'), amounts.join(',')].join('|') };
  })()`;
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const now = await evaluate(SETTLE);
    if (now.ok && prev && prev.key === now.key) break;
    prev = now;
    await sleep(250);
  }
  return Object.assign(await evaluate(PROBE), { clicked: 'ok' });
}

// 全部档先点一轮（对照场景要重新导航，点标签必须在「全部」那一页上做）
const gAll = await load({ key: 'groups-all', nodes: GROUPS, cfg: {} }, 1440, 900, false);
const gTokyo = await clickTab('东京');
const gEurope = await clickTab('欧洲');
const gUngrouped = await clickTab('未分组');
const gBack = await clickTab('全部');
// 对照场景：只放该分组的节点，页头统计与成本卡片的期望值由主题自己算出来（等价断言）
const soloTokyo = await load({ key: 'solo-tokyo', nodes: [G_TOKYO_1, G_TOKYO_2], cfg: {} }, 1440, 900, false);
const soloEurope = await load({ key: 'solo-europe', nodes: [G_EUROPE], cfg: {} }, 1440, 900, false);
const soloNone = await load({ key: 'solo-none', nodes: [G_UNGROUPED], cfg: {} }, 1440, 900, false);

ck('分组', '「全部」档页头统计 = 全部 4 台', gAll.stats.nodes === '4' && gAll.stats.online === '4' && gAll.cardCount === 4, [gAll.stats, gAll.cardCount]);
ck('分组', '「全部」档平均 CPU = 四台的平均（24%）', gAll.stats.cpu === '24%', gAll.stats.cpu);
ck('分组', '分组标签是 全部 / 东京 / 欧洲 / 未分组', JSON.stringify(gAll.tabLabels) === JSON.stringify(['全部', '东京', '欧洲', '未分组']) && gAll.activeTab === '全部', [gAll.tabLabels, gAll.activeTab]);
ck('分组', '四个分组标签都点得到（点不动就谈不上跟随）', [gTokyo, gEurope, gUngrouped, gBack].every((p) => p.clicked === 'ok'), [gTokyo.clicked, gEurope.clicked, gUngrouped.clicked, gBack.clicked]);

ck('分组', '点「东京」后页头 NODES / ONLINE 变成该分组（2 台）、列表只剩 2 张', gTokyo.stats.nodes === '2' && gTokyo.stats.online === '2' && gTokyo.cardCount === 2, [gTokyo.stats, gTokyo.cardCount]);
ck('分组', '点「东京」后平均 CPU 只算该分组（36%，不是全站的 24%）', gTokyo.stats.cpu === '36%', gTokyo.stats.cpu);
ck('分组', '点「东京」后页头下行速率 = 该分组两台之和（与「只放这两台」的站点一致）', gTokyo.stats.down === soloTokyo.stats.down && gTokyo.stats.down !== gAll.stats.down, [gTokyo.stats.down, soloTokyo.stats.down, gAll.stats.down]);
ck('分组', '点「东京」后成本卡片两栏都只算该分组（与「只放这两台」的站点逐字相同）', JSON.stringify(gTokyo.amounts) === JSON.stringify(soloTokyo.amounts), [gTokyo.amounts, soloTokyo.amounts]);
ck('分组', '成本卡片确实跟着变了（不是原地不动）', gTokyo.amounts.join() !== gAll.amounts.join(), [gAll.amounts, gTokyo.amounts]);
ck('分组', '点「东京」后到期印章仍只列该分组那台（TODAY/ND/EXPIRED 里的一枚）', gTokyo.reds.length === 1 && /东京二号/.test(gTokyo.reds[0]), gTokyo.reds);

ck('分组', '点「欧洲」后只剩 1 台（可点掉的那两个标签里最远的一档）', gEurope.stats.nodes === '1' && gEurope.cardCount === 1, [gEurope.stats.nodes, gEurope.cardCount]);
ck('分组', '点「欧洲」后成本卡片 = 只放这一台的站点', JSON.stringify(gEurope.amounts) === JSON.stringify(soloEurope.amounts), [gEurope.amounts, soloEurope.amounts]);
ck('分组', '点「欧洲」后到期印章清空（东京那台 3 天内到期的印章不该还在）', gEurope.reds.length === 0 && gEurope.clear === 'ALL CLEAR ✓', [gEurope.reds, gEurope.clear]);

ck('分组', '点「未分组」后统计与成本卡片 = 只放未分组那一台的站点', gUngrouped.stats.nodes === '1' && JSON.stringify(gUngrouped.amounts) === JSON.stringify(soloNone.amounts), [gUngrouped.stats.nodes, gUngrouped.amounts, soloNone.amounts]);

ck('分组', '点回「全部」后统计与成本卡片逐字复原', gBack.stats.nodes === '4' && gBack.stats.cpu === gAll.stats.cpu && JSON.stringify(gBack.amounts) === JSON.stringify(gAll.amounts), [gBack.stats, gBack.amounts, gAll.amounts]);
ck('分组', '成本卡片仍在分组标签上面（位置按站长口径不动）', JSON.stringify(gBack.mainOrder) === JSON.stringify(['cost-card', 'group-tabs', 'nodes-container']), gBack.mainOrder);

// 窄屏：切分组后成本卡片不能撑破（手机上这张卡最容易失控）
const phoneGroups = await load({ key: 'groups-phone', nodes: GROUPS, cfg: {} }, 390, 844, true);
const phoneTokyo = await clickTab('东京');
ck('分组', '窄屏切分组后统计同样跟着走', phoneTokyo.stats.nodes === '2', phoneTokyo.stats.nodes);
ck('分组', '窄屏切分组后成本卡片仍在 420px 内、无横向溢出', phoneTokyo.cardBox.h <= 420 && phoneTokyo.viewport.docScrollW <= 390, [phoneTokyo.cardBox, phoneTokyo.viewport]);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  [${c.scope}] ${c.label}${c.ok ? '' : '  →  ' + JSON.stringify(c.detail)}`);
console.log(`\n${checks.length - failed.length} PASS / ${failed.length} FAIL`);
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);
