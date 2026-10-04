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
// 带分组的夹具：验证「汇总卡片 → 分组标签 → 节点列表」这个顺序在页面上真的成立
const GROUPS = [
  node(40, { name: '东京一号', country: 'JP', price: 120, currency: 'HKD', billing_cycle: 'monthly', expires_in: 100, group: '东京' }),
  node(41, { name: '法兰克福一号', country: 'DE', price: 299, currency: 'CNY', billing_cycle: 'yearly', expires_in: 300, group: '欧洲' }),
  node(42, { name: '没有分组的机器', country: 'US', price: 20, currency: 'USD', billing_cycle: 'yearly', expires_in: 200, group: '' })
];
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
  { key: 'with-groups', nodes: GROUPS, cfg: {}, want: { blocks: 2, notes: 0, reds: 0, divider: true, tabs: true } },
  { key: 'user-override', nodes: MAIN, cfg: { costRates: 'HKD=1' }, want: { blocks: 2, notes: 2, reds: 7, divider: true, month: '¥1007.68', hkdStar: false } },
  { key: 'no-price', nodes: [E], cfg: {}, want: { hidden: true } },
  { key: 'no-expiry', nodes: [node(21, { name: '无到期机', price: 20, currency: 'USD', billing_cycle: 'yearly', expires_in: null })], cfg: {}, want: { blocks: 2, notes: 0, reds: 0, clear: 'NO EXPIRY SET', divider: true } }
];

/* --------------------------- 伺服 + 浏览器 --------------------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
let current = SCENARIOS[0];
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const json = (obj) => { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  if (path === '/api/me') return json({ authed: false, github: false, history_days: 30, public_page: true, site: 'fixture', site_name: '1999 夹具' });
  if (path === '/api/nodes') return json({ admin: false, nodes: current.nodes });
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
    costBottom: card ? Math.round(card.getBoundingClientRect().bottom) : null,
    firstCardTop: (() => { const c = document.querySelector('.node-card'); return c ? Math.round(c.getBoundingClientRect().top) : null; })(),
    names
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

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  [${c.scope}] ${c.label}${c.ok ? '' : '  →  ' + JSON.stringify(c.detail)}`);
console.log(`\n${checks.length - failed.length} PASS / ${failed.length} FAIL`);
chrome.kill();
server.close();
process.exit(failed.length ? 1 : 0);
