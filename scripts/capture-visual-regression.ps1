param(
    [string]$OutputDir = "artifacts\screenshots",
    [string]$AndroidPackage = "com.remotecodeonpc.app",
    [string]$VsCodeTitlePattern = "remote_code_on_pc"
)

$ErrorActionPreference = "Stop"

function Resolve-AdbPath {
    $candidates = @()
    if ($env:LOCALAPPDATA) {
        $candidates += (Join-Path $env:LOCALAPPDATA "Android\Sdk\platform-tools\adb.exe")
    }
    if ($env:ANDROID_HOME) {
        $candidates += (Join-Path $env:ANDROID_HOME "platform-tools\adb.exe")
    }
    if ($env:ANDROID_SDK_ROOT) {
        $candidates += (Join-Path $env:ANDROID_SDK_ROOT "platform-tools\adb.exe")
    }
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate)) {
            return $candidate
        }
    }
    return "adb"
}

function Save-WindowScreenshot([string]$TitlePattern, [string]$Path) {
    Add-Type -AssemblyName System.Drawing
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Rect {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@
    $window = Get-Process Code -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -match $TitlePattern } |
        Select-Object -First 1
    if (-not $window) {
        Write-Host "VS Code window matching '$TitlePattern' was not found."
        return $false
    }

    $rect = New-Object Win32Rect+RECT
    [Win32Rect]::GetWindowRect($window.MainWindowHandle, [ref]$rect) | Out-Null
    $width = [Math]::Max(1, $rect.Right - $rect.Left)
    $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
        return $true
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = if ([System.IO.Path]::IsPathRooted($OutputDir)) {
    $OutputDir
} else {
    Join-Path $repoRoot $OutputDir
}
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$adb = Resolve-AdbPath
$androidPath = Join-Path $resolvedOutput "android-$timestamp.png"
$vscodePath = Join-Path $resolvedOutput "vscode-$timestamp.png"

try {
    & $adb shell monkey -p $AndroidPackage 1 | Out-Null
    Start-Sleep -Seconds 2
    & $adb shell screencap -p /sdcard/remote-code-visual-regression.png | Out-Null
    & $adb pull /sdcard/remote-code-visual-regression.png $androidPath | Out-Null
    Write-Host "Android screenshot: $androidPath"
} catch {
    Write-Host "Android screenshot skipped: $($_.Exception.Message)"
}

if (Save-WindowScreenshot $VsCodeTitlePattern $vscodePath) {
    Write-Host "VS Code screenshot: $vscodePath"
}
