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

## ライセンス

例文はすべてこのプロジェクトのオリジナルです。
