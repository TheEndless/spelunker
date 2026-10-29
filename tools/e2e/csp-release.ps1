# Runs csp-release.mjs against the release exe: starts it with the debug port open, runs the checks,
# and always stops it afterwards. Build it first (npm run tauri build -- --no-bundle) and run
# fixtures.mjs once. No other copy of Spelunker may be open. Like release-check.ps1 it takes the
# foreground, because the release exe brings its own window forward by design (see README.md).
param([string]$Exe = (Join-Path $PSScriptRoot '..\..\target\release\Spelunker.exe'))
& (Join-Path $PSScriptRoot 'assert-no-spelunker.ps1')
$exe = (Resolve-Path $Exe).Path
$profile = Join-Path $PSScriptRoot '.release-profile'
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }
$process = $null
try {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
  $env:WEBVIEW2_USER_DATA_FOLDER = $profile
  $process = & (Join-Path $PSScriptRoot 'start-quiet.ps1') $exe -OffScreenWindowClass 'Tauri Window'
  Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 7
  Push-Location $PSScriptRoot
  node csp-release.mjs
  Pop-Location
} finally {
  Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  if ($process) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }
}
