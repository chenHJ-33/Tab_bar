// ============================================================
//  新标签页主体：时钟、搜索引擎、常用网站、壁纸、设置
// ============================================================

import { setBarIconOnly } from './bar.js';
import { initTranslate } from './translate.js';
import { createSuggest, DEFAULT_SUGGEST_SETTINGS } from './suggest.js';

// ---------- 壁纸预设 ----------

const PRESETS = [
  { key: 'midnight', css: 'radial-gradient(1200px 700px at 20% 0%, #1c2a4a 0%, #0d1526 45%, #070a12 100%)' },
  { key: 'dusk', css: 'linear-gradient(160deg, #2b1b3d 0%, #12131c 60%, #05060a 100%)' },
  { key: 'forest', css: 'radial-gradient(1000px 600px at 80% 10%, #14332c 0%, #0a1a18 50%, #050807 100%)' },
  { key: 'plain', css: 'none' },
];

// ---------- 搜索引擎 ----------

function enc(q) { return encodeURIComponent(q); }

// 图标策略：优先用 Chrome 本地缓存的真实 favicon（_favicon），
// 取不到时退回自绘的 SVG 徽标（品牌色 + 字形），保证任何情况下都有图。
const ENGINES = [
  {
    id: 'default', label: '默认', name: '跟随浏览器默认', color: '#5b6472', home: '',
    svg: '<circle cx="14.5" cy="14.5" r="6.5" fill="none" stroke="#ffffff" stroke-width="2.4"/>' +
         '<path d="M19.6 19.6 26 26" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round"/>',
    build: null
  },
  {
    id: 'baidu', label: '百度', name: '百度', color: '#2932e1', glyph: '百',
    home: 'https://www.baidu.com/',
    build: function (q) { return 'https://www.baidu.com/s?wd=' + enc(q); }
  },
  {
    id: 'bing', label: '必应', name: '必应', color: '#008373', glyph: 'b',
    home: 'https://cn.bing.com/',
    build: function (q) { return 'https://cn.bing.com/search?q=' + enc(q); }
  },
  {
    id: 'google', label: '谷歌', name: '谷歌', color: '#4285f4', glyph: 'G',
    home: 'https://www.google.com/',
    build: function (q) { return 'https://www.google.com/search?q=' + enc(q); }
  },
  {
    id: 'sogou', label: '搜狗', name: '搜狗', color: '#ff6a00', glyph: '搜',
    home: 'https://www.sogou.com/',
    build: function (q) { return 'https://www.sogou.com/web?query=' + enc(q); }
  },
  {
    id: 'so360', label: '360', name: '360 搜索', color: '#12b34c', glyph: '360',
    home: 'https://www.so.com/',
    build: function (q) { return 'https://www.so.com/s?q=' + enc(q); }
  },
  {
    id: 'duckduckgo', label: 'DuckDuckGo', name: 'DuckDuckGo', color: '#de5833', glyph: 'D',
    home: 'https://duckduckgo.com/',
    build: function (q) { return 'https://duckduckgo.com/?q=' + enc(q); }
  },
  {
    id: 'custom', label: '自定义', name: '自定义（自己填网址）', color: '#7a6cf0', home: '',
    svg: '<path d="M8 11.5h16M8 16h16M8 20.5h16" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>' +
         '<circle cx="13" cy="11.5" r="2.4" fill="#ffffff"/>' +
         '<circle cx="20" cy="16" r="2.4" fill="#ffffff"/>' +
         '<circle cx="15" cy="20.5" r="2.4" fill="#ffffff"/>',
    build: null
  },
];

