// 后台「主题设置」对话框的排版护栏（不用口令：CDP 打桩 /api/*，跑的是真 React 组件）。
//
// 为什么要有它：面板里那点地方是站长唯一看得见的「说明书」——
//   · 分组名/字段顺序错了、help 写成一堵字墙（四五行的灰字），他不会报错，只会觉得「乱」；
//   · 字段数 > 6 且分组 > 1 时对话框会切成「左侧分组导航 + 只挂载当前那一组」，
//     所以断言必须**按组点开再断**，拿一次 innerText 断所有组会得到一堆假 FAIL。
// 用法: node scripts/verify-settings-dialog.mjs [baseUrl=https://komari.im] [截图前缀=shots/settings]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const MANIFEST = JSON.parse(readFileSync('theme.json', 'utf8'));
const BASE = (process.argv[2] || 'https://komari.im').replace(/\/$/, '');
const PREFIX = process.argv[3] || 'shots/settings';
const OUT = PREFIX.split('/').slice(0, -1).join('/') || '.';
mkdirSync(OUT, { recursive: true });
const PORT = 9760 + Math.floor(Math.random() * 20);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync) || 'chrome';
// 线上面板在反代的 IP 白名单后面：走本机系统代理（出口在白名单内）才打得开 /admin
const proxyArgs = /^https?:/.test(BASE) ? ['--proxy-server=http://127.0.0.1:2080'] : [];

const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*', '--no-first-run',
  '--disable-gpu', '--hide-scrollbars', ...proxyArgs, '--window-size=1440,900',
  '--user-data-dir=' + (process.env.TEMP || '.') + '/settings-dlg-' + PORT + '-' + Date.now(), 'about:blank'], { stdio: 'ignore' });

