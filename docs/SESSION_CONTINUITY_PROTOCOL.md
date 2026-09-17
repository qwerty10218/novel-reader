# 對話接續與上下文保全規則

本文件用來解決 Codex / GPT 對話上下文會滿、會壓縮、會換 conversation 的問題。任何接手本專案的 AI，開始前都應先讀本文件。

## 一、核心原則

- 不把長期記憶依賴在聊天上下文裡。
- 長期規則與進度必須落在專案檔案：`CODEX_HANDOFF.md`、`00_PROJECT/CURRENT_STATUS.md`、`00_PROJECT/CHANGELOG.md`、`00_PROJECT/CODEX_CONTINUITY_MEMO.md`。
- 每次完成實作、修稿、建檔、工具調整或資料庫更新後，必須在 `00_PROJECT/IMPLEMENTATION_LOG.md` 新增一筆倒序紀錄；重大里程碑才額外更新 `CHANGELOG.md`。
- 寫作中若出現重大決策、章節定稿、年代修正、正體字規則修正、Git 同步策略調整，必須更新相關文件。
- 新 conversation 開始時，先讀檔恢復狀態，再繼續工作。

## 二、新對話啟動檢視流程

每次新 conversation 或上下文壓縮後，先依序檢視：

1. `AGENTS.md`：最高工作區規則。
2. `CODEX_HANDOFF.md`：專案總接手導引。
3. `00_PROJECT/CODEX_CONTINUITY_MEMO.md`：最新接續記憶。
4. `00_PROJECT/CURRENT_STATUS.md`：目前章節與任務狀態。
5. `00_PROJECT/CHANGELOG.md`：近期重大變更。
6. `00_PROJECT/IMPLEMENTATION_LOG.md`：近期實作、修稿、建檔與工具調整流水帳。
7. `01_STORY/TIMELINE.md`：年份與人生骨架。
8. `08_AI/WRITING_STYLE.md`：純文學風格。
9. `08_AI/TRADITIONAL_CHINESE_STANDARD.md`：正體字規範。
10. `08_AI/CONVERSION_LEXICON.md`：繁簡轉換專案詞庫。
11. 若任務涉及線上發布或同步，再讀 `web/SYNC_TO_GITHUB.md`。

讀完後，先用繁體中文向使用者簡報：

- 目前已完成到哪一章。
- 目前年份與下一章歷史時間點。
- 本輪要寫、修、查或同步什麼。
- 有哪些不可踩的紅線。

## 三、上下文快滿時的自動摘要

AI 無法保證每次都能直接讀取介面的上下文百分比，但當出現以下任一情況，應主動整理接續摘要：

- 使用者提醒上下文快滿。
- 任務已進行很久、累積大量討論或多輪修改。
- 完成一個章節段落、重大設定決策、插圖方案、閱讀器發布或 Git 同步。
- 即將進入下一章、下一輪重寫或重大技術調整。

摘要應寫入或更新 `00_PROJECT/CODEX_CONTINUITY_MEMO.md`，必要時同步更新 `CODEX_HANDOFF.md`、`CURRENT_STATUS.md` 與 `CHANGELOG.md`。

## 四、接續摘要格式

產生給下一個 conversation 的摘要時，使用以下格式：

```markdown
# 《彼岸仍是人間》接續摘要

## 本輪完成
- 

## 目前狀態
- 最新完成章節：
- 目前時間點：
- 下一章／下一場戲：
- 已發布到 web：

## 必須遵守
- 1962–1976 純歷史真實，禁止系統、光幕、金手指、超自然。
- 鐵盒只能在父母皆過世後的中老年終局揭露。
- 正體字：抬、臺、裡、隻、菸、藉、準。
- 顧清宇少年期不是覺醒型主角，而是害怕、困惑、委屈、怨、找藉口自衛、無能為力。

## 本輪關鍵決策
- 

## 待辦
- 

## 下輪啟動請先讀
1. `AGENTS.md`
2. `CODEX_HANDOFF.md`
3. `00_PROJECT/CODEX_CONTINUITY_MEMO.md`
4. `00_PROJECT/CURRENT_STATUS.md`
5. `01_STORY/TIMELINE.md`
6. `08_AI/SESSION_CONTINUITY_PROTOCOL.md`
7. `08_AI/WRITING_STYLE.md`
8. `08_AI/TRADITIONAL_CHINESE_STANDARD.md`
```

## 五、給使用者的新對話啟動提示詞

如果使用者要開新 conversation，可直接貼以下提示詞：

```markdown
我們正在創作嚴肅純文學歷史長篇《彼岸仍是人間》。請先不要動筆，先進入專案接續模式。

請依序閱讀：
1. `AGENTS.md`
2. `CODEX_HANDOFF.md`
3. `00_PROJECT/CODEX_CONTINUITY_MEMO.md`
4. `00_PROJECT/CURRENT_STATUS.md`
5. `00_PROJECT/CHANGELOG.md`
6. `01_STORY/TIMELINE.md`
7. `08_AI/SESSION_CONTINUITY_PROTOCOL.md`
8. `08_AI/WRITING_STYLE.md`
9. `08_AI/TRADITIONAL_CHINESE_STANDARD.md`
10. `08_AI/CONVERSION_LEXICON.md`

讀完後，請用繁體中文簡報：
- 目前寫到哪裡；
- 目前年份與章節時間線；
- 下一步最合理要做什麼；
- 哪些紅線不能踩；
- 若要同步 GitHub，請依 `web/SYNC_TO_GITHUB.md` 先 commit 再判斷是否 push。

請先簡報，不要直接改稿。
```
