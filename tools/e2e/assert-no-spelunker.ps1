# Stops the calling script when a Spelunker is already running, before it starts another one.
#
# tauri-plugin-single-instance (2.5, src/platform_impl/windows.rs) creates a mutex named after the
# app identifier in tauri.conf.json followed by "-sim" (the plugin adds a version only with its
# "semver" feature, which this app does not turn on). Debug and release builds share the identifier,
# so they share the mutex. An exe started while another holds it sends its launch to the running
# window and exits, and that window restores and focuses itself (a release build ignores
# SPELUNKER_NO_FOCUS by design). A test run would then take the focus and talk to the wrong app.
$config = Get-Content (Join-Path $PSScriptRoot '..\..\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
$mutexName = "$($config.identifier)-sim"
$running = $false
try {
  $existing = $null
  if ([System.Threading.Mutex]::TryOpenExisting($mutexName, [ref]$existing)) {
    $existing.Dispose()
    $running = $true
  }
} catch [System.UnauthorizedAccessException] {
  # The mutex exists but belongs to someone this session may not open, which still means it runs.
  $running = $true
}
if ($running) {
  throw "A Spelunker is already running (it holds the mutex '$mutexName'). Close it first: another copy started now would hand its launch to that window, which would come to the front."
}
