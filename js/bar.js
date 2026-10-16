// ============================================================
//  顶部常驻书签栏
//  数据来源：chrome.bookmarks，随书签增删改实时同步
// ============================================================

const BAR_FOLDER_ID = '1';   // Chrome 固定 ID：书签栏
const OTHER_FOLDER_ID = '2'; // Chrome 固定 ID：其他书签

const els = {
  bar: document.getElementById('bar'),
  items: document.getElementById('barItems'),
  moreWrap: document.getElementById('barMoreWrap'),
  moreBtn: document.getElementById('barMore'),
  tail: document.getElementById('barTail'),
};

function svgIcon(inner) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">' + inner + '</svg>'
  );
}

const FALLBACK_ICON = svgIcon(
  '<circle cx="8" cy="8" r="6.2" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.4"/>' +
  '<path d="M1.9 8h12.2M8 1.9c2.6 2.5 2.6 9.7 0 12.2M8 1.9c-2.6 2.5-2.6 9.7 0 12.2" fill="none" stroke="rgba(255,255,255,0.42)" stroke-width="1.1"/>'
);

const FOLDER_ICON = svgIcon(
  '<path d="M1.8 4.3c0-.8.6-1.4 1.4-1.4h2.8l1.4 1.6h5.4c.8 0 1.4.6 1.4 1.4v5.8c0 .8-.6 1.4-1.4 1.4H3.2c-.8 0-1.4-.6-1.4-1.4z" ' +
  'fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.3" stroke-linejoin="round"/>'
);

let barNodes = [];        // 书签栏下的节点
let otherChildren = [];   // “其他书签”下的节点
let allEls = [];          // 书签栏上已渲染的顶层元素，与 barNodes 一一对应
let overflowNodes = [];   // 被收进 “»” 的节点

// ---------- 图标 ----------

function faviconUrl(url, size) {
  return chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=' + (size || 16));
}

function makeIcon(url) {
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  if (url) {
    img.src = faviconUrl(url, 16);
    img.addEventListener('error', function onErr() {
      if (img.dataset.fallback) return;
      img.dataset.fallback = '1';
      img.src = FALLBACK_ICON;
    });
  } else {
    img.src = FOLDER_ICON;
  }
  return img;
}

// ---------- 弹出菜单 ----------

let openTopMenu = null;
let openTopTrigger = null;

function closeSub(itemEl) {
  if (itemEl._sub) {
    itemEl._sub.remove();
    itemEl._sub = null;
  }
  itemEl.classList.remove('open');
}

function closeSubsIn(scope, exceptEl) {
  scope.querySelectorAll('.has-sub').forEach(function (el) {
    if (el !== exceptEl) closeSub(el);
  });
}

function buildMenu(nodes) {
  const menu = document.createElement('div');
  menu.className = 'menu';

  nodes.forEach(function (node) {
    const isFolder = !node.url && node.children && node.children.length;

    if (node.url) {
      const a = document.createElement('a');
      a.className = 'menu-item';
      a.href = node.url;
      a.title = (node.title || node.url) + '\n' + node.url;
      a.appendChild(makeIcon(node.url));
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = node.title || node.url;
      a.appendChild(t);
      menu.appendChild(a);
      return;
    }

    if (isFolder) {
      const row = document.createElement('div');
      row.className = 'menu-item has-sub';
      row.appendChild(makeIcon(''));
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = node.title || '文件夹';
      row.appendChild(t);
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = '\u25B8';
      row.appendChild(arrow);

      const children = node.children;
      // 只用点击展开：避免鼠标划过时把嵌套文件夹一路全打开
      row.addEventListener('click', function (e) {
        // 子菜单挂在 row 内部，点在子菜单里的链接会冒泡到这里。
        // 必须先放行，否则下面的 preventDefault 会把子菜单里链接的跳转一起取消掉。
        if (row._sub && row._sub.contains(e.target)) return;  // 点在子菜单里，不算展开/收起
        e.preventDefault();
        e.stopPropagation();
        if (row._sub) {                                       // 已经展开 → 再点一次收起
          closeSub(row);
          return;
        }
        showSub(row, children);
      });
      menu.appendChild(row);
    }
  });

  if (!menu.children.length) {
    const empty = document.createElement('div');
    empty.className = 'menu-empty';
    empty.textContent = '（空）';
    menu.appendChild(empty);
  }

  return menu;
}

function place(menu, trigger, mode) {
  menu.hidden = false;
  menu.style.visibility = 'hidden';
  menu.style.left = '0px';
  menu.style.top = '0px';

  const r = trigger.getBoundingClientRect();
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let left;
  let top;

  if (mode === 'below') {
    left = r.left;
    top = r.bottom + 6;
  } else {
    left = r.right + 4;
    top = r.top - 6;
    if (left + w > window.innerWidth - 8) left = r.left - w - 4;
  }

  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));

  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.style.visibility = '';
}

function showSub(itemEl, nodes) {
  const parentMenu = itemEl.closest('.menu');
  if (parentMenu) closeSubsIn(parentMenu, itemEl);
  if (itemEl._sub) return;

  const sub = buildMenu(nodes);
  sub.hidden = true;
  itemEl.appendChild(sub);      // 挂在行内部，鼠标移入子菜单时不会触发父菜单的 mouseleave
  itemEl._sub = sub;
  itemEl.classList.add('open');
  place(sub, itemEl, 'side');
}

function closeTopMenu() {
  if (openTopMenu) {
    openTopMenu.remove();
    openTopMenu = null;
  }
  if (openTopTrigger) {
    openTopTrigger.classList.remove('active');
    openTopTrigger = null;
  }
}

