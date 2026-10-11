// 现网部署验收：核对「公网跑着的这份构建 = 本地 dist」，并做真机行为断言。
//
// 用法：node scripts/verify-live.mjs <baseUrl> [--shots <目录>] [--no-proxy] [--chrome <路径>]
//   · https 默认走本机系统代理（127.0.0.1:2080）——这台开发机的 Chrome 代理被系统策略锁死；
//     换台机器/直连时加 --no-proxy。
//   · 断言全部数据无关（换站点、换节点数都成立），站名/节点名不写进任何输出文件。
//
// 断言：
//   A. 页面渲染：卡片/行数 == /api/nodes 的节点数（≥1）、站名非空、运行时无未捕获异常；
//   B. 构建一致：script.js / monitor.js / adapt.css / styles.css 的公网字节哈希 == 本地 dist/；
//      index.html 剥掉 hub 给两条图标地址加的 ?v=（两侧都剥）后与本地逐字节相同；
//   C. 图标链：/favicon.svg、/favicon.ico、/apple-touch-icon.png、/apple-touch-icon-precomposed.png
//      都能取到；面板没设图标时应与本地主题自带的四份逐字节相同（设了则弱化为「取得到且非空」）；
//   D. hub 1.4.1 的 localStorage 容错在真站生效：注入「访问即抛 SecurityError」后页面照常渲染；
//   E. 历史窗口与 /api/me 的 history_days 一致（保留 ≥30 天时 30D 按钮应在）。
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = (process.argv[2] || '').replace(/\/$/, '')
if (!/^https?:\/\//.test(BASE)) {
  console.error('用法: node scripts/verify-live.mjs <baseUrl> [--shots <目录>] [--no-proxy]')
  process.exit(2)
}
const SHOTS = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const useProxy = /^https:/.test(BASE) && !process.argv.includes('--no-proxy')
const CHROME = process.argv.includes('--chrome')
  ? process.argv[process.argv.indexOf('--chrome') + 1]
  : process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
if (!existsSync(CHROME) && CHROME === 'C:/Program Files/Google/Chrome/Application/chrome.exe') {
  console.error('找不到 Chrome（用 --chrome <路径> 指定）')
  process.exit(2)
}

const LOCAL_FILES = ['script.js', 'monitor.js', 'adapt.css', 'styles.css']
const LOCAL_ICONS = ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'apple-touch-icon-precomposed.png']
const localHash = (f) => createHash('sha256').update(readFileSync(join('dist', f))).digest('hex')
const localText = (f) => readFileSync(join('dist', f), 'utf8')
if (!existsSync('dist/index.html')) {
  console.error('缺少 dist/index.html，先跑 npm run build')
  process.exit(2)
}

