# Prints which window has the foreground (its handle, process, and title). Read-only: it changes no
# window and sends no input. Run it before and after a suite to prove the suite left focus alone.
# With -WatchSeconds it keeps looking every 20 ms for that long and prints every change with the
# time, so a focus theft shows up even if the person switches windows during the run. Start the
# watch in a second shell, then the suite.
param([double]$WatchSeconds = 0)
if (-not ('ForegroundProbe' -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ForegroundProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  public static string Title(IntPtr window) { var text = new StringBuilder(512); GetWindowText(window, text, text.Capacity); return text.ToString(); }
}
"@
}

function Describe-Foreground([IntPtr]$window) {
  $processId = [uint32]0
  [void][ForegroundProbe]::GetWindowThreadProcessId($window, [ref]$processId)
  $processName = (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName
  'foreground: 0x{0:X} {1} (pid {2}) "{3}"' -f $window.ToInt64(), $processName, $processId, [ForegroundProbe]::Title($window)
}

$window = [ForegroundProbe]::GetForegroundWindow()
if ($WatchSeconds -le 0) { Describe-Foreground $window; exit }

$watch = [System.Diagnostics.Stopwatch]::StartNew()
"{0:HH:mm:ss.fff} {1}" -f (Get-Date), (Describe-Foreground $window)
while ($watch.Elapsed.TotalSeconds -lt $WatchSeconds) {
  Start-Sleep -Milliseconds 20
  $current = [ForegroundProbe]::GetForegroundWindow()
  if ($current -ne $window) {
    $window = $current
    "{0:HH:mm:ss.fff} {1}" -f (Get-Date), (Describe-Foreground $window)
  }
}
"{0:HH:mm:ss.fff} watch ended" -f (Get-Date)