// 自绘徽标（兜底用）
function engineBadgeSrc(eng) {
  if (!eng) eng = ENGINES[0];
  const color = eng.color || '#5b6472';
  let inner = eng.svg || '';

  if (!inner && eng.glyph) {
    const g = String(eng.glyph).replace(/[<>&"']/g, '');
    const multi = g.length > 1;
    inner = '<text x="16" y="' + (multi ? 21.5 : 23) + '" text-anchor="middle" ' +
            'font-family="Microsoft YaHei,system-ui,sans-serif" font-size="' + (multi ? 12.5 : 18) + '" ' +
            'font-weight="600" fill="#ffffff">' + g + '</text>';
  }

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<rect width="32" height="32" rx="9" fill="' + color + '"/>' + inner +
    '</svg>'
  );
}

// 引擎对应的官网地址（自定义引擎从模板里推出来），用来取 favicon
function engineHome(eng) {
  if (!eng) return '';
  if (eng.home) return eng.home;

  if (eng.id === 'custom') {
    const tpl = String(state.settings.customEngine || '').trim();
    if (tpl) {
      try {
        const u = new URL(tpl.replace('%s', 'x'));
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin + '/';
      } catch (e) { /* 模板还不是合法网址，忽略 */ }
    }
  }
  return '';
}

// 把图标装到某个 <img> 上；favicon 加载失败自动换成自绘徽标
function applyEngineIcon(img, eng) {
  if (!img) return;

  const home = engineHome(eng);
  if (!home) {
    img.onerror = null;
    img.src = engineBadgeSrc(eng);
    return;
  }

  img.onerror = function () {
    img.onerror = null;
    img.src = engineBadgeSrc(eng);
  };
  img.src = faviconUrl(home, 32) + '&showFallbackMonogram=true';
}

// ---------- 默认值 ----------

const DEFAULT_SETTINGS = {
  wallpaper: { type: 'preset', value: 'midnight' },
  dim: 35,
  barIconOnly: false,
  engine: 'default',
  customEngine: '',
  suggest: Object.assign({}, DEFAULT_SUGGEST_SETTINGS),
};

const DEFAULT_ICONS = [
  { name: '百度', url: 'https://www.baidu.com/' },
  { name: '知乎', url: 'https://www.zhihu.com/' },
  { name: '哔哩哔哩', url: 'https://www.bilibili.com/' },
  { name: 'GitHub', url: 'https://github.com/' },
  { name: '淘宝', url: 'https://www.taobao.com/' },
  { name: '微博', url: 'https://weibo.com/' },
  { name: '豆瓣', url: 'https://www.douban.com/' },
];

const MAX_LOCAL_WALLPAPERS = 8;
const MAX_WALL_W = 2560;
const MAX_WALL_H = 1600;

const state = {
  settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
  icons: DEFAULT_ICONS.slice(),
  wallpapers: [],   // [{ id, name, data }]
};

function $(id) { return document.getElementById(id); }

// 安全绑定：元素不存在时只警告，不让整页初始化中断
function on(id, evt, handler) {
  const el = $(id);
  if (!el) {
    console.warn('[新标签页] 找不到元素 #' + id + '，已跳过 ' + evt + ' 绑定');
    return null;
  }
  el.addEventListener(evt, handler);
  return el;
}

// ---------- 存储 ----------

function loadState() {
  return new Promise(function (resolve) {
    chrome.storage.local.get(['settings', 'icons', 'wallpapers'], function (o) {
      const s = (o && o.settings) || {};
      state.settings = Object.assign({}, DEFAULT_SETTINGS, s);
      state.settings.wallpaper = Object.assign({}, DEFAULT_SETTINGS.wallpaper, s.wallpaper || {});
      // 老版本存的设置里没有 suggest 这一项，补上默认值
      state.settings.suggest = Object.assign({}, DEFAULT_SUGGEST_SETTINGS, s.suggest || {});
      state.icons = (o && Array.isArray(o.icons)) ? o.icons : DEFAULT_ICONS.slice();
      state.wallpapers = (o && Array.isArray(o.wallpapers)) ? o.wallpapers : [];
      resolve();
    });
  });
}

function saveSettings() {
  chrome.storage.local.set({ settings: state.settings });
}

function saveIcons() {
  chrome.storage.local.set({ icons: state.icons });
}

function saveWallpapers() {
  return new Promise(function (resolve) {
    chrome.storage.local.set({ wallpapers: state.wallpapers }, function () {
      resolve(!chrome.runtime.lastError);
    });
  });
}

// ---------- 通用 ----------

function faviconUrl(url, size) {
  return chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=' + size);
}

function letterIcon(text) {
  const ch = String(text || '?').trim().charAt(0).toUpperCase().replace(/[<>&"']/g, '');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
    '<rect width="64" height="64" rx="16" fill="#3a3f4b"/>' +
    '<text x="32" y="43" font-family="system-ui,sans-serif" font-size="30" fill="rgba(255,255,255,0.88)" text-anchor="middle">' + ch + '</text>' +
    '</svg>'
  );
}

function attachFallback(img, text) {
  img.addEventListener('error', function () {
    if (img.dataset.fallback) return;
    img.dataset.fallback = '1';
    img.src = letterIcon(text);
  });
}

function setHint(text) {
  const hint = $('wallHint');
  if (hint) hint.textContent = text;
}

function setEngineHint(text) {
  const hint = $('engineHint');
  if (hint) hint.textContent = text;
}

function setSuggestHint(text) {
  const hint = $('sugHint');
  if (!hint) return;
  // 恢复默认文案时要连 <code> 标签一起还原，所以记下最初的 HTML
  if (hint.dataset.defaultHtml === undefined) hint.dataset.defaultHtml = hint.innerHTML;
  if (text) hint.textContent = text;
  else hint.innerHTML = hint.dataset.defaultHtml;
}

function looksLikeUrl(s) {
  if (/^https?:\/\//i.test(s)) return true;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) return true;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(s) && !/\s/.test(s);
}

function normalizeUrl(s) {
  return /^https?:\/\//i.test(s) ? s : 'https://' + s;
}

// ============================================================
//  搜索引擎
// ============================================================

function engineById(id) {
  const list = ENGINES.filter(function (e) { return e.id === id; });
  return list.length ? list[0] : ENGINES[0];
}

function currentEngine() {
  return engineById(state.settings.engine);
}

function buildCustomUrl(q) {
  const tpl = String(state.settings.customEngine || '').trim();
  if (!tpl || tpl.indexOf('%s') === -1) return null;
  return tpl.replace('%s', encodeURIComponent(q));
}

function syncEngineUi() {
  const eng = currentEngine();
  const label = $('engineLabel');
  if (label) label.textContent = eng.label;
  const icon = $('engineIcon');
  if (icon) applyEngineIcon(icon, eng);
  const sel = $('engine');
  if (sel) sel.value = eng.id;
  const row = $('customEngineRow');
  if (row) row.hidden = eng.id !== 'custom';
}

function setEngine(id) {
  state.settings.engine = id;
  saveSettings();
  syncEngineUi();
}

function doSearch(raw) {
  const q = String(raw || '').trim();
  if (!q) return;

  closeSuggest();
  if (suggest) suggest.remember(q);   // 记进最近搜索

  if (looksLikeUrl(q)) {
    location.href = normalizeUrl(q);
    return;
  }

  const eng = currentEngine();

  if (eng.id === 'custom') {
    const url = buildCustomUrl(q);
    if (url) { location.href = url; return; }
    // 自定义没填好 → 退回浏览器默认
  } else if (typeof eng.build === 'function') {
    location.href = eng.build(q);
    return;
  }

  if (chrome.search && chrome.search.query) {
    try {
      const p = chrome.search.query({ text: q, disposition: 'CURRENT_TAB' });
      if (p && typeof p.catch === 'function') {
        p.catch(function () { location.href = engineById('bing').build(q); });
      }
      return;
    } catch (e) { /* 回退 */ }
  }
  location.href = engineById('bing').build(q);
}

// ---------- 引擎切换菜单 ----------

let engineMenuEl = null;

// 搜索联想面板（在 bindSearch 里创建）
let suggest = null;

function closeSuggest() {
  if (suggest) suggest.close();
}

function placeBelow(menu, trigger) {
  menu.hidden = false;
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top = '0px';

  const r = trigger.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let left = r.left;
  let top = r.bottom + 8;

  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.visibility = '';
}

function closeEngineMenu() {
  if (engineMenuEl) {
    engineMenuEl.remove();
    engineMenuEl = null;
  }
  const btn = $('engineBtn');
  if (btn) btn.classList.remove('active');
}

function openEngineMenu() {
  if (engineMenuEl) { closeEngineMenu(); return; }

  closeSuggest();

  const btn = $('engineBtn');
  const menu = document.createElement('div');
  menu.className = 'menu';

  const title = document.createElement('div');
  title.className = 'menu-title';
  title.textContent = '搜索引擎';
  menu.appendChild(title);

  ENGINES.forEach(function (eng) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item' + (eng.id === state.settings.engine ? ' is-active' : '');

    const img = document.createElement('img');
    img.alt = '';
    applyEngineIcon(img, eng);
    item.appendChild(img);

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = eng.name;
    item.appendChild(t);

    if (eng.id === state.settings.engine) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.textContent = '✓';
      item.appendChild(tick);
    }

    item.addEventListener('click', function () {
      closeEngineMenu();
      if (eng.id === 'custom' && !String(state.settings.customEngine || '').trim()) {
        openSettings(true);
        return;
      }
      setEngine(eng.id);
    });

    menu.appendChild(item);
  });

  menu.hidden = true;
  document.body.appendChild(menu);
  placeBelow(menu, btn);
  engineMenuEl = menu;
  btn.classList.add('active');
}

// ============================================================
//  壁纸
// ============================================================

function applyWallpaper() {
  const el = $('wallpaper');
  if (!el) return;
  const wp = state.settings.wallpaper || DEFAULT_SETTINGS.wallpaper;

  if (wp.type === 'local') {
    const found = state.wallpapers.filter(function (w) { return w.id === wp.value; })[0];
    if (found) {
      el.style.backgroundImage = 'url("' + found.data + '")';
      el.style.backgroundColor = '#07090f';
      return;
    }
    // 图片被删了 → 回到第一个预设
    el.style.backgroundImage = PRESETS[0].css;
    el.style.backgroundColor = '';
    return;
  }

  if (wp.type === 'url') {
    el.style.backgroundImage = 'url("' + String(wp.value).replace(/"/g, '%22') + '")';
    el.style.backgroundColor = '#07090f';
    return;
  }

  const p = PRESETS.filter(function (x) { return x.key === wp.value; })[0] || PRESETS[0];
  el.style.backgroundImage = (p.css === 'none') ? 'none' : p.css;
  el.style.backgroundColor = (p.css === 'none') ? '#0b0d12' : '';
}

function applyDim() {
  let dim = Number(state.settings.dim);
  if (isNaN(dim)) dim = 35;
  const v = Math.max(0, Math.min(80, dim)) / 100;
  document.documentElement.style.setProperty('--dim', v.toFixed(2));
  const val = $('dimVal');
  if (val) val.textContent = Math.round(v * 100) + '%';
}

function isActiveLocal(id) {
  return state.settings.wallpaper.type === 'local' && state.settings.wallpaper.value === id;
}

function renderWallList() {
  const wrap = $('wallList');
  if (!wrap) return;
  wrap.textContent = '';

  state.wallpapers.forEach(function (w) {
    const item = document.createElement('div');
    item.className = 'wall-item' + (isActiveLocal(w.id) ? ' on' : '');
    item.style.backgroundImage = 'url("' + w.data + '")';
    item.title = w.name + '（点击应用）';
    item.addEventListener('click', function () {
      state.settings.wallpaper = { type: 'local', value: w.id };
      saveSettings();
      applyWallpaper();
      renderWallList();
      renderPresets();
    });

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.title = '删除这张壁纸';
    rm.addEventListener('click', function (e) {
      e.stopPropagation();
      state.wallpapers = state.wallpapers.filter(function (x) { return x.id !== w.id; });
      if (isActiveLocal(w.id)) {
        state.settings.wallpaper = { type: 'preset', value: 'midnight' };
        saveSettings();
      }
      saveWallpapers();
      applyWallpaper();
      renderWallList();
      renderPresets();
      setHint('已删除 1 张本地壁纸。');
    });

    item.appendChild(rm);
    wrap.appendChild(item);
  });
}

function renderPresets() {
  const wrap = $('presets');
  if (!wrap) return;
  wrap.textContent = '';

  PRESETS.forEach(function (p) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset' + (
      state.settings.wallpaper.type === 'preset' && state.settings.wallpaper.value === p.key ? ' on' : ''
    );
    b.style.background = (p.css === 'none') ? '#0b0d12' : p.css;
    b.title = p.key;
    b.addEventListener('click', function () {
      state.settings.wallpaper = { type: 'preset', value: p.key };
      saveSettings();
      applyWallpaper();
      renderPresets();
      renderWallList();
    });
    wrap.appendChild(b);
  });
}

