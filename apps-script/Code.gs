/**
 * 寶寶日記 — Google Apps Script 後端（第 1 版）
 *
 * 安裝：
 *   1. 開一份新的 Google 試算表 → 擴充功能 → Apps Script
 *   2. 把這整份程式貼進 Code.gs（取代原本內容）
 *   3. 把下面 KEY 改成你自己的密碼（App 和 Siri 捷徑都要填同一組）
 *   4. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *      執行身分：我　｜　誰可以存取：任何人 → 部署，複製網址
 *
 * 資料全部存在這份試算表的「紀錄」「設定」「自訂說法」分頁，不會傳到別的地方。
 */
const KEY = '請改成你的密碼';
const VERSION = 2;

const SHEET = '紀錄';
const HEAD = ['id', '時間', '類別', '數值', '單位', '細節', '原始文字', '記錄者', '寫入時間', '結束時間'];
const SET_SHEET = '設定';
const CUSTOM_SHEET = '自訂說法';
const CUSTOM_HEAD = ['說法', '記成', '數值', '細節'];

/* ───────────── 入口 ───────────── */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.text != null || p.action) return handle_(Object.assign({}, p, { plain: p.plain !== '0' && !p.action }));
  return ContentService.createTextOutput('寶寶日記後端正常運作（第 ' + VERSION + ' 版）');
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  // 捷徑有時把參數放在網址上
  if (e && e.parameter) Object.keys(e.parameter).forEach(k => { if (body[k] == null) body[k] = e.parameter[k]; });
  return handle_(body);
}

function handle_(b) {
  let out;
  try {
    if (String(b.key || '') !== KEY) throw new Error('密碼不對');
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { out = route_(b); } finally { lock.releaseLock(); }
  } catch (err) {
    out = { ok: false, error: String(err.message || err), reply: '沒有記錄成功：' + (err.message || err) };
  }
  const plain = b.plain === true || b.plain === 'true' || b.plain === '1';
  if (plain) return ContentService.createTextOutput(out.reply || (out.ok ? '好了' : out.error));
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function route_(b) {
  const a = b.action || 'say';
  if (a === 'say') return say_(String(b.text || ''), String(b.by || ''));
  if (a === 'list') return { ok: true, v: VERSION, records: list_(Number(b.days) || 60), settings: getSettings_(), custom: getCustom_() };
  if (a === 'add') { const r = addRec_(b.rec || {}, String(b.by || ''), ''); return { ok: true, rec: r }; }
  if (a === 'update') { updateRec_(String(b.id), b.rec || {}); return { ok: true }; }
  if (a === 'delete') { deleteRec_(String(b.id)); return { ok: true }; }
  if (a === 'settings') { setSettings_(b.set || {}); return { ok: true, settings: getSettings_() }; }
  if (a === 'custom') { setCustom_(b.list || []); return { ok: true, custom: getCustom_() }; }
  if (a === 'ping') return { ok: true, v: VERSION };
  throw new Error('不認得的動作 ' + a);
}

/* ───────────── 試算表存取 ───────────── */

function sheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET, 0);
    sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('yyyy/mm/dd hh:mm');
    sh.getRange('I:J').setNumberFormat('yyyy/mm/dd hh:mm');
    sh.setColumnWidth(2, 140); sh.setColumnWidth(6, 160); sh.setColumnWidth(7, 200);
  }
  return sh;
}

function rows_() {
  const sh = sheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, HEAD.length).getValues().map((r, i) => ({ row: i + 2, r: r }));
}

function toRec_(r) {
  const t = r[1] instanceof Date ? r[1].getTime() : (r[1] ? new Date(r[1]).getTime() : 0);
  const end = r[9] instanceof Date ? r[9].getTime() : (r[9] ? new Date(r[9]).getTime() : null);
  return {
    id: String(r[0]), t: t, type: String(r[2]), value: r[3] === '' ? null : Number(r[3]),
    unit: String(r[4] || ''), detail: String(r[5] || ''), text: String(r[6] || ''), by: String(r[7] || ''),
    end: end
  };
}

