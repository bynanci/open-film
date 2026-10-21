# OpenFilm プロジェクト形式

.openfilm プロジェクトはディレクトリです。プロジェクト schema 1.0.0 と OpenFilm アプリのリリース 0.1.0 は別々に管理されます。プロジェクトはソースメディアをローカルの file URI で参照します。ネイティブのファイル／フォルダー取り込みは元ファイルをその場所で参照します。ブラウザーで選択したファイルは元のローカルパスが公開されないため、選択したバイト列をプロジェクト管理下の sources/ にコピーします。どちらの方法でも元ファイルを変更しません。

機械可読な契約は[プロジェクト schema](https://github.com/bynanci/open-film/blob/main/schemas/openfilm-project-1.0.0.schema.json)、[メディア資産 schema](https://github.com/bynanci/open-film/blob/main/schemas/media-asset-1.0.0.schema.json)、[プラグイン manifest schema](https://github.com/bynanci/open-film/blob/main/schemas/plugin-manifest-1.schema.json)で公開しています。

```text
film.openfilm/
  project.json
  database.sqlite
  story/                  将来の独立した Story 文書用
  timeline/               将来の独立した Composition 文書用
  analysis/
    events.json
    duplicates.json
  sources/                ブラウザーコピーまたはハッシュ名のメディア
  fonts/                  パッケージ内のハッシュ名フォント
  collect-manifest.json   パッケージのハッシュ、範囲、権利記録のみ
  versions/               不変の名前付きスナップショットと非公開索引
    index.json            変更可能なラベルと冪等性記録のみ
    <version-id>/
      project.json        保存時の schema 1.0.0 manifest
      database.sqlite     SQLite 整合性のあるカタログ画像
      record.json         不変の版 ID とソースハッシュ
  cache/
    thumbnails/
    proxies/
    preview.mp4
    export-preview/       短期の非公開プロファイルフレーム PNG キャッシュ
    export-work/          非公開の MP4／PNG／WAV レンダー作業領域
  exports/
    timeline.json | timeline.otio | timeline.fcpxml | timeline.edl
    timeline.<format>.report.json
    film-<unique-id>.mp4  再生可能な完成版
    still-<request-id>.png + manifest
    mix-<request-id>.wav + manifest
    stems-<request-id>/   アライン済み役割別 WAV と manifest
```

SQLite には database.sqlite-wal と database.sqlite-shm が同時に存在する場合があります。分析、キャッシュ、書き出しファイルは処理に応じて生成されます。現在 Story とタイムラインは project.json に保存されています。予約済みディレクトリを作成しても、独立した正規文書がそこにあるわけではありません。

プロファイル出力は派生ファイルです。版管理された Export Profile とレシートは、出力寸法、フレーム／時間またはサンプル測定値、ソースハッシュ、警告を記録します。Composition／プロジェクト設定や schema 1.0.0 は変更しません。[書き出しプロファイル](/export-profiles)をご覧ください。非公開プレビューは期限切れ後に再生成できます。出力した静止画や WAV は、ユーザーが削除するまで exports/ に残ります。

## Manifest とカタログ

project.json には schemaVersion、id、title、ISO 形式の createdAt／updatedAt、mediaLibraries、stories、timelines、settings が入ります。各ライブラリは ID、URI、表示名を持ちます。settings は幅、高さ、フレームレートを含み、新規プロジェクトの初期値は 1920 × 1080、30 fps です。Story は候補／選択メディア ID を参照し、Composition はカタログのメディア ID を参照するトラックとクリップを含みます。

Composition には追加の graphicScenes を含められます。シーンはルート Image ノードに結び付いた PhotoDepth v1 レシピを持つ場合があります。ソース、アルファマスク、任意の背景は、コンテンツハッシュを持つ通常のローカルカタログ資産です。この拡張でも schema 1.0.0 は変わりません。シーンや PhotoDepth のない旧プロジェクトに移行は不要で、派生画像のバイト列を project.json に埋め込みません。

任意の projectContentLocale（en-US、zh-TW、ja-JP）と filmSettings（templateId、targetDuration、maxDuration）は新しい映画の初期値を記録し、Story 自体は作りません。Story 単位の上書きも可能です。テンプレートビートには templateBeatKey、titleSource、intentSource を付けられます。映画の言語変更で更新するのはテンプレート所有と明示されたフィールドだけです。由来情報のない既存テキストはそのまま保持します。これらの追加フィールドも schema 1.0.0 を維持し、カタログ移行は不要です。UI の言語とテーマはプロジェクト外のローカル設定です。

manifest は検証してから一時ファイルとのアトミック置換で保存します。カタログは SQLite schema PRAGMA user_version=2、WAL モード、一覧用インデックス、拡張可能な資産情報用 JSON 記述子を使用します。version 1 から version 2 への移行では、文字起こしの revision／segment テーブル、派生分析キャッシュ、ソースに結び付いた手動マーカーを追加し、原子的に移行します。既存の資産／ジョブ記述子を保ち、失敗時はロールバックします。大きな文字起こしは上限付きの segment ページを使い、単語を各 segment とともに保存します。manifest schema は 1.0.0 のままです。ユーザー設定のパッチはソース記述子を保ちながら評価／状態／タグを変更します。将来のカタログ schema は拒否します。整合性を守るため ProjectCatalog 経由でアクセスし、任意の SQL 変更は避けてください。

プロジェクトフォルダーをファイルバックアップとしてコピーするときは、アプリを閉じてください。稼働中のカタログには SQLite 対応のバックアップツールを使います。ソースメディアは別途バックアップしてください。manifest だけではカタログ設定を保持できず、見つからない元ファイルにもアクセスできません。

ジョブには従来の URI／段階／メッセージ診断に加え、安定したエラー code、文字列／数値 params、ローカライズされた復旧案内に使う detail も保存できます。

## メディア記述子と編集

資産は ID、URI、名前、種類、タグ、状態、拡張可能な名前空間付きメタデータ、任意の技術／撮影／ハッシュ／キャッシュ情報を持ちます。撮影時刻の解釈結果は metadata["openfilm.timestamp"] に保存し、元の値、ソース、信頼度、タイムゾーン、不確かさを記録します。タイムゾーンなしの撮影時刻は確定した UTC ではなく、信頼度を下げた壁時計 UTC として表します。

プラグインの衝突を避けるため、追加メタデータには openfilm.audio.transcript のような名前空間を使います。サムネイルとプロキシは派生キャッシュであり、元の資産 URI の代わりにはなりません。外部ファイルが変わった後で再取り込みすると、再ハッシュ／再検査しますが、既存のカタログ ID と設定は維持します。ソース URI から導いた ID は再リンク後も安定します。再リンク済み資産が古いソースパスを使っている場合、そこに別ファイルを置くと別の ID を作ります。

sourceIn、sourceOut、timelineStart、timelineDuration、Story の尺はすべて秒です。変形、音量／速度、タイトル、トランジションは処理内容を記述し、ソースを変更しません。カタログ、ビート候補／選択、タイムラインクリップ間で ID を一致させる必要があります。任意の Clip.locked は保護状態を保存し、schema 1.0.0 のままです。手動編集で Story の最大時間を超えた場合は、レンダリング前にタイムラインを短くしてください。Undo／Redo 履歴は編集中のセッションにだけ属し、保存されません。

## ポータブルなソース参照とキャッシュ

現在の資産 URI は絶対ローカル file URI です。再リンクはアプリ、HTTP API、デスクトップから利用できます。ポータブルな由来情報は既存の metadata["openfilm.reference"] 拡張に保存します。

- originalUri：最初の取り込み場所。再リンク後も保持します。
- contentHash、fileSize：任意の SHA-256 識別子とバイトサイズ。
- filename、mediaLibraryId、relativePath：ソース名とライブラリ内の相対位置。
- volumeId：安定した論理 ID。OS のディスク識別子ではありません。
- rootUri：現在のソースライブラリのルートまたはマウントパス。

再リンクでは資産 ID、ユーザーメタデータ、評価、ロック、ストーリー、クリップ編集を維持します。更新前に候補ファイルを再確認し、選択したカタログ行を単一 SQLite トランザクションで更新します。既知のハッシュ不一致は上書きできません。相対パス、ファイル名／サイズ、旧形式の手動照合には確認が必要です。旧形式の置換候補はメディアの種類と元の尺の制約にも合う必要があります。現在のルートはカタログ参照メタデータに保存します。再リンクで project.json と SQLite をまたぐトランザクションや、manifest の元ライブラリ URI 書き換えは必要ありません。

新しいサムネイル／プロキシ参照はプロジェクト相対の cache/... を使います。移動したプロジェクトを再度開くと、アプリ生成キャッシュの命名規則に一致する旧形式の絶対参照を復元します。元ソースは外部にあるので再リンクが必要な場合があります。ソースの有無とライブラリ利用状態は保存済み編集リビジョンとは別に実行時に確認します。物理ボリュームの自動検出は未実装です。照合や再マウントの制約は[メディアの移動](/ja/media-portability)と[再リンク契約](../RELINK_CONTRACTS.md)をご覧ください。

## 名前付きバージョン

任意の versions/ ディレクトリはアプリ管理データであり、schema 1.0.0／カタログ schema v5 の一部ではありません。存在しないプロジェクトも通常どおり開けます。バージョン作成ではカタログ書き込みを止め、保存済み manifest と上限付きカタログ画像を取得します。準備と公開の前に SQLite schema、整合性、外部キーを検証します。スナップショットのメタデータとハッシュはソースメディアをコピーせず、API／CLI 記録から絶対 URI を公開しません。名前と説明は索引に置き、保存済みバージョンを書き換えず変更できます。保存領域には件数とバイト数の明示的な上限があり、古い版を勝手に削除しません。

復元前に選択した manifest／カタログ／ソース指紋、現在の revision、ロックを検証し、先に名前付きの復旧チェックポイントを作ります。manifest の公開はカタログ復元トランザクション内で行います。起動時に中断を検出すると、小さな非公開ジャーナルでチェックポイントに戻します。現在の manifest とカタログを一緒に置き換え、エディタースナップショットを無効化します。キャッシュ／書き出し／元メディアは復元せず、セッションの Undo／Redo にもなりません。詳しくは[名前付きバージョン](/named-versions)をご覧ください。

ブラウザー管理コピーは検証済みソース相対パスと以前の管理 URI を openfilm.managedSource に記録します。プロジェクト移動時に再配置するのは、現在も管理対象ソースを指す資産だけです。明示的に外部ファイルへ再リンクしたものは外部参照のままです。ID と元の由来情報も維持します。ソースパスは sources/ 内に限定し、プロジェクトキャッシュや任意メタデータのパスを管理メディアとして読み込みません。

Collect Media パッケージも同じ管理対象ソース境界を使います。任意の collect-manifest.json には選択した Story／Composition、相対パス、内容ハッシュ／サイズ、必要なフォント紐付け、明示的な権利宣言、元 URI のダイジェストを記録します。カタログには参照された資産と選択された文字起こしだけを残し、無関係なライブラリ資産、キャッシュ、ジョブ、プロバイダー資格情報、名前付きバージョンのスナップショットは含みません。同じソースバイト列は sources/<ハッシュ接頭辞>/ に一度だけ保存します。資産 URI は不透明で一意のまま、openfilm.managedSource.relativePath が共有ファイルを示します。fonts/ のフォントと解決情報は、ハッシュで確認します。これらの記録は schema 1.0.0／カタログ schema v5 の外にあり、従来のプロジェクトもこれまでどおり開きます。ディレクトリ／ZIP と Verify の詳細は[Collect Media](/ja/collect-media)をご覧ください。

## 検証と移行

validateProject は現在の schema と構造／値の制約を確認します。migrateProject は現行 1.0.0 と、同じ v1 フィールド名を持つ文書化済みの 0.1.0 草案をサポートします。草案に settings がなければ 1920 × 1080／30 fps を追加します。入力を変更したり、バージョンなし／未知形式を推測したりはしません。未知の将来版は明確なエラーで拒否します。

草案を開くとメモリー上で移行し、保存または終了時に現在の manifest を保存します。元メディアは schema 移行の対象ではありません。形式移行を含む版で開く前にバックアップしてください。

## タイムライン交換

JSON 書き出しには schema バージョン、完全な Composition、参照資産、設定が入ります。OTIO はネイティブの Timeline／Stack／Track／Clip／Gap オブジェクトを使い、カット配置、現在のソース file URI、静止画の表示時間、音声、1x のソース範囲を表します。速度、音量／ミュート、変形、タイトル、クロスフェード、クリップロックなどの高度な編集は OpenFilm メタデータに保持し、明示的な警告を付けます。NLE のネイティブエフェクトには変換しません。元のクリップ項目と Composition 全体を埋め込みます。速度変更クリップでは速度変更前のネイティブ抜粋を使い、記録上の位置を保つ必要があればラベル付きの埋め草 Gap を追加します。メタデータを見て NLE 側で速度編集を手動再構成してください。同一トラック内の重複は拒否します。

アプリは警告を返し、隣に timeline.<format>.report.json を書きます。OTIO にも互換性レポートを埋め込みます。FCPXML と EDL は限られたカット形式のみで、高度な未対応操作を拒否します。完全なモデルを書き出す形式は JSON です。公式 OTIO パーサーで読み取り／書き込み／再読み取りできても、実際の NLE 動作を証明するものではありません。DaVinci Resolve の読み込みと再生は未検証です。対応機能、メタデータ位置、手動確認手順は[NLE 互換性](/nle-compatibility)をご覧ください。

## ネイティブインストーラーと保存領域の分離

M7E RuntimeManifest と同梱実行ファイルはアプリのインストール資源で、プロジェクトデータではありません。Runtime のステージングやインストーラーのパッケージ化でプロジェクトをコピーまたは移行しません。初回起動の確認はアプリデータ領域を使います。手動でアプリの版を戻してもプロジェクトは保持され、既存のプロジェクト／カタログ互換性検査を利用します。対応しない版は書き換えずに拒否します。[ネイティブインストーラー](/native-installer)をご覧ください。
