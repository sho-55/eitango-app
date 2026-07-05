'use strict';

/* ============================================================
 * 英単語マスター — デッキ式・語彙学習ウェブアプリ
 * データ: decks/index.json（一覧） + decks/<deck-id>.json（本体）
 * 進捗: localStorage 単一キー（この端末の中だけに保存）
 * ============================================================ */

const APP_VERSION = '1.5.0';
const LS_KEY = 'etg.v1';
const EXPORT_PREFIX = 'ETG1.';

/* ---------------- 進捗ストレージ ---------------- */

let storageWarned = false;

function freshState() {
  return { schemaVersion: 1, decks: {}, settings: { rate: 0.9 } };
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return freshState();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.decks) return freshState();
    if (data.schemaVersion !== 1) {
      // 将来のスキーマ移行はここに追加する。未知の版は退避して作り直す
      try { localStorage.setItem(LS_KEY + '.bak', raw); } catch (e) {}
      return freshState();
    }
    if (!data.settings) data.settings = { rate: 0.9 };
    return data;
  } catch (e) {
    return freshState();
  }
}

let state = loadState();

function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    if (!storageWarned) {
      storageWarned = true;
      toast('⚠ 進捗が保存できない設定になっています。ホーム画面から開いてね');
    }
  }
}

function deckProg(deckId) {
  if (!state.decks[deckId]) state.decks[deckId] = { words: {} };
  if (!state.decks[deckId].words) state.decks[deckId].words = {};
  return state.decks[deckId];
}

function wordProg(deckId, wordId) {
  const d = deckProg(deckId);
  return d.words[wordId] || { learned: false, right: 0, wrong: 0 };
}

function setLearned(deckId, wordId, val) {
  const d = deckProg(deckId);
  const w = d.words[wordId] || { learned: false, right: 0, wrong: 0 };
  w.learned = !!val;
  d.words[wordId] = w;
  saveState();
}

function recordAnswer(deckId, wordId, ok) {
  const d = deckProg(deckId);
  const w = d.words[wordId] || { learned: false, right: 0, wrong: 0 };
  if (ok) w.right++; else w.wrong++;
  d.words[wordId] = w;
  saveState();
}

/* デッキに存在しない単語の進捗を掃除（単語の削除・改名に追従） */
function pruneProgress(deck) {
  const d = state.decks[deck.id];
  if (!d || !d.words) return;
  const ids = new Set(deck.words.map(w => w.id));
  let changed = false;
  for (const k of Object.keys(d.words)) {
    if (!ids.has(k)) { delete d.words[k]; changed = true; }
  }
  if (changed) saveState();
}

/* ---------------- デッキ取得 ---------------- */

let deckIndex = null;
const deckCache = {};

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.json();
}

async function getIndex() {
  if (!deckIndex) deckIndex = await fetchJSON('./decks/index.json');
  return deckIndex;
}

async function getDeck(id) {
  if (deckCache[id]) return deckCache[id];
  const idx = await getIndex();
  const meta = idx.decks.find(d => d.id === id);
  if (!meta) throw new Error('デッキが見つかりません: ' + id);
  const deck = await fetchJSON('./decks/' + meta.file);
  deckCache[id] = deck;
  pruneProgress(deck);
  return deck;
}

function deckStats(deck) {
  let learned = 0, right = 0, wrong = 0;
  for (const w of deck.words) {
    const p = wordProg(deck.id, w.id);
    if (p.learned) learned++;
    right += p.right; wrong += p.wrong;
  }
  return { total: deck.words.length, learned, right, wrong };
}

function groupOf(deck, word) {
  if (!word.group || !Array.isArray(deck.groups)) return null;
  return deck.groups.find(g => g.key === word.group) || null;
}

/* ---------------- 発音 ---------------- */

function pickVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return null;
  const vs = synth.getVoices();
  return vs.find(v => v.lang === 'en-US' && v.localService)
      || vs.find(v => v.lang === 'en-US')
      || vs.find(v => v.lang && v.lang.indexOf('en') === 0)
      || null;
}

if (window.speechSynthesis) {
  // iOSは初回 getVoices() が空のことがある。イベントで温めておく
  window.speechSynthesis.onvoiceschanged = function () { pickVoice(); };
}

function speak(text) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel(); // iOSでキューが詰まるのを防ぐ
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = (state.settings && state.settings.rate) || 0.9;
    const v = pickVoice();
    if (v) u.voice = v;
    synth.speak(u);
  } catch (e) { /* 発音は学習を止めない：失敗しても無視 */ }
}

/* ---------------- ユーティリティ ---------------- */

const app = document.getElementById('app');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function stars(n) {
  return n ? '★'.repeat(n) : '';
}

/* 品詞バッジ: 一文字略号→フル表記の色分けチップ（"形/動" は2つ並べる） */
const POS_LABEL = { '動': '動詞', '名': '名詞', '形': '形容詞', '副': '副詞', '熟': '熟語', '前': '前置詞', '接': '接続詞', '代': '代名詞', '助': '助動詞', '間': '間投詞' };
const POS_CLASS = { '動': 'pos-v', '名': 'pos-n', '形': 'pos-adj', '副': 'pos-adv', '熟': 'pos-idm' };

