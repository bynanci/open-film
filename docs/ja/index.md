---
layout: home

hero:
  name: OpenFilm
  text: 素材から物語へ、そして一本の映画へ
  tagline: オープンソースのローカルファースト・メディアエディター。写真、動画、録音を整理し、物語を組み立て、元の素材を保ちながら編集・書き出しできます。
  actions:
    - theme: brand
      text: 導入と使い始め方
      link: /ja/getting-started
    - theme: alt
      text: 最初の映画を制作する
      link: /ja/product-workflow
    - theme: alt
      text: GitHub
      link: https://github.com/bynanci/open-film

features:
  - title: ローカルファースト
    details: 基本的な制作にクラウドアカウントは不要です。プロジェクトと素材はローカルで管理し、任意のリモートサービスは設定とデータ送信への同意後に利用します。
  - title: 物語から始める
    details: 思い出を整理し、大切な素材を選び、段落を構成してから編集可能なカットを作成します。
  - title: 確認してから反映
    details: 提案をプレビューし、変更を確認して編集を進められます。元の写真、動画、録音は書き換えません。
  - title: 持ち運べる作品
    details: 再生できる MP4 を出力し、対応する交換形式やメディアパッケージで他のツールでも制作を続けられます。
---

## 現在の提供状況

公開済みの最新安定版は **v0.4.0** です。`main` は未リリースの開発版で、このサイトには新しい機能の説明も含まれます。配布可能なネイティブデスクトップインストーラーはまだありません。[スタートガイド](getting-started.md)に従ってソースコードから起動してください。リリースごとの差は [GitHub Releases](https://github.com/bynanci/open-film/releases)、今後の方向性は [Roadmap](https://github.com/bynanci/open-film/blob/main/ROADMAP.md)で確認できます。

## 目的から探す

| やりたいこと                           | 最初に読むページ                                                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自分のコンピューターで起動する         | [必要環境、起動、最初の映画](getting-started.md)                                                                                                          |
| 一本の映画を完成させる                 | [素材追加 → 整理 → ストーリー → 編集 → 書き出し](product-workflow.md)                                                                                     |
| 素材を利用できるか確認する             | [カメラソースとプレビューの制限](source-support.md)                                                                                                       |
| プロジェクトを移動し、素材を再接続する | [メディアの移動と再リンク](media-portability.md)、[Collect Media](collect-media.md)                                                                       |
| 問題を相談し、開発に参加する           | [サポート](https://github.com/bynanci/open-film/blob/main/SUPPORT.ja.md)、[貢献ガイド](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.ja.md) |

## ユーザーガイド

### ストーリーと編集

[ストーリーテンプレート](creative-story-templates.md)、[精密編集](precision-editing.md)、[マーカーとスナップ](markers-and-snapping.md)、[音声品質](audio-quality.md)、[独立した音声タイミング](audio-policy.md)では操作と制限を説明します。必要に応じて[字幕](../en/composition-captions.md)、[文字起こし編集](../en/transcript-editing.md)、[ローカルプリセット](../en/local-presets.md)、[名前付きバージョン](../en/named-versions.md)も参照してください。

### 書き出しと仕上げ

[MP4 圧縮品質](export-quality.md)で出力設定を選び、[Collect Media](collect-media.md)で持ち運べる素材をまとめられます。他の編集ソフトへ移る前に [NLE 引き渡しガイド](../en/nle-handoff.md)と[互換性ガイド](../en/nle-compatibility.md)を確認してください。交換形式ですべての効果が編集可能なまま維持されるわけではありません。

## 利用範囲と制限

OpenFilm は、一人のユーザーが使うローカルワークステーション向けに設計されています。基本的な取り込み、ストーリー整理、編集、書き出しに AI は不要です。任意のローカルモデルには追加設定が必要で、リモートプロバイダーは明示的な有効化、データ送信への同意、各サービスの利用料金を伴います。[文字起こしの設定](../en/transcription.md)と[音声生成](../en/provider-generation.md)を参照してください。

カメラ形式、ハードウェア性能、外部編集ソフトとの互換性には個別の条件があります。機能が利用できない場合は対応するガイドを確認してください。開発中の項目と未完了のリリース条件は [v1.0.0 の準備状況](../en/roadmap/v1-readiness.md)にまとめています。

## 開発、検証記録、コミュニティ

コードは [Apache-2.0](https://github.com/bynanci/open-film/blob/main/LICENSE) で公開されています。[アーキテクチャ](../en/architecture.md)、[プロジェクト形式](project-format.md)、[統合契約](../en/CONTRACTS.md)から設計を確認できます。開発環境、チェック、変更の提出手順は[貢献ガイド](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.ja.md)をご覧ください。

ロードマップ、研究、検証記録は、方向性、仮説、実行結果をそれぞれ保存しています。サイドバーの検証記録には、実行時のプラットフォーム、commit、テスト結果、未完了の手動確認を記載し、結果の評価と再現に利用できます。

主要なユーザーガイドは繁体字中国語、英語、日本語の保存済みページを提供します。一部の技術資料と過去の検証記録は英語で管理しています。[ドキュメントの言語方針](i18n.md)も参照してください。不具合報告、文書改善、翻訳、コードの貢献を歓迎します。報告には公開可能な再現素材を使用し、私的な映像、元ファイルのパス、認証情報を含めないでください。
