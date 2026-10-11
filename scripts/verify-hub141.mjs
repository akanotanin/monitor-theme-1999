// hub 1.4.1 的主题侧适配验收 —— Monitor 1999（纯静态主题）那一份。
//
// 覆盖 release note「第三方主题请适配」里与本站有关的几条，外加两份 1.4.0 起就欠着的适配：
//
//   A. **浏览器禁用站点数据**（localStorage 访问抛 SecurityError）时页面必须照常渲染 ——
//      官方两个主题在 1.4.1 随附版里修的「整页空白」就是这个。夹具在页面任何脚本之前
//      把 `window.localStorage` 换成一枚会抛异常的 getter（并自证机制真的生效）。
//   B. 1.4.1 起**匿名推送满 1000 条时 `/api/ws` 握手回 503**。本站整站不用 WS（只轮询
//      `/api/nodes`），这组护栏钉两件事：①「一次 WS 升级尝试都没有」——结构上不受该上限
//      影响；② 轮询真的在跑（含 hub 给匿名请求回 gzip 帧的那条路径，fetch 要能照常消费）。
//      另含 1.4.0-④ 的「切回前台」：隐藏时停轮询 + **丢弃在途请求**（用慢响应夹具证明
//      迟到的响应真的没落地），回前台立刻补一次、轮询接回来。
//   C. `/api/nodes/{id}/metrics` 每行新增 `swap_used`/`tcp`/`udp`/`procs`：不认识的字段
//      不许让详情页出错（本站四张负载图只画 cpu/mem/disk/net，这里锁的是「多出也不崩」）。
//   D. **agent 上报的字符串一律纯文本渲染**（不许交给 innerHTML）：节点名、系统 / 内核 /
//      架构 / 虚拟化 / CPU 名、分组名、备注、探测线路名各埋一枚 `<img onerror>` 向量，
//      断言一处都没执行、页面上一个注入元素都没有、原文以文本形态可见；图表 tooltip 的
//      formatter 也要转义（它默认按 HTML 渲染）。
//   E. 站点图标四件套（hub 1.4.0-③）：`favicon.svg`/`favicon.ico`/`apple-touch-icon.png`/
//      `apple-touch-icon-precomposed.png` 在包里，index.html 静态引用前两个固定地址
//      （hub 会改写 `?v=`），touch 图 180×180 且完全不透明，ICO 是 16/32/48 三帧。
//   F. 历史窗口跟随 hub 的保留天数 `history_days`（1.3.2 起；匿名与登录同源）：
//      30 天 → 30D 按钮在、点下去真按 720h 取数；7 天 → 30D 收起、7D 按 168h 取；
//      旧 hub 没有该字段 → 回到 168 / 2160 兜底。
//
// 反向自测底账：拿改动前的构建跑，A 组必须红（整页空白：卡片 0 张 + SecurityError）、
// D 组的弹窗条目会红（`${node.name}` 等直接进 innerHTML）、E/F 组整组红（文件和逻辑都还没有）。
//
// 用法：node scripts/verify-hub141.mjs [截图目录=shots/hub141]
//   先 `npm run build` —— 验的是 dist/，不是源码。
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const OUT = process.argv[2] || 'shots/hub141'
mkdirSync(OUT, { recursive: true })
const PORT = 5241
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

/* ------------------------------------------------------------------ 夹具 */

// XSS 向量：onerror 是唯一会在 innerHTML 里真执行的那一类（<script> 经 innerHTML 是惰性的）。
// 所有向量共用同一个全局，任何一处未转义被执行到都会把它变成数字。
const XSS = '<img src=x onerror="window.__xss=(window.__xss||0)+1">'