function posBadge(pos) {
  if (!pos) return '';
  return String(pos).split('/').map(p => {
    const label = POS_LABEL[p] || p;
    const cls = POS_CLASS[p] || 'pos-x';
    return '<span class="posb ' + cls + '">' + esc(label) + '</span>';
  }).join('');
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function go(hash) { location.hash = hash; }

/* デッキ内フィルタ（セッション中だけ保持） */
const deckFilter = {};
const FILTERS = [
  { key: 'all',   label: 'ぜんぶ' },
  { key: 'todo',  label: 'まだだけ' },
  { key: 'star3', label: '★★★だけ' },
  { key: 'star2', label: '★★以上' }
];

/* 出題はんい（デッキ全体の通し番号で10語ブロック・複数選択可。セッション中だけ保持） */
const deckRange = {}; // deckId → 選択ブロックidの配列（空 = ぜんぶ）

function deckBlocks(deck) {
  // 1-10, 11-20, ... の通し番号ブロック（端数が5語未満なら前のブロックに吸収）
  const ws = deck.words;
  const blocks = [];
  const starts = [];
  for (let s = 0; s < ws.length; s += 10) starts.push(s);
  if (starts.length > 1 && ws.length - starts[starts.length - 1] < 5) starts.pop();
  starts.forEach((s, bi) => {
    const end = (bi === starts.length - 1) ? ws.length : s + 10;
    blocks.push({
      id: 'n:' + s,
      label: (s + 1) + '-' + end,
      ids: ws.slice(s, end).map(w => w.id)
    });
  });
  return blocks;
}

function rangeActive(deckId) {
  return (deckRange[deckId] || []).length > 0;
}

function applyRange(deck) {
  const sel = deckRange[deck.id] || [];
  if (!sel.length) return deck.words.slice();
  const idset = {};
  for (const b of deckBlocks(deck)) {
    if (sel.indexOf(b.id) >= 0) for (const id of b.ids) idset[id] = true;
  }
  return deck.words.filter(w => idset[w.id]);
}

/* はんい × 状態フィルタを重ねた出題プール */
function activePool(deck) {
  let ws = applyRange(deck);
  const key = deckFilter[deck.id] || 'all';
  if (key === 'todo')  ws = ws.filter(w => !wordProg(deck.id, w.id).learned);
  if (key === 'star3') ws = ws.filter(w => (w.star || 0) >= 3);
  if (key === 'star2') ws = ws.filter(w => (w.star || 0) >= 2);
  return ws;
}

function topbar(title, backHash) {
  return '<div class="topbar">' +
    '<button class="back" data-go="' + esc(backHash) + '" aria-label="もどる">←</button>' +
    '<h1>' + esc(title) + '</h1>' +
    '</div>';
}

function bindCommon() {
  app.querySelectorAll('[data-go]').forEach(b => {
    b.addEventListener('click', () => go(b.getAttribute('data-go')));
  });
  app.querySelectorAll('[data-speak]').forEach(b => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      speak(b.getAttribute('data-speak'));
    });
  });
}

function renderError(msg) {
  app.innerHTML =
    '<div class="apptitle"><div class="logo">英</div><h1>英単語マスター</h1></div>' +
    '<div class="errorbox">読み込みに失敗しました。<br>' + esc(msg) +
    '<br><br>電波のある場所で、もう一度ためしてください。' +
    '<button id="retry">再読み込み</button></div>';
  document.getElementById('retry').addEventListener('click', () => location.reload());
}

/* ---------------- ホーム（デッキ一覧） ---------------- */

async function renderHome() {
  let idx;
  try { idx = await getIndex(); } catch (e) { renderError(e.message); return; }

  let cards = '';
  for (const meta of idx.decks) {
    const cached = deckCache[meta.id];
    let learned = 0;
    if (cached) {
      learned = deckStats(cached).learned;
    } else {
      // デッキ未取得でも進捗キーの数で近似表示（開けば正確になる）
      const p = state.decks[meta.id];
      if (p && p.words) learned = Object.values(p.words).filter(w => w.learned).length;
      learned = Math.min(learned, meta.wordCount);
    }
    const total = meta.wordCount;
    const pct = total ? Math.round(learned / total * 100) : 0;
    cards +=
      '<button class="deckcard" data-go="#/deck/' + esc(meta.id) + '">' +
      '<h2>' + esc(meta.title) + '</h2>' +
      (meta.description ? '<div class="desc">' + esc(meta.description) + '</div>' : '') +
      '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="stats"><span class="done">覚えた ' + learned + ' / ' + total + '</span>' +
      '<span class="rest">あと ' + (total - learned) + ' 語</span></div>' +
      '</button>';
  }
  if (!idx.decks.length) {
    cards = '<div class="empty">単語帳がまだありません。<br>お父さん・お母さんに「単語帳を追加して」と頼んでね。</div>';
  }

  app.innerHTML =
    '<div class="apptitle"><div class="logo">英</div><div><h1>英単語マスター</h1>' +
    '<div class="sub">えいけん準2級への道</div></div></div>' +
    cards +
    '<div class="footer"><button class="chip" data-go="#/settings">⚙ 設定</button>' +
    '<div style="margin-top:8px">v' + APP_VERSION + '</div></div>';
  bindCommon();
}

/* ---------------- デッキメニュー ---------------- */

