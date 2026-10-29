# Stops the calling script when this user has Spelunker installed for real, before the script
# installs and removes a scratch copy. The installer and uninstaller write and delete the same
# registry keys a real install uses (the install-folder key and the four Explorer entries), so
# running the install tests over a real install would leave it without its right-click entries.
$places = 'Directory\shell', 'Directory\Background\shell', 'Drive\shell', 'CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\shell'
$keys = @('HKCU:\Software\Spelunker') + ($places | ForEach-Object { "HKCU:\Software\Classes\$_\Spelunker" })
$present = $keys | Where-Object { Test-Path -LiteralPath $_ }
if ($present) {
  throw ("Spelunker looks installed for this user, and these tests would remove its registry keys: " + ($present -join ', ') + ". Uninstall it first, or run the tests on another account.")
}