const profile = join(tmpdir(), `m1999-live-${Date.now()}`)
const args = ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu', '--no-sandbox',
  '--hide-scrollbars', `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank']
if (useProxy) args.push('--proxy-server=http://127.0.0.1:2080')
const chrome = spawn(CHROME, args, { stdio: 'ignore' })

let wsUrl = null
for (let i = 0; i < 80 && !wsUrl; i++) {
  try {
    const port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
    wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch { /* 还没起来 */ }
  if (!wsUrl) await sleep(250)
}
if (!wsUrl) throw new Error('Chrome 没起来')
const ws = new WebSocket(wsUrl)
await new Promise((r) => { ws.onopen = r })
let id = 0
const pending = new Map()
const errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '))
})
const send = (method, params = {}) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })) })
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')

const checks = []
const ck = (scope, label, ok, detail) => checks.push({ scope, label, ok: !!ok, detail })
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) writeFileSync(join(SHOTS, name), Buffer.from(r.result.data, 'base64'))
}
const waitFor = async (expr, ms = 20000) => {
  for (let i = 0; i < Math.ceil(ms / 250); i++) { if (await js(expr)) return true; await sleep(250) }
  return false
}
// 数字翻牌落定：所有会翻牌的元素都不含乱码字符（判据来自纯静态主题的实测：% 是正常内容，别进字符集）
const SETTLED = `(() => {
  const nodes = [...document.querySelectorAll('.stat-value, .metric-value, .net-rate, .net-total-item')]
  if (nodes.length < 8) return false
  return nodes.every((el) => !/[#&@!*^~]/.test(el.textContent))
})()`

const errBase = () => errors.length
const newErrors = (base) => errors.slice(base)

/* ---------------------------------------------------------------- 打开页面 */
const base0 = errBase()
await send('Page.navigate', { url: `${BASE}/?live=${Date.now()}` })
await waitFor(`document.querySelectorAll('.node-card, .node-row').length > 0`, 25000)
await sleep(800)

const page = JSON.parse(await js(`(async () => {
  const nodes = await fetch('/api/nodes').then((r) => r.json())
  const me = await fetch('/api/me').then((r) => r.json())
  return JSON.stringify({
    rendered: document.querySelectorAll('.node-card, .node-row').length,
    nodes: (nodes.nodes || []).length,
    siteName: (document.getElementById('site-name') || {}).textContent || '',
    historyDays: me.history_days ?? null,
    title: document.title,
  })
})()`) || '{}')
ck('A', '页面渲染：卡片/行数 == /api/nodes 的节点数（≥1）', page.nodes >= 1 && page.rendered === page.nodes, `${page.rendered} 渲染 / ${page.nodes} 节点`)
ck('A', '站名已写入（页头 + 标签页标题非空）', !!page.siteName && !!page.title, `${page.siteName} / ${page.title}`)
ck('A', '打开页面无未捕获异常 / 控制台报错', newErrors(base0).length === 0, newErrors(base0).join(' | ').slice(0, 200))

/* ---------------------------------------------------------------- B. 构建一致性 */
const remoteHashes = JSON.parse(await js(`(async () => {
  const out = {}
  for (const f of ${JSON.stringify(LOCAL_FILES)}) {
    const buf = await fetch('/' + f + '?live=' + Date.now()).then((r) => r.arrayBuffer())
    const d = await crypto.subtle.digest('SHA-256', buf)
    out[f] = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return JSON.stringify(out)
})()`) || '{}')
for (const f of LOCAL_FILES) {
  ck('B', `公网 /${f} 与本地 dist 逐字节一致`, remoteHashes[f] === localHash(f), remoteHashes[f] === localHash(f) ? 'same' : `remote=${(remoteHashes[f] || '').slice(0, 12)}… local=${localHash(f).slice(0, 12)}…`)
}
const remoteHtml = await js(`(async () => (await fetch('/?live=' + Date.now()).then((r) => r.text())))()`)
// 三层中间层注入的容差（都实测存在，逐字节对比前先剥掉）：
//   · hub 送页时给两条图标地址加 ?v=<摘要>（stamp_icons）——两侧都剥；
//   · Cloudflare 紧跟 <body> 注入的隐藏锚点 <a href="…/cdn-cgi/content?id=<每响应不同的 nonce>" …></a>
//     ——只在浏览器里取页时出现（curl 没有），锚点 URL 里带 nonce，必须剥；
//   · Cloudflare 注入的脚本块（整段含 __CF$ 的那块，本机实测 ~938B）——只剥这一块。
// 其余任何差异都要报出来。
const stripMiddle = (t) => t
  .replace(/"\/favicon\.svg\?v=[0-9a-f]+"/g, '"/favicon.svg"')
  .replace(/"\/apple-touch-icon\.png\?v=[0-9a-f]+"/g, '"/apple-touch-icon.png"')
  .replace(/<a href="https?:\/\/[^"]*\/cdn-cgi\/content\?id=[^"]*" aria-hidden="true" rel="nofollow noopener" style="display: none !important; visibility: hidden !important"><\/a>/g, '')
  .replace(/<script>((?:(?!<\/script>)[\s\S])*?)<\/script>/g, (m) => (m.includes('__CF$') ? '' : m))
const stamped = typeof remoteHtml === 'string' && /"\/favicon\.svg\?v=[0-9a-f]+"/.test(remoteHtml) && /"\/apple-touch-icon\.png\?v=[0-9a-f]+"/.test(remoteHtml)
ck('B', 'hub 给两条图标地址带了 ?v= 版本号', stamped, stamped ? 'ok' : (remoteHtml || '').slice(0, 120))
ck('B', 'index.html 只差中间层注入（hub 的 ?v= 与 Cloudflare 锚点/脚本块），其余逐字节一致', typeof remoteHtml === 'string' && stripMiddle(remoteHtml) === stripMiddle(localText('index.html')), '若不一致：服务器上不是这份构建，或 html 被中间层改写')

/* ---------------------------------------------------------------- C. 图标链 */
const iconInfo = JSON.parse(await js(`(async () => {
  const out = {}
  for (const f of ${JSON.stringify(LOCAL_ICONS)}) {
    try {
      const r = await fetch('/' + f + '?live=' + Date.now())
      const buf = await r.arrayBuffer()
      const d = await crypto.subtle.digest('SHA-256', buf)
      out[f] = { status: r.status, type: r.headers.get('content-type'), size: buf.byteLength, sha: [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('') }
    } catch (e) { out[f] = { error: String(e) } }
  }
  return JSON.stringify(out)
})()`) || '{}')
const iconLocal = (f) => (existsSync(join('dist', f)) ? localHash(f) : null)
// 站长在面板设了图标时 hub 会用他那一份回答全部路径（favicon.svg 与 favicon.ico 会是同一份字节）；
// 没设时逐条回答主题目录里的同名文件。两种都算合规，判据分开。
const adminIcon = iconInfo['favicon.svg']?.sha && iconInfo['favicon.ico']?.sha && iconInfo['favicon.svg'].sha === iconInfo['favicon.ico'].sha
for (const f of LOCAL_ICONS) {
  const info = iconInfo[f] || {}
  ck('C', `图标 /${f} 可取得且是图片`, info.status === 200 && !!info.type && (info.size || 0) > 0 && info.type.startsWith('image/'), `${info.status} ${info.type} ${info.size}B`)
}
if (adminIcon) {
  ck('C', '面板已设站点图标：四条路径由站长那份回答（两份内容一致）', true, 'admin-set')
} else {
  for (const f of LOCAL_ICONS) {
    ck('C', `图标 /${f} 与本地主题自带的同名文件逐字节一致（面板未设图标 → 主题兜底）`, (iconInfo[f] || {}).sha === iconLocal(f), (iconInfo[f] || {}).sha ? `remote=${iconInfo[f].sha.slice(0, 12)}… local=${(iconLocal(f) || '').slice(0, 12)}…` : 'missing')
  }
}

/* ---------------------------------------------------------------- E. history_days 与窗口按钮 */
await js(`document.querySelector('.node-card')?.click(); true`)
await waitFor(`!!document.querySelector('.load-timescale .btn-timescale')`, 10000)
await sleep(400)
const has30 = await js(`document.querySelectorAll('.load-timescale .btn-timescale[data-hours="720"]').length > 0`)
const expect30 = typeof page.historyDays === 'number' && page.historyDays * 24 >= 720
ck('E', `历史窗口与 /api/me 的 history_days 一致（保留 ${page.historyDays} 天 → 30D ${expect30 ? '应在' : '应收起'}）`, has30 === expect30, `30D=${has30}`)
await js(`document.getElementById('modal-close')?.click(); true`)

/* ---------------------------------------------------------------- D. localStorage 容错（真站） */
const blockId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError') } }) }
  catch (e) { window.__blockFailed = String(e) }
})()` })).result?.identifier
const baseD = errBase()
await send('Page.navigate', { url: `${BASE}/?storage=blocked&live=${Date.now()}` })
await waitFor(`document.querySelectorAll('.node-card, .node-row').length > 0`, 25000)
await sleep(600)
const blocked = JSON.parse(await js(`(() => {
  let mechanism = 'no-throw'
  try { localStorage } catch (e) { mechanism = e.name }
  return JSON.stringify({ rendered: document.querySelectorAll('.node-card, .node-row').length, mechanism, failed: window.__blockFailed ?? null })
})()`) || '{}')
ck('D', '机制自检：localStorage 访问真的会抛 SecurityError', blocked.failed === null && blocked.mechanism === 'SecurityError', JSON.stringify(blocked))
ck('D', '★ 禁用站点数据的访客也能看到整页（hub 1.4.1 的白屏那条）', blocked.rendered >= 1, `渲染 ${blocked.rendered} 条`)
ck('D', '禁用站点数据时无未捕获异常', newErrors(baseD).length === 0, newErrors(baseD).join(' | ').slice(0, 200))
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockId })

/* ---------------------------------------------------------------- 截图（可选） */
if (SHOTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  await send('Page.navigate', { url: `${BASE}/?live=${Date.now()}` })
  await waitFor(`document.querySelectorAll('.node-card, .node-row').length > 0`, 25000)
  for (let i = 0; i < 40; i++) { if (await js(SETTLED)) break; await sleep(250) }
  await sleep(1500)   // 等翻牌彻底落定
  await shot('live-desktop.png')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Page.navigate', { url: `${BASE}/?live=${Date.now()}` })
  await waitFor(`document.querySelectorAll('.node-card, .node-row').length > 0`, 25000)
  for (let i = 0; i < 40; i++) { if (await js(SETTLED)) break; await sleep(250) }
  await sleep(1500)
  await shot('live-mobile.png')
  console.log(`截图: ${SHOTS}/live-desktop.png, live-mobile.png`)
}

const failed = checks.filter((c) => !c.ok)
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  [${c.scope}] ${c.label}${c.ok ? '' : '  →  ' + JSON.stringify(c.detail)}`)
console.log(`\n${checks.length - failed.length} PASS / ${failed.length} FAIL  （${BASE}${useProxy ? '，经代理' : ''}）`)
chrome.kill()
process.exit(failed.length ? 1 : 0)
