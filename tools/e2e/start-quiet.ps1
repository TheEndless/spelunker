# Starts a program without activating it, so a test run never takes focus from the person using the
# machine. Start-Process always lets the new window activate, so this calls CreateProcess with
# STARTUPINFO asking for SW_SHOWNOACTIVATE instead.
# The new process inherits this session's environment variables, so set them before calling.
#
# Some programs ignore that request and show their window themselves (the Tauri window does). Give
# -OffScreenWindowClass the class of that window ('Tauri Window') and, once it appears, it is moved
# beside the desktop, out of sight, without activating it or changing its place in the window order.
# Off screen rather than minimized: a minimized WebView2 page reports itself hidden, stops drawing,
# and gets a wrong viewport size, so checks against it would not see what a person sees.
#
# Returns an object with the process Id, and with -Wait also its ExitCode.
param(
  [Parameter(Mandatory)][string]$FilePath,
  [string]$Arguments = '',
  [switch]$Wait,
  [string]$OffScreenWindowClass = ''
)

if (-not ('QuietStart' -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class QuietStart {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo {
    public int size; public string reserved; public string desktop; public string title;
    public int x, y, width, height, columns, rows, fillAttribute, flags;
    public short showWindow; public short reservedSize; public IntPtr reservedBuffer;
    public IntPtr standardInput, standardOutput, standardError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInformation { public IntPtr process; public IntPtr thread; public int processId; public int threadId; }
  [StructLayout(LayoutKind.Sequential)]
  struct Rect { public int left, top, right, bottom; }
  delegate bool EnumProc(IntPtr window, IntPtr parameter);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes,
    IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentFolder,
    ref StartupInfo startupInfo, out ProcessInformation processInformation);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out int exitCode);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

  const int STARTF_USESHOWWINDOW = 0x1;
  const short SW_SHOWNOACTIVATE = 4;
  const uint INFINITE = 0xFFFFFFFF;
  const int SM_XVIRTUALSCREEN = 76, SM_YVIRTUALSCREEN = 77;
  const uint SWP_NOSIZE = 0x1, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;

  /// Starts the program and returns its process id and, when waited for, its exit code (else -1).
  public static int[] Start(string path, string arguments, string folder, bool wait) {
    var startupInfo = new StartupInfo();
    startupInfo.size = Marshal.SizeOf(typeof(StartupInfo));
    startupInfo.flags = STARTF_USESHOWWINDOW;
    startupInfo.showWindow = SW_SHOWNOACTIVATE;
    var commandLine = new StringBuilder("\"" + path + "\"" + (arguments.Length > 0 ? " " + arguments : ""));
    ProcessInformation started;
    if (!CreateProcessW(path, commandLine, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, folder, ref startupInfo, out started)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "could not start " + path);
    }
    int exitCode = -1;
    if (wait) {
      WaitForSingleObject(started.process, INFINITE);
      GetExitCodeProcess(started.process, out exitCode);
    }
    CloseHandle(started.thread);
    CloseHandle(started.process);
    return new[] { started.processId, exitCode };
  }

  /// Moves the process's visible window of that class to the left of the whole desktop, keeping
  /// its size, without activating it or changing the window order. Returns "none" while there is no
  /// such window, "moved" when it had to be moved, and "away" when it already was out of sight.
  public static string MoveOffScreen(int processId, string windowClass) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((window, parameter) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      var name = new StringBuilder(256); GetClassName(window, name, name.Capacity);
      if (owner == processId && name.ToString() == windowClass && IsWindowVisible(window)) found = window;
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "none";
    Rect rect;
    GetWindowRect(found, out rect);
    int desktopLeft = GetSystemMetrics(SM_XVIRTUALSCREEN);
    if (rect.right < desktopLeft) return "away";
    int left = desktopLeft - (rect.right - rect.left) - 100;
    SetWindowPos(found, IntPtr.Zero, left, GetSystemMetrics(SM_YVIRTUALSCREEN), 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
    return "moved";
  }
}
"@
}

$path = (Resolve-Path $FilePath).Path
$result = [QuietStart]::Start($path, $Arguments, (Get-Location).Path, $Wait.IsPresent)
$processId = $result[0]
if ($OffScreenWindowClass) {
  # The program may place its window again while it starts, so it is watched until it has stayed
  # out of sight for two seconds in a row.
  $awayChecks = 0
  for ($attempt = 0; $attempt -lt 600 -and $awayChecks -lt 40; $attempt++) {
    $state = [QuietStart]::MoveOffScreen($processId, $OffScreenWindowClass)
    $awayChecks = if ($state -eq 'away') { $awayChecks + 1 } else { 0 }
    Start-Sleep -Milliseconds 50
  }
  if ($awayChecks -lt 40) { Write-Warning "the '$OffScreenWindowClass' window of pid $processId did not stay off screen within 30 seconds" }
}
[pscustomobject]@{ Id = $processId; ExitCode = if ($Wait) { $result[1] } else { $null } }