// 本地图片：压缩后保存，避免撑爆本地存储
function downscaleImage(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onerror = function () { reject(new Error('读取失败')); };
    reader.onload = function () {
      const img = new Image();
      img.onerror = function () { reject(new Error('不是有效的图片')); };
      img.onload = function () {
        const scale = Math.min(1, MAX_WALL_W / img.width, MAX_WALL_H / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function addLocalWallpapers(files) {
  const all = Array.prototype.slice.call(files || []).filter(function (f) {
    return /^image\//.test(f.type);
  });
  if (!all.length) return;

  const room = Math.max(0, MAX_LOCAL_WALLPAPERS - state.wallpapers.length);
  if (room === 0) {
    setHint('本地壁纸上限是 ' + MAX_LOCAL_WALLPAPERS + ' 张，先删掉几张再上传。');
    return;
  }

  const picked = all.slice(0, room);
  const skippedByLimit = all.length - picked.length;
  setHint('正在处理 ' + picked.length + ' 张图片…');

  const tasks = picked.map(function (file) {
    return downscaleImage(file).then(function (data) {
      return {
        id: 'w' + Date.now() + Math.random().toString(36).slice(2, 7),
        name: file.name || '壁纸',
        data: data
      };
    }).catch(function () { return null; });
  });

  Promise.all(tasks).then(function (results) {
    const added = results.filter(function (x) { return !!x; });

    if (!added.length) {
      setHint('没有添加成功：文件可能不是有效的图片。');
      return;
    }

    state.wallpapers = state.wallpapers.concat(added);
    const last = added[added.length - 1];
    state.settings.wallpaper = { type: 'local', value: last.id };
    saveSettings();
    applyWallpaper();
    renderWallList();
    renderPresets();

    return saveWallpapers().then(function (ok) {
      const skipped = skippedByLimit + (picked.length - added.length);
      if (!ok) setHint('保存失败：本地存储空间不足，先删掉几张旧壁纸再试。');
      else if (skipped > 0) setHint('已添加 ' + added.length + ' 张，' + skipped + ' 张被跳过。');
      else setHint('已添加 ' + added.length + ' 张本地壁纸。');
    });
  });
}

// 拖拽图片到页面任意位置即可设为壁纸
function bindDrop() {
  const mask = $('dropMask');
  if (!mask) return;
  let hideTimer = null;

  function hasFiles(e) {
    const dt = e.dataTransfer;
    if (!dt || !dt.types) return false;
    for (let i = 0; i < dt.types.length; i++) {
      if (dt.types[i] === 'Files') return true;
    }
    return false;
  }

  window.addEventListener('dragover', function (e) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    mask.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { mask.hidden = true; }, 220);
  });

  window.addEventListener('drop', function (e) {
    e.preventDefault();
    clearTimeout(hideTimer);
    mask.hidden = true;
    if (hasFiles(e)) addLocalWallpapers(e.dataTransfer.files);
  });
}

// ============================================================
//  时钟
// ============================================================

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function tickClock() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const timeEl = $('time');
  const dateEl = $('date');
  if (timeEl) timeEl.textContent = hh + ':' + mm;
  if (dateEl) {
    dateEl.textContent =
      d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEKDAYS[d.getDay()];
  }
}

// ============================================================
//  常用网站
// ============================================================

// ---------- 图标拖拽排序 ----------

let dragFrom = null;

function clearDragUi() {
  dragFrom = null;
  document.querySelectorAll('.tile').forEach(function (el) {
    el.classList.remove('dragging', 'drop-before', 'drop-after', 'drop-end');
  });
}

function setDropIndicator(el, side) {
  document.querySelectorAll('.tile').forEach(function (node) {
    if (node === el) return;
    node.classList.remove('drop-before', 'drop-after', 'drop-end');
  });
  if (!el) return;
  el.classList.remove('drop-before', 'drop-after', 'drop-end');
  el.classList.add(side === 'after' ? 'drop-after' : 'drop-before');
}

// 把 from 处的图标移动到「插入到 insertBefore 之前」的位置
function moveIconTo(from, insertBefore) {
  if (from === null || from === undefined || from < 0 || from >= state.icons.length) return false;

  const arr = state.icons.slice();
  const item = arr.splice(from, 1)[0];
  let idx = insertBefore;
  if (from < insertBefore) idx -= 1;
  if (idx < 0) idx = 0;
  if (idx > arr.length) idx = arr.length;
  arr.splice(idx, 0, item);
  state.icons = arr;
  return true;
}

function orderKey() {
  return JSON.stringify(state.icons);
}

// 结束一次拖拽：有变化才写存储并重绘
function commitIconDrop(insertBefore) {
  const from = dragFrom;
  if (from === null) return;

  const before = orderKey();
  clearDragUi();
  moveIconTo(from, insertBefore);
  if (orderKey() === before) return;

  saveIcons();
  renderIcons();
}

function bindTileDrag(tile, index) {
  tile.draggable = true;

  tile.addEventListener('dragstart', function (e) {
    dragFrom = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(index)); } catch (err) { /* 忽略 */ }
    }
    tile.classList.add('dragging');
  });

  tile.addEventListener('dragend', clearDragUi);

  tile.addEventListener('dragover', function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = tile.getBoundingClientRect();
    const after = (e.clientX - rect.left) > rect.width / 2;
    setDropIndicator(tile, after ? 'after' : 'before');
  });

  tile.addEventListener('drop', function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = tile.getBoundingClientRect();
    const after = (e.clientX - rect.left) > rect.width / 2;
    commitIconDrop(after ? index + 1 : index);
  });
}

