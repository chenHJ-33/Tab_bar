@echo off
chcp 936 >nul
setlocal
cd /d "%~dp0"

if not exist "manifest.json" (
  echo.
  echo  [错误] 当前目录不是扩展源码目录（找不到 manifest.json）
  echo         当前目录: %~dp0
  echo.
  pause
  exit /b 1
)

echo.
echo  ============================================================
echo    发布到 dist  --  Chrome 实际加载的目录
echo  ============================================================
echo.
echo    源目录 : %~dp0
echo    目标   : %~dp0dist
echo.

robocopy "%~dp0." "%~dp0dist" /MIR ^
  /XD ".git" "dist" "node_modules" "dev" ^
  /XF "README.md" ".gitignore" ".gitattributes" "publish.bat" "*.txt" ^
  /NJH /NJS /NDL /NFL /NP

set "RC=%ERRORLEVEL%"
if %RC% GEQ 8 (
  echo.
  echo  [失败] 同步出错，robocopy 错误码 %RC%
  echo.
  pause
  exit /b 1
)

if not exist "dist\manifest.json" (
  echo.
  echo  [失败] dist\manifest.json 不存在，请检查上面的输出
  echo.
  pause
  exit /b 1
)

echo.
echo  [完成] 源码已同步到 dist\
echo.
echo  接下来 :
echo    1. 打开 chrome://extensions
echo    2. 找到本扩展，点卡片上的刷新按钮
echo    3. 新开一个标签页查看效果
echo.
pause
