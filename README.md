# Monitor 1999

![Monitor 1999 主题首页预览](preview.png)

把 [ricebucket/komari-theme-1999](https://github.com/r1cebucket/komari-theme-1999)（基于原版 **v1.0.1**）移植到
[极简探针 Monitor](https://github.com/monitor-probe/monitor) 的主题，取名 **Monitor 1999**。
原主题的界面、样式与渲染逻辑保持原样，数据改由极简探针的 REST 接口提供，**不需要 Komari 服务器**。

## 主要功能

- **新粗野主义视觉**：粗边框、硬阴影、像素化的加载动画，强调色可选（黄 / 红 / 蓝 / 绿 / 紫）。
- **卡片 / 列表双视图**：访客的视图偏好记在本机，站点可在后台设置默认视图。
- **节点卡片**：CPU、内存、磁盘、流量四条进度条，上行 / 下行速率与运行时间；流量条按 Hub 的计费周期口径与 `sum` / `max` / `up` / `down` 模式绘制，未设流量上限时画成斜纹。
- **节点详情**：硬件 / 系统 / 存储 / 网络 四块信息（CPU 型号与核心数、架构、虚拟化、系统、内核、运行时间、最近上报、内存 / 交换 / 磁盘用量、双向速率与累计流量、TCP/UDP 连接数）。
- **历史曲线**：CPU、内存、磁盘、网络四张图，窗口 1H / 6H / 24H / 3D / 7D（登录后的管理员多一个 30D）。
- **延迟区块**：按探测线路列出最新延迟、丢包率、MIN / AVG / MAX / P50 / P99，并画出延迟曲线。
- **小动效**：数字变化时的乱码翻牌、像素骨架；详情页支持 `Esc` 关闭与键盘操作。
- **离线可用**：字体与 ECharts 都打进主题包，不依赖第三方 CDN。

## 本版更新

- 首次发布：把 Komari Theme 1999（v1.0.1）移植到极简探针 Monitor 1.3.0。
- 新增 `src/monitor.js` 适配层：Komari 的 RPC2 方法名（`common:getNodes`、`common:getRecords`、`public:getMe` …）翻译成极简探针的 REST 接口，`script.js` 里的调用点因此几乎不用改。
- `theme.json` 转成极简探针的主题清单，原版 4 项设置全部保留，另加「数据刷新间隔」「默认视图」两项。
- 移除主题内的登录弹窗（`POST /api/login` + 2FA + `/api/oauth`），顶栏按钮改为跳转后台 `/admin`。
- 字体（Archivo Black、Space Grotesk）与 ECharts 由 Google Fonts / jsDelivr 改为包内本地资源。

## 安装

需要极简探针 **1.3.0 或更高版本**（主题配置接口自该版本提供）。

- 后台「主题」→「上传主题包」，选择 [Releases](https://github.com/akanotanin/monitor-theme-1999/releases) 里的 `theme.tar.gz` 并启用；或
- 直接把包内容解到 `/opt/monitor/data/themes/1999/`（目录名必须等于 `theme.json` 的 `short`），再
  `chown -R monitor:monitor /opt/monitor/data/themes/1999 && chmod -R u=rwX,go=rX /opt/monitor/data/themes/1999`。
  Hub 即时生效，不用重启、也不用登录面板。

## 与原版的差异

原主题依赖 Komari 的 RPC2 接口，其中一部分能力极简探针并不提供。这些能力**直接移除入口，不用 0 或当前值顶替**：

| 原版功能 | 在极简探针上的表现 |
| --- | --- |
| 主题内登录弹窗（用户名 / 密码、6 位 2FA、OAuth2） | 整段移除。极简探针的登录只在 `/admin` 进行；顶栏按钮统一跳后台（已登录显示 `Admin`，未登录显示 `Login`），关闭该项设置后按钮不显示 |
| 节点详情「GPU」型号 | Hub 不上报，该项移除 |
| Connections / Processes 两张历史曲线卡 | Hub 只保存 CPU、内存、磁盘、上下行速率与 Ping 的历史，这两张卡移除；连接数的实时值仍在详情的 NETWORK 区块显示，进程数不再显示 |
| 30 天历史窗口按钮 | Hub 对匿名访客的窗口上限是 168 小时（超限会被**静默夹到上限**），所以该按钮只对已登录的管理员显示 |
| 流量上限模式 `min` | 极简探针只有 `sum` / `up` / `down` / `max` 四种模式 |
| 页面文案里的「Komari」 | 改为 Monitor；页脚 `Powered by` 指向极简探针上游，署名仍保留原作者 |

其余适配上的取舍：

- **丢包率**用 Hub 下发的**整窗口**丢包率（它按真实样本数计算）；只有 Hub 没下发某条线路时（说明该线路没丢包）才退回按桶统计。曲线里被 Hub 标记为「整桶全丢」的点画成断点。
- **历史粒度**由 Hub 按请求的桶数自动分桶（60 秒 ~ 数小时）：1H 窗口是 1 分钟一个点，7D 是十几分钟一个点；窗口拉长不会让点数变多，只是桶变宽。
- **内存 / 磁盘百分比的历史**：Hub 的历史只带 used，总量取该节点的当前值，所以总量若在窗口内变化过，早期点的百分比会略有偏差。
- **运行时间开关**：原版只隐藏卡片视图底部的运行时间行，且首次渲染时可能不生效；这里卡片与列表两种视图都会隐藏（已实测）。
- **主题设置存在 Hub**：配置读写 `GET/PUT /api/themes/1999/config`，在后台「主题 → 主题设置」里修改，换设备、重装主题都不会丢。页面里不再自带设置面板。
- **实时数据用轮询**：沿用原主题的设计，按「数据刷新间隔」（默认 3 秒）拉 `GET /api/nodes`，没有改用 Hub 的 `/api/ws` 推送。

## 数据映射

主题的渲染逻辑一行未改，全部沿用原版对 Komari 数据结构的读取方式；适配层放在 `src/monitor.js`：

| 主题调用的方法 | 极简探针接口 |
| --- | --- |
| `common:getNodes` | `GET /api/nodes` |
| `common:getNodesLatestStatus` | `GET /api/nodes` 里的实时 `metrics` |
| `common:getRecords`（负载） | `GET /api/nodes/{id}/metrics?hours=&points=&series=metrics` |
| `common:getRecords`（`type=ping`） | `GET /api/nodes/{id}/metrics?hours=&points=&series=ping` |
| `public:getMe` | `GET /api/me` |
| 站点名与主题配置（原 `/api/public`） | `GET /api/me` + `GET /api/themes/1999/config` |
| 其它方法 | 抛错（`Monitor 不提供此能力：…`），让原主题走降级分支 |

字段映射要点：

- `region` 取 `country`（ISO 3166-1 alpha-2，可能为空）；`virtualization` 取 `virt`；`kernel_version` 取 `kernel`；`weight` 取 `sort`。
- `traffic_limit_type` 取 `traffic_mode`；`net_total_up/down` 取**本计费周期**的 `month_tx/month_rx`，与 Hub 的流量上限同一口径。
- `net_in/net_out` 取 `metrics.net_rx/net_tx`（Hub 已是字节／秒）；`ram/swap/disk` 取 `mem_used/swap_used/disk_used`；`load`/`load5`/`load15` 取 `metrics.load[0..2]`；`process`/`connections`/`connections_udp` 取 `procs`/`tcp`/`udp`。
- 详情页的「最近上报」取 `last_seen`（unix 秒）转成本地时间字符串。
- 历史记录里 Hub 没有的字段保持缺省，图表画断点，不用当前值冒充。

## 开发

需要 Node.js 18 或更高（无第三方依赖）。

```bash
npm run build      # src/ + vendor/ → dist/
npm run check      # 校验 theme.json 的默认值与 src/monitor.js 的兜底默认值一致
npm run package    # 构建 + 打 release/theme.tar.gz（含 sha256）
npm run vendor     # 重新抓取 ECharts 与字体到 vendor/（带 sha256 校验）
npm run preview    # 本地预览 dist/，可加 MONITOR_HUB=https://<你的探针> 反代 /api
npm run clean      # 清掉 dist/ 与 release/
```

本地预览示例：

```bash
MONITOR_HUB=https://your-monitor.example.com npm run preview   # 打开 http://127.0.0.1:9911/
```

极简探针的接口没有 CORS 头，所以本地预览必须走上面的同源反代，浏览器直连 Hub 会被拦。

<details>
<summary>源码结构</summary>

```
src/index.html        上游模板：只改了标题、本地资源引用、去掉登录弹窗、页脚文案
src/styles.css        上游样式，一行未改（含已不再使用的登录弹窗样式）
src/script.js         上游脚本：只在数据层调用点与「被砍能力」处改动，均有 移植差异 注释
src/monitor.js        新增：极简探针适配层（RPC2 方法名 → REST、配置、历史记录）
src/vendor/fonts.css  新增：本地字体声明（Archivo Black、Space Grotesk 400/500/700）
vendor/               本地化的 ECharts 5.5.1 与字体 woff2（latin 子集，来自 @fontsource）
scripts/              build / package / check-defaults / vendor-assets / serve
theme.json            极简探针的主题清单（name / short / config / url）
```

</details>

## 发版流程

1. 同步升 `theme.json` 与 `package.json` 的 `version`；
2. 打 tag（`x.y.z`）并推送，`.github/workflows/release.yml` 会校验 tag 与版本号一致、构建、打 `release/theme.tar.gz` 并创建 Release（面板的「从 GitHub 安装 / 更新」认的就是这个文件名）。

## 许可

MIT。原主题 [Komari Theme 1999](https://github.com/r1cebucket/komari-theme-1999) 由 [ricebucket](https://github.com/r1cebucket) 编写，本仓库是它到极简探针的移植版本。
