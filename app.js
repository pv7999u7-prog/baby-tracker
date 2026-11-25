/* 寶寶日記 App */
(() => {
'use strict';
const VERSION = '1.0.0';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem('bb-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bb-' + k, JSON.stringify(v)); } catch (e) { /* 私密模式 */ } }
};

/* ───── 類別 ───── */
const T = {
  喝奶: { e: '🍼', c: 'milk', unit: 'cc', step: 10, presets: [60, 90, 120, 150, 180, 210], chips: ['母奶', '配方奶'] },
  親餵: { e: '🤱', c: 'bf', unit: '分鐘' },
  擠奶: { e: '🥛', c: 'milk', unit: 'cc', step: 10, presets: [60, 90, 120, 150, 200] },
  尿布: { e: '💧', c: 'diaper', chips: ['濕', '很濕', '少量'], one: true },
  大便: { e: '💩', c: 'poop', chips: ['黃', '黃綠', '綠', '褐', '黑', '紅', '白'], chips2: ['稀', '糊', '軟', '硬', '水便', '黏液', '有血', '量多'] },
  睡眠: { e: '😴', c: 'sleep', unit: '分鐘' },
  體溫: { e: '🌡️', c: 'temp', unit: '°C', step: 0.1, presets: [36.5, 36.8, 37.2, 37.5, 38, 38.5], chips: ['耳溫', '額溫', '肛溫', '腋溫'], one: true },
  吐奶: { e: '💦', c: 'milk', chips: ['少量', '很多', '噴射'], one: true },
  副食品: { e: '🥣', c: 'poop', unit: 'g', step: 5, opt: true },
  喝水: { e: '🚰', c: 'milk', unit: 'cc', step: 10, presets: [10, 20, 30, 50] },
  用藥: { e: '💊', c: 'temp', opt: true },
  疫苗: { e: '💉', c: 'temp' },
  洗澡: { e: '🛁', c: 'diaper' },
  體重: { e: '⚖️', c: 'weight', unit: 'kg', step: 0.01 },
  身高: { e: '📏', c: 'weight', unit: 'cm', step: 0.5 },
  頭圍: { e: '⭕', c: 'weight', unit: 'cm', step: 0.1 },
  備註: { e: '📝', c: 'sleep' }
};
const MORE = ['親餵', '擠奶', '吐奶', '副食品', '喝水', '用藥', '疫苗', '洗澡', '體重', '身高', '頭圍', '備註', '睡眠'];
const ic = t => (T[t] || T.備註).e;
const tc = t => (T[t] || T.備註).c;

/* ───── 狀態 ───── */
const state = {
  recs: LS.get('cache', []),
  settings: LS.get('settings', {}),
  demo: LS.get('demo', false),
  tab: 'today', filter: '全部', range: 7, logDays: 14, synced: LS.get('synced', 0),
  busy: false, err: '', tables: {}
};
let parseText = null;
fetch('apps-script/Code.gs?v=1').then(r => r.text()).then(src => {
  parseText = new Function(src + '\n;return parseText;')();
}).catch(() => {});

/* ───── 時間工具 ───── */
const pad = n => String(n).padStart(2, '0');
const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayKey = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const WD = '日一二三四五六';
function dayLabel(t) {
  const d0 = dayStart(Date.now()), d = dayStart(t);
  if (d === d0) return '今天';
  if (d === d0 - 86400000) return '昨天';
  const x = new Date(t); return (x.getMonth() + 1) + '/' + x.getDate() + '（' + WD[x.getDay()] + '）';
}
const md = t => { const x = new Date(t); return (x.getMonth() + 1) + '/' + x.getDate(); };
function dur(mins, short) {
  mins = Math.max(0, Math.round(mins));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (short) return h + ':' + pad(m);
  return (h ? h + ' 小時 ' : '') + (m || !h ? m + ' 分' : '');
}
const toLocalInput = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const num = v => Math.round(v * 100) / 100;
const isOpenSleep = r => r.type === '睡眠' && !r.end && r.value == null;

/* ───── 連線 ───── */
async function api(body) {
  if (state.demo) return demoApi(body);
  const url = LS.get('url', ''), key = LS.get('key', '');
  if (!url) throw new Error('還沒設定試算表網址');
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ key: key }, body)) });
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('回應看不懂，網址可能貼錯了'); }
  if (!j.ok) throw new Error(j.error || '失敗');
  return j;
}
const connected = () => state.demo || !!LS.get('url', '');

async function sync(quiet) {
  if (!connected() || state.busy) return;
  state.busy = true; state.err = ''; syncUI();
  try {
    const j = await api({ action: 'list', days: 120 });
    state.recs = j.records; state.settings = j.settings || {};
    state.synced = Date.now();
    if (!state.demo) { LS.set('cache', state.recs); LS.set('settings', state.settings); LS.set('synced', state.synced); }
  } catch (e) {
    state.err = e.message;
    if (!quiet) toast('更新失敗：' + e.message);
  }
  state.busy = false; syncUI();
  if (!$('#sheet').hidden) return; // 表單開著就不重畫
  render();
}

function syncUI() {
  const b = $('#syncBtn');
  b.classList.toggle('busy', state.busy);
  b.classList.toggle('err', !!state.err);
  $('#syncText').textContent = state.busy ? '更新中' : state.err ? '無法連線' : state.demo ? '示範模式' : !connected() ? '未連線' : state.synced ? hm(state.synced) + ' 更新' : '更新';
}

const saveCache = () => { if (!state.demo) LS.set('cache', state.recs); else LS.set('demo-recs', state.recs); };

async function addRec(rec, silent) {
  const tmp = Object.assign({ id: 'tmp' + Date.now(), value: null, unit: '', detail: '', end: null, by: LS.get('by', '') }, rec);
  state.recs.push(tmp); state.recs.sort((a, b) => a.t - b.t); render();
  try {
    const j = await api({ action: 'add', rec: rec, by: LS.get('by', '') });
    Object.assign(tmp, j.rec); saveCache(); render();
    if (!silent) toast('已記錄 ' + ic(tmp.type) + ' ' + summaryOf(tmp), { label: '復原', fn: () => delRec(tmp.id, true) });
    return tmp;
  } catch (e) {
    state.recs = state.recs.filter(r => r !== tmp); render();
    toast('沒有存到：' + e.message);
  }
}
async function updRec(id, patch) {
  const r = state.recs.find(x => x.id === id); if (!r) return;
  const old = Object.assign({}, r);
  Object.assign(r, patch); state.recs.sort((a, b) => a.t - b.t); render();
  try { await api({ action: 'update', id: id, rec: patch }); saveCache(); }
  catch (e) { Object.assign(r, old); render(); toast('沒有改到：' + e.message); }
}
async function delRec(id, isUndo) {
  const i = state.recs.findIndex(x => x.id === id); if (i < 0) return;
  const r = state.recs[i];
  state.recs.splice(i, 1); render();
  try { await api({ action: 'delete', id: id }); saveCache(); toast(isUndo ? '已復原' : '已刪除'); }
  catch (e) { state.recs.push(r); state.recs.sort((a, b) => a.t - b.t); render(); toast('沒有刪到：' + e.message); }
}