function list_(days) {
  const since = Date.now() - days * 86400000;
  return rows_().map(x => toRec_(x.r)).filter(r => r.t >= since || (r.type === '睡眠' && !r.end))
    .concat(rows_().map(x => toRec_(x.r)).filter(r => r.t < since && /^(體重|身高|頭圍)$/.test(r.type)))
    .sort((a, b) => a.t - b.t);
}

function newId_() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function addRec_(rec, by, text) {
  const sh = sheet_();
  const id = newId_();
  const t = rec.t ? new Date(Number(rec.t)) : new Date();
  const row = [id, t, rec.type || '備註', rec.value == null || rec.value === '' ? '' : Number(rec.value),
    rec.unit || '', rec.detail || '', text || '', by || '', new Date(), rec.end ? new Date(Number(rec.end)) : ''];
  sh.appendRow(row);
  return toRec_(row);
}

function findRow_(id) {
  const hit = rows_().find(x => String(x.r[0]) === id);
  if (!hit) throw new Error('找不到這筆紀錄');
  return hit;
}

function updateRec_(id, rec) {
  const hit = findRow_(id);
  const sh = sheet_();
  const r = hit.r.slice();
  if (rec.t != null) r[1] = new Date(Number(rec.t));
  if (rec.type != null) r[2] = rec.type;
  if ('value' in rec) r[3] = rec.value == null || rec.value === '' ? '' : Number(rec.value);
  if (rec.unit != null) r[4] = rec.unit;
  if (rec.detail != null) r[5] = rec.detail;
  if ('end' in rec) r[9] = rec.end ? new Date(Number(rec.end)) : '';
  sh.getRange(hit.row, 1, 1, HEAD.length).setValues([r]);
}

function deleteRec_(id) { sheet_().deleteRow(findRow_(id).row); }

function setSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SET_SHEET);
  if (!sh) { sh = ss.insertSheet(SET_SHEET); sh.getRange(1, 1, 1, 2).setValues([['項目', '內容']]).setFontWeight('bold'); }
  return sh;
}

function getSettings_() {
  const sh = setSheet_();
  const n = sh.getLastRow() - 1;
  const o = {};
  if (n > 0) sh.getRange(2, 1, n, 2).getDisplayValues().forEach(r => { if (r[0]) o[r[0]] = r[1]; });
  return o;
}

function setSettings_(set) {
  const sh = setSheet_();
  const n = sh.getLastRow() - 1;
  const keys = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(r => String(r[0])) : [];
  Object.keys(set).forEach(k => {
    const i = keys.indexOf(k);
    if (i >= 0) sh.getRange(i + 2, 2).setNumberFormat('@').setValue(String(set[k]));
    else { sh.appendRow([k, '']); sh.getRange(sh.getLastRow(), 2).setNumberFormat('@').setValue(String(set[k])); keys.push(k); }
  });
}

/* ───────────── 自訂說法 ───────────── */

function customSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CUSTOM_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CUSTOM_SHEET);
    sh.getRange(1, 1, 1, CUSTOM_HEAD.length).setValues([CUSTOM_HEAD]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function getCustom_() {
  const sh = customSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, CUSTOM_HEAD.length).getValues()
    .filter(r => String(r[0]).trim() && String(r[1]).trim())
    .map(r => ({ w: String(r[0]).trim(), type: String(r[1]).trim(), value: r[2] === '' ? null : Number(r[2]), detail: String(r[3] || '').trim() }));
}

function setCustom_(list) {
  const sh = customSheet_();
  const n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, CUSTOM_HEAD.length).clearContent();
  const rows = (list || []).filter(x => x && String(x.w || '').trim() && String(x.type || '').trim())
    .slice(0, 200)
    .map(x => [String(x.w).trim(), String(x.type).trim(), x.value == null || x.value === '' ? '' : Number(x.value), String(x.detail || '').trim()]);
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, CUSTOM_HEAD.length).setValues(rows);
  }
}

/* ───────────── Siri 說的話 ───────────── */