function renderIcons() {
  const wrap = $('icons');
  if (!wrap) return;
  wrap.textContent = '';

  state.icons.forEach(function (item, index) {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = item.url;
    a.title = item.name + '\n' + item.url + '\n（拖动可排序）';

    const img = document.createElement('img');
    img.alt = '';
    img.src = faviconUrl(item.url, 64);
    img.draggable = false;
    attachFallback(img, item.name);
    a.appendChild(img);

    const name = document.createElement('span');
    name.className = 'n';
    name.textContent = item.name;
    a.appendChild(name);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'del';
    del.textContent = '\u2715';
    del.title = '移除';
    del.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      state.icons.splice(index, 1);
      saveIcons();
      renderIcons();
    });
    a.appendChild(del);

    bindTileDrag(a, index);
    wrap.appendChild(a);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tile add';
  add.innerHTML = '<span class="plus">+</span><span class="n">添加</span>';
  add.addEventListener('click', openAddDialog);

  // 拖到「+」上 → 移到最后一格
  add.addEventListener('dragover', function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setDropIndicator(null, null);
    add.classList.add('drop-end');
  });
  add.addEventListener('drop', function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    e.stopPropagation();
    commitIconDrop(state.icons.length);
  });

  wrap.appendChild(add);
}

// 图标区的容器级拖拽（拖到空白处 = 移到末尾）；只绑定一次
function bindIconGrid() {
  const wrap = $('icons');
  if (!wrap) return;

  wrap.addEventListener('dragover', function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });

  wrap.addEventListener('drop', function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    commitIconDrop(state.icons.length);
  });

  // 拖图标时别让浏览器把 <a> 的链接当成导航
  window.addEventListener('dragover', function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
}

