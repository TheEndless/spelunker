# Lists the visible windows of the app's process: class, position, size, and whether it is minimized.
# Read-only. A `#32768` entry means a menu is open.
param([string]$Name = 'spelunker-app')
if (-not ('Wins' -as [type])) {
  Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Wins {
  delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public static List<string> ForProcess(uint target) {
    var found = new List<string>();
    EnumWindows((window, parameter) => {
      uint processId; GetWindowThreadProcessId(window, out processId);
      if (processId == target && IsWindowVisible(window)) {
        var name = new StringBuilder(256); GetClassName(window, name, 256);
        RECT rect; GetWindowRect(window, out rect);
        found.Add(name + " " + rect.Left + "," + rect.Top + " " + (rect.Right - rect.Left) + "x" + (rect.Bottom - rect.Top) + (IsIconic(window) ? " minimized" : ""));
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
}
$process = Get-Process $Name -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $process) { 'no process'; exit }
[Wins]::ForProcess([uint32]$process.Id)