function say_(text, by) {
  const now = new Date();
  const p = parseText(text, now, getCustom_());
  const all = rows_().map(x => toRec_(x.r));

  if (p.kind === 'empty') return { ok: false, reply: '沒有聽到內容，再說一次喔' };

  if (p.kind === 'undo') {
    const mine = rows_().filter(x => String(x.r[6] || '') !== '').sort((a, b) => b.r[8] - a.r[8]);
    const last = mine[0] || rows_().sort((a, b) => b.r[8] - a.r[8])[0];
    if (!last) return { ok: true, reply: '目前沒有紀錄可以刪除' };
    const r = toRec_(last.r);
    sheet_().deleteRow(last.row);
    return { ok: true, reply: '已刪除上一筆：' + describe_(r) };
  }

  if (p.kind === 'query') return { ok: true, reply: answer_(p, all, now) };

  const rec = p.rec;
  // 睡醒：補上最近一筆還在睡的紀錄
  if (rec.type === '睡眠' && p.wake) {
    const open = rows_().filter(x => String(x.r[2]) === '睡眠' && !x.r[9]).sort((a, b) => b.r[1] - a.r[1])[0];
    const end = rec.t;
    if (open && end - toRec_(open.r).t < 20 * 3600000 && end > toRec_(open.r).t) {
      const start = toRec_(open.r).t;
      const mins = Math.round((end - start) / 60000);
      updateRec_(String(open.r[0]), { end: end, value: mins, unit: '分鐘', detail: '' });
      return { ok: true, reply: '起床了！這次睡了' + dur_(mins) + '。今天共睡' + dur_(sleepToday_(rows_().map(x => toRec_(x.r)), now)) };
    }
    if (rec.value) { // 「睡了兩小時」
      rec.end = end; rec.t = end - rec.value * 60000;
    } else {
      return { ok: true, reply: '找不到開始睡的紀錄。可以說「睡了兩小時」或「一點睡到三點」' };
    }
  }
  if (rec.type === '睡眠' && !p.wake && !rec.end && rec.value) { rec.end = rec.t; rec.t = rec.t - rec.value * 60000; }

  const saved = addRec_(rec, by, text);
  return { ok: true, rec: saved, reply: confirm_(saved, all, now, p.unsure) };
}

function describe_(r) {
  const tm = Utilities.formatDate(new Date(r.t), Session.getScriptTimeZone(), 'HH:mm');
  return tm + ' ' + r.type + (r.value != null ? ' ' + fmtNum_(r.value) + (r.unit || '') : '') + (r.detail ? ' ' + r.detail : '');
}

function fmtNum_(n) { return Math.round(n * 100) / 100 + ''; }

function dur_(mins) {
  mins = Math.round(mins);
  const h = Math.floor(mins / 60), m = mins % 60;
  return (h ? h + '小時' : '') + (m || !h ? m + '分鐘' : '');
}

function dayStart_(now) { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }

function sleepToday_(all, now) {
  const s = dayStart_(now), e = now.getTime();
  let m = 0;
  all.filter(r => r.type === '睡眠').forEach(r => {
    const a = Math.max(r.t, s), b = Math.min(r.end || e, e);
    if (b > a) m += (b - a) / 60000;
  });
  return m;
}

function confirm_(r, all, now, unsure) {
  const s = dayStart_(now);
  const same = all.filter(x => x.type === r.type && x.t >= s && x.id !== r.id);
  const prev = all.filter(x => x.type === r.type && x.t < r.t).sort((a, b) => b.t - a.t)[0];
  const ago = prev ? '，距離上次' + dur_((r.t - prev.t) / 60000) : '';
  let msg = '已記錄' + r.type;
  if (r.value != null) msg += ' ' + fmtNum_(r.value) + (r.unit === '°C' ? '度' : r.unit);
  if (r.detail) msg += '，' + r.detail;
  if (r.type === '喝奶') {
    const tot = same.concat([r]).reduce((a, x) => a + (x.value || 0), 0);
    msg += '。今天第' + (same.length + 1) + '次，共' + Math.round(tot) + 'cc' + ago;
  } else if (r.type === '尿布' || r.type === '大便' || r.type === '親餵') {
    msg += '。今天第' + (same.length + 1) + '次' + ago;
  } else if (r.type === '體溫' && r.value >= 38) {
    msg += '。注意，發燒了' + (r.value >= 39 ? '，三個月以下寶寶發燒請盡快就醫' : '');
  } else if (r.type === '睡眠' && !r.end) {
    msg = '已記錄開始睡覺，醒來時說「起床」';
  } else if (r.type === '睡眠') {
    msg = '已記錄睡眠 ' + dur_(r.value);
  }
  if (unsure) msg = '聽不太懂，先存成備註：「' + r.detail + '」';
  return msg;
}