const mkNode = (id, over = {}) => {
  const node = {
    id, name: '节点 ' + id, os: 'Debian GNU/Linux 13 (trixie)', cpu_name: 'AMD EPYC 9654 96-Core Processor',
    cpu_cores: 1, arch: 'x86_64', mem_total: 2147483648, disk_total: 27917287424, swap_total: 0,
    country: 'JP', group: '', sort: id, traffic_limit: 1099511627776, traffic_mode: 'sum', virt: 'kvm',
    kernel: '6.1.0-53-cloud-amd64', online: true, last_seen: Math.floor(Date.now() / 1000), last_seen_ago: 0,
    price: 0, currency: 'CNY', billing_cycle: '', expires_at: '', expires_in: null, public_remark: '',
  }
  Object.assign(node, over)
  node.metrics = {
    cpu: 12.5, mem_used: 1181116006, mem_total: node.mem_total, disk_used: 10844792422, disk_total: node.disk_total,
    load: [0.1, 0.2, 0.3], net_rx: 173400, net_tx: 165400, month_rx: 346030080000, month_tx: 175100000000,
    total_rx: 760000000000, total_tx: 391000000000, uptime: 4320000, procs: 76, swap_used: 0, swap_total: 0, tcp: 16, udp: 3,
  }
  return node
}

const NORMAL = [mkNode(1, { name: '东京一号', country: 'JP' }), mkNode(2, { name: '法兰克福', country: 'DE' }), mkNode(3, { name: '马尼拉', country: 'PH', online: false, last_seen_ago: 120 })]

// D 组夹具：每个会进 innerHTML 的服务器字符串都埋一枚向量
const EVIL_GROUP = '组' + XSS
const EVIL_PROBE = '线路' + XSS
const EVIL = [
  mkNode(1, {
    name: 'XSS ' + XSS + ' 东京', os: 'Debian ' + XSS, kernel: '6.1.0' + XSS, arch: 'x86_64' + XSS,
    virt: 'kvm' + XSS, cpu_name: 'AMD EPYC ' + XSS, group: EVIL_GROUP, public_remark: '备注' + XSS,
  }),
  mkNode(2, { name: '普通机', group: EVIL_GROUP }),
  mkNode(3, { name: '未分组机' }),
]

// C 组夹具：1.4.1 的新形状 —— 每行多 swap_used / tcp / udp / procs
const now = Math.floor(Date.now() / 1000)
const METRICS_ROWS = Array.from({ length: 60 }, (_, i) => ({
  ts: now - (60 - i) * 60, cpu: 20 + (i % 5), mem_used: 1073741824, disk_used: 10737418240,
  net_rx: 1024, net_tx: 2048, swap_used: 104857600, tcp: 40 + (i % 10), udp: 8, procs: 90 + i,
}))
const PING_ROWS = Array.from({ length: 40 }, (_, i) => ({ ts: now - (40 - i) * 60, task_id: 1, latency: 12 + (i % 3) }))

let current = { nodes: NORMAL, cfg: {}, historyDays: 30, admin: false, slowRemaining: 0 }
const stats = { nodes: 0, gzipNodes: 0, metrics: 0, upgrades: 0, hours: [], me: 0 }
const probesOf = () => ({ '1': current.probes || '默认线路' })

/* ------------------------------------------------------------------ 桩服务器（含 WS 503 / gzip / 慢响应） */