/* ───── 摘要計算 ───── */
function summaryOf(r) {
  let s = r.type;
  if (r.type === '睡眠') s = isOpenSleep(r) ? '開始睡覺' : '睡眠 ' + dur(r.value || 0);
  else if (r.value != null) s += ' ' + num(r.value) + (r.unit || '');
  if (r.detail) s += ' · ' + r.detail;
  return s;
}
function sleepMins(recs, from, to) {
  let m = 0; const now = Date.now();
  recs.forEach(r => {
    if (r.type !== '睡眠') return;
    const e = r.end || (isOpenSleep(r) ? now : r.t + (r.value || 0) * 60000);
    const a = Math.max(r.t, from), b = Math.min(e, to);
    if (b > a) m += (b - a) / 60000;
  });
  return m;
}
function dayStats(d0) {
  const d1 = d0 + 86400000;
  const rs = state.recs.filter(r => r.t >= d0 && r.t < d1);
  const milk = rs.filter(r => r.type === '喝奶');
  return {
    milk: milk.reduce((a, r) => a + (r.value || 0), 0), milkN: milk.length,
    bf: rs.filter(r => r.type === '親餵').length,
    bfMin: rs.filter(r => r.type === '親餵').reduce((a, r) => a + (r.value || 0), 0),
    diaper: rs.filter(r => r.type === '尿布').length,
    poop: rs.filter(r => r.type === '大便').length,
    sleep: sleepMins(state.recs, d0, Math.min(d1, Date.now())),
    tempMax: rs.filter(r => r.type === '體溫' && r.value).reduce((a, r) => Math.max(a, r.value), 0) || null,
    n: rs.length
  };
}
const lastOf = types => state.recs.filter(r => types.indexOf(r.type) >= 0).slice(-1)[0];

/* ───── 畫面 ───── */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  const name = state.settings['寶寶名字'] || (state.demo ? '示範寶寶' : '寶寶日記');
  $('#babyName').textContent = name;
  $('#babyAge').textContent = ageText(state.settings['生日']);
  syncUI();
  const v = $('#view');
  if (state.tab === 'today') v.innerHTML = viewToday();
  else if (state.tab === 'log') v.innerHTML = viewLog();
  else if (state.tab === 'charts') { v.innerHTML = viewCharts(); drawCharts(); }
  else v.innerHTML = viewSettings();
}

function ageText(b) {
  if (!b) return '';
  const bd = new Date(b.replace(/\//g, '-') + 'T00:00:00');
  if (isNaN(bd)) return '';
  const days = Math.floor((dayStart(Date.now()) - bd.getTime()) / 86400000) + 1;
  if (days < 1) return '';
  if (days <= 100) return '出生第 ' + days + ' 天';
  const now = new Date(); let mo = (now.getFullYear() - bd.getFullYear()) * 12 + now.getMonth() - bd.getMonth();
  let dd = now.getDate() - bd.getDate();
  if (dd < 0) { mo--; dd += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  return (mo >= 12 ? Math.floor(mo / 12) + ' 歲 ' + (mo % 12) + ' 個月' : mo + ' 個月') + (dd ? ' ' + dd + ' 天' : '') + '（第 ' + days + ' 天）';
}

function viewToday() {
  let h = '';
  if (!connected()) {
    h += `<div class="banner"><b>👋 歡迎使用寶寶日記</b>先連上你自己的 Google 試算表，就能用 Siri 語音記錄、兩個人一起看。
      <div class="btns"><a class="btn" style="text-align:center;text-decoration:none" href="setup.html">開始設定</a><button class="btn ghost" data-act="demo-on">先看示範</button></div></div>`;
  }
  const now = Date.now(), d0 = dayStart(now);
  const s = dayStats(d0);
  const feed = lastOf(['喝奶', '親餵']);
  const sleeping = state.recs.filter(isOpenSleep).slice(-1)[0];
  if (feed) {
    h += `<div class="card hero" style="margin-top:8px"><div class="bub">${ic(feed.type)}</div><div>
      <div class="lbl">距離上次餵奶</div><div class="big">${dur((now - feed.t) / 60000)}</div>
      <div class="sub">${dayLabel(feed.t) === '今天' ? '' : dayLabel(feed.t) + ' '}${hm(feed.t)} · ${esc(summaryOf(feed))}</div></div></div>`;
  }
  // 七天平均
  let avg = 0, nd = 0;
  for (let i = 1; i <= 7; i++) { const x = dayStats(d0 - i * 86400000); if (x.n) { avg += x.milk; nd++; } }
  avg = nd ? Math.round(avg / nd) : 0;
  const lastTemp = lastOf(['體溫']);
  const tempRecent = lastTemp && now - lastTemp.t < 2 * 86400000;
  const fever = tempRecent && lastTemp.value >= 38;
  const lastPoop = lastOf(['大便']);
  if (sleeping) h += `<div class="card hero night" style="margin-top:10px"><div class="bub">🌙</div><div><div class="lbl">寶寶睡著了，噓～</div><div class="big">${dur((now - sleeping.t) / 60000)}</div><div class="sub">${hm(sleeping.t)} 開始睡 · 醒來按「起床」或跟 Siri 說</div></div></div>`;
  if (!feed && connected()) h += `<div class="card hero" style="margin-top:8px"><div class="bub">👶</div><div><div class="big" style="font-size:22px">哈囉，寶貝！</div><div class="sub">按下面的按鈕，或跟 Siri 說「寶寶紀錄」開始記錄</div></div></div>`;
  h += `<div class="stats">
    <div class="card stat"><div class="k"><span class="i" data-c="milk">🍼</span>今天喝奶</div>
      <div class="v">${Math.round(s.milk)}<small>cc</small></div><div class="s">${s.milkN} 次${s.bf ? ' · 親餵 ' + s.bf + ' 次' : ''}${avg ? ' · 7 天平均 ' + avg : ''}</div></div>
    <div class="card stat"><div class="k"><span class="i" data-c="diaper">💧</span>今天尿布</div>
      <div class="v">${s.diaper + s.poop}<small>次</small></div><div class="s">大便 ${s.poop} 次${lastPoop ? ' · 上次 ' + (dayLabel(lastPoop.t) === '今天' ? hm(lastPoop.t) : dayLabel(lastPoop.t)) : ''}</div></div>
    <div class="card stat"><div class="k"><span class="i" data-c="sleep">${sleeping ? '🌙' : '😴'}</span>${sleeping ? '睡著中' : '今天睡眠'}</div>
      <div class="v">${sleeping ? dur((now - sleeping.t) / 60000, true) : dur(s.sleep, true)}<small>${sleeping ? '' : '時:分'}</small></div>
      <div class="s">${sleeping ? hm(sleeping.t) + ' 開始 · 今天共 ' + dur(s.sleep) : '從 0 點算起'}</div></div>
    <div class="card stat ${fever ? 'alert' : ''}"><div class="k"><span class="i" data-c="temp">🌡️</span>體溫${fever ? ' ⚠️ 發燒' : ''}</div>
      <div class="v">${tempRecent ? num(lastTemp.value) + '<small>°C</small>' : '—'}</div>
      <div class="s">${tempRecent ? dayLabel(lastTemp.t) + ' ' + hm(lastTemp.t) + (lastTemp.detail ? ' · ' + esc(lastTemp.detail) : '') : '兩天內沒有量'}</div></div>
  </div>`;

  h += `<h2>快速記錄</h2><div class="quick">
    <button class="qb" data-add="喝奶"><span class="e" data-c="${tc('喝奶')}">🍼</span>喝奶<span class="h">選 cc 數</span></button>
    <button class="qb" data-add="尿布"><span class="e" data-c="${tc('尿布')}">💧</span>尿布<span class="h">點一下就記</span></button>
    <button class="qb" data-add="大便"><span class="e" data-c="${tc('大便')}">💩</span>大便<span class="h">顏色・形狀</span></button>
    <button class="qb ${sleeping ? 'on' : ''}" data-act="sleep"><span class="e" data-c="sleep">${sleeping ? '🌞' : '😴'}</span>${sleeping ? '起床' : '睡覺'}<span class="h">${sleeping ? '已睡 ' + dur((now - sleeping.t) / 60000) : '點一下開始'}</span></button>
    <button class="qb" data-add="體溫"><span class="e" data-c="${tc('體溫')}">🌡️</span>體溫<span class="h">°C</span></button>
    <button class="qb" data-act="more"><span class="e" data-c="bf">🧸</span>更多<span class="h">親餵、用藥…</span></button>
  </div>
  <form class="say" data-form="say"><input name="t" placeholder="用打字記：喝奶120、三點大便 黃 軟" autocomplete="off" enterkeyhint="send"><button>記錄</button></form>
  <div class="say-hint">和 Siri 說的一樣，例如「十分鐘前喝奶一百五」「體溫三十七點八」「起床」</div>`;

  const today = state.recs.filter(r => r.t >= d0 || isOpenSleep(r)).slice().reverse();
  h += `<h2>今天的紀錄 <button class="more" data-tab-go="log">全部紀錄 ›</button></h2>`;
  h += `<div class="card list">${today.length ? today.map(rowHtml).join('') : '<div class="empty">今天還沒有紀錄</div>'}</div>`;
  return h;
}

function rowHtml(r) {
  const fever = r.type === '體溫' && r.value >= 38;
  let main = r.type, sub = '';
  if (r.type === '睡眠') {
    if (isOpenSleep(r)) { main = '睡著中'; sub = '已睡 ' + dur((Date.now() - r.t) / 60000); }
    else { const e = r.end || r.t + (r.value || 0) * 60000; main = '睡眠 ' + dur((e - r.t) / 60000); sub = hm(r.t) + '–' + hm(e); }
  } else if (r.value != null) main += ' ' + num(r.value) + (r.unit === '°C' ? '°C' : ' ' + (r.unit || ''));
  if (r.detail) sub = (sub ? sub + ' · ' : '') + r.detail;
  if (r.by) sub = (sub ? sub + ' · ' : '') + r.by;
  return `<button class="row ${fever ? 'fever' : ''}" data-edit="${esc(r.id)}"><span class="e" data-c="${tc(r.type)}">${ic(r.type)}</span>
    <span class="m"><b>${esc(main)}</b>${sub ? '<div class="d">' + esc(sub) + '</div>' : ''}</span>
    <span class="t">${hm(r.t)}${r.text ? '<small>🎙 Siri</small>' : ''}</span></button>`;
}

function viewLog() {
  const types = ['全部'].concat(Object.keys(T).filter(t => state.recs.some(r => r.type === t)));
  let h = `<div class="chips" style="margin-top:8px">${types.map(t => `<button class="chip ${state.filter === t ? 'on' : ''}" data-filter="${t}">${t === '全部' ? '全部' : ic(t) + ' ' + t}</button>`).join('')}</div>`;
  const recs = state.recs.filter(r => state.filter === '全部' || r.type === state.filter);
  if (!recs.length) return h + '<div class="card empty" style="margin-top:10px">還沒有紀錄</div>';
  const days = {};
  recs.forEach(r => { const k = dayKey(r.t); (days[k] = days[k] || []).push(r); });
  const keys = Object.keys(days).sort().reverse();
  keys.slice(0, state.logDays).forEach(k => {
    const list = days[k].slice().reverse();
    const s = dayStats(dayStart(list[0].t));
    const sum = [s.milkN ? '奶 ' + Math.round(s.milk) + 'cc·' + s.milkN + '次' : '', s.bf ? '親餵 ' + s.bf + '次' : '', s.diaper + s.poop ? '尿布 ' + (s.diaper + s.poop) : '', s.poop ? '便 ' + s.poop : '', s.sleep ? '睡 ' + dur(s.sleep, true) : ''].filter(Boolean).join('｜');
    h += `<div class="day-h"><b>${dayLabel(list[0].t)}</b><span>${sum}</span></div><div class="card list">${list.map(rowHtml).join('')}</div>`;
  });
  if (keys.length > state.logDays) h += `<div class="btns" style="margin-top:14px"><button class="btn ghost" data-act="more-days">顯示更早的紀錄</button></div>`;
  h += `<div class="btns" style="margin-top:14px"><button class="btn ghost" data-act="csv">匯出 CSV（給醫生看）</button></div>`;
  return h;
}

/* ───── 圖表頁 ───── */
function viewCharts() {
  const R = state.range;
  let h = `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><div class="seg">${[7, 14, 30].map(n => `<button class="${R === n ? 'on' : ''}" data-range="${n}">${n} 天</button>`).join('')}</div></div>`;
  if (!state.recs.length) return h + '<div class="card empty" style="margin-top:12px">有紀錄之後這裡會出現圖表</div>';
  const days = rangeDays(R);
  const st = days.map(d => dayStats(d));
  const done = st.slice(0, -1).filter(x => x.n);       // 不含今天的平均
  const avg = k => done.length ? done.reduce((a, x) => a + x[k], 0) / done.length : 0;
  const card = (id, title, sub, legend) => `<div class="card chart-card"><h3>${title}</h3><div class="cs">${sub}</div>${legend || ''}<div id="ch-${id}"></div>
    <button class="tbl-toggle" data-table="${id}">${state.tables[id] ? '收起表格' : '看表格'}</button><div id="tb-${id}"></div></div>`;
  h += card('milk', '🍼 每天喝奶量', `平均每天 <b>${Math.round(avg('milk'))} cc</b> · <b>${num(avg('milkN')).toFixed(1)}</b> 次（不含今天）`);
  h += card('rhythm', '🕐 24 小時作息', '每一列是一天，看得出寶寶餵奶和睡覺的規律',
    `<div class="legend"><span><i style="background:var(--sleep)"></i>睡眠</span><span><i class="dot" style="background:var(--milk)"></i>喝奶／親餵</span><span><i class="dot" style="background:var(--diaper)"></i>尿布</span><span><i class="dot" style="background:var(--poop)"></i>大便</span></div>`);
  h += card('diaper', '💧 每天尿布與大便', `平均每天尿布 <b>${num(avg('diaper') + avg('poop')).toFixed(1)}</b> 次，其中大便 <b>${num(avg('poop')).toFixed(1)}</b> 次`,
    `<div class="legend"><span><i style="background:var(--diaper)"></i>尿布（全部）</span><span><i style="background:var(--poop)"></i>大便</span></div>`);
  h += card('sleep', '😴 每天睡眠', `平均每天 <b>${dur(avg('sleep'))}</b>（不含今天）`);
  const t0 = days[0];
  if (state.recs.some(r => r.type === '體溫' && r.t >= t0)) {
    const temps = state.recs.filter(r => r.type === '體溫' && r.t >= t0 && r.value);
    const mx = temps.reduce((a, r) => r.value > a.value ? r : a, temps[0]);
    h += card('temp', '🌡️ 體溫', `量了 <b>${temps.length}</b> 次，最高 <b>${num(mx.value)}°C</b>（${md(mx.t)} ${hm(mx.t)}）· 紅色虛線是 38°C`);
  }
  if (state.recs.some(r => r.type === '體重')) {
    const ws = state.recs.filter(r => r.type === '體重' && r.value);
    const a = ws[0], b = ws[ws.length - 1];
    const gain = ws.length > 1 && b.t > a.t ? Math.round((b.value - a.value) * 1000 / ((b.t - a.t) / 86400000) * 7) : null;
    h += card('weight', '⚖️ 體重成長', `最新 <b>${num(b.value)} kg</b>（${md(b.t)}）${gain != null ? ' · 平均每週 <b>' + (gain >= 0 ? '+' : '') + gain + ' g</b>' : ''}（全部紀錄）`);
  }
  return h;
}
function rangeDays(R) { const d0 = dayStart(Date.now()); const a = []; for (let i = R - 1; i >= 0; i--) a.push(dayStart(d0 - i * 86400000 + 3600000 * 3)); return a; }

function drawCharts() {
  const days = rangeDays(state.range);
  const st = days.map(d => dayStats(d));
  const cats = days.map(d => md(d));
  const lab = days.map(d => dayLabel(d));
  bar('milk', cats, [{ name: '喝奶', color: 'milk', vals: st.map(x => Math.round(x.milk)) }], {
    unit: 'cc', tip: i => `<b>${lab[i]}</b><br>喝奶 <b>${Math.round(st[i].milk)} cc</b> · ${st[i].milkN} 次${st[i].bf ? '<br>親餵 ' + st[i].bf + ' 次 ' + st[i].bfMin + ' 分' : ''}`,
    table: [['日期', '喝奶 cc', '次數', '親餵次數'], days.map((d, i) => [lab[i], Math.round(st[i].milk), st[i].milkN, st[i].bf])]
  });
  bar('diaper', cats, [{ name: '尿布', color: 'diaper', vals: st.map(x => x.diaper + x.poop) }, { name: '大便', color: 'poop', vals: st.map(x => x.poop) }], {
    unit: '次', tip: i => `<b>${lab[i]}</b><br>尿布 <b>${st[i].diaper + st[i].poop}</b> 次<br>大便 <b>${st[i].poop}</b> 次`,
    table: [['日期', '尿布', '大便'], days.map((d, i) => [lab[i], st[i].diaper + st[i].poop, st[i].poop])]
  });
  bar('sleep', cats, [{ name: '睡眠', color: 'sleep', vals: st.map(x => Math.round(x.sleep / 6) / 10) }], {
    unit: '小時', tip: i => `<b>${lab[i]}</b><br>睡眠 <b>${dur(st[i].sleep)}</b>`,
    table: [['日期', '睡眠'], days.map((d, i) => [lab[i], dur(st[i].sleep)])]
  });
  rhythm('rhythm', days.slice(-Math.min(state.range, 14)));
  if ($('#ch-temp')) {
    const pts = state.recs.filter(r => r.type === '體溫' && r.t >= days[0] && r.value);
    line('temp', pts, { color: 'temp', unit: '°C', ref: 38, x0: days[0], x1: Date.now(), dec: 1, floor: 35.5,
      table: [['時間', '體溫', '方式'], pts.slice().reverse().map(r => [md(r.t) + ' ' + hm(r.t), num(r.value), r.detail || ''])] });
  }
  if ($('#ch-weight')) {
    const pts = state.recs.filter(r => r.type === '體重' && r.value);
    const x0 = pts[0].t, x1 = Math.max(pts[pts.length - 1].t, x0 + 86400000 * 7);
    line('weight', pts, { color: 'weight', unit: 'kg', x0: x0 - 86400000, x1: x1 + 86400000, dec: 2,
      table: [['日期', '體重 kg'], pts.slice().reverse().map(r => [md(r.t), num(r.value)])] });
  }
}

/* ───── SVG 小圖表 ───── */
const NS = 'http://www.w3.org/2000/svg';
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function tableFor(id, table) {
  const el = $('#tb-' + id); if (!el) return;
  el.innerHTML = state.tables[id] ? `<table class="data"><tr>${table[0].map(x => '<th>' + esc(x) + '</th>').join('')}</tr>${table[1].slice().reverse().map(r => '<tr>' + r.map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('')}</table>` : '';
}
function bindTip(svg, hits, tipFn, onHl) {
  const tip = $('#tip');
  const show = (e) => {
    const pt = svg.getBoundingClientRect();
    const x = (e.clientX - pt.left) * (svg.viewBox.baseVal.width / pt.width);
    const y = (e.clientY - pt.top) * (svg.viewBox.baseVal.height / pt.height);
    const i = hits(x, y);
    if (i == null) { hide(); return; }
    tip.innerHTML = tipFn(i); tip.hidden = false;
    const tw = tip.offsetWidth;
    const cx = Math.min(Math.max(e.clientX, tw / 2 + 8), innerWidth - tw / 2 - 8);
    tip.style.left = cx + 'px'; tip.style.top = Math.max(e.clientY - 6, tip.offsetHeight + 16) + 'px';
    onHl && onHl(i);
  };
  const hide = () => { tip.hidden = true; onHl && onHl(null); };
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.buttons) show(e); });
  svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
  document.addEventListener('pointerdown', e => { if (!svg.contains(e.target)) hide(); }, { passive: true });
  window.addEventListener('scroll', hide, { passive: true, once: true });
}
function mkSvg(el, W, H) {
  el.innerHTML = `<svg class="ch" viewBox="0 0 ${W} ${H}" role="img"></svg>`;
  return el.firstChild;
}
const C = k => `var(--${k})`;

