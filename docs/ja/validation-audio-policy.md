# D3B1 独立音声の検証

2026-10-30。実際の合成メディア、既存サービス、production Record コンポーネントと
OfflineAudioContext で検証しています。元ファイル、音声のサンプル座標、保存済みオブジェクトを
確認しており、モック時計だけを再生一致の証拠にはしていません。

| 検証               | 実測結果                                                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 欠落パケットと原点 | 20／50／80／150 ms の繰り返し欠落、125 ms 遅延、負の最初の PTS、非ゼロのコンテナー開始。48k と原点復元後16k の全パルスが1サンプル以内。                                                                                    |
| 1× 位相            | 七つの独立したパルス位置と一つの共通インパルス基準。従来の `atempo=1` は九つのイベントを生成したため、新しい標準1×だけから除外。従来グラフは保持。残る limiter 遅延239サンプル。                                           |
| AAC                | 実際の H264/AAC のパルス誤差 [1,1,1] サンプル。1024サンプル以内の条件を満たす。                                                                                                                                            |
| Record PCM         | 実サービスの PCM を production scheduler と実際の OfflineAudioContext に入力。開始0と任意シーク53129で WAV との差0、ブロック境界差0。各六ノードが連続。18016サンプルの排程開始はオフライン制御値であり、物理遅延ではない。 |
| ブラウザー操作     | 二件が一回で合格、14.96秒、skip／retry／flakyなし。再生、停止、シーク、準備中断、Undo、再オープン、単一音声所有を確認。Undo後の旧PCMは409で拒否。                                                                          |
| 保存               | 新しい保存／export／Collect UI41件と既存の Named Version／v5／variant／Collect／export71件が合格。音声、pin、写真、二言語タイトル、色、preset の完全な値を保持。                                                           |

重複音声は +6.020599913 dB、フレーム丸めは +799 サンプル、4秒での envelope 再開始は
−4.242897225 dB となり、それぞれ同じ ±0.5 dB／1サンプル条件で拒否しました。全主音声の
ミュート、stem の抑制回避、素材変更、壊れた PCM、Undo 前の古いプレビューも同じ測定／
サービスガードで拒否します。相関によるイベント別位置合わせや許容値の緩和はありません。

正規の実行コマンド、完全な SHA-256、各チェックポイント、原点ポリシーと追記された最終ゲートは
[共通の英語検証記録](../en/validation-audio-policy.md)に保存しています。使い方と上限は
[音声タイミングのガイド](audio-policy.md)を参照してください。

物理 Windows／macOS、GTK のネイティブツールチェーン、実機音声遅延、人による聴取品質、
実際の NLE QA は未実施です。D3B2 coverage 永続化も未完了のままです。

## 最終統合と Record 開始の修正 — 2026-10-30

Pin `c260deaa` 統合後の `a0e1f34b` では二件中一件が失敗しました。
実 PCM は一致しましたが、バッファー済み映像の補正 seek が音声を繰り返し再準備しました。
この RED は保持しています。補正対象が実際にバッファー内にある native `waiting` だけで
主音声時計を維持し、未取得素材／`stalled`／エラーの待機は保持しました。
新しい三件を含む monitor／scheduler／transport 94 件、型検証、lint、build、公式 OTIO 18 件が合格しました。

修正後の clean `acd8410d56d1a7ee368ea0494354ea8fbc9b316c` で元の二つの browser ケースが
9.795 秒で合格しました。skip／retry／flaky はありません。開始 0／53129 の PCM 差と境界差は
ともに 0、各六ノード、Undo 後は 409、native audio の再生呼び出しは 0 です。
両ポート 4310／1420 は終了後に閉じています。

完全な 5436 件の旧結果は `d5d75107` のみの証拠です。新しい開始修正の限定レビューと
最終 hosted CI は未完了です。物理端末、聴取、Resolve、native installer の手動 gate と
D3B2 の永続 coverage は未完了のままです。公開 stable は v0.4.0 です。

## レビュー済み ripple と音量自動化の時間対応 — 2026-11-05

Prompt 02 は最新 main `92ccf361642f060466b269dc2fcf3ed4d77102b3` を基点に実装し、
コード候補は `e7ede9443d66416e5e8ef8efbdd1823cfb4ffb2a` です。Silence ripple と
クリップ内 gain／fade／ducking automation を整数 48 kHz sample clock で対応づけます。
元の source range、speed、continuity ID と offset を保存し、Review の Accept 前に
detached ripple を検証して一つの compound edit として記録します。別の mixer を追加せず、
元音声を変更せず、Review を自動適用しません。

保存／再読込／render では source と clock の鮮度を検証します。`clip.split` にも同じ対応づけを
適用します。mapped clock に対する trim、speed、source replacement、未知の ducking 参照、
未対応 J/L timing など、等価性を証明できない操作は typed conflict として拒否します。
locked clip／track と User Pin を保護し、Undo／Redo では automation metadata を復元します。

コード候補の全 Vitest は **446 files、5,853/5,853 tests 合格**（517.10 秒）です。
44.1 kHz／48 kHz 合成音源、1.25x speed、automation、Silence ripple、sample mapping と
実際の FFmpeg render を含みます。source-clock と direct mix は既存の `2/2^23` PCM 誤差範囲内、
最終 render も編集境界にある limiter の実測 5 ms lookahead と 2 samples を除き同範囲内です。
limiter 窓は測定結果として明記し、許容誤差を広げていません。