const server = createServer((req, res) => {
  res.on('error', () => {})   // 页面 abort 掉慢请求后这里会 ECONNRESET，静音即可
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  const json = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)) }
  if (path.startsWith('/api/')) {
    if (path === '/api/me') {
      stats.me += 1
      const body = { authed: false, github: false, public_page: true, site: `http://127.0.0.1:${PORT}`, site_name: '适配验收' }
      if (current.historyDays !== 'omit') body.history_days = current.historyDays
      return json(body)
    }
    if (path === '/api/nodes') {
      stats.nodes += 1
      const nodes = current.nodes.map((n) => { const copy = { ...n }; if (!current.admin) delete copy.remark; return copy })
      const body = Buffer.from(JSON.stringify({ admin: !!current.admin, nodes }))
      const aencoding = String(req.headers['accept-encoding'] || '')
      const reply = () => {
        if (res.writableEnded || res.destroyed) return
        // hub 1.4.1：匿名请求带 gzip 就直接回已压缩的帧
        if (/gzip/.test(aencoding)) {
          stats.gzipNodes += 1
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' })
          res.end(gzipSync(body))
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(body)
        }
      }
      const delay = current.slowRemaining > 0 ? (current.slowRemaining -= 1, 2500) : 0
      if (delay) setTimeout(reply, delay); else reply()
      return
    }
    if (/^\/api\/nodes\/[^/]+\/metrics$/.test(path)) {
      stats.metrics += 1
      stats.hours.push(url.searchParams.get('hours'))
      return json({ metrics: METRICS_ROWS, ping: PING_ROWS, probes: probesOf(), loss: {}, step: 60 })
    }
    if (path.endsWith('/config')) return json(current.cfg)
    return json({})
  }
  const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path)).replace(/^(\.\.[/\\])+/, '')
  let file = join('dist', rel)
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) file = join('dist', 'index.html')   // 单页主题：未知路径回落入口
  // 模拟 hub 送页时的图标版本号改写（stamp_icons）：主题必须原样保留这两个地址
  if (current.stampIcons && file === join('dist', 'index.html')) {
    const stamped = readFileSync(file, 'utf8')
      .replace('"/favicon.svg"', '"/favicon.svg?v=deadbeef"')
      .replace('"/apple-touch-icon.png"', '"/apple-touch-icon.png?v=deadbeef"')
    res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' })
    return res.end(stamped)
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  res.end(readFileSync(file))
})
server.on('upgrade', (req, socket) => {
  // hub 1.4.1 在匿名推送满 1000 条时的形态：握手回 503
  stats.upgrades += 1
  socket.write('HTTP/1.1 503 Service Unavailable\r\ncontent-length: 0\r\nconnection: close\r\n\r\n')
  socket.destroy()
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

/* ------------------------------------------------------------------ 无头浏览器 + CDP */

const CHROME = process.argv.includes('--chrome')
  ? process.argv[process.argv.indexOf('--chrome') + 1]
  : process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const profile = join(tmpdir(), `m1999-hub141-${Date.now()}`)
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--disable-gpu', '--no-sandbox',
  '--hide-scrollbars', '--no-proxy-server', `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' })

let wsUrl = null
for (let i = 0; i < 80 && !wsUrl; i++) {
  try {
    const cdpPort = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0])
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl
  } catch { /* 还没起来 */ }
  if (!wsUrl) await sleep(250)
}
if (!wsUrl) throw new Error('Chrome 没起来（--chrome <路径> 可以指定浏览器）')
const ws = new WebSocket(wsUrl)
await new Promise((r) => { ws.onopen = r })

let id = 0
const pending = new Map()
let errors = []
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception')
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '))
})
const send = (method, params = {}) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })) })
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable')
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })

const checks = []
const ck = (scope, label, ok, detail) => checks.push({ scope, label, ok: !!ok, detail })
const waitFor = async (expr, ms = 12000) => {
  for (let i = 0; i < Math.ceil(ms / 200); i++) { if (await js(expr)) return true; await sleep(200) }
  return false
}
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r.result?.data) writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'))
}
const cardCount = () => js(`document.querySelectorAll('.node-card').length`)
const navigate = async (key) => {
  current.key = key
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?s=${key}&t=${Date.now()}` })
}

/* ---------------------------------------------------------------- A. 浏览器禁用站点数据：页面不许白屏 */
console.log('=== A、浏览器禁用站点数据（localStorage 抛 SecurityError）：页面照常渲染 ===')
current = { nodes: NORMAL, cfg: { defaultViewMode: 'list' }, historyDays: 30, admin: false, slowRemaining: 0 }
const BLOCK = `(() => {
  try {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('The operation is insecure.', 'SecurityError') },
    })
  } catch (e) { window.__storageBlockFailed = String(e) }
})()`
const blockId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: BLOCK })).result?.identifier
let errBase = errors.length
await navigate('storage-blocked')
const mech = await js(`(() => {
  const failed = window.__storageBlockFailed ?? null
  let mechanism = 'no-throw'
  try { localStorage } catch (e) { mechanism = e.name || 'throws' }
  return JSON.stringify({ failed, mechanism })
})()`)
const mechObj = JSON.parse(mech || '{}')
ck('A', '机制自检：localStorage 访问真的会抛（桩真的生效了）', mechObj.failed === null && mechObj.mechanism === 'SecurityError', mech)
await waitFor(`document.querySelectorAll('.node-card, .node-row').length > 0`, 10000)
await sleep(600)
const renderedA = await js(`document.querySelectorAll('.node-card, .node-row').length`)
ck('A', '★ 页面照常渲染（卡片 ≥ 3 张，不是空白页）', renderedA >= 3, `卡片/行 ${renderedA} 条`)
ck('A', '★ 顶栏与统计栏都在（页面没有整页卸载）', await js(`!!document.querySelector('header') && !!document.getElementById('stat-nodes')`))
ck('A', '站点设置的默认视图（list）照样生效（读 localStorage 失败按「没存过」处理）', await js(`document.querySelector('#nodes-container').classList.contains('list-view')`))
const clicked = await js(`(() => { const b = document.querySelector('.btn-view[data-view="grid"]'); if (!b) return 'no-button'; b.click(); return 'ok' })()`)
await sleep(400)
const afterClick = await js(`JSON.stringify({ cards: document.querySelectorAll('.node-card').length, list: document.querySelector('#nodes-container').classList.contains('list-view') })`)
const ac = JSON.parse(afterClick || '{}')
ck('A', '★ 禁用存储时切视图仍能用（写 localStorage 失败被吞掉，页面照样重建）', clicked === 'ok' && ac.cards >= 3 && ac.list === false, `${clicked} / ${afterClick}`)
ck('A', 'A 组没有未捕获异常 / 控制台报错（尤其 SecurityError）', errors.length === errBase, errors.slice(errBase).join(' | ').slice(0, 240))
errBase = errors.length
await shot('a-storage-disabled.png')
await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: blockId })