function openTopMenuFor(trigger, nodes) {
  if (!nodes || !nodes.length) return;
  if (openTopTrigger === trigger) {
    closeTopMenu();
    return;
  }
  closeTopMenu();

  const menu = buildMenu(nodes);
  menu.hidden = true;
  document.body.appendChild(menu);
  place(menu, trigger, 'below');

  openTopMenu = menu;
  openTopTrigger = trigger;
  trigger.classList.add('active');
}

document.addEventListener('mousedown', function (e) {
  if (!openTopMenu) return;
  if (openTopMenu.contains(e.target)) return;
  if (openTopTrigger && openTopTrigger.contains(e.target)) return;
  closeTopMenu();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeTopMenu();
});

// ---------- 渲染 ----------

function makeBarItem(node) {
  const isFolder = !node.url;
  const el = document.createElement(isFolder ? 'button' : 'a');
  el.className = 'bar-item';

  if (isFolder) {
    el.type = 'button';
    el.title = node.title || '文件夹';
    el.appendChild(makeIcon(''));
  } else {
    el.href = node.url;
    el.title = (node.title || node.url) + '\n' + node.url;
    el.appendChild(makeIcon(node.url));
  }

  const t = document.createElement('span');
  t.className = 't';
  t.textContent = node.title || node.url || '文件夹';
  el.appendChild(t);

  if (isFolder) {
    el.addEventListener('click', function (e) {
      e.stopPropagation();
      openTopMenuFor(el, node.children);
    });
  }

  return el;
}

function makeMenuButton(nodes, title) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bar-item';
  btn.title = title;
  btn.appendChild(makeIcon(''));
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = title;
  btn.appendChild(t);
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    openTopMenuFor(btn, nodes);
  });
  return btn;
}

function render() {
  closeTopMenu();
  els.items.textContent = '';
  els.tail.textContent = '';
  allEls = [];
  overflowNodes = [];

  // 书签栏为空时给一个入口
  if (!barNodes.length) {
    const hint = document.createElement('button');
    hint.type = 'button';
    hint.className = 'bar-empty';
    hint.textContent = '书签栏是空的 · 点这里添加书签';
    hint.addEventListener('click', function () {
      chrome.tabs.create({ url: 'chrome://bookmarks/' });
    });
    els.items.appendChild(hint);
    relayout();
    return;
  }

  barNodes.forEach(function (node) {
    const el = makeBarItem(node);
    els.items.appendChild(el);
    allEls.push(el);
  });

  // 右侧 “其他书签”
  if (otherChildren.length) {
    els.tail.appendChild(makeMenuButton(otherChildren, '其他书签'));
  }

  relayout();
}

// 计算哪些项放不下，收进 “»”
function relayout() {
  if (!allEls.length) {
    els.moreWrap.hidden = true;
    return;
  }

  els.moreWrap.hidden = true;
  allEls.forEach(function (el) { el.style.display = ''; });

  const GAP = 2;
  const widths = allEls.map(function (el) { return el.getBoundingClientRect().width; });
  const total = widths.reduce(function (sum, w) { return sum + w + GAP; }, 0);

  const barW = els.bar.clientWidth;
  const tailW = els.tail.offsetWidth;
  let avail = barW - 16 - tailW - GAP;   // 16 = 书签栏左右 padding

  if (total <= avail) {
    overflowNodes = [];
    return;
  }

  els.moreWrap.hidden = false;
  const moreW = els.moreBtn.getBoundingClientRect().width;
  avail = avail - moreW - GAP;

  let acc = 0;
  let cut = allEls.length;
  for (let i = 0; i < allEls.length; i++) {
    acc += widths[i] + GAP;
    if (acc > avail) { cut = i; break; }
  }
  if (cut < 0) cut = 0;

  allEls.forEach(function (el, i) {
    if (i >= cut) el.style.display = 'none';
  });

  overflowNodes = barNodes.slice(cut);
}

// ---------- 数据 ----------

function loadTree() {
  return new Promise(function (resolve) {
    chrome.bookmarks.getTree(function (tree) {
      const root = (tree && tree[0]) || { children: [] };
      const children = root.children || [];
      let bar = null;
      let other = null;

      children.forEach(function (n) {
        if (n.id === BAR_FOLDER_ID) bar = n;
        if (n.id === OTHER_FOLDER_ID) other = n;
      });
      if (!bar) bar = children[0] || null;

      barNodes = (bar && bar.children) ? bar.children : [];
      otherChildren = (other && other.children) ? other.children : [];
      resolve();
    });
  });
}

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(function () {
    loadTree().then(render);
  }, 60);
}

function init() {
  if (!els.bar || !els.items || !els.moreWrap || !els.moreBtn || !els.tail) {
    console.warn('[新标签页] 书签栏缺少必要的 DOM 元素，已跳过初始化');
    return;
  }

  els.moreBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    openTopMenuFor(els.moreBtn, overflowNodes);
  });

  window.addEventListener('resize', function () {
    closeTopMenu();
    relayout();
  });

  if (window.ResizeObserver) {
    new ResizeObserver(function () { relayout(); }).observe(els.bar);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(relayout);
  }

  ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded'].forEach(function (evt) {
    if (chrome.bookmarks[evt]) chrome.bookmarks[evt].addListener(scheduleReload);
  });

  loadTree().then(render);
}

// ---------- 对外接口 ----------

export function setBarIconOnly(iconOnly) {
  document.body.classList.toggle('bar-icon-only', !!iconOnly);
  requestAnimationFrame(relayout);
}

export function refreshBar() {
  relayout();
}

init();
