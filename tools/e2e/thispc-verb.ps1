# Asks the Windows shell for the verbs of the This PC folder and, with -Run, runs ours.
param([switch]$Run)
$shell = New-Object -ComObject Shell.Application
$thisPc = $shell.NameSpace(17).Self   # CSIDL_DRIVES: This PC
$verbs = @($thisPc.Verbs())
"verbs the shell offers for This PC:"
$verbs | ForEach-Object { '  ' + $_.Name }
$ours = $verbs | Where-Object { $_.Name -like '*Spelunker*' }
if ($ours) { "ours: found ($($ours.Name))" } else { "ours: NOT FOUND" }
if ($Run -and $ours) { $ours.DoIt(); "ran it" }