function answer_(p, all, now) {
  const s = dayStart_(now);
  const today = all.filter(r => r.t >= s);
  if (p.what === 'summary') {
    const milk = today.filter(r => r.type === '喝奶');
    const parts = [];
    parts.push('今天喝奶' + milk.length + '次共' + Math.round(milk.reduce((a, r) => a + (r.value || 0), 0)) + 'cc');
    const bf = today.filter(r => r.type === '親餵').length; if (bf) parts.push('親餵' + bf + '次');
    parts.push('換尿布' + today.filter(r => r.type === '尿布' || r.type === '大便').length + '次');
    parts.push('大便' + today.filter(r => r.type === '大便').length + '次');
    const sl = sleepToday_(all, now); if (sl) parts.push('睡了' + dur_(sl));
    return parts.join('，');
  }
  const type = p.type || '喝奶';
  const last = all.filter(r => r.type === type).sort((a, b) => b.t - a.t)[0];
  if (!last) return '還沒有' + type + '的紀錄';
  if (type === '睡眠' && !last.end) return '寶寶從' + describe_(last).slice(0, 5) + '開始睡，已經睡了' + dur_((now - last.t) / 60000);
  return '上次' + type + '是' + describe_(last).replace(' ' + type, '') + '，' + dur_((now - last.t) / 60000) + '前';
}

/* ───────────── 中文語句解析（純函式，可單獨測試） ───────────── */

const CN_DIG = { '零': 0, '〇': 0, '一': 1, '二': 2, '兩': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const CN_UNIT = { '十': 10, '百': 100, '千': 1000 };

function cnInt_(s) {
  if (/^[0-9]+$/.test(s)) return Number(s);
  let total = 0, cur = 0, lastUnit = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c in CN_DIG) { cur = CN_DIG[c]; lastUnit = 0; }
    else if (c in CN_UNIT) {
      const u = CN_UNIT[c];
      total += (cur || (u === 10 ? 1 : 0)) * u; cur = 0; lastUnit = u;
    }
  }
  // 「一百五」= 150、「兩千五」= 2500
  if (cur && !lastUnit && /[百千][一二兩三四五六七八九]$/.test(s)) cur *= (/百.$/.test(s) ? 10 : 100);
  return total + cur;
}

// 把中文數字換成阿拉伯數字；「三十七點五」→ 37.5，「半」單獨留著
function cnToNum_(s) {
  s = s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/．/g, '.');
  const re = /[零〇一二兩两三四五六七八九十百千0-9]+(?:[點点.][零〇一二三四五六七八九0-9]+)?/g;
  return s.replace(re, m => {
    // 小時鐘點「三點」「三點二十」交給 parseTime 處理：保留「點」以外的寫法
    const parts = m.split(/[點点.]/);
    const ip = cnInt_(parts[0]);
    if (parts.length === 1) return String(ip);
    const dec = parts[1].split('').map(c => (c in CN_DIG ? CN_DIG[c] : c)).join('');
    const sep = /[點点]/.test(m) ? '點' : '.';
    return ip + sep + (/^[0-9]+$/.test(dec) ? dec : String(cnInt_(parts[1])));
  });
}

const PERIOD = { '凌晨': 0, '早上': 0, '上午': 0, '中午': 12, '下午': 12, '傍晚': 12, '晚上': 12, '半夜': 0 };

