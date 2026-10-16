// ============================================================
//  翻译面板：对接百度翻译开放平台（通用文本翻译 API）
//  - 签名：sign = MD5(appid + q + salt + 密钥)，密钥只存本机
//  - 长文本按 UTF-8 字节切块（百度单次上限 6000 字节），逐块翻译后拼回
//  - 免费版 QPS = 1，所以分块之间留间隔，遇到 54003/54005 自动退避重试
// ============================================================

import { md5 } from './md5.js';

const API = 'https://fanyi-api.baidu.com/api/trans/vip/translate';

const MAX_CHUNK_BYTES = 4800;   // 留出余量，别贴着 6000 字节上限
const CHUNK_GAP_MS = 280;       // 分块之间的最小间隔（免费版 1 QPS）
const DEBOUNCE_MS = 700;        // 「自动」模式的停止输入等待时间
const MAX_RETRY = 3;
const STORAGE_KEY = 'translate';

// ---------- 语言表（百度翻译的代码） ----------

const LANGS = [
  { id: 'zh', label: '中文 (简体)' },
  { id: 'cht', label: '中文 (繁体)' },
  { id: 'en', label: '英语' },
  { id: 'yue', label: '粤语' },
  { id: 'wyw', label: '文言文' },
  { id: 'jp', label: '日语' },
  { id: 'kor', label: '韩语' },
  { id: 'fra', label: '法语' },
  { id: 'spa', label: '西班牙语' },
  { id: 'th', label: '泰语' },
  { id: 'ara', label: '阿拉伯语' },
  { id: 'ru', label: '俄语' },
  { id: 'pt', label: '葡萄牙语' },
  { id: 'de', label: '德语' },
  { id: 'it', label: '意大利语' },
  { id: 'el', label: '希腊语' },
  { id: 'nl', label: '荷兰语' },
  { id: 'pl', label: '波兰语' },
  { id: 'bul', label: '保加利亚语' },
  { id: 'est', label: '爱沙尼亚语' },
  { id: 'dan', label: '丹麦语' },
  { id: 'fin', label: '芬兰语' },
  { id: 'cs', label: '捷克语' },
  { id: 'rom', label: '罗马尼亚语' },
  { id: 'slo', label: '斯洛文尼亚语' },
  { id: 'swe', label: '瑞典语' },
  { id: 'hu', label: '匈牙利语' },
  { id: 'vie', label: '越南语' },
];

const FROM_LANGS = [{ id: 'auto', label: '自动检测' }].concat(LANGS);

// ---------- 错误码 → 人话 ----------

const ERROR_TEXT = {
  52001: '请求超时，请重试',
  52002: '百度翻译系统错误，请重试',
  52003: '未授权用户：AppID 或密钥不对（也可能还没通过开发者认证）',
  54000: '必填参数为空',
  54001: '签名错误：多半是密钥填错了',
  54003: '访问频率受限：免费版是 1 次/秒，稍等一下再试',
  54004: '账户余额不足',
  54005: '长文本请求过于频繁，稍等一下再试',
  58000: '客户端 IP 非法：去百度翻译控制台把本机 IP 加进白名单',
  58001: '译文语言方向不支持',
  58002: '服务当前已关闭',
  90107: '认证未通过或未生效（开发者认证还在审核中）',
};

// 可以靠等待恢复的错误：重试
const RETRYABLE = { 52001: 1, 52002: 1, 54003: 1, 54005: 1 };

class TranslateError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TranslateError';
    this.code = code;
  }
}

// ---------- 存储 ----------

const DEFAULTS = {
  appid: '',
  key: '',
  from: 'auto',
  to: 'zh',
};

// 输入框草稿只存在 sessionStorage：同一个标签页刷新能找回，
// 新开的标签页各自独立、永远是空的（旧版本存在 chrome.storage.local，
// 于是每开一个新标签页都会带上一次翻译的残留内容）。
const DRAFT_KEY = 'translateDraft';

let cfg = Object.assign({}, DEFAULTS);