/* ---------------------------------------------------------------- B. 无 WS + 轮询 + 隐藏/前台（1.4.0-④） */
console.log('\n=== B、不依赖 WS（1.4.1 的 503 上限碰不到）+ 轮询在跑 + 隐藏停/前台补 ===')
current = { nodes: NORMAL, cfg: { dataUpdateInterval: 2 }, historyDays: 30, admin: false, slowRemaining: 0 }
await navigate('polling')
await waitFor(`document.querySelectorAll('.node-card').length > 0`, 10000)
await sleep(500)
const n0 = stats.nodes
await sleep(5000)   // 覆盖两轮 2s
ck('B', '★ 轮询在拉 /api/nodes（5 秒窗口 ≥ 2 次）', stats.nodes - n0 >= 2, `窗口内 ${stats.nodes - n0} 次`)
ck('B', '★ 5 秒窗口里一次 WS 升级尝试都没有（本站不用 WS，结构上不受匿名 1000 条上限影响）', stats.upgrades === 0, `升级尝试 ${stats.upgrades} 次`)

// 隐藏：停轮询 + 丢弃在途请求（用慢响应证明迟到的帧真的没落地）
current = { nodes: NORMAL, cfg: { dataUpdateInterval: 2 }, historyDays: 30, admin: false, slowRemaining: 1 }
await navigate('hidden')
await waitFor(`window.Monitor1999 !== undefined`, 5000)
for (let i = 0; i < 40 && stats.nodes === 0; i++) await sleep(50)   // 等首个 /api/nodes 真的在途（2500ms 慢响应）
await js(`(() => {
  window.__hiddenVal = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__hiddenVal })
  window.__setHidden = (v) => { window.__hiddenVal = v; document.dispatchEvent(new Event('visibilitychange')) }
  window.__setHidden(true)
  return true
})()`)
const nHide = stats.nodes
await sleep(3600)   // 慢响应若没被丢弃，2.5s 时就会落地
ck('B', '★ 隐藏后不再发 /api/nodes 请求', stats.nodes === nHide, `${nHide} → ${stats.nodes}`)
ck('B', '★ 在途请求被丢弃：迟到的慢响应没有把卡片画出来（也没有 CONNECTION ERROR）',
  (await cardCount()) === 0 && !(await js(`document.body.innerText.includes('CONNECTION ERROR')`)), `卡片 ${await cardCount()} 张`)
