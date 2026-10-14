// ============================================================
//  搜索联想（搜索框下方的候选下拉）
//  - 在线联想词：按当前搜索引擎选接口，fetch + host_permissions 跨域
//    （扩展页面 CSP 禁止远程脚本，所以只能用 fetch，不能用 JSONP）
//  - 输入框为空且聚焦时：显示最近 10 条搜索记录（本地存储）
//  - 键盘：↑ / ↓ 选择，Enter 填入并直接搜索，Esc 关闭
// ============================================================

const STORAGE_KEY = 'searchSuggest';
const HISTORY_KEY = 'searchHistory';

const DEBOUNCE_MS = 220;        // 停止输入多久才发请求
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 80;
const HISTORY_MAX = 10;         // 空输入时最多显示几条历史
const HISTORY_KEEP = 60;        // 本地最多保留多少条历史
const FETCH_TIMEOUT_MS = 5000;
const MAX_ITEMS = 10;           // 下拉最多显示几条
const MAX_INPUT_LEN = 100;      // 过长的输入不联想，避免触发接口限制

export const DEFAULT_SUGGEST_SETTINGS = {
  enabled: true,
  online: true,
  history: true,
};

// ---------- 各引擎的联想接口 ----------
// 返回 null 表示这个引擎没有自己的联想接口（「跟随浏览器默认」和「自定义」就是这种）

function apiUrl(eng, q) {
  const s = encodeURIComponent(q);
  switch (eng && eng.id) {
    case 'baidu': return 'https://www.baidu.com/sugrec?prod=pc&wd=' + s;
    case 'bing': return 'https://api.bing.com/osjson.aspx?query=' + s;
    case 'sogou': return 'https://sor.html5.qq.com/api/getsug?key=' + s + '&t=1';
    case 'so360': return 'https://sug.so.360.cn/suggest?encodein=utf-8&encodeout=utf-8&word=' + s;
    case 'google':
      return 'https://suggestqueries.google.com/complete/search?client=chrome&hl=zh-CN&q=' + s;
    case 'duckduckgo': return 'https://duckduckgo.com/ac/?type=list&q=' + s;
    default: return null;
  }
}

// ---------- 提供方（提供方 = 一个接口 + 一个解析器）----------
// 为什么要有这一层：「跟随浏览器默认」和「自定义」没有联想接口，
// 谷歌 / DuckDuckGo 在国内网络又常常连不上——只认当前引擎的话，
// 这两种情况下输入就完全没有候选。所以这里做成「兜底链」：
// 先问当前引擎自己的接口，没有或取不到就自动换下一家，保证输入总有候选。

const PROVIDER_NAMES = {
  baidu: '百度',
  bing: '必应',
  sogou: '搜狗',
  so360: '360',
  google: '谷歌',
  duckduckgo: 'DuckDuckGo',
};

// 兜底顺序：优先国内可达、返回质量稳定的
const FALLBACK_ORDER = ['baidu', 'bing', 'sogou', 'so360', 'google', 'duckduckgo'];

// 一次联想最多试几家（避免每个词都把所有接口敲一遍）
const MAX_PROVIDER_TRIES = 3;

function providerIdsFor(engineId) {
  const own = FALLBACK_ORDER.indexOf(engineId) !== -1 ? engineId : null;
  const rest = FALLBACK_ORDER.filter(function (id) { return id !== engineId; });
  return own ? [own].concat(rest) : rest;
}

// ---------- 各引擎的返回解析 ----------
// 全部做了防御式解析：字段缺失、接口改版都只会得到空数组，不会抛错

function asList(x) {
  return Array.isArray(x) ? x : [];
}

function pickText(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    if (typeof v.word === 'string') return v.word;      // 360
    if (typeof v.phrase === 'string') return v.phrase;  // DuckDuckGo
    if (typeof v.q === 'string') return v.q;
  }
  return '';
}

function dedupe(list) {
  const out = [];
  list.forEach(function (s) {
    if (s && out.indexOf(s) === -1) out.push(s);
  });
  return out;
}

function parseBaidu(raw) {
  let o = null;
  try { o = JSON.parse(raw); } catch (e) { return []; }
  return asList(o && o.g).map(function (x) { return (x && x.q) || ''; });
}