function bar(id, cats, series, o) {
  const el = $('#ch-' + id); if (!el) return;
  const W = Math.max(280, el.clientWidth || 320), H = 170, L = 34, Rr = 6, Tp = 10, B = 22;
  const svg = mkSvg(el, W, H);
  const max = niceMax(Math.max.apply(null, series.flatMap(s => s.vals)) * 1.05);
  const pw = W - L - Rr, ph = H - Tp - B, n = cats.length, band = pw / n;
  const y = v => Tp + ph - v / max * ph;
  let g = '';
  for (let k = 0; k <= 4; k++) {
    const v = max * k / 4, yy = y(v);
    g += `<line class="${k ? 'gl' : 'base'}" x1="${L}" x2="${W - Rr}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 3.5}" text-anchor="end">${num(v)}</text>`;
  }
  g += `<rect class="hl" id="hl-${id}" x="0" y="${Tp}" width="${band}" height="${ph}" rx="6" visibility="hidden"/>`;
  const ns = series.length, gap = 2;
  const bw = Math.min(ns > 1 ? 11 : 18, (band * 0.7 - gap * (ns - 1)) / ns);
  cats.forEach((c, i) => {
    const cx = L + band * i + band / 2;
    const totalW = bw * ns + gap * (ns - 1);
    series.forEach((s, j) => {
      const v = s.vals[i]; if (!v) return;
      const x = cx - totalW / 2 + j * (bw + gap), top = y(v), h = Tp + ph - top, r = Math.min(4, bw / 2, h);
      g += `<path style="fill:${C(s.color)}" d="M${x},${Tp + ph}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${Tp + ph}Z"/>`;
    });
    const every = n <= 7 ? 1 : n <= 14 ? 2 : 5;
    if ((n - 1 - i) % every === 0) g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${i === n - 1 ? '今天' : c}</text>`;
  });
  svg.innerHTML = g;
  const hl = svg.querySelector('#hl-' + id);
  bindTip(svg, (x) => { const i = Math.floor((x - L) / band); return i >= 0 && i < n ? i : null; }, o.tip,
    i => { if (i == null) hl.setAttribute('visibility', 'hidden'); else { hl.setAttribute('x', L + band * i); hl.setAttribute('visibility', 'visible'); } });
  tableFor(id, o.table);
}

function line(id, pts, o) {
  const el = $('#ch-' + id); if (!el) return;
  const W = Math.max(280, el.clientWidth || 320), H = 170, L = 38, Rr = 10, Tp = 12, B = 22;
  const svg = mkSvg(el, W, H);
  const vs = pts.map(p => p.value).concat(o.ref ? [o.ref] : []);
  let lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
  if (o.floor != null) lo = Math.min(lo, o.floor + 1);
  const pad0 = (hi - lo) * 0.15 || 0.5; lo -= pad0; hi += pad0;
  if (o.floor != null) lo = Math.max(lo, o.floor);
  const pw = W - L - Rr, ph = H - Tp - B;
  const x = t => L + (t - o.x0) / (o.x1 - o.x0) * pw, y = v => Tp + ph - (v - lo) / (hi - lo) * ph;
  let g = '';
  for (let k = 0; k <= 3; k++) {
    const v = lo + (hi - lo) * k / 3, yy = y(v);
    g += `<line class="${k ? 'gl' : 'base'}" x1="${L}" x2="${W - Rr}" y1="${yy}" y2="${yy}"/><text x="${L - 6}" y="${yy + 3.5}" text-anchor="end">${v.toFixed(o.dec === 2 ? 1 : 1)}</text>`;
  }
  // x 軸日期
  const span = (o.x1 - o.x0) / 86400000, stepD = span <= 8 ? 1 : span <= 16 ? 2 : span <= 40 ? 5 : Math.ceil(span / 6);
  for (let t = dayStart(o.x0) + 86400000; t <= o.x1; t += 86400000 * stepD) g += `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${md(t)}</text>`;
  if (o.ref) g += `<line class="ref" x1="${L}" x2="${W - Rr}" y1="${y(o.ref)}" y2="${y(o.ref)}"/><text class="reft" x="${W - Rr}" y="${y(o.ref) - 4}" text-anchor="end">${o.ref}°C</text>`;
  g += `<line id="cx-${id}" class="base" y1="${Tp}" y2="${Tp + ph}" visibility="hidden"/>`;
  if (pts.length > 1) g += `<polyline fill="none" style="stroke:${C(o.color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => x(p.t) + ',' + y(p.value)).join(' ')}"/>`;
  pts.forEach((p, i) => {
    const hot = o.ref && p.value >= o.ref;
    g += `<circle id="pt-${id}-${i}" cx="${x(p.t)}" cy="${y(p.value)}" r="4" style="fill:${hot ? 'var(--critical)' : C(o.color)};stroke:var(--card)" stroke-width="2"/>`;
  });
  const last = pts[pts.length - 1];
  if (last) g += `<text class="lab" x="${Math.min(x(last.t), W - Rr)}" y="${y(last.value) - 9}" text-anchor="${x(last.t) > W - 40 ? 'end' : 'middle'}">${num(last.value)}</text>`;
  svg.innerHTML = g;
  const cxl = svg.querySelector('#cx-' + id);
  bindTip(svg, (px) => {
    let bi = null, bd = 1e9;
    pts.forEach((p, i) => { const d = Math.abs(x(p.t) - px); if (d < bd) { bd = d; bi = i; } });
    return bd < 40 ? bi : null;
  }, i => `<b>${md(pts[i].t)} ${hm(pts[i].t)}</b><br>${num(pts[i].value)} ${o.unit}${pts[i].detail ? ' · ' + esc(pts[i].detail) : ''}`,
  i => { if (i == null) cxl.setAttribute('visibility', 'hidden'); else { const xx = x(pts[i].t); cxl.setAttribute('x1', xx); cxl.setAttribute('x2', xx); cxl.setAttribute('visibility', 'visible'); } });
  tableFor(id, o.table);
}

function rhythm(id, days) {
  const el = $('#ch-' + id); if (!el) return;
  const W = Math.max(280, el.clientWidth || 320), L = 46, Rr = 6, Tp = 4, rowH = 22, B = 20;
  const H = Tp + rowH * days.length + B;
  const svg = mkSvg(el, W, H);
  const pw = W - L - Rr, x = ms => L + ms / 86400000 * pw;
  let g = '';
  [0, 6, 12, 18, 24].forEach(hh => { const xx = x(hh * 3600000); g += `<line class="gl" x1="${xx}" x2="${xx}" y1="${Tp}" y2="${H - B}"/><text x="${xx}" y="${H - 5}" text-anchor="middle">${hh}${hh === 12 ? '時' : ''}</text>`; });
  const evs = [];
  const now = Date.now();
  days.slice().reverse().forEach((d0, ri) => {
    const yy = Tp + ri * rowH, mid = yy + rowH / 2, d1 = d0 + 86400000;
    g += `<text x="${L - 6}" y="${mid + 3.5}" text-anchor="end">${ri === 0 ? '今天' : md(d0)}</text>`;
    g += `<line class="gl" x1="${L}" x2="${W - Rr}" y1="${yy + rowH}" y2="${yy + rowH}" style="opacity:.5"/>`;
    state.recs.forEach(r => {
      if (r.type === '睡眠') {
        const e = r.end || (isOpenSleep(r) ? now : r.t + (r.value || 0) * 60000);
        const a = Math.max(r.t, d0), b = Math.min(e, d1);
        if (b > a) {
          g += `<rect x="${x(a - d0)}" y="${mid - 6}" width="${Math.max(2, x(b - d0) - x(a - d0) - 1)}" height="12" rx="3" style="fill:var(--sleep);opacity:.85"/>`;
          evs.push({ row: ri, x0: x(a - d0), x1: x(b - d0), r: r, e: e });
        }
        return;
      }
      if (r.t < d0 || r.t >= d1) return;
      const col = r.type === '喝奶' || r.type === '親餵' ? 'milk' : r.type === '尿布' ? 'diaper' : r.type === '大便' ? 'poop' : null;
      if (!col) return;
      const xx = x(r.t - d0), off = col === 'milk' ? -5 : 5;
      g += `<circle cx="${xx}" cy="${mid + off}" r="${col === 'milk' ? 4 : 3}" style="fill:${C(col)};stroke:var(--card)" stroke-width="1.5"/>`;
      evs.push({ row: ri, x0: xx - 3, x1: xx + 3, r: r });
    });
  });
  svg.innerHTML = g;
  bindTip(svg, (px, py) => {
    const ri = Math.floor((py - Tp) / rowH);
    let best = null, bd = 14;
    evs.forEach((ev, i) => {
      if (ev.row !== ri) return;
      const d = px < ev.x0 ? ev.x0 - px : px > ev.x1 ? px - ev.x1 : 0;
      if (d < bd || (d === 0 && ev.r.type !== '睡眠')) { bd = d; best = i; }
    });
    return best;
  }, i => {
    const ev = evs[i], r = ev.r;
    if (r.type === '睡眠') return `<b>😴 ${hm(r.t)}–${isOpenSleep(r) ? '現在' : hm(ev.e)}</b><br>睡了 ${dur((ev.e - r.t) / 60000)}`;
    return `<b>${ic(r.type)} ${hm(r.t)}</b><br>${esc(summaryOf(r))}`;
  });
}

/* ───── 設定頁 ───── */
function viewSettings() {
  const by = LS.get('by', '');
  return `<h2>寶寶</h2><div class="card set">
    <div class="fld"><label>寶寶名字</label><input id="sName" value="${esc(state.settings['寶寶名字'] || '')}" placeholder="例如：小湯圓"></div>
    <div class="fld"><label>生日</label><input id="sBirth" type="date" value="${esc((state.settings['生日'] || '').replace(/\//g, '-'))}"></div>
    <button class="btn" data-act="save-baby" ${connected() ? '' : 'disabled'}>儲存（兩支手機都會看到）</button>
  </div>
  <h2>連線到自己的試算表</h2><div class="card set">
    <p>資料存在你自己的 Google 試算表。網址和密碼照「設定教學」做完就有。</p>
    <div class="fld"><label>網頁應用程式網址</label><input id="sUrl" value="${esc(LS.get('url', ''))}" placeholder="https://script.google.com/macros/s/…/exec" autocapitalize="off" autocorrect="off"></div>
    <div class="fld"><label>密碼（Code.gs 第一行的 KEY）</label><input id="sKey" type="password" value="${esc(LS.get('key', ''))}" autocomplete="off"></div>
    <div class="fld"><label>我是（記錄者名字，可不填）</label>
      <div class="chips">${['媽媽', '爸爸', '阿嬤', '阿公', '保母'].map(n => `<button class="chip ${by === n ? 'on' : ''}" data-by="${n}">${n}</button>`).join('')}</div>
      <input id="sBy" value="${esc(by)}" placeholder="或自己打" style="margin-top:8px"></div>
    <button class="btn" data-act="save-conn">儲存並測試連線</button>
  </div>
  <h2>其他</h2><div class="card set">
    <a class="linkbtn" href="setup.html">📖 設定教學（試算表＋Siri 捷徑）</a>
    <div class="btns" style="margin-top:10px"><button class="btn ghost" data-act="${state.demo ? 'demo-off' : 'demo-on'}">${state.demo ? '關閉示範模式' : '開啟示範模式（假資料）'}</button></div>
  </div>
  <div class="ver">寶寶日記 ${VERSION}${state.synced && !state.demo ? ' · 上次更新 ' + dayLabel(state.synced) + ' ' + hm(state.synced) : ''}</div>`;
}

/* ───── 表單 ───── */
function openSheet(html) {
  const sh = $('#sheet'); sh.innerHTML = '<div class="grab"></div>' + html;
  sh.hidden = false; $('#sheetBg').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBg').hidden = true; render(); }

function openMore() {
  openSheet(`<h3><span class="e" data-c="bf">🧸</span>記錄其他項目<button class="x" data-act="close">✕</button></h3><div class="more-grid">${MORE.map(t => `<button class="qb" data-add="${t}"><span class="e" data-c="${tc(t)}">${ic(t)}</span>${t === '睡眠' ? '補記睡眠' : t}</button>`).join('')}</div>`);
}

let form = null;
function openForm(type, rec) {
  const m = T[type] || T.備註;
  const editing = !!rec;
  const last = lastOf([type]);
  form = { type: type, id: rec ? rec.id : null, t: rec ? rec.t : Date.now(), when: rec ? 'custom' : 0,
    value: rec ? rec.value : (m.presets ? (last && last.value != null ? last.value : m.presets[2] || m.presets[0]) : (type === '體重' || type === '身高' || type === '頭圍') && last ? last.value : null),
    detail: rec ? rec.detail : '', end: rec && rec.end ? rec.end : null };
  if (type === '睡眠' && !rec) { form.t = Date.now() - 3600000; form.end = Date.now(); form.when = 'custom'; }
  if (type === '親餵') {
    const L = /左(\d+)/.exec(form.detail || ''), R = /右(\d+)/.exec(form.detail || '');
    form.L = L ? +L[1] : rec ? (rec.value || 0) : 10; form.R = R ? +R[1] : rec ? 0 : 10;
  }
  let h = `<h3><span class="e" data-c="${m.c}">${m.e}</span>${editing ? '修改' : '記錄'}${type === '睡眠' && !editing ? '一段睡眠' : type}<button class="x" data-act="close">✕</button></h3>`;
  if (type === '睡眠') {
    h += `<div class="fld"><label>開始睡</label><input type="datetime-local" id="fT" value="${toLocalInput(form.t)}"></div>`;
    h += `<div class="fld"><label>醒來${editing && isOpenSleep(rec) ? '（還在睡就留空）' : ''}</label><input type="datetime-local" id="fEnd" value="${form.end || (rec && rec.value) ? toLocalInput(form.end || rec.t + rec.value * 60000) : ''}"></div>`;
  } else {
    h += `<div class="fld"><label>時間</label><div class="chips when">${[['現在', 0], ['10 分前', 10], ['30 分前', 30], ['1 小時前', 60], ['自訂', 'custom']].map(([l, v]) => `<button class="chip ${form.when === v ? 'on' : ''}" data-when="${v}">${l}</button>`).join('')}</div>
      <input type="datetime-local" id="fT" value="${toLocalInput(form.t)}" ${form.when === 'custom' ? '' : 'hidden'}></div>`;
  }
  if (type === '親餵') {
    h += `<div class="fld"><label>左邊（分鐘）</label><div class="amt"><button data-stepk="L" data-d="-1">－</button><input id="fL" inputmode="numeric" value="${form.L}"><button data-stepk="L" data-d="1">＋</button></div></div>
      <div class="fld"><label>右邊（分鐘）</label><div class="amt"><button data-stepk="R" data-d="-1">－</button><input id="fR" inputmode="numeric" value="${form.R}"><button data-stepk="R" data-d="1">＋</button></div></div>`;
  } else if (m.unit && type !== '睡眠') {
    h += `<div class="fld"><label>${type === '體溫' ? '溫度' : '數量'}${m.opt ? '（可不填）' : ''}</label><div class="amt"><button data-step="-1">－</button>
      <input id="fV" inputmode="decimal" value="${form.value != null ? num(form.value) : ''}" placeholder="—"><span class="u">${m.unit}</span><button data-step="1">＋</button></div>
      ${m.presets ? `<div class="presets">${m.presets.map(p => `<button class="chip" data-preset="${p}">${p}</button>`).join('')}</div>` : ''}</div>`;
  }
  const picked = (form.detail || '').split(/\s+/).filter(Boolean);
  const chipRow = (list, multi) => `<div class="chips" style="flex-wrap:wrap">${list.map(c => `<button class="chip ${picked.indexOf(c) >= 0 ? 'on' : ''}" data-chip="${c}" data-multi="${multi ? 1 : 0}" data-group="${list.join(',')}">${c}</button>`).join('')}</div>`;
  if (m.chips) h += `<div class="fld"><label>${type === '大便' ? '顏色' : type === '體溫' ? '量法' : '種類'}</label>${chipRow(m.chips, false)}</div>`;
  if (m.chips2) h += `<div class="fld"><label>形狀・狀況（可多選）</label>${chipRow(m.chips2, true)}</div>`;
  const known = (m.chips || []).concat(m.chips2 || []);
  const freeText = type === '親餵' ? '' : picked.filter(p => known.indexOf(p) < 0).join(' ');
  if (type !== '親餵') h += `<div class="fld"><label>${type === '備註' ? '內容' : type === '用藥' ? '藥名・劑量' : type === '副食品' ? '吃了什麼' : '備註（可不填）'}</label>${type === '備註' ? `<textarea id="fD">${esc(freeText)}</textarea>` : `<input id="fD" value="${esc(freeText)}">`}</div>`;
  if (rec && rec.text) h += `<p style="font-size:13px;color:var(--ink-3);margin:-4px 2px 12px">🎙 Siri 原話：「${esc(rec.text)}」${rec.by ? '　' + esc(rec.by) : ''}</p>`;
  h += `<div class="btns">${editing ? '<button class="btn danger" data-act="del">刪除</button>' : ''}<button class="btn" data-act="save">${editing ? '儲存修改' : '記錄'}</button></div>`;
  openSheet(h);
}

function readForm() {
  const type = form.type, m = T[type] || T.備註;
  const tEl = $('#fT');
  let t = form.when === 'custom' || type === '睡眠' ? new Date(tEl.value).getTime() : Date.now() - form.when * 60000;
  if (form.id && form.when === 'keep') t = form.t;
  if (isNaN(t)) throw new Error('時間格式不對');
  if (t > Date.now() + 60000) throw new Error('時間不能是未來');
  const rec = { t: t, type: type, value: null, unit: m.unit || '', detail: '' };
  const on = Array.from(document.querySelectorAll('#sheet [data-chip].on')).map(b => b.dataset.chip);
  const free = $('#fD') ? $('#fD').value.trim() : '';
  rec.detail = on.concat(free ? [free] : []).join(' ');
  if (type === '親餵') {
    const L = +$('#fL').value || 0, R = +$('#fR').value || 0;
    rec.value = L + R; rec.detail = [L ? '左' + L : '', R ? '右' + R : ''].filter(Boolean).join(' ');
  } else if (type === '睡眠') {
    const e = $('#fEnd').value ? new Date($('#fEnd').value).getTime() : null;
    if (e && e <= t) throw new Error('醒來時間要比開始晚');
    rec.end = e; rec.value = e ? Math.round((e - t) / 60000) : null; rec.unit = e ? '分鐘' : '';
  } else if ($('#fV')) {
    const v = $('#fV').value.trim();
    if (v !== '') { rec.value = Number(v); if (isNaN(rec.value)) throw new Error('數量要填數字'); }
    else if (!m.opt) throw new Error('請填' + (type === '體溫' ? '溫度' : '數量'));
    if (rec.value == null) rec.unit = '';
    if (type === '體溫' && rec.value != null && (rec.value < 34 || rec.value > 43)) throw new Error('體溫看起來不對（34～43）');
  }
  if (type === '備註' && !rec.detail) throw new Error('請寫內容');
  return rec;
}

async function toggleSleep() {
  const open = state.recs.filter(isOpenSleep).slice(-1)[0];
  if (open) {
    const end = Date.now(), mins = Math.round((end - open.t) / 60000);
    await updRec(open.id, { end: end, value: mins, unit: '分鐘', detail: open.detail || '' });
    toast('🌞 起床了，睡了 ' + dur(mins), { label: '復原', fn: () => updRec(open.id, { end: null, value: null, unit: '' }) });
  } else {
    await addRec({ t: Date.now(), type: '睡眠' }, true);
    const r = state.recs.filter(isOpenSleep).slice(-1)[0];
    toast('😴 開始睡覺，醒來再按「起床」', r ? { label: '復原', fn: () => delRec(r.id, true) } : null);
  }
}

async function sayText(text) {
  if (!parseText) { toast('還在載入，請稍等一下'); return; }
  const p = parseText(text, new Date());
  if (p.kind === 'empty') return;
  if (p.kind === 'undo') {
    const last = state.recs[state.recs.length - 1];
    if (last) delRec(last.id, true); return;
  }
  if (p.kind === 'query') { toast('查詢請看上面的卡片，或問 Siri 喔'); return; }
  const rec = p.rec;
  if (rec.type === '睡眠') {
    const open = state.recs.filter(isOpenSleep).slice(-1)[0];
    if (p.wake && open) { const mins = Math.round((rec.t - open.t) / 60000); await updRec(open.id, { end: rec.t, value: mins, unit: '分鐘' }); toast('🌞 睡了 ' + dur(mins)); return; }
    if (rec.value) { rec.end = rec.t; rec.t -= rec.value * 60000; }
    else if (p.wake) { toast('找不到開始睡的紀錄'); return; }
  }
  if (p.unsure) toast('聽不太懂，先存成備註');
  await addRec(rec, p.unsure);
}

/* ───── 提示 ───── */
let toastTimer;
function toast(msg, act) {
  const el = $('#toast');
  el.innerHTML = '<span>' + esc(msg) + '</span>' + (act ? '<button>' + esc(act.label) + '</button>' : '');
  el.hidden = false;
  if (act) el.querySelector('button').onclick = () => { el.hidden = true; act.fn(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, act ? 6000 : 3000);
}

/* ───── 事件 ───── */
document.addEventListener('click', async e => {
  const b = e.target.closest('button, [data-act]'); if (!b) return;
  const d = b.dataset;
  if (d.tab) { state.tab = d.tab; render(); scrollTo(0, 0); return; }
  if (d.tabGo) { state.tab = d.tabGo; render(); scrollTo(0, 0); return; }
  if (d.add) {
    if (!connected()) { toast('先到「設定」連上試算表，或開示範模式'); return; }
    if (d.add === '尿布' && $('#sheet').hidden) { addRec({ t: Date.now(), type: '尿布', detail: '' }).then(r => r && toast('已記錄 💧 尿布', { label: '修改', fn: () => openForm('尿布', r) })); return; }
    openForm(d.add); return;
  }
  if (d.edit) { const r = state.recs.find(x => x.id === d.edit); if (r) openForm(T[r.type] ? r.type : '備註', r); return; }
  if (d.filter) { state.filter = d.filter; render(); return; }
  if (d.range) { state.range = +d.range; render(); return; }
  if (d.table) { state.tables[d.table] = !state.tables[d.table]; render(); return; }
  if (d.by) { $('#sBy').value = d.by; document.querySelectorAll('[data-by]').forEach(x => x.classList.toggle('on', x === b)); return; }
  if (d.when != null) {
    form.when = d.when === 'custom' ? 'custom' : +d.when;
    document.querySelectorAll('[data-when]').forEach(x => x.classList.toggle('on', x === b));
    $('#fT').hidden = form.when !== 'custom';
    if (form.when !== 'custom') $('#fT').value = toLocalInput(Date.now() - form.when * 60000);
    return;
  }
  if (d.preset) { $('#fV').value = d.preset; return; }
  if (d.step) {
    const m = T[form.type]; const v = parseFloat($('#fV').value) || (m.presets ? m.presets[0] : 0);
    $('#fV').value = num(Math.max(0, v + (+d.step) * (m.step || 1))); return;
  }
  if (d.stepk) { const el = $('#f' + d.stepk); el.value = Math.max(0, (+el.value || 0) + (+d.d) * 1); return; }
  if (d.chip) {
    if (d.multi !== '1') document.querySelectorAll(`#sheet [data-chip][data-group="${d.group}"]`).forEach(x => { if (x !== b) x.classList.remove('on'); });
    b.classList.toggle('on'); return;
  }
  switch (d.act) {
    case 'close': closeSheet(); break;
    case 'more': if (!connected()) { toast('先到「設定」連上試算表，或開示範模式'); break; } openMore(); break;
    case 'sleep': if (!connected()) { toast('先到「設定」連上試算表，或開示範模式'); break; } toggleSleep(); break;
    case 'save': {
      let rec; try { rec = readForm(); } catch (err) { toast(err.message); break; }
      const id = form.id; $('#sheet').hidden = true; $('#sheetBg').hidden = true;
      if (id) { await updRec(id, rec); toast('已修改'); } else await addRec(rec);
      render(); break;
    }
    case 'del': {
      const r = state.recs.find(x => x.id === form.id);
      if (r && confirm('刪除這筆「' + summaryOf(r) + '」？')) { $('#sheet').hidden = true; $('#sheetBg').hidden = true; await delRec(r.id); }
      break;
    }
    case 'save-conn': {
      const url = $('#sUrl').value.trim(), key = $('#sKey').value.trim();
      if (url && !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) { toast('網址應該是 https://script.google.com/… 開頭'); break; }
      LS.set('url', url); LS.set('key', key); LS.set('by', $('#sBy').value.trim());
      if (state.demo) { state.demo = false; LS.set('demo', false); state.recs = []; }
      if (url) { await sync(true); toast(state.err ? '連不上：' + state.err : '✓ 連線成功'); } else render();
      break;
    }
    case 'save-baby': {
      const set = { '寶寶名字': $('#sName').value.trim(), '生日': $('#sBirth').value };
      try { const j = await api({ action: 'settings', set: set }); state.settings = j.settings; LS.set('settings', state.settings); toast('已儲存'); render(); }
      catch (err) { toast('沒有存到：' + err.message); }
      break;
    }
    case 'demo-on': state.demo = true; LS.set('demo', true); state.recs = LS.get('demo-recs', null) || demoData(); state.settings = { '寶寶名字': '示範寶寶', '生日': dayKey(Date.now() - 52 * 86400000) }; LS.set('demo-recs', state.recs); render(); toast('示範模式：假資料只存在這支手機'); break;
    case 'demo-off': state.demo = false; LS.set('demo', false); state.recs = LS.get('cache', []); state.settings = LS.get('settings', {}); render(); sync(true); break;
    case 'more-days': state.logDays += 14; render(); break;
    case 'csv': exportCsv(); break;
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.dataset.form === 'say') {
    const inp = e.target.querySelector('input'); const v = inp.value.trim(); if (!v) return;
    if (!connected()) { toast('先到「設定」連上試算表，或開示範模式'); return; }
    inp.value = ''; inp.blur(); sayText(v);
  }
});
$('#sheetBg').addEventListener('click', closeSheet);
$('#syncBtn').addEventListener('click', () => sync());
document.addEventListener('visibilitychange', () => { if (!document.hidden) { sync(true); } });
setInterval(() => {
  if (document.hidden) return;
  if (Date.now() - state.synced > 60000) sync(true);
  else if (state.tab === 'today' && $('#sheet').hidden) render();
}, 30000);