await js(`window.__setHidden(false)`)
await waitFor(`document.querySelectorAll('.node-card').length > 0`, 5000)
await sleep(300)
ck('B', '★ 回到前台立刻补一次 /api/nodes，数据画出来', (await cardCount()) >= 3 && stats.nodes - nHide >= 1, `卡片 ${await cardCount()} 张 / 补拉 ${stats.nodes - nHide} 次`)
const nBack = stats.nodes
await sleep(4600)   // 覆盖两轮 2s
ck('B', '回到前台后轮询接回来（4.6 秒窗口 ≥ 2 次）', stats.nodes - nBack >= 2, `窗口内 ${stats.nodes - nBack} 次`)
ck('B', '★ gzip 帧路径真的被走到了（hub 1.4.1 对匿名 /api/nodes 的压缩路径照常消费）', stats.gzipNodes >= 3, `gzip 响应 ${stats.gzipNodes} 次`)
ck('B', 'B 组没有未捕获异常 / 控制台报错', errors.length === errBase, errors.slice(errBase).join(' | ').slice(0, 240))
errBase = errors.length
await shot('b-foreground.png')

/* ---------------------------------------------------------------- C. metrics 新字段：不认识的字段不许崩 */
console.log('\n=== C、metrics 行里多 swap_used/tcp/udp/procs：详情页照常画图 ===')
current = { nodes: NORMAL, cfg: {}, historyDays: 30, admin: false, slowRemaining: 0 }
const mBefore = stats.metrics
await navigate('metrics-shape')
await waitFor(`document.querySelectorAll('.node-card').length > 0`, 10000)
await js(`document.querySelector('.node-card').click()`)
await waitFor(`document.querySelectorAll('.load-chart-container canvas').length >= 4`, 10000)
await sleep(800)
ck('C', '★ 详情页取到了指标（服务端计数 ≥1）', stats.metrics - mBefore >= 1, `窗口内 ${stats.metrics - mBefore} 次`)
ck('C', '★ 四张负载图都画出来了（canvas ≥ 4）', (await js(`document.querySelectorAll('.load-chart-container canvas').length`)) >= 4)
ck('C', '★ 延迟图也画出来了（#chart-ping canvas ≥ 1）', (await js(`document.querySelectorAll('#chart-ping canvas').length`)) >= 1)
ck('C', '没有因为多出的字段报错', !errors.some((e) => /swap_used|procs|tcp|udp/.test(e)), errors.join(' | ').slice(0, 240))
ck('C', 'C 组没有未捕获异常 / 控制台报错', errors.length === errBase, errors.slice(errBase).join(' | ').slice(0, 240))
errBase = errors.length
await shot('c-detail.png')

/* ---------------------------------------------------------------- D. 服务器字符串一律纯文本 */
console.log('\n=== D、agent 上报的字符串纯文本渲染（卡片 / 分组标签 / 详情页 / tooltip） ===')
current = { nodes: EVIL, cfg: {}, historyDays: 30, admin: false, slowRemaining: 0, probes: EVIL_PROBE }
await navigate('plain-text')
await waitFor(`document.querySelectorAll('.node-card').length > 0`, 10000)
await sleep(600)
ck('D', '★ 卡片上的节点名以纯文本渲染（文本里看得到 <img，但一个元素都没注入）',
  (await js(`[...document.querySelectorAll('.node-card .node-name')].some((el) => el.textContent.includes('<img'))`)) &&
  (await js(`document.querySelectorAll('.node-card img').length`)) === 0)