async function renderDeckMenu(deckId) {
  let deck;
  try { deck = await getDeck(deckId); } catch (e) { renderError(e.message); return; }
  const st = deckStats(deck);
  const pct = st.total ? Math.round(st.learned / st.total * 100) : 0;
  const answered = st.right + st.wrong;
  const acc = answered ? Math.round(st.right / answered * 100) : null;
  const filterKey = deckFilter[deckId] || 'all';
  const filtered = activePool(deck);
  const hasBlank = deck.words.some(w => w.quizEn && w.quizAns);

  const chips = FILTERS.map(f =>
    '<button class="chip' + (f.key === filterKey ? ' on' : '') + '" data-filter="' + f.key + '">' + f.label + '</button>'
  ).join('');

  const rangeSel = deckRange[deckId] || [];
  const rangeChips =
    '<button class="chip' + (rangeSel.length ? '' : ' on') + '" data-rblock="">ぜんぶ</button>' +
    deckBlocks(deck).map(b =>
      '<button class="chip' + (rangeSel.indexOf(b.id) >= 0 ? ' on' : '') + '" data-rblock="' + esc(b.id) + '">' + esc(b.label) + '</button>'
    ).join('');

  app.innerHTML =
    topbar(deck.title, '#/') +
    '<div class="card">' +
    '<div class="progresshead"><span>覚えた ' + st.learned + '/' + st.total + '</span>' +
    '<div class="bar"><i style="width:' + pct + '%"></i></div><span>' + pct + '%</span></div>' +
    (acc !== null
      ? '<div class="note">クイズ正答率 ' + acc + '%（' + st.right + '勝' + st.wrong + '敗）</div>'
      : '<div class="note">クイズはまだやっていないよ</div>') +
    '</div>' +
    '<div class="filterrow">' + chips + '</div>' +
    '<div class="note" style="margin-bottom:4px">出題はんい（タップで選ぶ・複数OK）</div>' +
    '<div class="filterrow">' + rangeChips + '</div>' +
    (rangeActive(deckId)
      ? '<div class="note" style="margin:-6px 0 10px">いま ' + filtered.length + ' 語にしぼりこみ中。クイズははんい内ぜんぶ出るよ</div>'
      : '') +
    '<button class="modebtn" data-go="#/deck/' + esc(deckId) + '/cards"><span class="emoji">🃏</span>' +
    '<span>フラッシュカード<span class="hint">英語 → 意味を思い出す（' + filtered.length + '語）</span></span></button>' +
    '<button class="modebtn" data-go="#/deck/' + esc(deckId) + '/sheet"><span class="emoji">🟥</span>' +
    '<span>赤シート<span class="hint">意味をかくして、タップでチラ見</span></span></button>' +
    '<button class="modebtn" data-go="#/deck/' + esc(deckId) + '/quiz"><span class="emoji">✏️</span>' +
    '<span>4択クイズ<span class="hint">意味を選ぶ。' + (rangeActive(deckId) ? 'はんい内ぜんぶ出るよ' : 'まだの単語から出るよ') + '</span></span></button>' +
    (hasBlank
      ? '<button class="modebtn" data-go="#/deck/' + esc(deckId) + '/blank"><span class="emoji">💭</span>' +
        '<span>空所クイズ<span class="hint">文の空所の単語を思い出す</span></span></button>'
      : '') +
    '<button class="modebtn" data-go="#/deck/' + esc(deckId) + '/list"><span class="emoji">📖</span>' +
    '<span>単語リスト<span class="hint">全部ながめる・発音チェック</span></span></button>' +
    '<div class="dangerzone"><button class="dangerbtn" id="resetdeck">このデッキの記録をリセット</button></div>';

  bindCommon();
  app.querySelectorAll('[data-filter]').forEach(b => {
    b.addEventListener('click', () => {
      deckFilter[deckId] = b.getAttribute('data-filter');
      renderDeckMenu(deckId);
    });
  });
  app.querySelectorAll('[data-rblock]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-rblock');
      if (!id) {
        deckRange[deckId] = [];
      } else {
        const cur = deckRange[deckId] || [];
        const i = cur.indexOf(id);
        if (i >= 0) cur.splice(i, 1); else cur.push(id);
        deckRange[deckId] = cur;
      }
      renderDeckMenu(deckId);
    });
  });
  document.getElementById('resetdeck').addEventListener('click', () => {
    if (confirm('「' + deck.title + '」の覚えた記録とクイズ成績を消します。いいですか？')) {
      delete state.decks[deckId];
      saveState();
      renderDeckMenu(deckId);
      toast('リセットしました');
    }
  });
}

/* ---------------- フラッシュカード ---------------- */

let fc = null; // {deckId, queue, i, flipped, knownCount, laterIds}

async function renderCards(deckId, onlyIds) {
  let deck;
  try { deck = await getDeck(deckId); } catch (e) { renderError(e.message); return; }
  let pool = activePool(deck);
  if (onlyIds) pool = deck.words.filter(w => onlyIds.indexOf(w.id) >= 0);
  if (!pool.length) {
    app.innerHTML = topbar('フラッシュカード', '#/deck/' + deckId) +
      '<div class="empty">この条件のカードはありません。<br>はんい・フィルタを「ぜんぶ」に戻してみてね。</div>';
    bindCommon();
    return;
  }
  fc = { deckId, deck, queue: shuffle(pool), i: 0, flipped: false, knownCount: 0, laterIds: [] };
  fcShow();
}