function openAddDialog() {
  const dlg = $('addDialog');
  if (!dlg) return;
  const nameEl = $('addName');
  const urlEl = $('addUrl');
  if (nameEl) nameEl.value = '';
  if (urlEl) urlEl.value = '';
  dlg.showModal();
}

// ============================================================
//  设置面板
// ============================================================

function openSettings(focusCustomEngine) {
  const panel = $('settings');
  panel.hidden = false;
  renderPresets();
  renderWallList();

  if (focusCustomEngine) {
    $('customEngineRow').hidden = false;
    const input = $('customEngine');
    input.value = state.settings.customEngine || '';
    input.focus();
    input.select();
  }
}

function renderEngineSelect() {
  const sel = $('engine');
  if (!sel) return;
  sel.textContent = '';
  ENGINES.forEach(function (eng) {
    const o = document.createElement('option');
    o.value = eng.id;
    o.textContent = eng.name;
    sel.appendChild(o);
  });
  sel.value = state.settings.engine;
}

function bindSettings() {
  const panel = $('settings');

  on('gearBtn', 'click', function () {
    if (!panel) return;
    if (panel.hidden) openSettings(false);
    else panel.hidden = true;
  });

  on('settingsClose', 'click', function () {
    if (panel) panel.hidden = true;
  });

  // 壁纸：上传本地图片
  on('wallpaperUploadBtn', 'click', function () {
    const input = $('wallpaperFiles');
    if (input) input.click();
  });

  on('wallpaperFiles', 'change', function (e) {
    addLocalWallpapers(e.target.files);
    e.target.value = '';
  });

  // 壁纸：图片地址
  on('wallpaperUrlApply', 'click', function () {
    const input = $('wallpaperUrl');
    const url = input ? input.value.trim() : '';
    if (!url) return;
    state.settings.wallpaper = { type: 'url', value: url };
    saveSettings();
    applyWallpaper();
    renderPresets();
    renderWallList();
  });

  // 壁纸：遮罩暗度
  const dim = on('dim', 'input', function () {
    state.settings.dim = Number(dim.value);
    applyDim();
  });
  if (dim) {
    dim.addEventListener('change', function () {
      state.settings.dim = Number(dim.value);
      saveSettings();
    });
  }

  // 搜索引擎
  on('engine', 'change', function (e) {
    setEngine(e.target.value);
  });

  on('customEngineApply', 'click', function () {
    const input = $('customEngine');
    const tpl = input ? input.value.trim() : '';
    state.settings.customEngine = tpl;

    if (tpl && tpl.indexOf('%s') !== -1) {
      saveSettings();
      setEngine('custom');
      setEngineHint('已保存，并切换到这个自定义搜索引擎。');
      return;
    }

    saveSettings();
    syncEngineUi();
    setEngineHint(tpl ? '格式不对：网址里必须包含 %s（关键词的位置）。' : '已清空自定义搜索引擎。');
  });

  // 书签栏
  on('barIconOnly', 'change', function (e) {
    state.settings.barIconOnly = e.target.checked;
    saveSettings();
    setBarIconOnly(e.target.checked);
  });

  // 常用网站
  on('resetIcons', 'click', function () {
    state.icons = DEFAULT_ICONS.slice();
    saveIcons();
    renderIcons();
  });

  // 书签管理
  on('openBookmarkManager', 'click', function () {
    chrome.tabs.create({ url: 'chrome://bookmarks/' });
  });
}

