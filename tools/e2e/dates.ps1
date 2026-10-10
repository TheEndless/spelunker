# What Windows says the modified time of each file in a folder is, in the user's regional format
# (the short date and short time, as Explorer's Date modified column shows them).
param([string]$Folder = (Join-Path $PSScriptRoot '..\..\docs'))
Get-ChildItem -LiteralPath $Folder -File | Sort-Object Name | ForEach-Object {
  '{0}|{1} {2}' -f $_.Name, $_.LastWriteTime.ToString('d'), $_.LastWriteTime.ToString('t')
}
"culture: $((Get-Culture).Name)  short date: $((Get-Culture).DateTimeFormat.ShortDatePattern)  short time: $((Get-Culture).DateTimeFormat.ShortTimePattern)"