メディアは全て合成素材です。実機 Windows／macOS、物理音声遅延、人による聴取品質は未検証です。
rebase 後、`pnpm format:check`、`pnpm test:i18n`（3,141 keys）、
`pnpm test:docs-i18n`（英語 mirror 158 件）、`pnpm lint`、`pnpm typecheck`、
`pnpm build`、`pnpm test:contracts`（77 files、1,498 tests）が合格しました。
build には既存の 500 kB chunk advisory があります。PR の hosted CI は作成後に確認します。
変更は merge／release されていません。

## PR #114 修正 review — 2026-11-05

統合基底は `main@1bafb5cd4532ce9f9a171499abc8631e4863d1ee` です。元の候補
`4964cdf` で八件の新しい回帰テストが失敗し、元 trim 秒数、legacy 再生原点、tempo 処理履歴、
絶対 source anchor を保持する修正を加えました。fractional ripple の配置 sample 数が元 clock と
一致しない場合は、Review 公開前に typed conflict で拒否します。提案を暗黙に丸めません。
map 済み独立音声を拒否し、UI の明示的な envelope reset は既存 Undo／Redo と保存を使用します。
Collect は Pin 解除後も元ファイルを保持します。Record の既存一時間上限は保持 DSP 履歴にも適用します。

限定十ファイル／171 tests と durable Job 失敗回帰、七件の browser tests が合格しました。
独立 correction review でも七件の guard／実 PCM tests が合格し、技術 blocker は残っていません。
1×44.1／48 kHz transient、fractional trim と sub-ms 原点の繰り返し分割、繰り返し ripple を確認し、
既存 PCM 誤差 `2/2^23` と limiter 窓を緩和していません。1000 segments／1000 points のローカル
graph compile 診断は中央値 352.41 ms → 2.43 ms、graph hash は同一でした。これは compile のみの
測定で、FFmpeg や実機速度の保証ではありません。最終 signed head と hosted CI は
[PR #114](https://github.com/bynanci/open-film/pull/114) に記録します。以前の5853件は旧候補の証拠のままです。
実機、聴取、署名／公証、release の gate は未完了です。

最終修正 source の全 Vitest は **447 files／5,878 tests 合格**、552.62秒、exit0 です。
途中終了した先行実行は合格として数えていません。format、3159 locale keys、160 mirrors、lint、
typecheck、build、77 files／1504 contracts、18 interchange checks、license、8 provenance checks、
339 browser-case partition が合格しました。関連二 browser specs は七件とも合格です。
既存の大きな chunk advisory は残ります。assertion、PCM 許容誤差、test を緩和／無効化していません。

### Hosted tool provisioning

署名 source `f681df7` の DCO、fast-contract、native-shell、docs、四 browser shards、三 OS Render QA、
Windows recovery は合格しました。media 準備だけが Azure Ubuntu mirror で遅延し、160 MB／107 packages
のうち約十一分で32番目までしか取得できませんでした。旧成功候補の同 step は27秒でした。新 runner の
再試行も準備段階に留まり、中断した実行は media QA 合格に数えていません。
CI 修正は既存 suites／signing keys を保った公式 HTTPS archive と有界 retry を共有 installer で使用します。
準備のみ八分上限とし、test budget／assertion／artifact は維持します。既存 CI policy50件、shell syntax、
format、license が合格し、独立 review で blocker はありません。全5878件は application source が同一の
`f681df7` の結果です。最終 head の hosted gate は改めて必要です。ローカル Cargo／GTK／WebKit がないため
`pnpm test:native` は未実行です。hosted native-shell 合格を実機 installer 検証として扱っていません。

### Complex graph の決定的 pixel conversion

`0100dfad5dde7114fd906c81dbc718ff68159f26` の Windows recovery は、同じ保存済み PNG を
使った十二回目の render で六 pixel／十 RGB channels の差を検出しました。保存された MP4 を
独立に decode すると保存 RGB と完全一致し、title／caption／GraphicScene PNG hash も同じです。
失敗した [Windows run 42129370648](https://github.com/bynanci/open-film/actions/runs/42129370648)
は合格として数えません。
実 FFmpeg debug test は、出力側 `-sws_flags` が complex graph の scale 設定へ届かないことを
修正前に検出しました。graph 内に accurate rounding／bitexact の default を宣言し、profile の
明示 scale と profile なしの自動 pixel conversion の実 context が両 flags を持つことを検証します。
独立 CLI control で赤 fixture の253→252を確認し、完全一致 assertion を維持しました。
encoder 設定、geometry、繰り返し pixel equality、PCM 許容誤差を緩和していません。
新 runtime test も Windows FFmpeg9 gate に追加しました。全 local suite と新 head の hosted CI が
必要で、この限定 test の合格だけで Windows drift の解決を宣言しません。最終結果は PR に記録します。

`ad311ee` の全 local run は447 files／5,879件中5,878合格、一件失敗（592.95秒）でした。
Film Look の source oracle だけが default YUV rounding を使っていました。実 production graph の
matrix 直前 RGBA は `[111,79,55,255]`、旧 reference RGB は `[112,78,56]` です。reference source
変換だけを修正し、元の三 channel units 上限と output decode を維持しました。retro／sport／中間の
誤差は `[3,1,2]`、`[0,2,0]`、`[0,1,2]` で、matrix と encoder は変更していません。
Windows run42132424512 は新 diagnostic parser のみ失敗し、139／140件合格でした。保存された二 scope
各48回の repeated render は全 pixel／channel 差ゼロ、decoded hash も一致しました。log を有界 capture
に収める verbose と hide_banner にし、内部 instance 名に依存せず geometry と pixel format で context
を確認します。自動 RGBA→YUV と全 context の両 flags は引き続き必須です。新 head の全 gate が必要で、
赤い run を合格として数えません。
