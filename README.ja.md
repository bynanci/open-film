# OpenFilm

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

OpenFilm は、ストーリーを中心に設計されたオープンソースのローカルファーストなメディア編集ツールです。ローカルの写真、動画、音声を整理し、思い出やストーリー、編集可能な映像にまとめます。元ファイルは変更しません。

## 機能概要

Vue デスクトップワークスペース、CLI、ローカル Node サービス、SQLite プロジェクトデータベースで構成され、クラウドアカウントや AI サービスは不要です。UI は繁体字中国語、英語、日本語に対応し、UI 言語と作品の言語は個別に設定できます。

素材の取り込み、ライブラリ整理、ストーリー作成、タイムライン編集、プレビュー、書き出しまでを扱います。写真や動画の編集、速度・音量調整、音楽・ナレーション・字幕の追加、名前付きバージョンの保存、移動した素材の再リンクができます。ストーリーグラフ（Story Graph）によるマルチ視点表示、絵コンテ提案（StoryPlan）、ガイド付きパイプライン（Guided Pipeline）、変更影響分析と増分実行（Incremental Runs）、クリエイティブ派生案（Creative Variants）の A/B レビューにも対応しています。MP4 のほか、対応する場合は JSON、OpenTimelineIO、FCPXML、EDL、PNG、WAV、音声ステムを出力できます。

素材の出所とプロジェクトデータを保持し、文字起こし、外部言語サービス、メディア再リンク、互換性検証について状態と制限を明示します。元メディアは書き換えません。

## はじめ方

Node.js 24.14.0 以降、pnpm 11.11.0、FFmpeg、FFprobe が必要です。依存関係をインストール後、基本的な作業はローカルで実行できます。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

CLI の例、詳細な機能、互換性、検証内容は[英語版 README](README.md)を参照してください。ドキュメントサイトは[繁体字中国語](https://bynanci.github.io/open-film/)、[English](https://bynanci.github.io/open-film/en/)、[日本語](https://bynanci.github.io/open-film/ja/)に対応しています。