function loadCfg() {
  return new Promise(function (resolve) {
    chrome.storage.local.get([STORAGE_KEY], function (o) {
      const saved = (o && o[STORAGE_KEY]) || {};
      cfg = Object.assign({}, DEFAULTS, saved);
      // 老版本把输入框内容一起存进了这里，已经不再使用，顺手清掉
      if ('text' in cfg) {
        delete cfg.text;
        saveCfg();
      }
      resolve();
    });
  });
}

function saveCfg() {
  const patch = {};
  patch[STORAGE_KEY] = cfg;
  chrome.storage.local.set(patch);
}

// ---------- 文本切块 ----------

function charBytes(cp) {
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

// 先按行合并，单行超长再按字符硬切；保证不切断代理对，且拼回后与原文一致
export function splitChunks(text, maxBytes) {
  const out = [];
  let cur = '';
  let curLen = 0;

  function push() {
    if (cur) {
      out.push(cur);
      cur = '';
      curLen = 0;
    }
  }

  String(text).split('\n').forEach(function (line, i) {
    const piece = (i === 0 ? '' : '\n') + line;
    let pLen = 0;
    for (const ch of piece) pLen += charBytes(ch.codePointAt(0));

    if (curLen + pLen <= maxBytes) {
      cur += piece;
      curLen += pLen;
      return;
    }

    push();

    if (pLen > maxBytes) {
      let seg = '';
      let segLen = 0;
      for (const ch of line) {
        const cl = charBytes(ch.codePointAt(0));
        if (segLen + cl > maxBytes) {
          out.push(seg);
          seg = '';
          segLen = 0;
        }
        seg += ch;
        segLen += cl;
      }
      cur = seg;
      curLen = segLen;
      return;
    }

    cur = line;
    curLen = pLen;
  });

  push();
  return out.length ? out : [''];
}

// ---------- 调用百度接口 ----------

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

function makeSalt() {
  return String(Date.now()) + String(Math.floor(Math.random() * 10000));
}

async function requestChunk(chunk, from, to) {
  const salt = makeSalt();
  const sign = md5(cfg.appid + chunk + salt + cfg.key);

  const body = new URLSearchParams();
  body.set('q', chunk);
  body.set('from', from);
  body.set('to', to);
  body.set('appid', cfg.appid);
  body.set('salt', salt);
  body.set('sign', sign);

  let res;
  try {
    res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: body.toString(),
    });
  } catch (e) {
    throw new TranslateError('网络请求失败：连不上百度翻译接口（检查网络或代理）', 'network');
  }

  if (!res.ok) {
    throw new TranslateError('网络请求失败：HTTP ' + res.status, 'http');
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new TranslateError('接口返回的不是 JSON，可能被代理或网络劫持了', 'parse');
  }

  if (data && data.error_code) {
    const code = String(data.error_code);
    const msg = ERROR_TEXT[code] || ('百度翻译返回错误 ' + code + (data.error_msg ? '：' + data.error_msg : ''));
    throw new TranslateError(msg, code);
  }

  const list = (data && Array.isArray(data.trans_result)) ? data.trans_result : [];
  if (!list.length) return '';

  // 百度按换行拆分，每个片段一条结果；用换行拼回，保持原文的行结构
  return list.map(function (r) { return r.dst == null ? '' : r.dst; }).join('\n');
}

async function requestChunkWithRetry(chunk, from, to) {
  let lastErr = null;
  for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
    try {
      return await requestChunk(chunk, from, to);
    } catch (e) {
      lastErr = e;
      if (!RETRYABLE[String(e.code)]) throw e;
      await sleep(600 * Math.pow(2, attempt));   // 0.6s / 1.2s / 2.4s
    }
  }
  throw lastErr;
}

async function translateText(text, from, to) {
  if (!cfg.appid || !cfg.key) {
    throw new TranslateError('还没配置百度翻译的 AppID 和密钥（右下角设置 → 翻译）', 'noconfig');
  }

  const chunks = splitChunks(text, MAX_CHUNK_BYTES);
  const parts = [];

  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(CHUNK_GAP_MS);
    parts.push(await requestChunkWithRetry(chunks[i], from, to));
  }

  return parts.join('\n');
}

