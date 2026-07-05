#!/usr/bin/env node
/* デッキ検証 — デプロイ前に必ず実行する
 * 使い方: node tools/validate_deck.mjs
 * decks/index.json と全デッキJSONを検証。エラーがあれば exit 1。
 * 旧 build_materials.py の検証ルールを移植:
 *  - クイズ空所は quizAns から機械生成した形（頭文字+アンダースコア）と厳密一致
 *  - 見出し語の原形チェック（名詞複数形/動詞過去形の疑い → 警告）
 *  - 例文は13語以内（中1が読める長さ）
 *  - ja の完全重複は4択クイズの正解一意性を壊すのでエラー
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECKS = path.join(ROOT, 'decks');

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const skel = (a) =>
  String(a).trim().split(/\s+/).map((w) => w[0] + '_'.repeat(w.length - 1)).join(' ');

const normJa = (s) =>
  String(s).replace(/[〜～]/g, '').replace(/^(を|に|が|の|で|へ|と)/, '')
    .replace(/[・、。（）()\s]/g, '');

// 動詞 -ed で終わるが原形である語（旧スクリプトから移植）
const ED_OK = new Set(['need','feed','exceed','succeed','proceed','bleed','speed','seed','shed','embed','wed']);
const S_OK = new Set(['news','bus','class','glass','grass','pass','cross','miss','kiss','dress','address','business','chess','boss','gas','plus','tennis','virus','focus','campus','christmas']);

async function main() {
  // index.json
  let index;
  try {
    index = JSON.parse(await readFile(path.join(DECKS, 'index.json'), 'utf8'));
  } catch (e) {
    err(`decks/index.json が読めない: ${e.message}`);
    return report();
  }
  if (index.schemaVersion !== 1) err('index.json: schemaVersion は 1');
  if (!Array.isArray(index.decks)) { err('index.json: decks が配列でない'); return report(); }

  const filesOnDisk = (await readdir(DECKS)).filter((f) => f.endsWith('.json') && f !== 'index.json');
  const filesInIndex = new Set(index.decks.map((d) => d.file));
  for (const f of filesOnDisk) if (!filesInIndex.has(f)) warn(`decks/${f} は index.json に載っていない（アプリに出ない）`);

  const seenDeckIds = new Set();
  for (const meta of index.decks) {
    const label = `index[${meta.id ?? '?'}]`;
    for (const k of ['id', 'file', 'title', 'wordCount']) {
      if (meta[k] === undefined || meta[k] === '') err(`${label}: ${k} が欠損`);
    }
    if (meta.id && !/^[a-z0-9-]+$/.test(meta.id)) err(`${label}: デッキidは小文字英数とハイフンのみ（GitHub Pagesは大文字小文字を区別）`);
    if (meta.id && seenDeckIds.has(meta.id)) err(`${label}: デッキid重複`);
    seenDeckIds.add(meta.id);
    if (meta.file !== `${meta.id}.json`) err(`${label}: file は "<id>.json" にする（現在 ${meta.file}）`);

    let deck;
    try {
      deck = JSON.parse(await readFile(path.join(DECKS, meta.file), 'utf8'));
    } catch (e) {
      err(`${label}: ${meta.file} が読めない: ${e.message}`);
      continue;
    }
    validateDeck(deck, meta);
  }
  report();
}

function validateDeck(deck, meta) {
  const L = `deck[${deck.id ?? meta.id}]`;
  if (deck.schemaVersion !== 1) err(`${L}: schemaVersion は 1`);
  if (deck.id !== meta.id) err(`${L}: デッキ内 id (${deck.id}) と index の id (${meta.id}) が不一致`);
  if (!deck.title) err(`${L}: title が欠損`);
  if (!Array.isArray(deck.words) || !deck.words.length) { err(`${L}: words が空`); return; }
  if (deck.words.length !== meta.wordCount) err(`${L}: wordCount 不一致（index=${meta.wordCount} / 実際=${deck.words.length}）`);
  if (deck.words.length < 4) err(`${L}: 4択クイズには最低4語必要（現在${deck.words.length}語）`);
  else if (deck.words.length < 12) warn(`${L}: ${deck.words.length}語と少なめ（クイズの選択肢が単調になりがち）`);

  const groupKeys = new Set((deck.groups || []).map((g) => g.key));
  const seenIds = new Set();
  const seenEn = new Set();
  const jaMap = new Map();

  for (const w of deck.words) {
    const W = `${L} "${w.en ?? w.id ?? '?'}"`;
    for (const k of ['id', 'en', 'ja']) {
      if (!w[k] || !String(w[k]).trim()) err(`${W}: ${k} が欠損`);
    }
    if (w.id && !/^[a-z0-9-]+$/.test(w.id)) err(`${W}: 単語idは小文字英数とハイフンのみ（現在 "${w.id}"）`);
    if (w.id && seenIds.has(w.id)) err(`${W}: 単語id重複`);
    if (w.id) seenIds.add(w.id);
    const enKey = String(w.en || '').toLowerCase();
    if (seenEn.has(enKey)) err(`${W}: 見出し語の重複`);
    seenEn.add(enKey);

    // ja 重複（4択の正解一意性）
    if (w.ja) {
      if (jaMap.has(w.ja)) err(`${W}: 意味 "${w.ja}" が "${jaMap.get(w.ja)}" と完全重複（4択の正解が一意に決まらない）`);
      else jaMap.set(w.ja, w.en);
    }

    // 原形チェック（疑いは警告）
    const en = String(w.en || '');
    const pos = String(w.pos || '');
    if (pos.startsWith('名') && /[^aeiou]s$/.test(en) && !S_OK.has(en)) warn(`${W}: 名詞が複数形の疑い（原形=単数で）`);
    if (pos.startsWith('動') && en.endsWith('ed') && !ED_OK.has(en)) warn(`${W}: 動詞が過去形の疑い（原形で）`);

    // 例文
    if (w.exEn) {
      const n = (String(w.exEn).match(/[A-Za-z']+/g) || []).length;
      if (n > 13) err(`${W}: 例文が${n}語（中1が読める13語以内に）`);
      if (!w.exJa) warn(`${W}: 例文の和訳 exJa がない`);
    }

    // 空所クイズ
    if (w.quizEn || w.quizAns) {
      if (!w.quizEn || !w.quizAns) {
        err(`${W}: quizEn と quizAns は両方セットで入れる`);
      } else {
        const expected = skel(w.quizAns);
        const q = String(w.quizEn);
        if (q.includes(' = ')) {
          const right = q.split(' = ').slice(1).join(' = ').trim().replace(/（.*$/, '').trim();
          if (right !== expected) err(`${W}: 空所スケルトン不一致。期待: "${expected}" / 実際: "${right}"`);
        } else if (!q.includes(expected)) {
          err(`${W}: quizEn に "${expected}"（quizAns から自動生成した空所）が含まれていない`);
        }
      }
    }

    if (w.star !== undefined && ![1, 2, 3].includes(w.star)) err(`${W}: star は 1〜3 の数値`);
    if (w.group !== undefined && !groupKeys.has(w.group)) err(`${W}: group "${w.group}" が deck.groups に無い`);

    // HTMLタグ混入
    for (const [k, v] of Object.entries(w)) {
      if (typeof v === 'string' && /<[a-z/!]/i.test(v)) err(`${W}: ${k} にHTMLタグらしき文字列（<）が混入`);
    }
  }

  // 4択の誤答候補数（アプリの除外条件＝完全一致・部分包含を適用した後で3個以上あるか）
  for (const w of deck.words) {
    if (!w.ja) continue;
    const cand = new Set();
    for (const o of deck.words) {
      if (o === w || !o.ja) continue;
      if (o.ja === w.ja || o.ja.includes(w.ja) || w.ja.includes(o.ja)) continue;
      cand.add(o.ja);
    }
    if (cand.size < 3) warn(`${L} "${w.en}": 4択の誤答候補が${cand.size}個しかない（意味の近い語が多い/デッキが小さい）`);
  }

  // ja の準重複（助詞ゆらぎ）
  const seenNorm = new Map();
  for (const w of deck.words) {
    if (!w.ja) continue;
    const key = normJa(w.ja);
    if (!key) continue;
    if (seenNorm.has(key) && seenNorm.get(key) !== w.ja) {
      warn(`${L}: 意味が紛らわしい可能性 「${seenNorm.get(key)}」と「${w.ja}」（4択で並ぶと迷う）`);
    }
    seenNorm.set(key, w.ja);
  }
}

function report() {
  for (const w of warns) console.log('  ⚠', w);
  for (const e of errors) console.log('  ✖', e);
  if (errors.length) {
    console.log(`\n検証NG: エラー${errors.length}件 / 警告${warns.length}件 — 修正してから再実行`);
    process.exit(1);
  }
  console.log(`\n検証OK（警告${warns.length}件）`);
}

main();
