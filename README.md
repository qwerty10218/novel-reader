# 彼岸仍是人間 - 小說閱讀器 (Novel Reader)

這是一個純前端、輕量級、沉浸式的私人網路小說閱讀器。專為《彼岸仍是人間》這部時代小說量身打造。

## 📖 關於故事
《彼岸仍是人間》講述一個在時代浪潮中失去父親、失去信任，又在彼岸的對照下重新找回真實人間的故事。

## ✨ 網站特色 (Features)
- **純粹的閱讀體驗**：無廣告、無多餘裝飾，專注於文字本身。
- **無縫多端同步**：透過 Supabase 紀錄，輸入專屬「暱稱」即可在手機與電腦間自動同步閱讀進度與章節。
- **繁簡轉換**：內建 OpenCC 繁簡即時轉換功能。
- **雙閱讀模式**：支援傳統的「向下滾動 (Scroll)」與仿實體書的「左右翻頁 (Page)」模式。
- **排版自訂**：可自由調整字體大小，切換「黑體 / 明體」，並搭配舒適的復古褐色紙張背景。
- **離線容錯**：當網路不穩無法連線雲端時，進度會自動無聲地保存在本地瀏覽器 (LocalStorage) 中，絕不打斷閱讀心流。

## 🛠️ 技術架構 (Tech Stack)
- **前端**：HTML5, CSS3, Vanilla JavaScript (純原生 JS，無須任何建置工具)
- **渲染**：[marked.js](https://github.com/markedjs/marked) (將 Markdown 轉為 HTML)
- **繁簡轉換**：[opencc-js](https://github.com/nk2028/opencc-js)
- **雲端資料庫**：[Supabase](https://supabase.com/) (儲存匿名閱讀進度)
- **部署**：GitHub Pages

## 🚀 如何新增章節？ (For Author)
本系統採用最簡單的 Markdown 檔案管理架構。
1. 將寫好的 `.md` 檔案放入 `chapters/` 資料夾中。
2. 開啟 `js/config.js`，在 `chapters` 陣列中新增一筆紀錄：
   ```javascript
   { id: 5, title: "第四章：章節名稱", file: "chapters/005.md" }
   ```
3. `git push` 到 GitHub，網站目錄與內容即會自動更新。