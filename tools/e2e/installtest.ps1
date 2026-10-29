# Installs the per-user setup silently into a scratch folder, checks that the Explorer entries
# appear (including the one on This PC, asked of the shell itself), uninstalls it, and checks that
# they are gone. Run after `npm run tauri build`. Touches only this user's registry keys, so it
# refuses to run when Spelunker is installed for real, and when a copy is running.
& (Join-Path $PSScriptRoot 'assert-no-spelunker.ps1')
& (Join-Path $PSScriptRoot 'assert-no-real-install.ps1')
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$setup = (Get-ChildItem (Join-Path $repo 'target\release\bundle\nsis\Spelunker_*_x64-setup.exe') | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$target = Join-Path $PSScriptRoot '.install-test'
if (Test-Path $target) { Remove-Item -Recurse -Force $target }

"== before install"
& "$PSScriptRoot\regshow.ps1"

"== installing silently to $target"
$startQuiet = Join-Path $PSScriptRoot 'start-quiet.ps1'
$install = & $startQuiet $setup -Arguments "/S /D=$target" -Wait
"installer exit code: $($install.ExitCode)"
"files: " + ((Get-ChildItem $target | Select-Object -ExpandProperty Name) -join ', ')

"== after install"
& "$PSScriptRoot\regshow.ps1"
"== what the shell offers on This PC"
& "$PSScriptRoot\thispc-verb.ps1" | Select-String 'ours'

"== uninstalling"
$uninstall = Get-ChildItem $target -Filter 'uninstall*.exe' | Select-Object -First 1
$run = & $startQuiet $uninstall.FullName -Arguments "/S _?=$target" -Wait
"uninstaller exit code: $($run.ExitCode)"

"== after uninstall"
& "$PSScriptRoot\regshow.ps1"
& "$PSScriptRoot\thispc-verb.ps1" | Select-String 'ours'

# The silent uninstall leaves its own copy and an install-folder key behind when run in place.
if (Test-Path $target) { Remove-Item -Recurse -Force $target }
$vendor = 'HKCU:\Software\Spelunker'
if (Test-Path $vendor) { Remove-Item $vendor -Recurse -Force -Confirm:$false; 'removed leftover install-folder key' }