function parseTime_(s, now) {
  let t = now.getTime();
  let m;
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*(分鐘|分|小時|個小時|個鐘頭|鐘頭)\s*(前|之前)/))) {
    const n = Number(m[1]);
    t -= /小時|鐘頭/.test(m[2]) ? n * 3600000 : n * 60000;
    return { t: t, rest: s.replace(m[0], ' ') };
  }
  if ((m = s.match(/半(個)?(小時|鐘頭)(前|之前)/))) return { t: t - 1800000, rest: s.replace(m[0], ' ') };
  if ((m = s.match(/(剛剛|剛才|剛)/))) s = s.replace(m[0], ' ');
  // 鐘點：要有時段字（下午三點）或「分」「半」（三點二十分、三點半）才算時間
  m = s.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上|半夜)?\s*(\d{1,2})\s*[點点:：]\s*(半|\d{1,2})?\s*(分)?/);
  if (m && (m[1] || m[3] === '半' || m[4] || /[:：]/.test(m[0]))) {
    let h = Number(m[2]);
    const mi = m[3] === '半' ? 30 : Number(m[3] || 0);
    if (h > 23 || mi > 59) return { t: t, rest: s };
    if (m[1] && PERIOD[m[1]] === 12 && h < 12) h += 12;
    if (m[1] === '中午' && h >= 12 + 6) h -= 12;
    const d = new Date(now); d.setHours(h, mi, 0, 0);
    // 沒寫時段又是 12 小時制：選最接近「過去」的那個
    if (!m[1] && h < 12) { const pm = new Date(d); pm.setHours(h + 12); if (pm <= now && pm > d) d.setTime(pm.getTime()); }
    if (d > now) d.setDate(d.getDate() - 1);
    return { t: d.getTime(), rest: s.replace(m[0], ' '), clock: true };
  }
  return { t: t, rest: s };
}

function firstNum_(s) { const m = s.match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; }

const COLORS = ['黃綠', '黃色', '綠色', '褐色', '咖啡色', '黑色', '紅色', '白色', '灰白', '黃', '綠', '褐', '咖啡', '黑', '紅', '白'];
const TEXTURES = ['水便', '水狀', '稀', '糊', '軟', '硬', '顆粒', '有血', '血絲', '黏液', '很多', '少量', '大量', '正常'];

function pickWords_(s, list) {
  const out = [];
  list.forEach(w => { if (s.indexOf(w) >= 0 && !out.some(o => o.indexOf(w) >= 0)) out.push(w); });
  return out;
}

const UNITS = { 喝奶: 'cc', 擠奶: 'cc', 喝水: 'cc', 親餵: '分鐘', 睡眠: '分鐘', 體溫: '°C', 體重: 'kg', 身高: 'cm', 頭圍: 'cm', 副食品: 'g' };

// 自訂說法：找句子裡最長的那個
function matchCustom_(s, custom) {
  const flat = s.replace(/\s+/g, '').toLowerCase();
  let best = null;
  (custom || []).forEach(c => {
    const w = String(c.w || '').replace(/\s+/g, '').toLowerCase();
    if (w && flat.indexOf(w) >= 0 && (!best || w.length > best.wn.length)) best = Object.assign({ wn: w }, c);
  });
  return best;
}

function removeWord_(s, w) {
  // 句子裡可能有空白，逐字容許空白比對
  const re = new RegExp(w.split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'i');
  return s.replace(re, ' ');
}

