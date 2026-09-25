/*
 * Monitor 1999 —— 极简探针（Monitor）适配层
 * ---------------------------------------------------------------------------
 * 上游主题 Komari Theme 1999 的界面、样式与渲染逻辑一行未改（见 src/script.js、
 * src/styles.css 的上游注释）；本文件是它与极简探针之间的唯一边界：
 *
 *   1. 把 Komari 的 RPC2 方法名（common:getNodes / common:getNodesLatestStatus /
 *      common:getRecords / public:getMe …）翻译成极简探针的 REST 接口，形状保持
 *      Komari 的 Client / NodeStatus，script.js 里的调用点因此不用改；
 *   2. 把主题配置（原来读 /api/public 的 theme_settings）改读 Hub 的
 *      GET /api/themes/1999/config —— 站点级设置只存在 Hub，访客端不落一份；
 *   3. 收口极简探针不上报的能力（GPU、温度、进程/连接数历史…），
 *      缺数据一律返回“无”，不用 0 或当前值顶替。
 *
 * 极简探针接口（匿名可读）：
 *   GET /api/me                                    → { authed, public_page, site_name }
 *   GET /api/nodes                                 → { nodes: [...] }（含实时 metrics）
 *   GET /api/nodes/{id}/metrics?hours=&points=&series=metrics|ping
 *   GET /api/themes/1999/config                    → 主题配置对象（未保存过返回 {}）
 *
 * 关于 hours/points：Hub 把请求的桶数 points 夹在 60..1440，步长
 * step = 60s * ceil(hours*60/points)。匿名窗口上限 168 小时（登录 2160），
 * 超限会被**静默夹到上限**，所以下面显式带上上限信息给界面用。
 */