function bindSearch() {
  const form = $('searchForm');
  const input = $('searchInput');
  const panel = $('suggestPanel');

  if (form && input) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      // 键盘选中的候选词已经填进输入框了，这里直接按输入框内容搜
      doSearch(input.value);
    });
  }

  on('engineBtn', 'click', function (e) {
    e.stopPropagation();
    closeSuggest();
    openEngineMenu();
  });

  if (input && panel) {
    suggest = createSuggest({
      input: input,
      panel: panel,
      getEngine: currentEngine,
      getSettings: function () { return state.settings.suggest; },
      // 选中候选：
      //   键盘 Enter → 只把候选词补全进输入框，再按一次 Enter 才搜索
      //   鼠标点击   → 明确就要这一条，填入并直接搜索
      onPick: function (text, opt) {
        input.value = text;
        closeSuggest();
        input.focus();
        if (!opt || opt.search !== false) doSearch(text);
      }
    });
  }
}

function bindSuggestSettings() {
  const box = $('sugEnabled');
  const online = $('sugOnline');
  const hist = $('sugHistory');
  if (box) box.checked = !!state.settings.suggest.enabled;
  if (online) online.checked = !!state.settings.suggest.online;
  if (hist) hist.checked = !!state.settings.suggest.history;

  function apply(patch) {
    state.settings.suggest = Object.assign({}, state.settings.suggest, patch);
    saveSettings();
    if (suggest) suggest.setSettings(patch);
  }

  on('sugEnabled', 'change', function (e) { apply({ enabled: e.target.checked }); });
  on('sugOnline', 'change', function (e) { apply({ online: e.target.checked }); });
  on('sugHistory', 'change', function (e) {
    apply({ history: e.target.checked });
    setSuggestHint(e.target.checked ? '' : '已关闭搜索记录：新的搜索不再被记住，聚焦空输入框也不会弹出候选。');
  });

  on('sugClear', 'click', function () {
    if (suggest) suggest.clearHistory();
    setSuggestHint('搜索记录已清空。');
  });
}