// ============================================================
//  界面
// ============================================================

function $(id) { return document.getElementById(id); }

let els = {};
let translating = false;
let pendingRun = false;   // 翻译途中又有新输入，结束后补翻
let debounceTimer = null;
let draftTimer = null;
let lastOutput = '';

function fillSelect(sel, list, value) {
  if (!sel) return;
  sel.textContent = '';
  list.forEach(function (l) {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.label;
    sel.appendChild(o);
  });
  sel.value = value;
}

function setStatus(text, kind) {
  if (!els.status) return;
  els.status.textContent = text || '';
  els.status.className = 'tr-status' + (kind ? ' ' + kind : '');
}

function renderOutput(text, isError) {
  if (!els.output) return;
  lastOutput = isError ? '' : (text || '');
  els.output.textContent = text || '';
  els.output.classList.toggle('is-error', !!isError);
  els.output.classList.toggle('is-empty', !text);
}

// 输入框高度跟着内容走：空的时候只有占位提示那么高，输入后自动撑高。
// 上限由 CSS 的 max-height 控制，超出后出现滚动条。
function autoGrow() {
  if (!els.input) return;
  els.input.style.height = 'auto';
  els.input.style.height = els.input.scrollHeight + 'px';
}

function syncLangUi() {
  if (els.from) els.from.value = cfg.from;
  if (els.to) els.to.value = cfg.to;
}

function setBusy(on) {
  translating = on;
}

async function doTranslate() {
  // 正在翻译时又来了新输入：不丢弃，记下来等这轮结束再翻一次
  if (translating) {
    pendingRun = true;
    return;
  }

  const text = els.input ? els.input.value : '';
  if (!text.trim()) {
    renderOutput('');
    setStatus('');
    return;
  }

  if (!cfg.appid || !cfg.key) {
    setStatus('未配置密钥', 'warn');
    renderOutput('先在右下角「设置 → 翻译」里填入百度翻译的 AppID 和密钥。', true);
    return;
  }

  const from = cfg.from;
  const to = cfg.to;
  if (from !== 'auto' && from === to) {
    setStatus('源语言和目标语言相同', 'warn');
    renderOutput('源语言和目标语言不能相同。', true);
    return;
  }

  setBusy(true);
  setStatus('翻译中…', 'busy');

  try {
    const out = await translateText(text, from, to);
    renderOutput(out);
    const parts = splitChunks(text, MAX_CHUNK_BYTES).length;
    setStatus('完成 · ' + text.length + ' 字' + (parts > 1 ? '（分 ' + parts + ' 段）' : ''), 'ok');
  } catch (e) {
    const msg = (e && e.message) || '翻译失败';
    renderOutput(msg, true);
    setStatus(e && e.code === 'noconfig' ? '未配置密钥' : '失败', 'warn');
    if (e && e.code === 'noconfig') {
      const panel = $('settings');
      if (panel) panel.hidden = false;
    }
  } finally {
    setBusy(false);
    // 这轮期间又输入过 → 立刻补翻一次，保证译文对应最新内容
    if (pendingRun) {
      pendingRun = false;
      await doTranslate();
    }
  }
}

// 自动翻译一直开着：停止输入 DEBOUNCE_MS 毫秒后自动翻
function scheduleAuto() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(doTranslate, DEBOUNCE_MS);
}

// 输入框草稿：只写当前标签页的 sessionStorage（换标签页互不影响，新标签页里读不到）
function readDraft() {
  try {
    return sessionStorage.getItem(DRAFT_KEY) || '';
  } catch (e) {
    return '';
  }
}

function writeDraft(text) {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch (e) { /* 无痕模式等场景下写不了，忽略即可 */ }
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(function () {
    writeDraft(els.input ? els.input.value : '');
  }, 500);
}