function parseText(raw, now, custom) {
  now = now || new Date();
  let s = String(raw || '').replace(/[，。！？、,.!?；;]+$/g, '').trim();
  if (!s) return { kind: 'empty' };
  s = s.replace(/[，。！？、,!?；;]/g, ' ');
  const cust = matchCustom_(s, custom);
  if (cust) {
    if (cust.type === '取消') return { kind: 'undo' };
    s = removeWord_(s, cust.wn);
  }
  if (!cust && /^(取消|刪除|删除|打錯|說錯|撤銷|復原)|刪(掉|除)上一筆|上一筆(刪|不要|錯)/.test(s)) return { kind: 'undo' };

  s = s.replace(/一點點|一點/g, '少量').replace(/一下下/g, '');
  const forceNote = !cust && /^(備註|記錄一下|筆記)/.test(s);
  s = cnToNum_(s);
  // 小數點：時間解析完再把「點」換成小數點
  const tp = parseTime_(s, now);
  let rest = tp.rest.replace(/(\d)[點点](\d)/g, '$1.$2');
  const t = tp.t;

  // 查詢
  if (!cust && /(上次|上一次|最後一次).*(什麼時候|幾點|多久)?|多久(沒|前)|幾點(喝|換|大|睡)/.test(rest) && !/\d{2,}/.test(rest)) {
    return { kind: 'query', what: 'last', type: typeOf_(rest) || '喝奶' };
  }
  if (!cust && /(今天|今日).*(多少|幾次|幾|狀況|總共|統計|報告)|^(今天|今日)$/.test(rest)) return { kind: 'query', what: 'summary' };
  if (!cust && /睡多久|睡了多久|還在睡|睡多少/.test(rest)) return { kind: 'query', what: 'last', type: '睡眠' };

  const custType = cust ? (cust.type === '起床' ? '睡眠' : cust.type) : null;
  const type = forceNote ? null : custType && custType !== '備註' ? custType : custType === '備註' ? null : typeOf_(rest);
  const n = firstNum_(rest);
  const rec = { t: t, type: type || '備註', value: null, unit: '', detail: '' };
  const out = { kind: 'add', rec: rec };

  switch (type) {
    case '體溫': {
      let v = n;
      if (v != null && v > 100 && v < 430) v = v / 10;       // 「三七五」
      if (v != null && v < 30 && v >= 5) v = 30 + v;          // 「七點五度」很少見，忽略
      rec.value = v; rec.unit = '°C';
      rec.detail = pickWords_(rest, ['耳溫', '額溫', '肛溫', '腋溫', '口溫']).join(' ');
      break;
    }
    case '體重': {
      let v = n;
      if (/公克|克|g\b/i.test(rest) && v > 200) v = v / 1000;
      else if (v != null && v > 200) v = v / 1000;
      rec.value = v; rec.unit = 'kg'; break;
    }
    case '身高': case '頭圍': rec.value = n; rec.unit = 'cm'; break;
    case '親餵': {
      const L = rest.match(/左(?:邊|側)?\D{0,2}(\d+)/), R = rest.match(/右(?:邊|側)?\D{0,2}(\d+)/);
      if (L || R) {
        rec.value = (L ? Number(L[1]) : 0) + (R ? Number(R[1]) : 0);
        rec.detail = [L ? '左' + L[1] : '', R ? '右' + R[1] : ''].filter(Boolean).join(' ');
      } else {
        rec.value = n;
        rec.detail = pickWords_(rest, ['左邊', '右邊', '兩邊', '雙邊', '左', '右']).slice(0, 1).join('');
      }
      rec.unit = '分鐘'; break;
    }
    case '喝奶': case '擠奶': {
      rec.value = n; rec.unit = 'cc';
      rec.detail = pickWords_(rest, ['母奶', '母乳', '配方奶', '配方', '奶粉', '水解']).slice(0, 1).join('').replace('母乳', '母奶').replace(/^配方$|奶粉/, '配方奶');
      break;
    }
    case '大便': {
      const d = pickWords_(rest, COLORS).slice(0, 1).concat(pickWords_(rest, TEXTURES));
      rec.detail = d.join(' ');
      break;
    }
    case '尿布': {
      rec.detail = /大便|便便/.test(rest) ? '' : pickWords_(rest, ['很濕', '濕', '乾', '很多', '少量']).slice(0, 1).join('');
      break;
    }
    case '睡眠': {
      if ((cust && cust.type === '起床') || (!cust && /起床|醒了|醒來|睡醒|起來了|醒/.test(rest))) out.wake = true;
      const hm = rest.match(/(\d+(?:\.\d+)?)\s*(小時|個小時|鐘頭|個鐘頭)(?:\s*(\d+)\s*分)?/);
      const mm = rest.match(/(\d+)\s*分(鐘)?/);
      const half = rest.match(/(\d+)\s*個?半\s*(小時|鐘頭)/);
      if (half) rec.value = Number(half[1]) * 60 + 30;
      else if (hm) rec.value = Math.round(Number(hm[1]) * 60 + Number(hm[3] || 0));
      else if (/半小時|半個小時/.test(rest)) rec.value = 30;
      else if (mm) rec.value = Number(mm[1]);
      if (rec.value) rec.unit = '分鐘';
      break;
    }
    case '吐奶': rec.detail = pickWords_(rest, ['少量', '很多', '大量', '噴射']).join(' '); break;
    case '副食品': case '用藥': case '疫苗': case '洗澡': case '喝水': {
      const m = rest.match(/(\d+(?:\.\d+)?)\s*(cc|CC|ml|毫升|g|克|公克|匙|湯匙|顆|口)/);
      if (m) { rec.value = Number(m[1]); rec.unit = m[2].replace(/CC|ml|毫升/, 'cc').replace(/公克|克/, 'g'); }
      else if (type === '喝水' && n != null) { rec.value = n; rec.unit = 'cc'; }
      rec.detail = cleanDetail_(rest, type);
      break;
    }
    default:
      rec.type = '備註'; rec.detail = cust ? rest.replace(/\s+/g, ' ').trim() : String(raw).trim(); out.unsure = !forceNote && !cust;
      if (forceNote) rec.detail = rec.detail.replace(/^(備註|記錄一下|筆記)\s*/, '');
  }
  if (type === '尿布' && /大便|便便/.test(rest)) rec.type = '大便';
  if (cust) {
    if (rec.value == null && cust.value != null && !isNaN(cust.value)) { rec.value = cust.value; rec.unit = rec.unit || UNITS[rec.type] || ''; }
    if (cust.detail) rec.detail = [cust.detail, rec.detail].filter(Boolean).join(' ');
    if (rec.type === '備註' && !rec.detail) rec.detail = cust.w;
    out.custom = cust.w;
  }
  return out;
}

