@echo off
echo 正在啟動測試伺服器...
echo 請不要關閉這個黑色視窗，瀏覽器即將自動打開。
start http://localhost:8000
python -m http.server 8000
pause