// 交换语言；源语言是「自动检测」时，换成「目标语言 → 中文/英语」这种有意义的组合
function swapLangs() {
  const from = cfg.from;
  const to = cfg.to;

  if (from === 'auto') {
    cfg.from = to;
    cfg.to = (to === 'zh') ? 'en' : 'zh';
  } else {
    cfg.from = to;
    cfg.to = from;
  }

  syncLangUi();
  saveCfg();

  // 顺手把译文挪到输入框，方便来回对照
  if (lastOutput && els.input) {
    els.input.value = lastOutput;
    renderOutput('');
    autoGrow();
    scheduleDraftSave();
  }
  scheduleAuto();
}

function copyOutput() {
  const text = els.output ? els.output.textContent : '';
  if (!text) return;

  const done = function () {
    if (els.copy) {
      els.copy.textContent = '已复制';
      setTimeout(function () { if (els.copy) els.copy.textContent = '复制'; }, 1200);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { setStatus('复制失败', 'warn'); });
  } else if (els.output) {
    const range = document.createRange();
    range.selectNodeContents(els.output);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    setStatus('已选中，按 Ctrl+C 复制', 'ok');
  }
}

function bindPanel() {
  if (els.input) {
    els.input.addEventListener('input', function () {
      autoGrow();
      scheduleDraftSave();
      scheduleAuto();
    });

    els.input.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(debounceTimer);
        return doTranslate();
      }
      return undefined;
    });
  }

  if (els.from) {
    els.from.addEventListener('change', function () {
      cfg.from = els.from.value;
      saveCfg();
      scheduleAuto();
    });
  }

  if (els.to) {
    els.to.addEventListener('change', function () {
      cfg.to = els.to.value;
      saveCfg();
      scheduleAuto();
    });
  }

  if (els.swap) els.swap.addEventListener('click', swapLangs);
  if (els.copy) els.copy.addEventListener('click', copyOutput);
}

function bindSettings() {
  if (els.keyShow) {
    els.keyShow.addEventListener('click', function () {
      if (!els.key) return;
      const show = els.key.type === 'password';
      els.key.type = show ? 'text' : 'password';
      els.keyShow.textContent = show ? '隐藏' : '显示';
    });
  }

  if (els.save) {
    els.save.addEventListener('click', function () {
      cfg.appid = els.appid ? els.appid.value.trim() : '';
      cfg.key = els.key ? els.key.value.trim() : '';
      saveCfg();

      if (els.trHint) {
        els.trHint.textContent = (cfg.appid && cfg.key)
          ? '已保存到本机。密钥只存在 chrome.storage.local，不会上传到任何第三方。'
          : 'AppID 和密钥都要填。在 fanyi-api.baidu.com 申请「通用文本翻译」后即可使用。';
      }

      // 存完直接试翻一次，省得用户以为没生效
      if (cfg.appid && cfg.key && els.input && els.input.value.trim()) return doTranslate();
      return undefined;
    });
  }
}

export async function initTranslate() {
  els = {
    input: $('trInput'),
    output: $('trOutput'),
    from: $('trFrom'),
    to: $('trTo'),
    swap: $('trSwap'),
    copy: $('trCopy'),
    status: $('trStatus'),
    appid: $('trAppid'),
    key: $('trKey'),
    keyShow: $('trKeyShow'),
    save: $('trSave'),
    trHint: $('trHint'),
  };

  if (!els.input || !els.output) {
    console.warn('[新标签页] 翻译面板的 DOM 不完整，已跳过翻译功能');
    return;
  }

  await loadCfg();

  fillSelect(els.from, FROM_LANGS, cfg.from);
  fillSelect(els.to, LANGS, cfg.to);

  if (els.appid) els.appid.value = cfg.appid || '';
  if (els.key) els.key.value = cfg.key || '';
  // 新开的标签页 sessionStorage 是空的 → 输入框为空；本标签页刷新则恢复草稿
  if (els.input) els.input.value = readDraft();

  renderOutput('');
  setStatus(cfg.appid && cfg.key ? '' : '未配置密钥', cfg.appid && cfg.key ? '' : 'warn');
  autoGrow();

  bindPanel();
  bindSettings();

  // 换行位置会随宽度变化，窗口尺寸变了要重新量一次
  window.addEventListener('resize', autoGrow);
}