let id = 0; const pend = new Map();
async function connect() {
  for (let i = 0; i < 40; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(300);
  }
  throw new Error('Chrome 没起来');
}
const ws = new WebSocket(await connect());
await new Promise((r) => { ws.onopen = r; });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Fetch.requestPaused') {
    const { requestId, request } = m.params; const u = request.url;
    const json = (o) => send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(o)).toString('base64') });
    if (/\/api\/ws/.test(u)) return send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
    if (/\/api\/themes\/[^/]+\/config/.test(u)) return json({});
    if (/\/api\/themes(\?|$)/.test(u)) return json({ themes: [
      { name: MANIFEST.name, short: MANIFEST.short, description: MANIFEST.description, version: MANIFEST.version, author: MANIFEST.author, url: MANIFEST.url, selected: true, builtin: false, config: MANIFEST.config },
      { name: '默认主题', short: 'default', description: '', version: '1.0.0', author: 'Monitor', url: '', selected: false, builtin: true, config: [] }
    ] });
    if (/\/api\/me(\?|$)/.test(u)) return json({ authed: true, admin: true, github: false, public_page: true, site: BASE, site_name: 'Komari Monitor' });
    if (/\/api\/nodes/.test(u)) return json({ nodes: [] });
    if (/\/api\/ping-tasks/.test(u)) return json({ tasks: [] });
    if (/\/api\/version/.test(u)) return json({ version: '1.3.0' });
    return send('Fetch.continueRequest', { requestId });
  }
};
const js = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) console.log('EVAL ERR', r.result.exceptionDetails.exception?.description);
  return r.result?.result?.value;
};
let pass = 0; let fail = 0;
const check = (n, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${extra ? '  →  ' + extra : ''}`); ok ? pass++ : fail++; };

await send('Runtime.enable'); await send('Page.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*', requestStage: 'Request' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: `${BASE}/admin/themes` });

// ① 页面渲染出来了（认稳定文案，别认那枚按钮：config 为空的主题根本没有它）
let pageOk = false;
for (let i = 0; i < 80; i++) { await sleep(500); pageOk = await js(`document.body.innerText.includes('安装主题')`); if (pageOk) break; }
check('主题页渲染出来了（认「安装主题」这句稳定文案）', pageOk, await js(`document.title`));
let btn = false;
for (let i = 0; i < 20 && !btn; i++) { btn = await js(`!!document.querySelector('button[title="主题设置"]')`); if (!btn) await sleep(500); }
check('卡片上有「主题设置」按钮（manifest 声明了 config 才会有）', btn);
if (!btn) { console.log('⚠ 面板没起来或被白名单挡住，后续断言不成立'); ws.close(); proc.kill(); process.exit(1); }
await js(`document.querySelector('button[title="主题设置"]').click()`);
let dlg = false;
for (let i = 0; i < 40; i++) { await sleep(400); dlg = await js(`!!document.querySelector('[role="dialog"]')`); if (dlg) break; }
check('设置对话框打开了', dlg);
await sleep(800);

// ② 分组导航：必须是 theme.json 里的标题、同序
const titles = MANIFEST.config.filter((e) => e.type === 'title').map((e) => e.label);
const nav = await js(`[...document.querySelectorAll('[role="dialog"] nav button')].map((b) => b.innerText.trim())`);
check('分组导航的标题与 theme.json 逐字同序', JSON.stringify(nav) === JSON.stringify(titles), `${JSON.stringify(nav)} vs ${JSON.stringify(titles)}`);

// ③ 逐组点开：字段、help 行数、选项文案、开关初值
const groups = [];
{
  const items = MANIFEST.config;
  let cur = { title: '（无分组）', fields: [] };
  for (const it of items) {
    if (it.type === 'title') { if (cur.fields.length || cur.title !== '（无分组）') groups.push(cur); cur = { title: it.label, fields: [] }; }
    else cur.fields.push(it);
  }
  groups.push(cur);
}
const shotIndex = [];
for (const [gi, group] of groups.entries()) {
  if (nav.includes(group.title)) {
    await js(`[...document.querySelectorAll('[role="dialog"] nav button')].find((b) => b.innerText.trim() === ${JSON.stringify(group.title)})?.click()`);
    await sleep(600);
  }
  const probe = await js(`(() => {
    const dlg = document.querySelector('[role="dialog"]');
    // 面板里两类字段的 DOM 不同：
    //   select / text / number：<div><label data-slot="label">标题</label> 控件 <p>说明</p></div>
    //   boolean：<div><label><span><span>标题</span><span>说明</span></span><button role=switch></label></div>
    //   （布尔项的说明就挂在 label 里，不是 <p>）
    const wraps = [...dlg.querySelectorAll('label')].map((lab) => lab.parentElement).filter((el, i, a) => el && a.indexOf(el) === i);
    const lineCount = (el) => {
      if (!el) return 0;
      const cs = getComputedStyle(el);
      const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.5 : parseFloat(cs.lineHeight);
      return Math.round(el.getBoundingClientRect().height / lh);
    };
    const fields = wraps.map((wrap) => {
      const lab = wrap.querySelector('label');
      const isFieldLabel = lab && lab.getAttribute('data-slot') === 'label';
      const help = isFieldLabel ? wrap.querySelector('p') : (lab.querySelector('span > span:nth-child(2)') || null);
      const title = isFieldLabel ? lab.textContent.trim() : (lab.querySelector('span > span')?.textContent.trim() || '');
      const sel = wrap.querySelector('select');
      const sw = wrap.querySelector('button[role="switch"]');
      const r = wrap.getBoundingClientRect();
      return {
        label: title,
        help: help ? help.textContent.trim() : '',
        helpLines: lineCount(help),
        options: sel ? [...sel.options].map((o) => o.textContent) : null,
        selected: sel ? sel.value : null,
        switchChecked: sw ? sw.getAttribute('aria-checked') : null,
        x: Math.round(r.x), w: Math.round(r.width)
      };
    });
    return { labels: fields.map((f) => f.label), fields, text: dlg.innerText.replace(/\\s+/g, ' ').slice(0, 400) };
  })()`);

  const wantLabels = group.fields.map((f) => f.label);
  check(`[${group.title}] 字段都在（${wantLabels.length} 个）`, JSON.stringify(probe.labels) === JSON.stringify(wantLabels), `${JSON.stringify(probe.labels)}`);
  const worst = Math.max(0, ...probe.fields.map((f) => f.helpLines));
  check(`[${group.title}] 每个说明都 ≤ 3 行（最长的 ${worst} 行）`, worst <= 3, probe.fields.map((f) => `${f.label}:${f.helpLines}`).join(' '));
  check(`[${group.title}] 每个字段都有说明文字`, probe.fields.every((f) => f.help.length > 0), probe.fields.filter((f) => !f.help).map((f) => f.label));
  for (const [fi, f] of group.fields.entries()) {
    const got = probe.fields[fi];
    if (!got) continue;
    if (f.type === 'select') {
      const want = f.options.map((o) => o.label);
      check(`[${group.title}] ${f.label}：下拉选项逐字同序`, JSON.stringify(got.options) === JSON.stringify(want), `${JSON.stringify(got.options)}`);
    }
    if (f.type === 'boolean') {
      check(`[${group.title}] ${f.label}：开关初值 = default（${f.default}）`, got.switchChecked === String(f.default), got.switchChecked);
    }
  }
  // 只截对话框本体（带一点留白），别把整页后台都塞进交付图
  const clip = await js(`(() => { const r = document.querySelector('[role="dialog"]').getBoundingClientRect(); return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: r.width + 32, height: r.height + 32 }; })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 } });
  const file = `${PREFIX}-${gi + 1}-${group.title}.png`;
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  shotIndex.push(file);
}
check('每个分组都能点开（导航项数 == 分组数）', nav.length === groups.length, `${nav.length} vs ${groups.length}`);

console.log(`\n结果: PASS ${pass} / FAIL ${fail}`);
console.log('截图:', shotIndex.join(' , '));
ws.close(); proc.kill();
process.exit(fail ? 1 : 0);