function exportCsv() {
  const rows = [['時間', '類別', '數值', '單位', '細節', '結束時間', '記錄者']].concat(state.recs.map(r => [dayKey(r.t) + ' ' + hm(r.t), r.type, r.value == null ? '' : r.value, r.unit, r.detail, r.end ? dayKey(r.end) + ' ' + hm(r.end) : '', r.by || '']));
  const csv = '﻿' + rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = '寶寶日記_' + dayKey(Date.now()) + '.csv'; a.click();
}

/* ───── 示範資料 ───── */
let demoSeq = 0;
function demoApi(b) {
  const r = state.recs;
  if (b.action === 'list') return Promise.resolve({ ok: true, records: r, settings: state.settings });
  if (b.action === 'add') return Promise.resolve({ ok: true, rec: Object.assign({ id: 'd' + Date.now() + (demoSeq++), value: null, unit: '', detail: '', end: null, by: b.by || '' }, b.rec) });
  if (b.action === 'settings') { state.settings = Object.assign({}, state.settings, b.set); return Promise.resolve({ ok: true, settings: state.settings }); }
  return Promise.resolve({ ok: true });
}
function demoData() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = []; const now = Date.now(); let id = 0;
  const add = (t, type, value, unit, detail, end) => { if (t < now) out.push({ id: 'd' + (id++), t: t, type: type, value: value, unit: unit || '', detail: detail || '', end: end || null, by: rnd() > .5 ? '媽媽' : '爸爸', text: rnd() > .6 ? '（Siri）' : '' }); };
  const start = dayStart(now) - 20 * 86400000;
  let t = start + 3600000;
  while (t < now) {
    const age = (t - start) / 86400000;
    const amt = Math.round((90 + age * 2.2 + rnd() * 40) / 10) * 10;
    add(t, rnd() > .85 ? '親餵' : '喝奶', null, '', '', null);
    const f = out[out.length - 1]; if (f) { if (f.type === '親餵') { f.value = 15 + Math.round(rnd() * 10); f.unit = '分鐘'; f.detail = '左' + Math.round(f.value / 2) + ' 右' + (f.value - Math.round(f.value / 2)); } else { f.value = amt; f.unit = 'cc'; f.detail = rnd() > .7 ? '母奶' : '配方奶'; } }
    add(t + 10 * 60000, '尿布', null, '', rnd() > .7 ? '很濕' : '');
    if (rnd() > .7) add(t + 15 * 60000, '大便', null, '', ['黃 軟', '黃綠 糊', '黃 糊', '褐 軟'][Math.floor(rnd() * 4)]);
    const sl = t + (25 + rnd() * 20) * 60000, h = new Date(t).getHours();
    const len = (h >= 21 || h < 6 ? 150 + rnd() * 80 : 70 + rnd() * 60) * 60000;
    if (sl + len < now) add(sl, '睡眠', Math.round(len / 60000), '分鐘', '', sl + len);
    else if (sl < now) add(sl, '睡眠', null, '', '', null);
    t = sl + len + (15 + rnd() * 30) * 60000;
  }
  for (let d = 0; d <= 20; d += 7) add(start + d * 86400000 + 10 * 3600000, '體重', num(4.1 + d * 0.028 + rnd() * 0.05), 'kg', '');
  add(now - 2 * 86400000 + 3600000 * 2, '體溫', 37.2, '°C', '耳溫');
  add(now - 2 * 86400000 + 3600000 * 9, '體溫', 38.3, '°C', '耳溫');
  add(now - 2 * 86400000 + 3600000 * 14, '體溫', 37.6, '°C', '耳溫');
  add(now - 86400000 + 3600000 * 8, '體溫', 36.9, '°C', '耳溫');
  add(now - 3 * 86400000 + 3600000 * 11, '疫苗', null, '', '五合一 第一劑');
  add(now - 86400000 + 3600000 * 19, '洗澡', null, '', '');
  return out.sort((a, b) => a.t - b.t);
}

/* ───── 開始 ───── */
if (state.demo) { state.recs = LS.get('demo-recs', null) || demoData(); state.settings = { '寶寶名字': '示範寶寶', '生日': dayKey(Date.now() - 52 * 86400000) }; }
render();
sync(true);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
