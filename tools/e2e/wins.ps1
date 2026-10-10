Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public static class Wins {
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static List<string> ForProcess(uint target) {
    var found = new List<string>();
    EnumWindows((h, p) => { uint pid; GetWindowThreadProcessId(h, out pid); if (pid == target && IsWindowVisible(h)) { var s = new StringBuilder(256); GetClassName(h, s, 256); RECT r; GetWindowRect(h, out r); found.Add(s + " " + r.L + "," + r.T + " " + (r.R-r.L) + "x" + (r.B-r.T)); } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
$p = Get-Process spelunker-app -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $p) { 'no process'; exit }
[Wins]::ForProcess([uint32]$p.Id)