(function () {
  'use strict';

  var SHORT = '1999';

  // 主题配置的兜底默认值。改这里必须同步 theme.json 的 default，
  // scripts/check-defaults.mjs 会在打包前双向比对。
  var DEFAULTS = {
    accentColor: 'yellow',
    cardStyle: 'thick',
    showUptime: true,
    showLoginButton: true,
    dataUpdateInterval: 3,
    defaultViewMode: 'grid'
  };

  var ACCENTS = ['yellow', 'red', 'blue', 'green', 'purple'];
  var CARD_STYLES = ['thick', 'thin', 'double'];
  var VIEW_MODES = ['grid', 'list'];

  // Hub 的历史窗口上限（见 src/api.rs 的 PUBLIC_HOURS / ADMIN_HOURS）
  var MAX_HOURS_PUBLIC = 168;
  var MAX_HOURS_ADMIN = 2160;

  // 一次快照的复用窗口：页面初始化会并发请求 getNodes + getNodesLatestStatus，
  // 不合并就会把 /api/nodes 打两遍
  var SNAPSHOT_TTL_MS = 1500;

  var snapshot = { at: 0, list: null };
  var inflight = null;

  // /api/me 的短缓存：站点信息与登录态在初始化时各取一次，没必要打两遍
  var ME_TTL_MS = 5000;
  var meCache = { at: 0, value: null };

  var settings = null;
  var me = { authed: false, public_page: true, site_name: '' };

  function fetchJSON(url) {
    return fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    }).then(function (res) {
      if (!res.ok) throw new Error(url + ' → HTTP ' + res.status);
      return res.json();
    });
  }

  function readMe() {
    var now = Date.now();
    if (meCache.value && now - meCache.at < ME_TTL_MS) return Promise.resolve(meCache.value);
    return fetchJSON('/api/me').then(function (info) {
      meCache = { at: Date.now(), value: info };
      return info;
    });
  }

  function numberOr(value, fallback) {
    return typeof value === 'number' && isFinite(value) ? value : fallback;
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function readNodes(force) {
    var now = Date.now();
    if (!force && snapshot.list && now - snapshot.at < SNAPSHOT_TTL_MS) {
      return Promise.resolve(snapshot.list);
    }
    if (!force && inflight) return inflight;
    inflight = fetchJSON('/api/nodes')
      .then(function (payload) {
        var list = Array.isArray(payload) ? payload : (payload && payload.nodes) || [];
        snapshot = { at: Date.now(), list: list };
        inflight = null;
        return list;
      })
      .catch(function (error) {
        inflight = null;
        throw error;
      });
    return inflight;
  }

  /* 极简探针 Node → Komari Client（主题只读它用到的字段，其余不编造） */
  function mapClient(node) {
    return {
      uuid: String(node.id),
      name: node.name || '',
      os: node.os || '',
      cpu_name: node.cpu_name || '',
      cpu_cores: numberOr(node.cpu_cores, 0),
      arch: node.arch || '',
      mem_total: numberOr(node.mem_total, 0),
      disk_total: numberOr(node.disk_total, 0),
      swap_total: numberOr(node.swap_total, 0),
      region: node.country || '',        // ISO 3166-1 alpha-2，可能为空
      group: node.group || '',
      weight: numberOr(node.sort, 0),
      traffic_limit: numberOr(node.traffic_limit, 0),
      traffic_limit_type: node.traffic_mode || 'max',   // sum / up / down / max
      virtualization: node.virt || '',
      kernel_version: node.kernel || ''
    };
  }

  /* 极简探针 Node → Komari NodeStatus（net_total_* 取本计费周期口径） */
  function mapStatus(node) {
    var m = node.metrics || {};
    var load = Array.isArray(m.load) ? m.load : [];
    return {
      online: node.online === true,
      cpu: numberOr(m.cpu, 0),
      ram: numberOr(m.mem_used, 0),
      ram_total: numberOr(m.mem_total, numberOr(node.mem_total, 0)),
      disk: numberOr(m.disk_used, 0),
      disk_total: numberOr(m.disk_total, numberOr(node.disk_total, 0)),
      swap: numberOr(m.swap_used, 0),
      swap_total: numberOr(m.swap_total, numberOr(node.swap_total, 0)),
      load: numberOr(load[0], 0),
      load5: numberOr(load[1], 0),
      load15: numberOr(load[2], 0),
      net_in: numberOr(m.net_rx, 0),     // 下行，字节/秒
      net_out: numberOr(m.net_tx, 0),    // 上行，字节/秒
      net_total_up: numberOr(node.month_tx, numberOr(m.month_tx, 0)),
      net_total_down: numberOr(node.month_rx, numberOr(m.month_rx, 0)),
      uptime: numberOr(m.uptime, 0),
      process: numberOr(m.procs, 0),
      connections: numberOr(m.tcp, 0),
      connections_udp: numberOr(m.udp, 0),
      // Komari 的 time 是时间字符串，主题在详情页里交给 new Date() 用
      time: node.last_seen ? new Date(node.last_seen * 1000).toISOString() : ''
    };
  }

  /* 主题配置：GET /api/themes/1999/config（匿名可读，未保存过回 {}） */
  function readConfig() {
    if (settings) return Promise.resolve(settings);
    return fetchJSON('/api/themes/' + SHORT + '/config')
      .catch(function () { return {}; })   // Hub < 1.3.0 没有该接口：静默回退默认值
      .then(function (saved) {
        var merged = {};
        Object.keys(DEFAULTS).forEach(function (key) {
          merged[key] = DEFAULTS[key];
        });
        if (saved && typeof saved === 'object') {
          Object.keys(merged).forEach(function (key) {
            var value = saved[key];
            if (key === 'accentColor' && ACCENTS.indexOf(value) >= 0) merged[key] = value;
            else if (key === 'cardStyle' && CARD_STYLES.indexOf(value) >= 0) merged[key] = value;
            else if (key === 'defaultViewMode' && VIEW_MODES.indexOf(value) >= 0) merged[key] = value;
            else if (key === 'dataUpdateInterval' && typeof value === 'number' && isFinite(value)) {
              merged[key] = Math.min(60, Math.max(1, Math.round(value)));
            } else if (key === 'showUptime' || key === 'showLoginButton') {
              if (typeof value === 'boolean') merged[key] = value;
            }
          });
        }
        settings = merged;
        // 主题配置是站点级设置；调用方通过 Object.assign 写回主题自己的 state.settings
        return Object.assign({}, merged);
      });
  }

  /* 负载历史：Hub 只保存 ts/cpu/mem_used/disk_used/net_rx/net_tx */
  function loadRecords(uuid, hours) {
    var requested = Math.min(Math.max(1, hours || 1), me.authed ? MAX_HOURS_ADMIN : MAX_HOURS_PUBLIC);
    return Promise.all([readNodes(), fetchJSON(
      '/api/nodes/' + encodeURIComponent(uuid) + '/metrics?hours=' + requested + '&points=240&series=metrics'
    )]).then(function (result) {
      var node = findById(result[0], uuid) || {};
      var memTotal = numberOr(node.mem_total, 0);
      var diskTotal = numberOr(node.disk_total, 0);
      return (result[1].metrics || []).map(function (row) {
        return {
          time: row.ts,                              // unix 秒，主题的 parseRecordTime 认识
          cpu: row.cpu,
          ram: row.mem_used,
          ram_total: memTotal,
          disk: row.disk_used,
          disk_total: diskTotal,
          net_in: row.net_rx,
          net_out: row.net_tx
        };
      });
    });
  }

  /* 延迟历史：Hub 的 ping 行是 {ts, task_id, latency, loss?, band?}，
     某一桶全丢时 latency 为 null；probes 给线路名，loss 是整窗口的丢包百分比。 */
  function pingRecords(uuid, hours) {
    var requested = Math.min(Math.max(1, hours || 1), me.authed ? MAX_HOURS_ADMIN : MAX_HOURS_PUBLIC);
    return fetchJSON(
      '/api/nodes/' + encodeURIComponent(uuid) + '/metrics?hours=' + requested + '&points=240&series=ping'
    ).then(function (data) {
      var probes = data.probes || {};
      var rows = data.ping || [];
      var taskIds = Object.keys(probes);

      var grid = [];
      var seen = {};
      rows.forEach(function (row) {
        if (!seen[row.ts]) { seen[row.ts] = true; grid.push(row.ts); }
      });
      grid.sort(function (a, b) { return a - b; });

      var byKey = {};
      rows.forEach(function (row) { byKey[row.task_id + '@' + row.ts] = row.latency; });

      // 每条线路补齐所有桶：缺的、以及 latency 为 null 的，都写成 -1。
      // 上游主题把负数当丢包（Komari 的存法），于是曲线断开、丢包率与 Hub 口径一致。
      var records = [];
      taskIds.forEach(function (id) {
        var taskId = /^\d+$/.test(id) ? Number(id) : id;
        grid.forEach(function (ts) {
          var latency = byKey[taskId + '@' + ts];
          records.push({
            task_id: taskId,
            time: ts,
            value: (typeof latency === 'number' && latency >= 0) ? latency : -1
          });
        });
      });

      return {
        records: records,
        tasks: taskIds.map(function (id) {
          return { id: /^\d+$/.test(id) ? Number(id) : id, name: probes[id] };
        }),
        // 整窗口丢包（百分比）。Hub 只有在真的丢包时才带上该线路；
        // 桶里丢了几次是它算不准的部分，所以界面用这个值而不是自己按桶数推。
        loss: data.loss || {}
      };
    });
  }

  /* Komari RPC2 方法名 → 极简探针接口。未实现的方法抛错（而不是回空对象），
     让原主题的降级分支自己把功能藏起来。 */
  function rpc(method, params) {
    params = params || {};
    switch (method) {
      case 'rpc.ping':
        return readNodes().then(function () { return 'pong'; });

      case 'common:getNodes':
        return readNodes().then(function (list) {
          var out = {};
          list.forEach(function (node) { out[String(node.id)] = mapClient(node); });
          return out;
        });

      case 'common:getNodesLatestStatus':
        return readNodes().then(function (list) {
          var out = {};
          list.forEach(function (node) { out[String(node.id)] = mapStatus(node); });
          return out;
        });

      case 'public:getMe':
        return site().then(function (info) {
          return { logged_in: info.authed, site_name: info.siteName, public_page: info.publicPage };
        });

      case 'common:getRecords':
        if (params.type === 'ping') return pingRecords(params.uuid, params.hours);
        return loadRecords(params.uuid, params.hours).then(function (records) {
          return { records: records, tasks: [] };
        });

      default:
        throw new Error('Monitor 不提供此能力：' + method);
    }
  }

  /* 站点信息 + 主题配置（对应上游的 /api/public） */
  function site() {
    return Promise.all([readMe().catch(function () { return null; }), readConfig()])
      .then(function (result) {
        var info = result[0] || {};
        me = { authed: info.authed === true, public_page: info.public_page !== false, site_name: info.site_name || '' };
        return {
          siteName: String(me.site_name || '').trim() || 'Monitor',
          authed: me.authed,
          publicPage: me.public_page,
          settings: result[1],
          maxHours: me.authed ? MAX_HOURS_ADMIN : MAX_HOURS_PUBLIC
        };
      });
  }

  window.Monitor1999 = {
    short: SHORT,
    defaults: DEFAULTS,
    rpc: rpc,
    site: site,
    loadRecords: loadRecords,
    pingRecords: pingRecords,
    isAuthed: function () { return me.authed; },
    maxHours: function () { return me.authed ? MAX_HOURS_ADMIN : MAX_HOURS_PUBLIC; }
  };
})();
