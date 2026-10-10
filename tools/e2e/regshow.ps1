foreach ($place in 'Directory\shell', 'Directory\Background\shell', 'Drive\shell', 'CLSID\{20D04FE0-3AEA-1069-A2D8-08002B30309D}\shell') {
  $key = "HKCU:\Software\Classes\$place\Spelunker"
  if (Test-Path -LiteralPath $key) {
    $label = (Get-ItemProperty -LiteralPath $key).'(default)'
    $icon = (Get-ItemProperty -LiteralPath $key).Icon
    $command = (Get-ItemProperty -LiteralPath "$key\command").'(default)'
    "{0}`n   label:   {1}`n   icon:    {2}`n   command: {3}" -f $place, $label, $icon, $command
  } else {
    "{0}`n   (absent)" -f $place
  }
}
