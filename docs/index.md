---
layout: home

hero:
  name: OpenFilm
  text: 從素材到故事，再到影片
  tagline: 開源、本機優先的媒體編輯器。整理照片、影片與錄音，規劃故事、剪輯並輸出，同時保留原始素材。
  actions:
    - theme: brand
      text: 安裝與開始使用
      link: /getting-started
    - theme: alt
      text: 製作第一部影片
      link: /product-workflow
    - theme: alt
      text: GitHub
      link: https://github.com/bynanci/open-film

features:
  - title: 本機優先
    details: 基本製作流程不需要雲端帳號。專案與素材由本機管理；選用遠端服務前，須先設定服務並同意資料傳送。
  - title: 從故事開始
    details: 先整理時刻、選擇重要素材與安排段落，再建立可編輯的剪輯。
  - title: 檢視後再採用
    details: 預覽建議、確認變更並保留編輯控制權，原始照片、影片與錄音不會被改寫。
  - title: 可攜的作品
    details: 輸出可播放的 MP4，或以支援的交換格式與媒體套件，接續其他工具的製作流程。
---

## 目前可用的版本

最新已發布的穩定版本是 **v0.4.0**；`main` 是尚未發布的開發版本，本網站也包含這些新功能的說明。目前尚未提供可散布的原生桌面安裝程式，請依[開始使用](getting-started.md)從原始碼啟動。發行差異請看 [GitHub Releases](https://github.com/bynanci/open-film/releases)，後續方向請看 [Roadmap](https://github.com/bynanci/open-film/blob/main/ROADMAP.md)。

## 選擇你的起點

| 你想做的事            | 從這裡開始                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 在電腦上啟動 OpenFilm | [環境需求、啟動與第一部影片](getting-started.md)                                                                                                              |
| 完成一部影片          | [加入素材 → 整理 → 故事 → 剪輯 → 輸出](product-workflow.md)                                                                                                   |
| 確認素材能否使用      | [相機與來源支援](source-support.md)                                                                                                                           |
| 移動專案或找回素材    | [媒體搬移與重新連結](media-portability.md)、[Collect Media 套件](collect-media.md)                                                                            |
| 修正問題或參與開發    | [支援方式](https://github.com/bynanci/open-film/blob/main/SUPPORT.zh-TW.md)、[貢獻指南](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.zh-TW.md) |

## 使用指南

### 故事與剪輯

[故事模板](creative-story-templates.md)、[精準剪輯](precision-editing.md)、[標記與吸附](markers-and-snapping.md)、[音訊品質](audio-quality.md)與[獨立聲音時間](audio-policy.md)說明實際操作與適用限制。進一步可閱讀[字幕](en/composition-captions.md)、[逐字稿編輯](en/transcript-editing.md)、[本機預設](en/local-presets.md)與[命名版本](en/named-versions.md)。

### 輸出與接續製作

從[輸出品質](export-quality.md)選擇 MP4 品質，利用[Collect Media](collect-media.md)整理可攜素材。需要進入其他剪輯器時，先閱讀 [NLE 交接指南](en/nle-handoff.md)及[相容性說明](en/nle-compatibility.md)；交換格式不保證每項效果都能保持可編輯。

## 使用範圍與限制

OpenFilm 以單一使用者的本機工作站為設計範圍。基本匯入、故事整理、剪輯與輸出不依賴 AI；選用的本機模型需要額外設定，遠端供應商則需要明確啟用、資料同意與各自的服務費用。細節見[轉錄設定](en/transcription.md)與[語音生成](en/provider-generation.md)。

相機格式、硬體效能和外部剪輯器的相容性各有條件。遇到功能不支援時，請先查對應指南；開發中的功能與未完成的發布條件列在 [v1.0.0 就緒狀態](en/roadmap/v1-readiness.md)。

## 開發、證據與社群

程式碼採 [Apache-2.0 授權](https://github.com/bynanci/open-film/blob/main/LICENSE)。從[架構](en/architecture.md)、[專案格式](project-format.md)與[整合契約](en/CONTRACTS.md)了解設計；開發環境、檢查命令及提交方式集中在[貢獻指南](https://github.com/bynanci/open-film/blob/main/CONTRIBUTING.zh-TW.md)。

Roadmap、研究與驗證紀錄各自保存方向、假設和執行證據。側欄的「驗證紀錄」包含當時的平台、commit、測試結果及待完成的人工檢查，供查核與重現使用。

主要使用指南提供繁體中文、英文與日文的保存版本。部分技術契約與歷史驗證紀錄目前以英文維護；翻譯規則見[文件語言政策](i18n.md)。歡迎回報錯誤、改善文件、補充翻譯或提交程式碼。回報時請使用可公開的重現素材，避免附上私人影片、原始路徑或憑證。
