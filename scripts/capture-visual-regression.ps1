param(
    [string]$OutputDir = "artifacts\screenshots",
    [string]$BaselineDir = "test-fixtures\visual-baseline",
    [string]$AndroidPackage = "com.remotecodeonpc.app",
    [string]$VsCodeTitlePattern = "remote_code_on_pc",
    [switch]$VsCodeFullscreen,
    [switch]$UpdateBaseline,
    [switch]$NoCompare,
    [double]$MaxPixelDeltaRatio = 0.08,
    [double]$VsCodeMaxPixelDeltaRatio = 0.18,
    [int]$PixelThreshold = 30,
    [string]$VsCodeFullscreenBaselineName = "vscode-fullscreen.png"
)

$ErrorActionPreference = "Stop"

function Resolve-RepoPath([string]$PathValue) {
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }
    return Join-Path $repoRoot $PathValue
}

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

function Save-WindowScreenshot([string]$TitlePattern, [string]$Path, [switch]$Fullscreen) {
    Add-Type -AssemblyName System.Drawing
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32VisualRegression {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@
    $window = Get-Process Code -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -match $TitlePattern } |
        Select-Object -First 1
    if (-not $window) {
        Write-Host "VS Code window matching '$TitlePattern' was not found."
        return $false
    }

    if ($Fullscreen) {
        [Win32VisualRegression]::ShowWindow($window.MainWindowHandle, 3) | Out-Null
        [Win32VisualRegression]::SetForegroundWindow($window.MainWindowHandle) | Out-Null
        Start-Sleep -Seconds 1
    } else {
        [Win32VisualRegression]::ShowWindow($window.MainWindowHandle, 9) | Out-Null
        [Win32VisualRegression]::SetForegroundWindow($window.MainWindowHandle) | Out-Null
        Start-Sleep -Milliseconds 400
    }

    $rect = New-Object Win32VisualRegression+RECT
    [Win32VisualRegression]::GetWindowRect($window.MainWindowHandle, [ref]$rect) | Out-Null
    $width = [Math]::Max(1, $rect.Right - $rect.Left)
    $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
    if ($width -lt 320 -or $height -lt 240) {
        Write-Host "VS Code screenshot skipped: window is too small ($($width)x$($height))."
        return $false
    }
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

function Resize-Bitmap([System.Drawing.Bitmap]$Bitmap, [int]$MaxWidth) {
    $scale = [Math]::Min(1.0, $MaxWidth / [double]$Bitmap.Width)
    $width = [Math]::Max(1, [int][Math]::Round($Bitmap.Width * $scale))
    $height = [Math]::Max(1, [int][Math]::Round($Bitmap.Height * $scale))
    $resized = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($resized)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($Bitmap, 0, 0, $width, $height)
        return $resized
    } finally {
        $graphics.Dispose()
    }
}

