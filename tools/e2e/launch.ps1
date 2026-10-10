# Builds the debug app and starts it with the Chrome DevTools debug port open (9222), using a
# throwaway WebView2 profile so a running copy of the app is not disturbed.
# The page comes from the Vite dev server, so start it first: npm run dev (port 5173).
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$profile = Join-Path $PSScriptRoot '.webview-profile'
if (Test-Path $profile) { Remove-Item -Recurse -Force $profile }

Push-Location $repo
cargo build -p spelunker-app 2>&1 | Select-Object -Last 3
Pop-Location

$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222'
$env:WEBVIEW2_USER_DATA_FOLDER = $profile
$process = Start-Process (Join-Path $repo 'target\debug\spelunker-app.exe') -PassThru
Start-Sleep -Seconds 6
"started pid $($process.Id)"
(Invoke-WebRequest http://127.0.0.1:9222/json -UseBasicParsing).StatusCode
