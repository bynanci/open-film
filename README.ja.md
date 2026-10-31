# OpenFilm

[English](README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

[![Verify](https://github.com/bynanci/open-film/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bynanci/open-film/actions/workflows/ci.yml)
[![最新リリース](https://img.shields.io/github/v/release/bynanci/open-film)](https://github.com/bynanci/open-film/releases/latest)
[![ライセンス](https://img.shields.io/github/license/bynanci/open-film)](LICENSE)
[![ドキュメント](https://img.shields.io/badge/docs-online-2563eb)](https://bynanci.github.io/open-film/)

**写真、動画、音声から、編集を続けられるストーリーへ。**

OpenFilm は、ローカルファーストのオープンソース映像編集ツールです。散らばった素材の
整理、ストーリーの構成、ラフカットの作成、細かな編集まで、一つのプロジェクトで進められます。
元のメディアは変更せず、基本的な作業にクラウドアカウントや AI サービスは必要ありません。
対応する交換形式で、別の編集ソフトに引き継いで仕上げることもできます。

[ドキュメント](https://bynanci.github.io/open-film/ja/) ·
[ロードマップ](ROADMAP.md) ·
[開発に参加](CONTRIBUTING.ja.md)

## できること

- **素材を整理する。** ローカルのファイルやフォルダーを読み込み、メタデータ、重複素材や
  イベントの提案を確認し、選択内容をポータブルな SQLite カタログに保存します。
- **ストーリーを組み立てる。** 用意された構成や自分で書いたアウトラインから始め、
  Story Graph と Storyboard でアイデアを結び、素材を選び、尺の条件に沿ったラフカットを確認します。
- **編集を自分で決める。** 非破壊編集、ロック、元に戻す／やり直し、保存済みのプロジェクト
  バージョンを使って、クリップ、写真、タイトル、字幕、音声を調整します。
- **自動処理を確認する。** Pipeline の手順、変更案、クリエイティブバリアントを確認してから
  採用します。任意のローカル／リモート provider は設定して利用し、リモートへの送信には明示的な同意が必要です。
- **プレビューして書き出す。** MP4、静止画、音声を書き出すほか、対応する交換形式で
  編集可能なカットを引き継げます。Visual QA と書き出しレポートで制限を確認できます。
- **プロジェクトを持ち運ぶ。** 移動したソースを再リンクし、参照素材を収集できます。
  グラフィカルな画面、CLI、ローカル API が同じアプリケーションサービスを利用します。

これらは現在の開発ブランチの機能です。一連の操作は[制作フロー](docs/ja/product-workflow.md)、
外部編集ソフトへの引き継ぎの制限は [NLE 互換性ガイド](docs/nle-compatibility.md)をご覧ください。
一部のエフェクトは事前のレンダリング、または引き継ぎ先での手動再作成が必要です。

## プロジェクトの状況

| バージョン／配布形態                                               | 内容                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| [v0.4.0](https://github.com/bynanci/open-film/releases/tag/v0.4.0) | 最新の公開済み安定**ソースリリース**です。含まれる範囲は、その版のリリースノートをご確認ください。   |
| `main`                                                             | v1.0.0 に向けた開発ブランチで、公開済みリリース以降の変更を含みます。                                |
| ネイティブインストーラー                                           | まだ配布していません。ランタイムの同梱、署名、クリーン環境での検証がリリース要件として残っています。 |

[v1.0.0 準備ロードマップ](docs/roadmap/v1-readiness.md)で、残りの編集機能、ネイティブ配布の
要件、ワークステーション検証を追跡しています。実機での再生、音声、画面表示、NLE の確認は、
自動テストとは分けて記録しています。

現在の OpenFilm は、個人のローカルワークステーション向けです。ローカル API は
マルチユーザー環境やインターネット公開を想定したサービスではありません。対応範囲は
[セキュリティポリシー](SECURITY.ja.md)をご覧ください。

## ソースから実行する

### 必要な環境

- Git
- Node.js **24.14.0 以降**
- `package.json` に固定されている pnpm **11.11.0**
- `PATH` から実行できる FFmpeg と FFprobe

ブラウザーで動く開発ワークスペースに Rust は不要です。ネイティブシェルの開発に必要な
追加の環境は[デスクトップガイド](apps/desktop/README.ja.md)をご確認ください。

### 開発ワークスペースを起動する

```sh
git clone https://github.com/bynanci/open-film.git
cd open-film
pnpm install --frozen-lockfile
pnpm dev
```

ブラウザーで **[http://127.0.0.1:1420](http://127.0.0.1:1420)** を開きます。このコマンドは
ポート `4310` でローカルアプリケーションサービスを、`1420` でワークスペースを起動します。
利用中はターミナルを開いたままにしてください。映像を作成し、少量の素材を読み込んで、
**Library → Story → Edit → Export** の順に進めます。終了するには `Ctrl+C` を押します。

リポジトリのルートで CLI のヘルプを確認できます。

```sh
pnpm cli --help
```

上の手順は `main` を取得します。リリース済みの版を使う場合は、
[v0.4.0 のソースリリース](https://github.com/bynanci/open-film/releases/tag/v0.4.0)を選び、
その版の手順に従ってください。ソースからのビルドは、検証済みの一般ユーザー向け
インストーラーの作成を意味しません。

## ドキュメントを探す

| 目的                                             | 参照先                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 最初の映像を作る                                 | [はじめに](docs/ja/getting-started.md)、[制作フロー](docs/ja/product-workflow.md)、[ドキュメント索引](docs/ja/index.md)              |
| 再現可能なサンプルを試す                         | 生成素材を使う[プロポーズ映像の参考フロー](docs/reference-workflows/proposal-film.md)                                                |
| プロジェクトを移動する、別の編集ソフトに引き継ぐ | [メディアの可搬性](docs/ja/media-portability.md)、[Collect Media](docs/ja/collect-media.md)、[NLE 互換性](docs/nle-compatibility.md) |
| プロジェクトの方向性を知る                       | [プロジェクトのビジョン](docs/PROJECT_BRIEF.md)、[ロードマップ](ROADMAP.md)、[タスク一覧](TASKS.md)                                  |
| 実装に参加する                                   | [アーキテクチャ](docs/architecture.md)、[プロジェクト形式](docs/ja/project-format.md)、[統合契約](docs/CONTRACTS.md)                 |
| リリース準備や調査を確認する                     | [v1 準備状況](docs/roadmap/v1-readiness.md)、[検証記録の索引](docs/ja/index.md)、[調査インデックス](research/README.ja.md)           |

ユーザーガイドは英語、繁体字中国語、日本語で提供しています。技術リファレンスと検証記録は
主に英語で管理しています。翻訳範囲は[言語ポリシー](docs/ja/i18n.md)をご覧ください。

## コントリビューションとコミュニティ

<<<<<<< HEAD
不具合報告、ドキュメントの改善、翻訳、再現可能なメディア事例、コードの貢献を歓迎します。
環境設定、チェック、pull request の手順は[コントリビューションガイド](CONTRIBUTING.ja.md)から
始めてください。大きな変更は、discussion または issue で範囲と担当する既存コンポーネントを
相談してから進めると役立ちます。

- [質問やアイデアを話し合う](https://github.com/bynanci/open-film/discussions)
- [不具合の報告・機能の提案](https://github.com/bynanci/open-film/issues/new/choose)
- [サポート](SUPPORT.ja.md) · [行動規範](CODE_OF_CONDUCT.ja.md)
- [セキュリティ問題を非公開で報告する](SECURITY.ja.md)

英語、繁体字中国語、日本語で参加できます。報告には生成したテスト素材か、共有する権利を
持つメディアを使ってください。私的なメディア、プロジェクトデータベース、元ファイルのパス、
GPS 情報、認証情報は公開 issue に添付しないでください。

## ライセンスと任意のサービス

現在のローカル機能は無料で利用できます。OpenFilm の第一者ソースコードは
[Apache-2.0](LICENSE) でライセンスされ、条件に従った商用利用、変更、再配布が認められます。
帰属表示やサードパーティの条件は [NOTICE](NOTICE) と[ライセンスガイド](docs/licensing.md)を
ご確認ください。

Apache-2.0 は商用利用やフォークを認めています。ソースコードの利用条件と
公式プロジェクトのブランドは別の問題です。[ブランドポリシー](TRADEMARKS.md)、
[商用利用ガイド](COMMERCIAL.md)、[ガバナンス](GOVERNANCE.md)を参照してください。
これらの文書は Apache-2.0 の条件を変更しません。

任意の外部 AI サービスには別途料金がかかる場合があります。自分の API キーで provider を
設定すると、その利用料は提供元から請求され、OpenFilm に含まれるものではありません。
基本的なローカル作業にこれらのサービスは不要です。メディア、フォント、モデルの重み、
その他のサードパーティ素材には、それぞれのライセンスが適用されます。