function Compare-VisualBaseline([string]$Name, [string]$CurrentPath, [string]$BaselinePath, [double]$AllowedDeltaRatio) {
    if (-not (Test-Path $CurrentPath)) {
        Write-Host "$Name comparison skipped: screenshot is missing."
        return
    }
    if (-not (Test-Path $BaselinePath)) {
        Write-Host "$Name comparison skipped: baseline is missing. Run with -UpdateBaseline after reviewing the screenshot."
        return
    }

    Add-Type -AssemblyName System.Drawing
    $currentOriginal = [System.Drawing.Bitmap]::FromFile($CurrentPath)
    $baselineOriginal = [System.Drawing.Bitmap]::FromFile($BaselinePath)
    try {
        $widthDelta = [Math]::Abs($currentOriginal.Width - $baselineOriginal.Width) / [double][Math]::Max($currentOriginal.Width, $baselineOriginal.Width)
        $heightDelta = [Math]::Abs($currentOriginal.Height - $baselineOriginal.Height) / [double][Math]::Max($currentOriginal.Height, $baselineOriginal.Height)
        if ($widthDelta -gt 0.08 -or $heightDelta -gt 0.08) {
            throw "$Name visual baseline dimensions changed too much: current $($currentOriginal.Width)x$($currentOriginal.Height), baseline $($baselineOriginal.Width)x$($baselineOriginal.Height)."
        }

        $current = Resize-Bitmap $currentOriginal 260
        $baseline = Resize-Bitmap $baselineOriginal 260
        try {
            $width = [Math]::Min($current.Width, $baseline.Width)
            $height = [Math]::Min($current.Height, $baseline.Height)
            $changed = 0
            $total = $width * $height
            for ($y = 0; $y -lt $height; $y++) {
                for ($x = 0; $x -lt $width; $x++) {
                    $a = $current.GetPixel($x, $y)
                    $b = $baseline.GetPixel($x, $y)
                    $delta = ([Math]::Abs($a.R - $b.R) + [Math]::Abs($a.G - $b.G) + [Math]::Abs($a.B - $b.B)) / 3
                    if ($delta -gt $PixelThreshold) {
                        $changed++
                    }
                }
            }
            $ratio = $changed / [double]$total
            $pct = [Math]::Round($ratio * 100, 2)
            if ($ratio -gt $AllowedDeltaRatio) {
                throw "$Name visual baseline changed by $pct% (limit $([Math]::Round($AllowedDeltaRatio * 100, 2))%)."
            }
            Write-Host "$Name visual baseline OK: $pct% changed."
        } finally {
            $current.Dispose()
            $baseline.Dispose()
        }
    } finally {
        $currentOriginal.Dispose()
        $baselineOriginal.Dispose()
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = Resolve-RepoPath $OutputDir
$resolvedBaseline = Resolve-RepoPath $BaselineDir
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
New-Item -ItemType Directory -Force -Path $resolvedBaseline | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$adb = Resolve-AdbPath
$androidPath = Join-Path $resolvedOutput "android-$timestamp.png"
$vscodeName = if ($VsCodeFullscreen) { "vscode-fullscreen-$timestamp.png" } else { "vscode-$timestamp.png" }
$vscodePath = Join-Path $resolvedOutput $vscodeName
$androidBaseline = Join-Path $resolvedBaseline "android.png"
$vscodeBaseline = Join-Path $resolvedBaseline $(if ($VsCodeFullscreen) { $VsCodeFullscreenBaselineName } else { "vscode.png" })

try {
    & $adb shell monkey -p $AndroidPackage 1 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "adb monkey failed with exit code $LASTEXITCODE" }
    Start-Sleep -Seconds 5
    & $adb shell screencap -p /sdcard/remote-code-visual-regression.png 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "adb screencap failed with exit code $LASTEXITCODE" }
    & $adb pull /sdcard/remote-code-visual-regression.png $androidPath 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $androidPath)) { throw "adb pull failed with exit code $LASTEXITCODE" }
    Write-Host "Android screenshot: $androidPath"
} catch {
    Write-Host "Android screenshot skipped: $($_.Exception.Message)"
}

if (Save-WindowScreenshot $VsCodeTitlePattern $vscodePath -Fullscreen:$VsCodeFullscreen) {
    Write-Host "VS Code screenshot: $vscodePath"
}

if ($UpdateBaseline) {
    if (Test-Path $androidPath) {
        Copy-Item -LiteralPath $androidPath -Destination $androidBaseline -Force
        Write-Host "Android baseline updated: $androidBaseline"
    }
    if (Test-Path $vscodePath) {
        Copy-Item -LiteralPath $vscodePath -Destination $vscodeBaseline -Force
        Write-Host "VS Code baseline updated: $vscodeBaseline"
    }
} elseif (-not $NoCompare) {
    Compare-VisualBaseline "Android" $androidPath $androidBaseline $MaxPixelDeltaRatio
    Compare-VisualBaseline "VS Code" $vscodePath $vscodeBaseline $VsCodeMaxPixelDeltaRatio
}