function cleanDetail_(s, type) {
  return s.replace(/(副食品|吃藥|餵藥|用藥|吃了|吃|打疫苗|疫苗|打針|洗澡|喝水|喝了)/g, ' ')
    .replace(/\d+(?:\.\d+)?\s*(cc|CC|ml|毫升|g|克|公克|匙|湯匙|顆|口)/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function typeOf_(s) {
  const rules = [
    ['體溫', /體溫|發燒|量溫度|溫度|耳溫|額溫|肛溫|腋溫|\d\d\.\d\s*度|\d+\s*度/],
    ['體重', /體重|公斤|kg|斤重/i],
    ['身高', /身高|身長/],
    ['頭圍', /頭圍/],
    ['吐奶', /吐奶|溢奶|吐了|嘔吐|吐/],
    ['擠奶', /擠奶|擠了|擠母奶|集乳|吸奶/],
    ['親餵', /親餵|親自餵|直接餵|喝ㄋㄟㄋㄟ|餵母乳|吃母乳|左邊|右邊|左側|右側/],
    ['大便', /大便|便便|拉屎|嗯嗯|大號|拉肚子|解便|拉了/],
    ['尿布', /尿布|尿尿|小便|尿了|濕了|換尿/],
    ['喝奶', /喝奶|餵奶|奶|瓶餵|喝了\s*\d|^\d+\s*(cc|CC|ml|毫升)$/],
    ['睡眠', /睡|起床|醒了|醒來|睡醒|起來了/],
    ['洗澡', /洗澡|泡澡/],
    ['用藥', /藥|退燒|滴劑|維他命|維生素|益生菌/],
    ['疫苗', /疫苗|打針|預防針/],
    ['喝水', /喝水|水\s*\d/],
    ['副食品', /副食品|吃了|吃|米糊|泥|粥/]
  ];
  for (let i = 0; i < rules.length; i++) if (rules[i][1].test(s)) return rules[i][0];
  return null;
}

/* 在 Apps Script 編輯器選這個函式按「執行」，可以先建好分頁並授權 */
function setup() {
  sheet_(); setSheet_(); customSheet_();
  Logger.log('完成！接著按「部署」→「新增部署作業」→ 網頁應用程式');
}

if (typeof module !== 'undefined') module.exports = { parseText: parseText, cnToNum_: cnToNum_, cnInt_: cnInt_ };