ck('D', '分组标签同理是纯文本', (await js(`[...document.querySelectorAll('.group-tab')].some((el) => el.textContent.includes('<img'))`)) && (await js(`document.querySelectorAll('#group-tabs img').length`)) === 0)
await js(`document.querySelector('.node-card').click()`)
await waitFor(`!!document.querySelector('.modal-node-name')`, 8000)
await sleep(900)
const modal = await js(`(() => {
  const name = document.querySelector('.modal-node-name')
  const meta = document.querySelector('.modal-node-meta')
  const info = [...document.querySelectorAll('.modal-info-row .info-value')].map((el) => el.textContent)
  const chips = [...document.querySelectorAll('.remark-chip-text')].map((el) => el.textContent)
  const tasks = [...document.querySelectorAll('.latency-task-name')].map((el) => el.textContent)
  return JSON.stringify({
    nameText: name.textContent, nameEscaped: name.innerHTML.includes('&lt;img'),
    metaText: meta.textContent, metaEscaped: meta.innerHTML.includes('&lt;img'),
    infoHasRawText: info.some((t) => t.includes('<img')), infoEscaped: [...document.querySelectorAll('.modal-info-row .info-value')].some((el) => el.innerHTML.includes('&lt;img')),
    chips, tasks, imgInModal: document.querySelectorAll('#node-modal img').length,
  })
})()`)
const d = JSON.parse(modal || '{}')
ck('D', '★ 详情页标题是纯文本（原文可见、HTML 被转义）', /<img/.test(d.nameText || '') && d.nameEscaped === true, d.nameText)
ck('D', '★ 详情页「系统 · 架构 · 地区」是纯文本', /<img/.test(d.metaText || '') && d.metaEscaped === true, d.metaText)
ck('D', '★ 详情页信息格（CPU / 内核 / 虚拟化）是纯文本', d.infoHasRawText === true && d.infoEscaped === true)
ck('D', '★ 备注小卡片是纯文本', (d.chips || []).some((t) => t.includes('<img')), JSON.stringify(d.chips))
ck('D', '★ 探测线路名（详情页任务卡）是纯文本', (d.tasks || []).some((t) => t.includes('<img')), JSON.stringify(d.tasks))
// 图表 tooltip：ECharts 默认按 HTML 渲染 formatter 的返回值，seriesName 必须转义
const tooltip = await js(`(() => {
  try {
    const dom = document.getElementById('chart-ping')
    const inst = window.echarts && echarts.getInstanceByDom(dom)
    if (!inst) return JSON.stringify({ state: 'no-instance' })
    const f = inst.getOption().tooltip[0].formatter
    if (typeof f !== 'function') return JSON.stringify({ state: 'no-formatter', type: typeof f })
    const out = f([{ marker: '', seriesName: ${JSON.stringify('线路 ' + XSS)}, value: [${now * 1000}, 12] }])
    return JSON.stringify({ state: 'ok', hasRaw: out.includes('<img'), hasEscaped: out.includes('&lt;img') })
  } catch (e) { return JSON.stringify({ state: 'error', message: String(e) }) }
})()`)
const tip = JSON.parse(tooltip || '{}')
ck('D', '★ 图表 tooltip 的 formatter 转义 seriesName（ECharts 默认按 HTML 渲染）', tip.state === 'ok' && tip.hasRaw === false && tip.hasEscaped === true, tooltip)
await js(`(() => { const inst = window.echarts && echarts.getInstanceByDom(document.getElementById('chart-ping')); if (inst) inst.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 10 }); return true })()`)
await sleep(400)
ck('D', '★ 整个详情页里一个注入元素都没有（__xss 从未被触发）', (await js(`document.querySelectorAll('#node-modal img').length`)) === 0 && (await js(`window.__xss === undefined`)) === true, `__xss=${await js('String(window.__xss)')}`)
ck('D', '全页 __xss 均为 undefined（分组 / 卡片 / 备注 / tooltip 全部覆盖）', (await js(`window.__xss === undefined`)) === true)
ck('D', 'D 组没有未捕获异常（含图片 onerror 报错）', errors.length === errBase, errors.slice(errBase).join(' | ').slice(0, 240))
errBase = errors.length
await shot('d-plain-text.png')
await js(`(() => { const c = document.getElementById('modal-close'); if (c) c.click(); return true })()`)