function parseBing(raw) {
  let o = null;
  try { o = JSON.parse(raw); } catch (e) { return []; }
  return asList(o && o[1]).map(pickText);
}

function parse360(raw) {
  let o = null;
  try { o = JSON.parse(raw); } catch (e) { return []; }
  return asList(o && o.result).map(pickText);
}

function parseGoogle(raw) {
  let o = null;
  try { o = JSON.parse(raw); } catch (e) { return []; }
  return asList(o && o[1]).map(pickText);
}

function parseDuck(raw) {
  let o = null;
  try { o = JSON.parse(raw); } catch (e) { return []; }
  return asList(o).map(pickText);
}

// 搜狗返回的不是 JSON，而是 window.sogou.sug([...]) 形式的 JS 字面量，
// 且编码是 GBK。这里先按括号配对切出那个数组（不能用 lastIndexOf(']')，
// 因为后面还有别的数组），再 JSON.parse。
function sliceBalancedArray(raw) {
  const start = raw.indexOf('[');
  if (start === -1) return '';

  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return '';
}

function parseSogou(raw) {
  const body = sliceBalancedArray(raw);
  if (!body) return [];
  let o = null;
  try {
    o = JSON.parse(body);
  } catch (e) {
    return [];
  }
  return asList(o && o[1]).map(pickText);
}

const PARSERS = {
  baidu: parseBaidu,
  bing: parseBing,
  sogou: parseSogou,
  so360: parse360,
  google: parseGoogle,
  duckduckgo: parseDuck,
};

export function parseSuggest(engineId, raw) {
  const fn = PARSERS[engineId];
  if (!fn || typeof raw !== 'string') return [];
  let list = [];
  try { list = fn(raw); } catch (e) { list = []; }
  return dedupe(list.map(function (s) { return String(s).trim(); }).filter(Boolean));
}

// 搜狗是 GBK，其余都是 UTF-8：用 content-type 判断，必要时兜底
export function decodeBuffer(buf, contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.indexOf('gb') !== -1 || ct.indexOf('gbk') !== -1 || ct.indexOf('gb2312') !== -1) {
    try { return new TextDecoder('gbk').decode(buf); } catch (e) { /* 浏览器不支持 gbk 时退回 */ }
  }
  return new TextDecoder('utf-8').decode(buf);
}

// ---------- 纯函数：键盘导航（方便单测） ----------

export function moveActive(cur, delta, len) {
  if (!len) return -1;
  if (cur < 0) return delta > 0 ? 0 : len - 1;
  let next = cur + delta;
  if (next < 0) next = len - 1;
  if (next >= len) next = 0;
  return next;
}

export function pushHistory(list, q, max) {
  const text = String(q == null ? '' : q).trim();
  const cap = max || HISTORY_KEEP;
  const arr = Array.isArray(list) ? list.filter(function (x) { return typeof x === 'string'; }) : [];
  if (!text) return arr.slice(0, cap);

  const out = [text];
  arr.forEach(function (x) {
    if (x !== text && out.length < cap) out.push(x);
  });
  return out;
}

