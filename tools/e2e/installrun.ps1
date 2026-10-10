# Installs the setup into a scratch folder, starts the INSTALLED app the way Explorer's folder entry
# does (exe plus the folder with a trailing dot), reports what the window loaded and what is in
# Look in, then stops it and uninstalls. Run with no other copy of Spelunker open and no dev server.
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$setup = Join-Path $repo 'target\release\bundle\nsis\Spelunker_0.1.0_x64-setup.exe'
$target = Join-Path $PSScriptRoot '.install-run'
$profile = Join-Path $PSScriptRoot '.install-run-profile'
foreach ($path in $target, $profile) { if (Test-Path $path) { Remove-Item -Recurse -Force $path } }

Start-Process $setup -ArgumentList '/S', "/D=$target" -Wait | Out-Null
$exe = Join-Path $target 'Spelunker.exe'
"installed: $(Test-Path $exe)"

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
$env:WEBVIEW2_USER_DATA_FOLDER = $profile
$folder = Join-Path $repo 'docs'
$process = Start-Process $exe -ArgumentList ('"' + $folder + '."') -PassThru
Start-Sleep -Seconds 7
try {
  $pages = (Invoke-WebRequest http://127.0.0.1:9222/json -UseBasicParsing).Content | ConvertFrom-Json
  $pages | Where-Object { $_.type -eq 'page' } | ForEach-Object { "page: $($_.url)" }
  Push-Location $PSScriptRoot
  "Look in: " + (node q.mjs "document.querySelector('[role=combobox]').value")
  "drawn:   " + (node q.mjs "!!document.querySelector('[role=search]') && !!document.querySelector('[role=grid]')")
  Pop-Location
} catch { "no answer: $($_.Exception.Message)" }

Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
$uninstall = Join-Path $target 'uninstall.exe'
if (Test-Path $uninstall) { Start-Process $uninstall -ArgumentList '/S', "_?=$target" -Wait | Out-Null }
foreach ($path in $target, $profile) { if (Test-Path $path) { Remove-Item -Recurse -Force $path } }
$vendor = 'HKCU:\Software\Spelunker'
if (Test-Path $vendor) { Remove-Item $vendor -Recurse -Force -Confirm:$false }
"entries after uninstall:"
& "$PSScriptRoot\regshow.ps1" | Select-String 'absent' | Measure-Object | ForEach-Object { "  $($_.Count) of 4 absent" }
