# 英単語マスター

英検準2級レベルの英単語を学習するためのシンプルなウェブアプリ。

**アプリ:** https://sho-55.github.io/eitango-app/

## 機能

- 🃏 フラッシュカード（英語 → 意味、発音つき）
- 🟥 赤シートモード（意味をかくしてタップでチラ見）
- ✏️ 4択クイズ（まだ覚えていない単語を優先出題）
- 💭 空所クイズ（文の空所に入る単語を思い出す）
- 📖 単語リスト（★頻出度・例文・覚え方つき）
- 進捗（覚えた/まだ・正答率）はブラウザ内 localStorage に保存

## 技術

- 静的サイト（バニラ HTML / CSS / JavaScript、ビルド不要）
- 発音は Web Speech API
- オフライン対応（network-first Service Worker）
- 単語データは `decks/*.json`、一覧は `decks/index.json`

## デッキ検証

```
node tools/validate_deck.mjs
```

## 手動メンテナンス（AIツールを使わない場合）

このアプリは静的サイトなので、単語データは手作業でも追加できます。

### 単語を1語追加する

1. `decks/master-80.json` を開き、`words` 配列の**末尾**に既存エントリをコピーして書き換える。
   最小構成は3項目だけで動きます（他の項目は省略可）:
   ```json
   { "id": "example", "en": "example", "ja": "例", "pos": "名", "group": "4" }
   ```

   | 項目 | 必須 | 内容 |
   |---|---|---|
   | `id` | ✔ | 小文字英数とハイフン。**一度決めたら変えない**（学習記録のキー） |
   | `en` / `ja` | ✔ | 見出し語（原形）と意味 |
   | `pos` `kana` `ipa` `star` `group` | | 品詞・カタカナ読み・発音記号・頻出度(1-3)・グループ |
   | `exEn` `exJa` `tip` | | 例文と和訳・覚え方 |
   | `quizEn` `quizAns` | | 空所クイズ（空所は「頭文字+文字数分の `_`」。両方セットで） |

2. `decks/index.json` の `wordCount` を +1 する
3. 検証してから push する:
   ```
   node tools/validate_deck.mjs
   git add decks/ && git commit -m "Add word" && git push
   ```

- 単語は必ず**末尾に追加**（途中挿入すると学習画面の通し番号がずれる）
- 反映は push 後 最大10分

### push しても反映されないとき

Pages のビルドが稀に一時エラーになります。再ビルドを要求してください:

```
gh api -X POST repos/sho-55/eitango-app/pages/builds
```

（または GitHub の Actions タブ → 失敗した "pages build and deployment" → Re-run all jobs）

## ライセンス

例文はすべてこのプロジェクトのオリジナルです。