// 输入的是网址 / 以 / 开头时不做联想
export function looksLikeUrl(s) {
  if (/^https?:\/\//i.test(s)) return true;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return true;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !/\s/.test(s);
}

// 在候选里把包含输入内容的那一段高亮出来（用 DOM 节点拼，不用 innerHTML）
function markMatch(text, query) {
  const span = document.createElement('span');
  span.className = 'sug-text';

  const t = String(text);
  const q = String(query || '').trim();
  const at = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;

  if (at === -1) {
    span.textContent = t;
    return span;
  }

  span.appendChild(document.createTextNode(t.slice(0, at)));
  const hit = document.createElement('b');
  hit.className = 'hit';
  hit.textContent = t.slice(at, at + q.length);
  span.appendChild(hit);
  span.appendChild(document.createTextNode(t.slice(at + q.length)));
  return span;
}

// ============================================================
//  面板
// ============================================================

export function createSuggest(opts) {
  const input = opts.input;
  const panel = opts.panel;
  const getEngine = opts.getEngine;          // () => 当前引擎对象
  const getSettings = opts.getSettings;      // () => { enabled, online, history }
  const onPick = opts.onPick;                // (text) => void  选中后触发搜索
  const onHistoryChange = opts.onHistoryChange;

  let settings = Object.assign({}, DEFAULT_SUGGEST_SETTINGS, getSettings ? getSettings() : null);
  let history = [];

  let items = [];            // 当前显示的候选（不含表头）
  let rows = [];             // items 对应的 DOM 行
  let active = -1;
  let open = false;
  let composing = false;
  let itemsSeq = 0;          // 防止旧请求的结果盖住新结果
  let timer = null;
  let abort = null;
  let hideTimer = null;
  let pendingMove = 0;       // 面板还没出来时按下的 ↑/↓，等候选到了再落实

  const cache = new Map();   // key: engineId + '\n' + q  →  { t, list }（每个面板各存一份）

  // ---------- 历史记录 ----------

  function loadHistory() {
    return new Promise(function (resolve) {
      chrome.storage.local.get([HISTORY_KEY], function (o) {
        history = (o && Array.isArray(o[HISTORY_KEY])) ? o[HISTORY_KEY] : [];
        resolve();
      });
    });
  }

  function remember(q) {
    if (!settings.history) return;
    history = pushHistory(history, q, HISTORY_KEEP);
    chrome.storage.local.set({ [HISTORY_KEY]: history });
    if (onHistoryChange) onHistoryChange(history.slice());
  }

  function clearHistory() {
    history = [];
    chrome.storage.local.set({ [HISTORY_KEY]: [] });
    if (onHistoryChange) onHistoryChange([]);
    close();
  }

  // ---------- 开关 ----------

  function setSettings(patch) {
    settings = Object.assign({}, settings, patch);
    if (!settings.enabled) close();
    return settings;
  }

  // ---------- 在线联想 ----------

  function fromCache(providerId, q) {
    const hit = cache.get(providerId + '\n' + q);
    if (!hit) return null;
    if (Date.now() - hit.t > CACHE_TTL_MS) {
      cache.delete(providerId + '\n' + q);
      return null;
    }
    return hit.list;
  }

  function toCache(providerId, q, list) {
    const key = providerId + '\n' + q;
    if (cache.size >= CACHE_MAX) {
      const first = cache.keys().next();
      if (!first.done) cache.delete(first.value);
    }
    cache.set(key, { t: Date.now(), list: list });
  }

  // 记住上一次成功的提供方：下次优先用它，省掉反复试错
  let preferredProvider = null;

  // 问一家要联想词；返回 null 表示这家取不到（断网 / 超时 / 被拦 / 返回空）
  function fetchFrom(providerId, q, signal) {
    const url = apiUrl({ id: providerId }, q);
    if (!url) return Promise.resolve(null);

    const cached = fromCache(providerId, q);
    if (cached) return Promise.resolve(cached);

    return fetch(url, { signal: signal, credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const ct = res.headers.get('content-type');
        return res.arrayBuffer().then(function (buf) { return decodeBuffer(buf, ct); });
      })
      .then(function (text) {
        const list = parseSuggest(providerId, text).slice(0, MAX_ITEMS);
        if (!list.length) return null;
        toCache(providerId, q, list);
        return list;
      })
      .catch(function () { return null; });
  }

  // 依次尝试候选提供方，第一个有结果的就算数
  function fetchSuggest(eng, q) {
    const ids = providerIdsFor(eng && eng.id);

    // 当前引擎自己的接口永远排第一：用户选了百度就该先问百度，
    // 不能因为百度偶尔失败过一次，就长期改用别家的建议。
    const ownId = (eng && eng.id === ids[0]) ? ids[0] : null;

    // 兜底部分才按「上次成功的提供方」排序，减少反复试错
    const tail = ownId ? ids.slice(1) : ids.slice();
    if (preferredProvider && tail.indexOf(preferredProvider) !== -1) {
      tail.splice(tail.indexOf(preferredProvider), 1);
      tail.unshift(preferredProvider);
    }
    const ordered = ownId ? [ownId].concat(tail) : tail;

    const seq = ++itemsSeq;
    if (abort) abort.abort();
    abort = new AbortController();
    const signal = abort.signal;

    const tried = ordered.slice(0, MAX_PROVIDER_TRIES);

    // 每家的超时都比总预算短：前一家慢/挂了，后面还有机会
    const perTry = Math.max(1200, Math.round(FETCH_TIMEOUT_MS / tried.length));

    function attempt(i) {
      if (i >= tried.length) return Promise.resolve(null);
      if (signal.aborted) return Promise.resolve(undefined);

      const id = tried[i];
      let timer = null;
      const race = new Promise(function (resolve) {
        timer = setTimeout(function () { resolve(null); }, perTry);
      });

      return Promise.race([fetchFrom(id, q, signal), race])
        .then(function (list) {
          clearTimeout(timer);
          if (list && list.length) {
            preferredProvider = id;
            return { list: list, provider: id };
          }
          return attempt(i + 1);
        });
    }

    return attempt(0).then(function (r) {
      // 只有「仍然是最新的那次请求」才允许渲染
      if (seq !== itemsSeq) return undefined;
      return r;   // null = 所有提供方都没结果；undefined = 已被更新的请求取代
    });
  }

  // ---------- 渲染 ----------

  function setActive(i) {
    if (!items.length) {
      active = -1;
      return;
    }
    active = Math.max(0, Math.min(i, items.length - 1));
    // 注意：用 rows 而不是 panel.children —— 第一个子节点是表头，索引会整体错一位
    rows.forEach(function (el, n) {
      el.classList.toggle('on', n === active);
    });
    const el = rows[active];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function makeRow(text, kind) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sug-item';
    row.title = text;

    const icon = document.createElement('span');
    icon.className = 'sug-icon';
    icon.textContent = (kind === 'history') ? '\u21BA' : '\uD83D\uDD0D';
    row.appendChild(icon);

    row.appendChild(markMatch(text, kind === 'history' ? '' : input.value));

    if (kind === 'history') {
      const del = document.createElement('span');
      del.className = 'sug-del';
      del.textContent = '\u2715';
      del.title = '从历史记录中删除';
      del.addEventListener('mousedown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        history = history.filter(function (x) { return x !== text; });
        chrome.storage.local.set({ [HISTORY_KEY]: history });
        if (onHistoryChange) onHistoryChange(history.slice());
        items = items.filter(function (x) { return x !== text; });
        render('history', text);
      });
      row.appendChild(del);
    }

    // 用 mousedown 而不是 click：避免输入框先失焦导致下拉被关掉
    row.addEventListener('mousedown', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('sug-del')) return;
      e.preventDefault();
      pick(text);
    });

    row.addEventListener('mouseenter', function () {
      const n = rows.indexOf(row);
      if (n !== -1) setActive(n);
    });

    return row;
  }

  function render(kind, query, sourceLabel) {
    items = items.slice(0, MAX_ITEMS);
    active = -1;
    rows = [];
    panel.textContent = '';

    if (!items.length) {
      close();
      return;
    }

    const head = document.createElement('div');
    head.className = 'sug-head';
    head.textContent = (kind === 'history') ? '最近搜索' : '搜索建议';
    if (sourceLabel) {
      const from = document.createElement('span');
      from.className = 'sug-from';
      from.textContent = '来自' + sourceLabel;
      head.appendChild(from);
    }
    panel.appendChild(head);

    items.forEach(function (text) {
      const row = makeRow(text, kind);
      rows.push(row);
      panel.appendChild(row);
    });

    panel.hidden = false;
    open = true;
    if (input.setAttribute) input.setAttribute('aria-expanded', 'true');

    // 候选刚出来：把之前按下的 ↑/↓ 补上（例如清空输入后按 ↓，再等历史加载）
    if (pendingMove) {
      setActive(moveActive(-1, pendingMove, items.length));
      pendingMove = 0;
    }
  }

  function close() {
    open = false;
    active = -1;
    rows = [];
    items = [];
    pendingMove = 0;
    panel.hidden = true;
    panel.textContent = '';
    if (input.setAttribute) input.setAttribute('aria-expanded', 'false');
    if (abort) abort.abort();
  }

  // ---------- 何时显示什么 ----------

  // 本地兜底：拿历史记录里包含关键词的那几条当候选
  function localFallback(q) {
    if (!settings.history || !history.length) return false;
    const kw = q.toLowerCase();
    const local = history.filter(function (x) {
      return x.toLowerCase().indexOf(kw) !== -1;
    }).slice(0, MAX_ITEMS);
    if (!local.length) return false;
    items = local;
    render('history', '');
    return true;
  }

  function refresh() {
    if (!settings.enabled) { close(); return; }

    const q = input.value.trim();

    // 正在用输入法拼字：等拼完再联想，否则会把拼音当成关键词发出去
    if (composing) return;

    if (!q) {
      // 空输入 → 最近搜索
      if (!settings.history || !history.length) { close(); return; }
      items = history.slice(0, HISTORY_MAX);
      render('history', '');
      return;
    }

    if (looksLikeUrl(q)) { close(); return; }   // 要打开网址，不联想
    if (q.length > MAX_INPUT_LEN) { close(); return; }

    // 关掉联网建议 → 只用本地历史匹配
    if (!settings.online) {
      if (!localFallback(q)) close();
      return;
    }

    const eng = getEngine ? getEngine() : null;

    fetchSuggest(eng, q).then(function (r) {
      if (r === undefined) return;              // 已被更新的请求取代
      if (r && r.list && r.list.length) {
        items = r.list;
        // 用的不是当前引擎的接口时，在表头标出来，避免用户误以为
        // 「我选的必应，怎么候选是百度来的」
        const own = eng && eng.id === r.provider;
        render('online', q, own ? '' : (PROVIDER_NAMES[r.provider] || r.provider));
      } else {
        // 所有提供方都没结果：退到本地历史
        if (!localFallback(q)) close();
      }
    });
  }

  function schedule() {
    clearTimeout(timer);
    if (!input.value.trim()) {
      // 清空输入时立即回到历史列表，不用等防抖
      refresh();
      return;
    }
    timer = setTimeout(refresh, DEBOUNCE_MS);
  }

  // ---------- 选中 ----------

  // 鼠标点击和 Enter 的语义不同：
  //   鼠标点击 = 明确就要这一条 → 填入输入框并直接搜索
  //   Enter    = 先把候选补全到输入框（可能还要接着改），再按一次 Enter 才搜索
  // 所以用 searchNow 区分，由 onPick 决定要不要马上跳走。
  function pick(text, searchNow) {
    if (onPick) onPick(text, { search: searchNow !== false });
  }

  function pickActive(searchNow) {
    if (active < 0 || !items[active]) return false;
    pick(items[active], searchNow);
    return true;
  }

  // ---------- 事件 ----------

  function onKeyDown(e) {
    if (e.isComposing || composing) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const delta = (e.key === 'ArrowDown') ? 1 : -1;

      if (panel.hidden) {
        // 下拉还没出来（例如刚清空输入、或刚用回车补全过）→ 先让它出来，
        // 并记住这次按键想往哪走，等候选到了再落实（否则这一下会被吞掉）
        if (!settings.enabled) return;
        e.preventDefault();
        pendingMove = delta;
        refresh();
        return;
      }

      e.preventDefault();
      setActive(moveActive(active, delta, items.length));
      return;
    }

    if (e.key === 'Enter') {
      // 没有高亮 → 不拦截，交给表单提交去搜索
      if (panel.hidden || active < 0) return;
      e.preventDefault();
      // 只补全，不搜索；再按一次 Enter 才搜索
      pickActive(false);
      return;
    }

    if (e.key === 'Escape') {
      if (panel.hidden) return;
      e.preventDefault();
      e.stopPropagation();   // 别让 Esc 顺手把设置面板也关了
      close();
    }
  }

  function bind() {
    input.addEventListener('input', function () {
      if (composing) return;
      schedule();
    });
    input.addEventListener('keydown', onKeyDown);

    input.addEventListener('compositionstart', function () {
      composing = true;
      close();
    });
    input.addEventListener('compositionend', function () {
      composing = false;
      schedule();
    });

    input.addEventListener('focus', function () {
      clearTimeout(hideTimer);
      refresh();
    });

    // 失焦延迟一点再关：留给 mousedown 选中候选的时间
    input.addEventListener('blur', function () {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(close, 120);
    });
  }

  return {
    init: function () {
      bind();
      return loadHistory().then(function () {
        if (input.focus) input.focus();
      });
    },
    refresh: refresh,
    close: close,
    remember: remember,
    clearHistory: clearHistory,
    setSettings: setSettings,
    isOpen: function () { return open; },
    getHistory: function () { return history.slice(); },
  };
}
