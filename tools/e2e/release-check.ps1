# Starts the release exe (the one the installers carry) with the debug port open, reports the
# address its window loaded, and whether the app actually drew itself. A good release build shows an
# address inside the app (tauri.localhost), never the dev server (localhost:5173). Run it with no
# dev server running and no other copy of Spelunker open (only one copy can run at a time).
param([string]$Exe = (Join-Path $PSScriptRoot '..\..\target\release\Spelunker.exe'))
$exe = (Resolve-Path $Exe).Path
$profile = Join-Path $PSScriptRoot '.release-profile'
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
$env:WEBVIEW2_USER_DATA_FOLDER = $profile
$process = Start-Process $exe -PassThru
Start-Sleep -Seconds 6
"started $exe (pid $($process.Id))"
try {
  $pages = (Invoke-WebRequest http://127.0.0.1:9222/json -UseBasicParsing).Content | ConvertFrom-Json
  $pages | Where-Object { $_.type -eq 'page' } | ForEach-Object { "page: $($_.url)  title: $($_.title)" }
  Push-Location $PSScriptRoot
  "drawn: " + (node q.mjs "!!document.querySelector('[role=search]') && !!document.querySelector('[role=grid]') && document.querySelectorAll('button').length + ' buttons'")
  Pop-Location
} catch { "no debug port answer: $($_.Exception.Message)" }
Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }
