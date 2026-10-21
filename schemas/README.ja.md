# OpenFilm 公開フォーマット

[繁體中文](README.zh-TW.md) · [English](README.md) · [日本語](README.ja.md)

`openfilm-project-1.0.0.schema.json` はプロジェクト manifest と、メディア、ストーリー、コンポジション、イベント、重複グループ、ジョブの再利用可能な定義を示します。`media-asset-1.0.0.schema.json` はメディア定義を参照し、`plugin-manifest-1.schema.json` は Plugin API 1、`workstation-qa-1.0.0.schema.json` は候補版に紐づく手動／ハードウェア QA 証拠を定義します。`$id` は安定した識別子です。検証器は同梱ファイルをローカルで解決でき、ネットワークを必要としません。

長さ、ソースのトリム位置、タイムライン位置は秒、フレームレートは fps です。クリップの画面 x/y 座標は合成フレームの中心を原点とするピクセル（+x は右、+y は下）です。ソースピクセルは拡大縮小と時計回りの回転前に contain-fit します。地理座標は WGS84 度、イベント範囲は km、信頼度とジョブ進捗は0〜1、評価は0〜5です。時刻には明示的なタイムゾーンが必要です。Plugin メタデータキーは名前空間を付けてください。

クリップの `locked` は1.0.0の追加任意フィールドです。既存プロジェクトも変換なしで有効です。ロックはクリップ識別、ソース選択、長さ、効果を保護しますが、前の編集によりタイムライン位置は移動することがあります。編集／削除前に明示的にロック解除します。ローダーは保存／再読み込み時に保持し、boolean 以外を拒否します。

manifest 読み込み時は `validateProject` を呼び出してください。構造 schema に加え、時間範囲、重複しない ID、日付、ストーリーと beat の参照を確認します。`{ assetIds: catalogIds }` を指定すると、候補、選択、制約、クリップの参照もカタログと照合できます。プロジェクト manifest に元メディアやカタログを重複して埋め込みません。

任意の `graphicScenes` は完全な v1 シーンを含みます。Image／Text／Shape／Group のみを許可し、形状、文字、アニメーション、リスト数、4段階のネストに上限を設けます。PhotoDepth は任意拡張で、識別子はカタログ ID でありパスや URL ではありません。実行時には区間関係、ID の一意性、ノード／文字／ピクセルの総量、PhotoDepth の画像／ソース／時間／保護領域の関連も検証します。JSON Schema の `maxLength` は Unicode 文字数を数え、core は UTF-16 code unit の上限も確認します。構造検証だけでは `validateProject` やローカルメディア確認の代わりになりません。

`validateMediaAsset`、`validateStory`、`validateComposition`、`validateJob` は移植可能なランタイム検証器です。成功すると独立した JSON 互換データを返し、元のオブジェクトは変更しません。`migrateProject` は文書化された0.1.0草案を1.0.0にします。省略設定には1920×1080、30 fpsを設定します。未バージョン、不正、将来版、未文書化版は拒否し、単位や欠落内容を推測しません。

ストーリー制約は一意の `assetIds` を持つ `must-include`、`must-exclude`、`asset-order` と、任意の `enabled` を持つ `chronological` をサポートします。ソルバーは実現不可能な要件を報告し、必須素材を黙って捨てません。

AI インターフェースは `execution: local | remote`、エンドポイント、受け取り得るデータ種別を宣言します。ProviderRegistry に既定のリモート Provider はありません。登録だけでは有効にならず、呼び出し側が `grantConsent` を通じて範囲と時刻を持つ `RemoteProviderConsent` を渡す必要があります。呼び出しごとに同意、データ種別、変更されていない接続先を確認します。撤回や Provider の変更後は再承認が必要です。Plugin は実行コードなので、ホストは信頼できるものだけを採用してください。同意チェックはホストの契約であり、任意コードのサンドボックスではありません。
