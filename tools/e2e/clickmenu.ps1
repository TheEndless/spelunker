param([string]$Name)
# Finds an open popup-menu item by its text with UI Automation and clicks its center with the real mouse.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Mouse2 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(200); mouse_event(2,0,0,0,UIntPtr.Zero); mouse_event(4,0,0,0,UIntPtr.Zero); }
}
"@
$root = [System.Windows.Automation.AutomationElement]::RootElement
$condition = New-Object System.Windows.Automation.PropertyCondition ([System.Windows.Automation.AutomationElement]::NameProperty), $Name
$item = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
if (-not $item) { "NOT FOUND: $Name"; exit 1 }
$box = $item.Current.BoundingRectangle
$x = [int]($box.X + $box.Width / 2); $y = [int]($box.Y + $box.Height / 2)
[Mouse2]::Click($x, $y)
"clicked '$Name' at $x,$y"