/* ---------------------------------------------------------------- E. 站点图标四件套 */
console.log('\n=== E、站点图标：四份兜底文件 + index.html 静态引用（hub 1.4.0-③） ===')
const html = readFileSync('dist/index.html', 'utf8')
for (const f of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) {
  ck('E', `dist/${f} 在包里`, existsSync(join('dist', f)))
}
ck('E', 'index.html 静态引用 "/favicon.svg"（hub 会把这两个地址改写成 ?v=，引号形态要一致）', html.includes('"/favicon.svg"'))
ck('E', 'index.html 静态引用 "/apple-touch-icon.png"', html.includes('"/apple-touch-icon.png"'))
if (existsSync('dist/favicon.ico')) {
  const ico = readFileSync('dist/favicon.ico')
  const count = ico.readUInt16LE(4)
  const sizes = []
  let firstIsPng = false
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16
    sizes.push((ico[off] || 256))
    if (i === 0) firstIsPng = ico[ico.readUInt32LE(off + 12)] === 0x89 && ico.readUInt32LE(off + 12) + 3 < ico.length && ico[ico.readUInt32LE(off + 12) + 1] === 0x50
  }
  ck('E', 'favicon.ico 是三帧（16/32/48）、帧内容是 PNG', count === 3 && JSON.stringify(sizes) === JSON.stringify([16, 32, 48]) && firstIsPng, `count=${count} sizes=${JSON.stringify(sizes)}`)
}
if (existsSync('dist/apple-touch-icon-precomposed.png') && existsSync('dist/apple-touch-icon.png')) {
  ck('E', 'precomposed 与 apple-touch-icon.png 字节相同（老 iOS 直接来取这一条）', readFileSync('dist/apple-touch-icon-precomposed.png').equals(readFileSync('dist/apple-touch-icon.png')))
}
if (existsSync('dist/favicon.svg')) {
  const svg = readFileSync('dist/favicon.svg', 'utf8')
  ck('E', 'favicon.svg 是矢量（viewBox 64 格 + 主题强调色黄）', /viewBox="0 0 64 64"/.test(svg) && /#FFE600/i.test(svg))
}
current = { nodes: NORMAL, cfg: {}, historyDays: 30, admin: false, slowRemaining: 0, stampIcons: true }
await navigate('icons')
await waitFor(`document.querySelectorAll('.node-card').length > 0`, 10000)
const iconInfo = await js(`(async () => {
  const out = {}
  const iconLink = document.querySelector('link[rel="icon"]')
  const touchLink = document.querySelector('link[rel="apple-touch-icon"]')
  out.iconCount = document.querySelectorAll('link[rel="icon"]').length
  out.iconHref = iconLink ? iconLink.getAttribute('href') : null
  out.touchHref = touchLink ? touchLink.getAttribute('href') : null
  const svgRes = await fetch('/favicon.svg')
  out.svgType = svgRes.headers.get('content-type'); out.svgText = (await svgRes.text()).slice(0, 80)
  const touch = new Image(); touch.src = '/apple-touch-icon.png'
  try { await touch.decode() } catch (e) { out.touchErr = String(e) }
  out.touchW = touch.naturalWidth; out.touchH = touch.naturalHeight
  if (out.touchW) {
    const c = document.createElement('canvas'); c.width = 180; c.height = 180
    const ctx = c.getContext('2d'); ctx.drawImage(touch, 0, 0)
    const data = ctx.getImageData(0, 0, 180, 180).data
    let minA = 255; for (let i = 3; i < data.length; i += 4) if (data[i] < minA) minA = data[i]
    out.minAlpha = minA
  }
  const ico = new Image(); ico.src = '/favicon.ico'
  try { await ico.decode() } catch (e) { out.icoErr = String(e) }
  out.icoW = ico.naturalWidth
  return JSON.stringify(out)
})()`)
const ic = JSON.parse(iconInfo || '{}')
ck('E', '★ hub 给的 ?v= 版本号原样保留（主题不改写、不换地址）', ic.iconHref === '/favicon.svg?v=deadbeef' && ic.touchHref === '/apple-touch-icon.png?v=deadbeef', `${ic.iconHref} / ${ic.touchHref}`)
ck('E', '页面只有一条 link[rel=icon]（多一条会互相打架）', ic.iconCount === 1, `iconCount=${ic.iconCount}`)
ck('E', '★ /favicon.svg 由主题回答（content-type image/svg+xml）', (ic.svgType || '').includes('image/svg+xml'), ic.svgType)
ck('E', '★ apple-touch-icon.png 是 180×180', ic.touchW === 180 && ic.touchH === 180, `${ic.touchW}×${ic.touchH}`)
ck('E', '★ touch 图完全不透明（iOS 会把透明像素填黑）', ic.minAlpha === 255, `minAlpha=${ic.minAlpha}`)
ck('E', '★ favicon.ico 浏览器解得出（取最大帧 48）', ic.icoW === 48, `naturalWidth=${ic.icoW} err=${ic.icoErr || ''}`)
ck('E', 'E 组没有未捕获异常', errors.length === errBase, errors.slice(errBase).join(' | ').slice(0, 240))
errBase = errors.length

/* ---------------------------------------------------------------- F. 历史窗口跟随 history_days */
console.log('\n=== F、历史窗口跟随 hub 的保留天数（history_days） ===')
// F1：保留 30 天 → 匿名也有 30D，点下去真的按 720h 取数
current = { nodes: NORMAL, cfg: {}, historyDays: 30, admin: false, slowRemaining: 0 }
await navigate('history-30')
await waitFor(`document.querySelectorAll('.node-card').length > 0 && window.Monitor1999 && window.Monitor1999.maxHours() === 720`, 10000)
ck('F', '保留 30 天 → maxHours 是 720（匿名与登录同源）', (await js(`window.Monitor1999.maxHours()`)) === 720, String(await js(`window.Monitor1999.maxHours()`)))
await js(`document.querySelector('.node-card').click()`)
await waitFor(`!!document.querySelector('.load-timescale .btn-timescale[data-hours="720"]')`, 8000)
const hoursBefore = stats.hours.length
await js(`document.querySelector('.load-timescale .btn-timescale[data-hours="720"]').click()`)
await sleep(1200)
ck('F', '★ 30D 按钮在，且点下去按 hours=720 取数', stats.hours.slice(hoursBefore).includes('720'), JSON.stringify(stats.hours.slice(hoursBefore)))
// 截图前滚到负载图：默认视野里四张图有一半在折叠之下，只拍上半屏会看着像「图没画出来」
await js(`(() => { const g = document.getElementById('chart-cpu'); if (g) g.scrollIntoView({ block: 'center' }); return true })()`)
await sleep(500)
await shot('f-history-30.png')
// F2：保留 7 天 → 30D 收起、7D 按 168h 取
current = { nodes: NORMAL, cfg: {}, historyDays: 7, admin: false, slowRemaining: 0 }
await navigate('history-7')
await waitFor(`document.querySelectorAll('.node-card').length > 0 && window.Monitor1999 && window.Monitor1999.maxHours() === 168`, 10000)
ck('F', '保留 7 天 → maxHours 是 168', (await js(`window.Monitor1999.maxHours()`)) === 168, String(await js(`window.Monitor1999.maxHours()`)))
await js(`document.querySelector('.node-card').click()`)
await waitFor(`!!document.querySelector('.load-timescale .btn-timescale')`, 8000)
await sleep(400)
ck('F', '★ 保留天数不够时 30D 按钮收起（不再出现「写着 30D 实际画 7 天」）', (await js(`document.querySelectorAll('.load-timescale .btn-timescale[data-hours="720"]').length`)) === 0)
const hoursBefore7 = stats.hours.length
await js(`(() => { const b = document.querySelector('.load-timescale .btn-timescale[data-hours="168"]'); if (b) b.click(); return true })()`)
await sleep(1200)
ck('F', '7D 按钮在那、按 hours=168 取数', stats.hours.slice(hoursBefore7).includes('168'), JSON.stringify(stats.hours.slice(hoursBefore7)))
// F3：旧 hub 没有 history_days → 168 兜底
current = { nodes: NORMAL, cfg: {}, historyDays: 'omit', admin: false, slowRemaining: 0 }
await navigate('history-old')
await waitFor(`document.querySelectorAll('.node-card').length > 0 && window.Monitor1999 && window.Monitor1999.maxHours() === 168`, 10000)
ck('F', '旧 hub（没有 history_days 字段）→ 匿名回到 168 兜底', (await js(`window.Monitor1999.maxHours()`)) === 168, String(await js(`window.Monitor1999.maxHours()`)))
ck('F', 'F 组没有未捕获异常', errors.length === errBase, errors.slice(errBase).join(' | ').slice(0, 240))

/* ---------------------------------------------------------------- 汇总 */
const failed = checks.filter((c) => !c.ok)
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  [${c.scope}] ${c.label}${c.ok ? '' : '  →  ' + JSON.stringify(c.detail)}`)
console.log(`\n${checks.length - failed.length} PASS / ${failed.length} FAIL`)
console.log(`（背景计数：/api/nodes ${stats.nodes} 次，其中 gzip ${stats.gzipNodes} 次；metrics ${stats.metrics} 次；WS 升级尝试 ${stats.upgrades} 次）`)
chrome.kill()
server.close()
process.exit(failed.length ? 1 : 0)
