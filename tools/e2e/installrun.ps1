# Installs the setup into a scratch folder, starts the INSTALLED app the way Explorer's folder entry
# does (exe plus the folder with a trailing dot), reports what the window loaded and what is in
# Look in, then stops it and uninstalls. Run with no other copy of Spelunker open and no dev server.
& (Join-Path $PSScriptRoot 'assert-no-spelunker.ps1')
& (Join-Path $PSScriptRoot 'assert-no-real-install.ps1')
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$setup = (Get-ChildItem (Join-Path $repo 'target\release\bundle\nsis\Spelunker_*_x64-setup.exe') | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$target = Join-Path $PSScriptRoot '.install-run'
$profile = Join-Path $PSScriptRoot '.install-run-profile'
foreach ($path in $target, $profile) { if (Test-Path $path) { Remove-Item -Recurse -Force $path } }

$startQuiet = Join-Path $PSScriptRoot 'start-quiet.ps1'
& $startQuiet $setup -Arguments "/S /D=$target" -Wait | Out-Null
$exe = Join-Path $target 'Spelunker.exe'
"installed: $(Test-Path $exe)"

$folder = Join-Path $repo 'docs'
$process = $null
try {
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
  $env:WEBVIEW2_USER_DATA_FOLDER = $profile
  # Started without activation and moved off screen, but the release exe ignores SPELUNKER_NO_FOCUS by
  # design and focuses a restored window itself, so this takes the foreground (see README.md).
  $process = & $startQuiet $exe -Arguments ('"' + $folder + '."') -OffScreenWindowClass 'Tauri Window'
  # The child has its copy of the variables, so the shell does not keep the debug port switched on.
  Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 7
  try {
    $pages = (Invoke-WebRequest http://127.0.0.1:9222/json -UseBasicParsing).Content | ConvertFrom-Json
    $pages | Where-Object { $_.type -eq 'page' } | ForEach-Object { "page: $($_.url)" }
    Push-Location $PSScriptRoot
    "Look in: " + (node q.mjs "document.querySelector('[role=combobox]').value")
    "drawn:   " + (node q.mjs "!!document.querySelector('[role=search]') && !!document.querySelector('[role=grid]')")
    Pop-Location
  } catch { "no answer: $($_.Exception.Message)" }
} finally {
  # However the run ends (an error, or Ctrl+C), the app and its unauthenticated debug port go, and
  # the scratch install and its registry keys are removed.
  Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
  if ($process) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $uninstall = Join-Path $target 'uninstall.exe'
  if (Test-Path $uninstall) { & $startQuiet $uninstall -Arguments "/S _?=$target" -Wait | Out-Null }
  foreach ($path in $target, $profile) { if (Test-Path $path) { Remove-Item -Recurse -Force $path } }
  $vendor = 'HKCU:\Software\Spelunker'
  if (Test-Path $vendor) { Remove-Item $vendor -Recurse -Force -Confirm:$false }
}
"entries after uninstall:"
& "$PSScriptRoot\regshow.ps1" | Select-String 'absent' | Measure-Object | ForEach-Object { "  $($_.Count) of 4 absent" }