function fcShow() {
  const deck = fc.deck;
  if (fc.i >= fc.queue.length) {
    app.innerHTML = topbar('フラッシュカード', '#/deck/' + fc.deckId) +
      '<div class="card qresult">' +
      '<div class="score">' + fc.knownCount + '/' + fc.queue.length + '</div>' +
      '<div class="msg">「覚えた」にできた数だよ。おつかれさま！</div>' +
      (fc.laterIds.length
        ? '<button class="qnext" id="again">「まだ」の' + fc.laterIds.length + '語をもう一周</button>'
        : '') +
      '<button class="qnext" style="background:var(--green)" data-go="#/deck/' + esc(fc.deckId) + '">デッキにもどる</button>' +
      '</div>';
    bindCommon();
    const again = document.getElementById('again');
    if (again) again.addEventListener('click', () => renderCards(fc.deckId, fc.laterIds));
    return;
  }

  const w = fc.queue[fc.i];
  const g = groupOf(deck, w);
  const front =
    '<div class="word">' + esc(w.en) + '</div>' +
    ((w.kana || w.ipa) ? '<div class="kana">' + esc(w.kana || '') + (w.ipa ? ' ' + esc(w.ipa) : '') + '</div>' : '') +
    (w.star ? '<div class="star">' + stars(w.star) + '</div>' : '') +
    '<div class="taphint">タップで意味を見る</div>';
  const back =
    '<div class="word" style="font-size:22px">' + esc(w.en) + '</div>' +
    '<div class="mean">' + posBadge(w.pos) + esc(w.ja) + '</div>' +
    (w.exEn ? '<div class="ex">' + esc(w.exEn) + '<br><span class="ja">' + esc(w.exJa || '') + '</span></div>' : '') +
    (w.tip ? '<div class="tip">💡 ' + esc(w.tip) + '</div>' : '');

  app.innerHTML =
    topbar('フラッシュカード', '#/deck/' + fc.deckId) +
    '<div class="progresshead"><span>' + (fc.i + 1) + '/' + fc.queue.length + '</span>' +
    '<div class="bar"><i style="width:' + Math.round(fc.i / fc.queue.length * 100) + '%"></i></div>' +
    '<span>あと' + (fc.queue.length - fc.i) + '語</span></div>' +
    '<div class="fc" id="fcard">' + (fc.flipped ? back : front) + '</div>' +
    '<div class="fcbtns">' +
    '<button class="soundbtn" data-speak="' + esc(w.en) + '" style="min-width:54px">🔊</button>' +
    '<button class="btn-later" id="later">まだ</button>' +
    '<button class="btn-known" id="known">覚えた！</button>' +
    '</div>' +
    (g ? '<div class="note" style="text-align:center;margin-top:10px"><span class="groupbadge" style="color:' + esc(g.color || '#555') + ';background:' + esc(g.bg || '#eee') + '">' + esc((g.sym || '') + ' ' + (g.name || '')) + '</span></div>' : '');

  bindCommon();
  document.getElementById('fcard').addEventListener('click', () => {
    fc.flipped = !fc.flipped;
    fcShow();
  });
  document.getElementById('known').addEventListener('click', () => {
    setLearned(fc.deckId, w.id, true);
    fc.knownCount++;
    fc.i++; fc.flipped = false;
    fcShow();
  });
  document.getElementById('later').addEventListener('click', () => {
    setLearned(fc.deckId, w.id, false);
    fc.laterIds.push(w.id);
    fc.i++; fc.flipped = false;
    fcShow();
  });
}

/* ---------------- 赤シート ---------------- */

async function renderSheet(deckId) {
  let deck;
  try { deck = await getDeck(deckId); } catch (e) { renderError(e.message); return; }
  const pool = activePool(deck);
  if (!pool.length) {
    app.innerHTML = topbar('赤シート', '#/deck/' + deckId) +
      '<div class="empty">この条件の単語はありません。<br>はんい・フィルタを「ぜんぶ」に戻してみてね。</div>';
    bindCommon();
    return;
  }

  const rows = pool.map((w, i) =>
    '<div class="sheetrow">' +
    '<button class="soundbtn" data-speak="' + esc(w.en) + '">🔊</button>' +
    '<div class="en">' + esc(w.en) +
    (w.kana ? '<small>' + esc(w.kana) + '</small>' : '') + '</div>' +
    '<div class="ja" data-row="' + i + '">' + posBadge(w.pos) +
    '<span class="sheettext hidden-word">' + esc(w.ja) + '</span></div>' +
    '</div>'
  ).join('');

  app.innerHTML =
    topbar('赤シート', '#/deck/' + deckId) +
    '<div class="filterrow">' +
    '<button class="chip" id="hideall">ぜんぶかくす</button>' +
    '<button class="chip" id="showall">ぜんぶ見せる</button>' +
    '</div>' +
    '<div class="note" style="margin-bottom:10px">意味をタップするとチラ見できるよ。もう一度タップでかくす。</div>' +
    rows;

  bindCommon();
  app.querySelectorAll('.ja[data-row]').forEach(el => {
    el.addEventListener('click', () => {
      const t = el.querySelector('.sheettext');
      if (!t) return;
      if (t.classList.contains('hidden-word')) {
        t.classList.remove('hidden-word'); t.classList.add('peek');
      } else {
        t.classList.add('hidden-word'); t.classList.remove('peek');
      }
    });
  });
  document.getElementById('hideall').addEventListener('click', () => {
    app.querySelectorAll('.sheettext').forEach(el => { el.classList.add('hidden-word'); el.classList.remove('peek'); });
  });
  document.getElementById('showall').addEventListener('click', () => {
    app.querySelectorAll('.sheettext').forEach(el => { el.classList.remove('hidden-word'); el.classList.remove('peek'); });
  });
}

/* ---------------- 4択クイズ ---------------- */

let quiz = null; // {deckId, deck, qs, i, right, wrongWords, locked}

function pickQuizWords(deck, pool, n) {
  // まだ覚えていない・まちがいが多い単語を優先
  const scored = shuffle(pool).map(w => {
    const p = wordProg(deck.id, w.id);
    let s = 0;
    if (!p.learned) s += 2;
    if (p.wrong > p.right) s += 1;
    return { w, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, n).map(x => x.w);
}

function makeChoices(deck, word) {
  const others = deck.words.filter(w =>
    w.id !== word.id &&
    w.ja !== word.ja &&
    w.ja.indexOf(word.ja) < 0 &&
    word.ja.indexOf(w.ja) < 0
  );
  const seen = {};
  const distractors = [];
  for (const w of shuffle(others)) {
    if (seen[w.ja]) continue;
    seen[w.ja] = true;
    distractors.push(w.ja);
    if (distractors.length === 3) break;
  }
  return shuffle([word.ja].concat(distractors));
}

async function renderQuiz(deckId, onlyIds) {
  let deck;
  try { deck = await getDeck(deckId); } catch (e) { renderError(e.message); return; }
  let pool = activePool(deck);
  if (onlyIds) pool = deck.words.filter(w => onlyIds.indexOf(w.id) >= 0);
  if (deck.words.length < 4) {
    app.innerHTML = topbar('4択クイズ', '#/deck/' + deckId) +
      '<div class="empty">クイズを作るには最低4語必要だよ。</div>';
    bindCommon();
    return;
  }
  if (!pool.length) {
    app.innerHTML = topbar('4択クイズ', '#/deck/' + deckId) +
      '<div class="empty">この条件の単語はありません。<br>はんい・フィルタを「ぜんぶ」に戻してみてね。</div>';
    bindCommon();
    return;
  }
  // はんい指定中・まちがい再挑戦はプールをぜんぶ出題。通常は「まだ」優先の10問
  const qs = (onlyIds || rangeActive(deckId))
    ? shuffle(pool)
    : pickQuizWords(deck, pool, Math.min(10, pool.length));
  quiz = { deckId, deck, qs, i: 0, right: 0, wrongWords: [], locked: false };
  quizShow();
}

function quizShow() {
  const deck = quiz.deck;
  if (quiz.i >= quiz.qs.length) {
    const n = quiz.qs.length;
    const pct = Math.round(quiz.right / n * 100);
    app.innerHTML = topbar('4択クイズ', '#/deck/' + quiz.deckId) +
      '<div class="card qresult">' +
      '<div class="score">' + quiz.right + '/' + n + '</div>' +
      '<div class="msg">正答率 ' + pct + '%。' +
      (pct === 100 ? 'パーフェクト！すごい！' : pct >= 70 ? 'いい調子！' : 'まちがえた単語がのびしろだよ！') + '</div>' +
      (quiz.wrongWords.length
        ? '<button class="qnext" id="retrywrong">まちがえた' + quiz.wrongWords.length + '語をもう一度</button>'
        : '') +
      '<button class="qnext" id="retryall" style="background:var(--card);color:var(--ink);box-shadow:var(--shadow)">' + (rangeActive(quiz.deckId) ? 'はんい内をもう一回' : '新しい10問') + '</button>' +
      '<button class="qnext" style="background:var(--green)" data-go="#/deck/' + esc(quiz.deckId) + '">デッキにもどる</button>' +
      '</div>';
    bindCommon();
    const rw = document.getElementById('retrywrong');
    if (rw) rw.addEventListener('click', () => renderQuiz(quiz.deckId, quiz.wrongWords));
    document.getElementById('retryall').addEventListener('click', () => renderQuiz(quiz.deckId));
    return;
  }

  const w = quiz.qs[quiz.i];
  const choices = makeChoices(deck, w);
  quiz.locked = false;

  app.innerHTML =
    topbar('4択クイズ', '#/deck/' + quiz.deckId) +
    '<div class="progresshead"><span>' + (quiz.i + 1) + '/' + quiz.qs.length + '問</span>' +
    '<div class="bar quiz"><i style="width:' + Math.round(quiz.i / quiz.qs.length * 100) + '%"></i></div>' +
    '<span>正解 ' + quiz.right + '</span></div>' +
    '<div class="card">' +
    '<div class="note" style="text-align:center">この単語の意味は？</div>' +
    '<div class="qword">' + esc(w.en) + '</div>' +
    ((w.kana || w.ipa) ? '<div class="note" style="text-align:center">' + esc(w.kana || '') + (w.ipa ? ' ' + esc(w.ipa) : '') + '</div>' : '') +
    '<div style="text-align:center;margin-top:8px"><button class="soundbtn" data-speak="' + esc(w.en) + '">🔊</button></div>' +
    '</div>' +
    '<div class="choices">' +
    choices.map(c => '<button class="choice" data-ja="' + esc(c) + '">' + esc(c) + '</button>').join('') +
    '</div>' +
    '<div class="qfeedback" id="fb"></div>';

  bindCommon();
  app.querySelectorAll('.choice').forEach(btn => {
    btn.addEventListener('click', () => {
      if (quiz.locked) return;
      quiz.locked = true;
      const picked = btn.getAttribute('data-ja');
      const ok = picked === w.ja;
      recordAnswer(quiz.deckId, w.id, ok);
      if (ok) quiz.right++;
      else if (quiz.wrongWords.indexOf(w.id) < 0) quiz.wrongWords.push(w.id);
      app.querySelectorAll('.choice').forEach(b => {
        b.disabled = true;
        if (b.getAttribute('data-ja') === w.ja) b.classList.add('correct');
        else if (b === btn && !ok) b.classList.add('wrong');
      });
      speak(w.en);
      document.getElementById('fb').innerHTML =
        '<div class="card">' +
        '<div style="font-weight:700;color:' + (ok ? 'var(--green)' : 'var(--red)') + '">' +
        (ok ? '⭕ 正解！' : '❌ ざんねん… 正解は「' + esc(w.ja) + '」') + '</div>' +
        (w.exEn ? '<div class="ex" style="font-size:14px;margin-top:8px">' + esc(w.exEn) + '<br><span style="color:var(--sub);font-size:12px">' + esc(w.exJa || '') + '</span></div>' : '') +
        (w.tip ? '<div class="tip">💡 ' + esc(w.tip) + '</div>' : '') +
        '</div>' +
        '<button class="qnext" id="next">' + (quiz.i + 1 >= quiz.qs.length ? '結果を見る' : 'つぎへ') + '</button>';
      document.getElementById('next').addEventListener('click', () => { quiz.i++; quizShow(); });
      document.getElementById('next').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

/* ---------------- 空所クイズ（思い出しテスト） ---------------- */

let blank = null; // {deckId, deck, qs, i, right, wrongWords}

async function renderBlank(deckId, onlyIds) {
  let deck;
  try { deck = await getDeck(deckId); } catch (e) { renderError(e.message); return; }
  let pool = activePool(deck).filter(w => w.quizEn && w.quizAns);
  if (onlyIds) pool = pool.filter(w => onlyIds.indexOf(w.id) >= 0);
  if (!pool.length) {
    app.innerHTML = topbar('空所クイズ', '#/deck/' + deckId) +
      '<div class="empty">この条件の空所クイズはありません。<br>はんい・フィルタを「ぜんぶ」に戻してみてね。</div>';
    bindCommon();
    return;
  }
  // はんい指定中・思い出せなかった語の再挑戦はプールをぜんぶ出題
  const qs = (onlyIds || rangeActive(deckId))
    ? shuffle(pool)
    : pickQuizWords(deck, pool, Math.min(10, pool.length));
  blank = { deckId, deck, qs, i: 0, right: 0, wrongWords: [] };
  blankShow(false);
}

function blankShow(revealed) {
  if (blank.i >= blank.qs.length) {
    const n = blank.qs.length;
    app.innerHTML = topbar('空所クイズ', '#/deck/' + blank.deckId) +
      '<div class="card qresult">' +
      '<div class="score">' + blank.right + '/' + n + '</div>' +
      '<div class="msg">思い出せた数だよ。思い出そうとした回数だけ強くなる！</div>' +
      (blank.wrongWords.length
        ? '<button class="qnext" id="retrywrong">思い出せなかった' + blank.wrongWords.length + '語をもう一度</button>'
        : '') +
      '<button class="qnext" style="background:var(--green)" data-go="#/deck/' + esc(blank.deckId) + '">デッキにもどる</button>' +
      '</div>';
    bindCommon();
    const rw = document.getElementById('retrywrong');
    if (rw) rw.addEventListener('click', () => renderBlank(blank.deckId, blank.wrongWords));
    return;
  }

  const w = blank.qs[blank.i];
  app.innerHTML =
    topbar('空所クイズ', '#/deck/' + blank.deckId) +
    '<div class="progresshead"><span>' + (blank.i + 1) + '/' + blank.qs.length + '問</span>' +
    '<div class="bar quiz"><i style="width:' + Math.round(blank.i / blank.qs.length * 100) + '%"></i></div>' +
    '<span>できた ' + blank.right + '</span></div>' +
    '<div class="card">' +
    '<div class="note" style="text-align:center">空所に入る単語を思い出そう</div>' +
    '<div class="qsentence">' + esc(w.quizEn) + '</div>' +
    (w.ja && String(w.quizEn).indexOf(w.ja) < 0
      ? '<div class="qmean">' + posBadge(w.pos) + esc(w.ja) + '</div>'
      : '') +
    (revealed
      ? '<div class="qword" style="color:var(--green)">' + esc(w.quizAns) + '</div>' +
        '<div style="text-align:center"><button class="soundbtn" data-speak="' + esc(w.quizAns) + '">🔊</button></div>' +
        (w.tip ? '<div class="tip">💡 ' + esc(w.tip) + '</div>' : '')
      : '') +
    '</div>' +
    (revealed
      ? '<div class="note" style="text-align:center;margin-bottom:8px">思い出せた？（正直に！）</div>' +
        '<div class="selfbtns">' +
        '<button class="btn-later" id="no">まだだった</button>' +
        '<button class="btn-known" id="yes">できた！</button></div>'
      : '<button class="revealbtn" id="reveal">こたえを見る</button>' +
        '<div class="note" style="text-align:center;margin-top:10px">先に声に出してから答えを見ると効果バツグン！</div>');

  bindCommon();
  if (!revealed) {
    document.getElementById('reveal').addEventListener('click', () => blankShow(true));
  } else {
    document.getElementById('yes').addEventListener('click', () => {
      recordAnswer(blank.deckId, w.id, true);
      blank.right++; blank.i++; blankShow(false);
    });
    document.getElementById('no').addEventListener('click', () => {
      recordAnswer(blank.deckId, w.id, false);
      if (blank.wrongWords.indexOf(w.id) < 0) blank.wrongWords.push(w.id);
      blank.i++; blankShow(false);
    });
  }
}

/* ---------------- 単語リスト ---------------- */

const listFilter = {};
const listHideJa = {}; // deckId → true で「日本語を隠す」モード

async function renderList(deckId) {
  let deck;
  try { deck = await getDeck(deckId); } catch (e) { renderError(e.message); return; }
  const lf = listFilter[deckId] || 'all';
  const hide = !!listHideJa[deckId];
  let pool = applyRange(deck); // デッキメニューの「出題はんい」がリストにも効く
  if (lf === 'known') pool = pool.filter(w => wordProg(deckId, w.id).learned);
  if (lf === 'todo')  pool = pool.filter(w => !wordProg(deckId, w.id).learned);
  if (lf === 'star3') pool = pool.filter(w => (w.star || 0) >= 3);

  // デッキ全体の通し番号（はんいチップの「11-20」と対応）
  const numOf = {};
  deck.words.forEach((w, i) => { numOf[w.id] = i + 1; });

  const hideCls = hide ? ' hidden-word' : '';
  const chips = [
    ['all', 'ぜんぶ'], ['todo', 'まだ'], ['known', '覚えた'], ['star3', '★★★']
  ].map(([k, l]) =>
    '<button class="chip' + (k === lf ? ' on' : '') + '" data-lf="' + k + '">' + l + '</button>'
  ).join('') +
  '<button class="chip' + (hide ? ' on' : '') + '" id="hidetoggle">🟥 ' + (hide ? '日本語を見せる' : '日本語を隠す') + '</button>';

  const rows = pool.map(w => {
    const p = wordProg(deckId, w.id);
    const g = groupOf(deck, w);
    const answered = p.right + p.wrong;
    return '<div class="wrow">' +
      '<div class="head">' +
      '<button class="soundbtn" data-speak="' + esc(w.en) + '">🔊</button>' +
      '<div class="en">' + esc(w.en) +
      ((w.kana || w.ipa) ? '<span class="kana">' + esc(w.kana || '') + (w.ipa ? ' ' + esc(w.ipa) : '') + '</span>' : '') +
      '</div>' +
      '<button class="pill ' + (p.learned ? 'known' : 'later') + '" data-toggle="' + esc(w.id) + '">' +
      (p.learned ? '✓ 覚えた' : 'まだ') + '</button>' +
      '</div>' +
      '<div class="ja">' + posBadge(w.pos) + '<span class="hideable' + hideCls + '">' + esc(w.ja) + '</span></div>' +
      '<div class="meta">' +
      '<span>' + numOf[w.id] + '番</span> ' +
      (w.star ? '<span class="star">' + stars(w.star) + '</span> ' : '') +
      (g ? '<span class="groupbadge" style="color:' + esc(g.color || '#555') + ';background:' + esc(g.bg || '#eee') + '">' + esc((g.sym || '') + ' ' + (g.name || '')) + '</span> ' : '') +
      (answered ? '<span>クイズ ' + p.right + '勝' + p.wrong + '敗</span>' : '') +
      '</div>' +
      (w.exEn || w.tip
        ? '<details open><summary>例文・覚え方</summary>' +
          (w.exEn ? '<div style="margin-top:4px">' + esc(w.exEn) + ' <button class="soundbtn" style="font-size:14px" data-speak="' + esc(w.exEn) + '">🔊</button>' + (w.exJa ? '<br><span class="hideable' + hideCls + '" style="color:var(--sub);font-size:12px">' + esc(w.exJa) + '</span>' : '') + '</div>' : '') +
          (w.tip ? '<div class="tip">💡 ' + esc(w.tip) + '</div>' : '') +
          '</details>'
        : '') +
      '</div>';
  }).join('');

  app.innerHTML =
    topbar('単語リスト', '#/deck/' + deckId) +
    '<div class="filterrow">' + chips + '</div>' +
    (rows || '<div class="empty">この条件の単語はありません。</div>');

  bindCommon();
  app.querySelectorAll('[data-lf]').forEach(b => {
    b.addEventListener('click', () => {
      listFilter[deckId] = b.getAttribute('data-lf');
      renderList(deckId);
    });
  });
  document.getElementById('hidetoggle').addEventListener('click', () => {
    listHideJa[deckId] = !hide;
    renderList(deckId);
  });
  if (hide) {
    // 赤シートと同じ：タップでチラ見（黄色）、もう一度タップで隠す
    app.querySelectorAll('.hideable').forEach(el => {
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (el.classList.contains('hidden-word')) {
          el.classList.remove('hidden-word'); el.classList.add('peek');
        } else {
          el.classList.add('hidden-word'); el.classList.remove('peek');
        }
      });
    });
  }
  app.querySelectorAll('[data-toggle]').forEach(b => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-toggle');
      setLearned(deckId, id, !wordProg(deckId, id).learned);
      renderList(deckId);
    });
  });
}

/* ---------------- 設定 ---------------- */

function exportCode() {
  const payload = { schemaVersion: state.schemaVersion, decks: state.decks };
  const json = JSON.stringify(payload);
  return EXPORT_PREFIX + btoa(unescape(encodeURIComponent(json)));
}

function importCode(code) {
  const c = (code || '').trim();
  if (c.indexOf(EXPORT_PREFIX) !== 0) throw new Error('ひきつぎコードの形式がちがいます（ETG1. で始まるはず）');
  const json = decodeURIComponent(escape(atob(c.slice(EXPORT_PREFIX.length))));
  const data = JSON.parse(json);
  if (!data || data.schemaVersion !== 1 || typeof data.decks !== 'object') {
    throw new Error('コードの中身が読めませんでした');
  }
  return data;
}

function renderSettings() {
  const deckCount = Object.keys(state.decks).length;
  const wordCount = Object.values(state.decks)
    .reduce((n, d) => n + Object.keys(d.words || {}).length, 0);

  app.innerHTML =
    topbar('設定', '#/') +
    '<div class="card settings">' +
    '<h2>🔊 読み上げの速さ</h2>' +
    '<select id="rate">' +
    '<option value="0.6">ゆっくり</option>' +
    '<option value="0.9">ふつう</option>' +
    '<option value="1.1">はやめ</option>' +
    '</select>' +
    '<h2>📤 ひきつぎコード（進捗のバックアップ）</h2>' +
    '<div class="note">機種変更や、ブラウザ⇔ホーム画面アプリの引っこしに使うよ。コードをコピーして、新しい方の「読み込み」に貼り付けてね。</div>' +
    '<div class="btnrow"><button id="exp">コードを出す</button><button id="copy">コピー</button></div>' +
    '<textarea id="code" placeholder="ここにコードが出ます / 読み込むコードを貼り付けます"></textarea>' +
    '<div class="btnrow"><button id="imp">このコードを読み込む（上書き）</button></div>' +
    '<h2>🗑 データ</h2>' +
    '<div class="note">いま記録があるのは ' + deckCount + ' デッキ・' + wordCount + ' 語分。</div>' +
    '<div class="btnrow"><button id="wipe" style="color:var(--red)">全部の記録をリセット</button></div>' +
    '<h2>🔒 プライバシー</h2>' +
    '<div class="note">覚えた記録はこのスマホの中だけに保存されます。インターネットには送られません。<br>' +
    'いつも<strong>ホーム画面のアイコンから</strong>開くと記録が消えにくいよ。</div>' +
    '<div class="note" style="margin-top:12px">バージョン v' + APP_VERSION + '</div>' +
    '</div>';

  bindCommon();
  const rateSel = document.getElementById('rate');
  rateSel.value = String((state.settings && state.settings.rate) || 0.9);
  rateSel.addEventListener('change', () => {
    state.settings.rate = parseFloat(rateSel.value);
    saveState();
    speak('This is the new speed.');
  });
  document.getElementById('exp').addEventListener('click', () => {
    document.getElementById('code').value = exportCode();
    toast('コードを出しました');
  });
  document.getElementById('copy').addEventListener('click', () => {
    const ta = document.getElementById('code');
    if (!ta.value) ta.value = exportCode();
    ta.select();
    const done = () => toast('コピーしました。LINEのKeepメモなどに貼っておくと安心');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(done, () => { document.execCommand('copy'); done(); });
    } else {
      document.execCommand('copy'); done();
    }
  });
  document.getElementById('imp').addEventListener('click', () => {
    const ta = document.getElementById('code');
    try {
      const data = importCode(ta.value);
      const dn = Object.keys(data.decks).length;
      const wn = Object.values(data.decks).reduce((n, d) => n + Object.keys(d.words || {}).length, 0);
      if (confirm('コードには ' + dn + ' デッキ・' + wn + ' 語分の記録が入っています。\nいまの記録を上書きしますか？')) {
        state.decks = data.decks;
        saveState();
        toast('読み込みました！');
        go('#/');
      }
    } catch (e) {
      alert(e.message);
    }
  });
  document.getElementById('wipe').addEventListener('click', () => {
    if (confirm('全デッキの覚えた記録・クイズ成績を消します。本当にいいですか？')) {
      state = freshState();
      saveState();
      toast('リセットしました');
      go('#/');
    }
  });
}

/* ---------------- ルーター ---------------- */

async function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  window.scrollTo(0, 0);
  try {
    if (!parts.length) return await renderHome();
    if (parts[0] === 'settings') return renderSettings();
    if (parts[0] === 'deck' && parts[1]) {
      const id = parts[1];
      const mode = parts[2] || '';
      if (mode === 'cards') return await renderCards(id);
      if (mode === 'sheet') return await renderSheet(id);
      if (mode === 'quiz')  return await renderQuiz(id);
      if (mode === 'blank') return await renderBlank(id);
      if (mode === 'list')  return await renderList(id);
      return await renderDeckMenu(id);
    }
    return await renderHome();
  } catch (e) {
    renderError(e && e.message ? e.message : String(e));
  }
}

window.addEventListener('hashchange', route);
route();

/* ---------------- Service Worker（本番のみ） ---------------- */
/* ローカル開発（http.server）ではキャッシュ混乱を避けるため登録しない */
if ('serviceWorker' in navigator && location.hostname.slice(-9) === 'github.io') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