function bindAddDialog() {
  const dlg = $('addDialog');

  on('addCancel', 'click', function () {
    if (dlg) dlg.close();
  });

  on('addForm', 'submit', function (e) {
    const nameEl = $('addName');
    const urlEl = $('addUrl');
    const name = nameEl ? nameEl.value.trim() : '';
    const raw = urlEl ? urlEl.value.trim() : '';
    if (!name || !raw) {
      e.preventDefault();
      return;
    }
    state.icons.push({ name: name, url: normalizeUrl(raw) });
    saveIcons();
    renderIcons();
  });
}

function bindGlobal() {
  document.addEventListener('mousedown', function (e) {
    // 点空白处关掉搜索联想
    if (suggest && suggest.isOpen()) {
      const input = $('searchInput');
      const panel = $('suggestPanel');
      if (!(input && input.contains(e.target)) && !(panel && panel.contains(e.target))) {
        closeSuggest();
      }
    }

    if (!engineMenuEl) return;
    const btn = $('engineBtn');
    if (engineMenuEl.contains(e.target)) return;
    if (btn && btn.contains(e.target)) return;
    closeEngineMenu();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeSuggest();
      closeEngineMenu();
      const panel = $('settings');
      if (panel) panel.hidden = true;
    }
  });

  window.addEventListener('resize', function () {
    closeEngineMenu();
    closeSuggest();
  });
}

// ============================================================
//  启动
// ============================================================

loadState().then(function () {
  applyWallpaper();
  applyDim();
  renderPresets();
  renderWallList();
  renderIcons();
  renderEngineSelect();
  syncEngineUi();

  const iconOnly = $('barIconOnly');
  if (iconOnly) iconOnly.checked = !!state.settings.barIconOnly;

  const dimEl = $('dim');
  if (dimEl) dimEl.value = isNaN(Number(state.settings.dim)) ? 35 : Number(state.settings.dim);

  const customEl = $('customEngine');
  if (customEl) customEl.value = state.settings.customEngine || '';

  setBarIconOnly(!!state.settings.barIconOnly);

  bindSettings();
  bindSearch();
  bindSuggestSettings();
  bindAddDialog();
  bindGlobal();
  bindDrop();
  bindIconGrid();

  tickClock();
  setInterval(tickClock, 1000);

  const boot = [];
  if (suggest) boot.push(suggest.init());   // 读取本地搜索记录
  boot.push(initTranslate());

  return Promise.all(boot);
}).catch(function (err) {
  console.error('[新标签页] 初始化失败：', err);
});
