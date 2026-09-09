@echo off
chcp 65001 >nul
echo 正在啟動彼岸仍是人間小說閱讀器測試伺服器...
echo 請不要關閉這個黑視窗，瀏覽器即將自動開啟。
start http://localhost:8000
python -m http.server 8000
pause