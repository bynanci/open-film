# OpenFilm

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![Verify](https://github.com/bynanci/open-film/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bynanci/open-film/actions/workflows/ci.yml)
[![最新リリース](https://img.shields.io/github/v/release/bynanci/open-film)](https://github.com/bynanci/open-film/releases/latest)
[![ライセンス](https://img.shields.io/github/license/bynanci/open-film)](LICENSE)
[![ドキュメント](https://img.shields.io/badge/docs-online-2563eb)](https://bynanci.github.io/open-film/)

OpenFilm は、ローカルファーストのオープンソース映像編集ツールです。写真、動画、音声を整理し、ストーリーと編集可能な映像にまとめます。元のメディアは変更せず、クラウドアカウントも必要ありません。

## プロジェクトの状況

最新の正式安定版は **v0.4.0** です。main は未リリースの開発ブランチです。合意済みの **v1.0.0** の目標と残りのリリース条件は[リリース準備ロードマップ](docs/roadmap/v1-readiness.md)をご覧ください。配布可能なネイティブインストーラーはまだ提供していません。

## 主な機能

- ローカルメディアをプロジェクトに読み込み、ポータブルな SQLite カタログで整理します。
- ストーリーを組み立て、タイムラインを編集し、字幕や音声を追加して、変更を反映する前に確認できます。
- MP4、JSON、および対応する交換形式でプレビュー／書き出しができます。高度な OTIO エフェクトは他の編集ソフトで手動再作成が必要な場合があります。[互換性ガイド](docs/nle-compatibility.md)をご覧ください。
- Visual QA、コンタクトシート、書き出しレポートで保存済みの編集を確認し、参照メディアを持ち運べます。
- デスクトップワークフローと CLI を利用できます。任意の provider 連携は明示的に有効化し、基本機能に AI provider は不要です。

OpenFilm は個人のローカルワークステーション向けであり、マルチユーザー環境やインターネット公開用サービスではありません。ローカルサービスを外部公開する場合や plugin を確認する場合は、[セキュリティポリシー](SECURITY.md)をお読みください。

## ソースから実行

Node.js **24.14.0 以降**、pnpm **11.11.0**、FFmpeg、FFprobe が必要です。ネイティブデスクトップ shell の追加要件は[デスクトップガイド](apps/desktop/README.md)を参照してください。

    pnpm install --frozen-lockfile
    pnpm dev

ローカル開発ワークスペースとアプリケーションサービスが起動します。CLI を確認するには:

    pnpm cli --help

検証方法と各種テストコマンドは[コントリビューションガイド](CONTRIBUTING.md)にあります。これはソース開発の手順であり、一般ユーザー向けインストーラーではありません。

## ドキュメント

[公式ドキュメントサイト](https://bynanci.github.io/open-film/)は**繁体字中国語、英語、日本語**に対応しています。[制作フロー](docs/product-workflow.md)から始めるか、[ドキュメントマップ](docs/index.md)をご覧ください。

- 現在の状況：[ロードマップ](ROADMAP.md)、[v1.0.0 準備状況](docs/roadmap/v1-readiness.md)、[タスク一覧](TASKS.md)
- 設計とインターフェース：[アーキテクチャ](docs/architecture.md)、[プロジェクト形式](docs/project-format.md)、[統合契約](docs/CONTRACTS.md)
- 証拠：[リリースと検証記録](docs/index.md)
- 研究：[研究インデックス](research/README.ja.md)

## コミュニティ

- [コントリビューションガイド](CONTRIBUTING.ja.md) · [サポート](SUPPORT.ja.md)
- [行動規範](CODE_OF_CONDUCT.ja.md)
- [セキュリティ問題の報告](SECURITY.ja.md)
- [issue を作成](https://github.com/bynanci/open-film/issues/new/choose)

英語、繁体字中国語、日本語で報告できます。個人のメディア、プロジェクトデータベース、元ファイルのパス、GPS 情報、認証情報は添付しないでください。生成したテスト素材か、共有する権利を持つメディアをご利用ください。

## ライセンス

OpenFilm の第一者コードは [Apache-2.0](LICENSE) でライセンスされています。サードパーティのコンポーネントやメディアには個別のライセンス条件があります。[NOTICE](NOTICE) と[ライセンスガイド](docs/licensing.md)をご確認ください。
