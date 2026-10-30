# Gemini 分享研究彙整：OpenFilm roadmap 參考

- 整理日期：2026-10-30
- 對照版本：main，9c392b7cc8d46f4768d76f30bef30d0397cca8f8（當時與 origin/main 相同）
- 目的：保留外部研究可供日後 roadmap 討論，並避免把已完成能力重複列為缺口。

## 摘要

兩份 Gemini 報告提出了幾個值得保留的研究方向：更大素材庫的效能基準、衡量影片編輯品質而不只檢查輸出檔、可選的本機視覺／語音模型，以及真實 NLE 和 Windows/macOS 工作站驗證。這些方向與現有 roadmap 部分重疊，應沿用既有項目和驗收記錄。

報告也有幾項需要校正的產品現況：2,000 是 scene-planning 範圍的上限，不等於整個媒體庫只能有 2,000 個素材；Visual QA/contact sheets 與 PhotoDepth 已在目前 main 實作；OTIO 的 parser read/write/read 測試已存在，但它不代表應用程式能從任意 NLE round-trip 還原完整剪輯，也不代表 Resolve 已完成實機驗證。

因此，本文件記錄研究訊號和驗證條件，不新增版本承諾、技術選型或重複的 backlog。

## 原始分享與查閱範圍

1. [OpenFilm 本機優先 AI 剪輯工作站之技術補強可行性與劣勢深度研究報告](https://share.gemini.google/R8lVhb5P0XgU)
2. [OpenFilm 系統架構演進、任務路線圖推進與工程交付全景研究報告](https://share.gemini.google/8lOh2hiSawHA)

查閱內容包括候選規模、Agent/編輯品質、素材索引與向量儲存、本機視覺與語音模型、PhotoDepth、OTIO/NLE，以及 CI 和工作站驗證。報告提到的性能數字、模型能力、依賴選型和版本階段，除下方明確核對的論文外，均視為待驗證假設；不直接作為 OpenFilm 的量測結果或採用決策。

## 與目前 repo 的交叉比對

| 主題                       | main 上可核對的現況                                                                                                                                                                                                                                                                                                                                                                             | 對 roadmap 的含義                                                                                                                                                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2,000 候選上限與大素材庫   | [scene-plan.ts](../packages/application/src/scene-plan.ts) 對一次 scene-plan scope 設 2,000 個上限；[source-analysis.ts](../packages/application/src/source-analysis.ts) 對共用素材分析設 10,000 個資產上限；多來源 manifest 另有 100,000 筆候選邊界（[multi-source.ts](../packages/core/src/multi-source.ts)）。這些是不同工作流程和資料邊界，不能統稱為「整個 catalog 只能有 2,000 個素材」。 | 10,000–100,000 筆 catalog 的 fixtures、記憶體和延遲基準已列在 [ROADMAP「Then — Extensibility and scale」](../ROADMAP.md) 與 [TASKS 的 scale checklist](../TASKS.md)。擴大 scene-plan scope 前，先分開量測索引、候選選取、取消/串流與規劃時間；不因報告建議就導入 sqlite-vec 或 LanceDB。 |
| Visual QA / contact sheets | M1/F07 已由共用 Application 服務實作，含真實 FFmpeg 輸出、抽樣解碼、結構化問題及 contact sheet；細節與限制見 [驗證記錄](../docs/validation-visual-qa.md) 和 [roadmap 現況](../ROADMAP.md)。                                                                                                                                                                                                     | 「缺少 contact sheet」已過時。藝術判斷、真實影片品質、4K 效能、顯示器與 Resolve/NLE 後製仍須人工或工作站驗證；自動化的可量測檢查不能代替編輯者判斷。                                                                                                                                     |
| PhotoDepth / 2.5D          | M8A local PhotoDepth 已整合到現有 GraphicScene/Composition，含受保護區域、mask/fallback、固定範圍視差和 Visual QA；見 [PhotoDepth 驗證](../docs/validation-photo-depth.md) 與 [TASKS](../TASKS.md)。                                                                                                                                                                                            | 不要把已實作的 2.5D 播放/渲染誤寫成缺失。報告提到的自動深度估算模型是另一項能力；若研究導入，需以真實人像、邊緣瑕疵、4K、授權和本機硬體作獨立驗證。現有人工 gate 不會因合成測試通過而關閉。                                                                                              |
| 剪輯 Agent 與創作品質      | M1/F07 能檢查資產、字體、輸出影格等可量測問題；它不宣稱判斷敘事、節奏或「是否剪得好」。七子系統核對也把相鄰鏡頭連續性、A/B-roll、情緒曲線等分列為缺口或人工判斷，見 [能力矩陣](../docs/roadmap/seven-subsystem-reconciliation.md)。                                                                                                                                                             | 值得研究「硬性 brief/交付條件」與「人類編輯者偏好/敘事品質」分開評分。先定義資料集、盲評方式與可重現 rubric，再考慮把創作品質評估做成 roadmap 工作；不要把 render pass 率當作編輯品質分數。                                                                                              |
| 本機模型與向量資料庫       | Provider/Embedding 介面提供擴充邊界，但程式庫中沒有 FTS5、sqlite-vec 或 LanceDB 的現行選型證據。現有重複/時間/位置分析也不能等同於通用向量檢索。                                                                                                                                                                                                                                                | ONNX Runtime、Depth Anything、WhisperX、sqlite-vec、LanceDB 等只列為 Gemini 的候選方案。任何 prototype 都應比較授權、Windows/macOS CPU/DirectML/GPU 支援、套件體積、記憶體、延遲、品質、離線/隱私預設及無模型 fallback，再決定是否改變架構。                                             |
| OTIO 與 NLE round-trip     | OpenFilm 目前產生 OTIO；官方 OpenTimelineIO parser 已驗證 read/write/read、時間範圍、媒體來源及自訂 metadata。進階效果多為 metadata-only，且 [相容性文件](../docs/nle-compatibility.md) 明確記錄實際 Resolve 匯入/播放未驗證、一般 NLE round-trip 不會還原 OpenFilm 專案。                                                                                                                      | 精確描述差異：parser 序列化往返已測；NLE 匯入、重連、播放、效果翻譯和 NLE 輸出再匯入仍是不同 gate。若要建 full round-trip，先定義支援格式與每一類 effect 的保真驗收，不把 CRDT/RGA 當成完成互通的捷徑。                                                                                  |
| Windows/macOS 交付與 CI    | Linux synthetic 渲染和自動回歸已存在；固定工具鏈/字型與窄範圍 OS render matrix 尚未完成。Windows/macOS 原生 shell、硬體、外接碟、安裝/更新等 gate 仍在 [七子系統核對](../docs/roadmap/seven-subsystem-reconciliation.md) 和 [ROADMAP](../ROADMAP.md)。                                                                                                                                          | Gemini 提議的跨平台 CI 與實機驗證和現有未完成工作重合。新增驗證時保存精確 commit、OS/硬體/工具版本、命令、退出碼、輸出摘要與去識別化 logs；不要用 Linux 合成證據替代 Windows 工作站結果。                                                                                                |

## 外部論文核對

查閱日期：2026-10-30。以下核對只用來判斷分享報告的引用是否支持其主張，不把論文結果當成 OpenFilm 自身成效。

- [Timeline-Bench, arXiv:2609.35143](https://arxiv.org/abs/2609.35143) 的摘要描述 56 個真實影片編輯任務、16 個 Agent 設定；平均解決率 14.0%，最佳為 26.8%，人類編輯者在 83.5% 的比較中偏好參考剪輯。論文把內容/brief 測試和基於編輯者盲評校準的品質測試都納入完成條件。這支持「機械正確和創作品質需要分別檢驗」這個研究訊號，但不能直接推成 OpenFilm 的模型分數或性能目標。分享報告提到的 896 runs、72.9% mechanical pass、93% false success 等數字，這次未能在摘要中核實；使用前需回到論文全文逐項確認其分母和定義。
- 報告把 [arXiv:2610.25649](https://arxiv.org/abs/2610.25649) 與 query-centric timeline 關聯；實際題名是 _InteractAgent: Agentic Human Motion Interaction with Memory-Augmented Reflection_，研究的是人與場景的機器人/動作互動，不能支持影片時間線剪輯主張。
- [arXiv:2610.25733](https://arxiv.org/abs/2610.25733) 的確是 query-centric TimelineAgent，但研究的是跨多份文件的事件時間線抽取，不是影片剪輯 Agent。
- [arXiv:2610.26275](https://arxiv.org/abs/2610.26275) 研究影片中的因果中間事件鏈生成，與故事事件理解有關；它評估的是 VLM 因果推理，不等於驗證自動剪輯、時間線操作或最終成片品質。

## 後續討論時的決策檢查

把研究方向升成 roadmap 前，先回答對應問題，並連結既有項目而不是複製一份：

1. **規模**：測的是 catalog 數量、單次規劃 scope，還是並行分析？固定 fixture、硬體與記憶體/延遲指標是什麼？
2. **創作品質**：硬性交付條件和人工品質評分是否分開？盲評者、評分 rubric、參照剪輯及資料授權是什麼？
3. **本機模型**：安裝/卸載、離線、權限/同意、隱私、授權、CPU 和 GPU fallback 是否可重現？
4. **NLE 相容**：要驗證 parser、實際匯入/播放、媒體 relink，還是輸出再匯入？每種 effect 的保真邊界是否清楚？
5. **工作站證據**：測試 commit、Windows/macOS 版本、硬體、工具版本、命令與 logs 是否能對應到同一個候選版本？

版本號和階段名稱仍以主 roadmap 決策為準；本筆記不採用分享報告提出的 v0.5/v0.6/v1.0 安排。
