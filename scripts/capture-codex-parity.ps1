param(
    [string]$OutputDir = "artifacts\screenshots",
    [string]$CodexTitlePattern = "Codex",
    [string]$VsCodeTitlePattern = "remote_code_on_pc",
    [switch]$Fullscreen,
    [int]$PixelThreshold = 30
)

$ErrorActionPreference = "Stop"

function Resolve-RepoPath([string]$PathValue) {
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }
    return Join-Path $repoRoot $PathValue
}

function Ensure-Win32Types {
    Add-Type -AssemblyName System.Drawing
    if ("Win32CodexParityCapture" -as [type]) {
        return
    }
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32CodexParityCapture {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@
}

function Find-WindowCandidate([string[]]$ProcessNames, [string]$TitlePattern, [string]$Label) {
    $candidates = @()
    foreach ($name in $ProcessNames) {
        $candidates += Get-Process -Name $name -ErrorAction SilentlyContinue |
            Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }
    }
    if ($TitlePattern) {
        $matched = $candidates | Where-Object { $_.MainWindowTitle -match $TitlePattern }
        if ($matched) {
            return $matched | Sort-Object MainWindowTitle | Select-Object -First 1
        }
    }
    $fallback = $candidates | Sort-Object MainWindowTitle | Select-Object -First 1
    if ($fallback) {
        Write-Host "$Label title pattern '$TitlePattern' was not found; using '$($fallback.MainWindowTitle)'."
    }
    return $fallback
}

function Save-ProcessWindowScreenshot([System.Diagnostics.Process]$Window, [string]$Path, [switch]$MakeFullscreen) {
    Ensure-Win32Types
    if ($MakeFullscreen) {
        [Win32CodexParityCapture]::ShowWindow($Window.MainWindowHandle, 3) | Out-Null
        [Win32CodexParityCapture]::SetForegroundWindow($Window.MainWindowHandle) | Out-Null
        Start-Sleep -Seconds 1
    } else {
        [Win32CodexParityCapture]::ShowWindow($Window.MainWindowHandle, 9) | Out-Null
        Start-Sleep -Milliseconds 250
    }

    $rect = New-Object Win32CodexParityCapture+RECT
    [Win32CodexParityCapture]::GetWindowRect($Window.MainWindowHandle, [ref]$rect) | Out-Null
    $width = [Math]::Max(1, $rect.Right - $rect.Left)
    $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
    if ($width -lt 320 -or $height -lt 240) {
        throw "$($Window.ProcessName) window is too small: $($width)x$($height)"
    }

    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $hdc = $graphics.GetHdc()
        try {
            $captured = [Win32CodexParityCapture]::PrintWindow($Window.MainWindowHandle, $hdc, 2)
        } finally {
            $graphics.ReleaseHdc($hdc)
        }
        if (-not $captured) {
            throw "PrintWindow failed for '$($Window.MainWindowTitle)'"
        }
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
        return [pscustomobject]@{
            Path = $Path
            Width = $width
            Height = $height
            ProcessName = $Window.ProcessName
            ProcessId = $Window.Id
            Handle = $Window.MainWindowHandle.ToInt64()
            Title = $Window.MainWindowTitle
        }
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

function Compare-WindowImages([string]$LeftPath, [string]$RightPath) {
    Ensure-Win32Types
    $leftOriginal = [System.Drawing.Bitmap]::FromFile($LeftPath)
    $rightOriginal = [System.Drawing.Bitmap]::FromFile($RightPath)
    try {
        $left = Resize-Bitmap $leftOriginal 260
        $right = Resize-Bitmap $rightOriginal 260
        try {
            $width = [Math]::Min($left.Width, $right.Width)
            $height = [Math]::Min($left.Height, $right.Height)
            $changed = 0
            $total = $width * $height
            for ($y = 0; $y -lt $height; $y++) {
                for ($x = 0; $x -lt $width; $x++) {
                    $a = $left.GetPixel($x, $y)
                    $b = $right.GetPixel($x, $y)
                    $delta = ([Math]::Abs($a.R - $b.R) + [Math]::Abs($a.G - $b.G) + [Math]::Abs($a.B - $b.B)) / 3
                    if ($delta -gt $PixelThreshold) {
                        $changed++
                    }
                }
            }
            return $changed / [double]$total
        } finally {
            $left.Dispose()
            $right.Dispose()
        }
    } finally {
        $leftOriginal.Dispose()
        $rightOriginal.Dispose()
    }
}

function New-SideBySideImage([string]$LeftPath, [string]$RightPath, [string]$OutputPath, [string]$LeftLabel, [string]$RightLabel, [double]$DeltaRatio) {
    Ensure-Win32Types
    $left = [System.Drawing.Bitmap]::FromFile($LeftPath)
    $right = [System.Drawing.Bitmap]::FromFile($RightPath)
    try {
        $labelHeight = 34
        $width = $left.Width + $right.Width
        $height = [Math]::Max($left.Height, $right.Height) + $labelHeight
        $canvas = New-Object System.Drawing.Bitmap $width, $height
        $graphics = [System.Drawing.Graphics]::FromImage($canvas)
        try {
            $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml("#181818"))
            $font = New-Object System.Drawing.Font "Segoe UI", 10
            $brush = [System.Drawing.Brushes]::Gainsboro
            $deltaPct = [Math]::Round($DeltaRatio * 100, 2)
            $graphics.DrawString("$LeftLabel", $font, $brush, 10, 9)
            $graphics.DrawString("$RightLabel  |  pixel delta: $deltaPct%", $font, $brush, $left.Width + 10, 9)
            $graphics.DrawImage($left, 0, $labelHeight, $left.Width, $left.Height)
            $graphics.DrawImage($right, $left.Width, $labelHeight, $right.Width, $right.Height)
            $canvas.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            if ($font) { $font.Dispose() }
            $graphics.Dispose()
            $canvas.Dispose()
        }
    } finally {
        $left.Dispose()
        $right.Dispose()
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutput = Resolve-RepoPath $OutputDir
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

$codexWindow = Find-WindowCandidate @("Codex") $CodexTitlePattern "Codex"
$vscodeWindow = Find-WindowCandidate @("Code") $VsCodeTitlePattern "VS Code"
if (-not $codexWindow) { throw "Codex window was not found." }
if (-not $vscodeWindow) { throw "VS Code Remote Code window was not found." }
if ($codexWindow.MainWindowHandle -eq $vscodeWindow.MainWindowHandle) {
    throw "Codex and VS Code resolved to the same window handle; parity capture is invalid."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$codexPath = Join-Path $resolvedOutput "codex-parity-$timestamp.png"
$vscodePath = Join-Path $resolvedOutput "vscode-parity-$timestamp.png"
$sideBySidePath = Join-Path $resolvedOutput "codex-vs-vscode-parity-$timestamp.png"
$metadataPath = Join-Path $resolvedOutput "codex-vs-vscode-parity-$timestamp.json"

$codexInfo = Save-ProcessWindowScreenshot $codexWindow $codexPath -MakeFullscreen:$Fullscreen
$vscodeInfo = Save-ProcessWindowScreenshot $vscodeWindow $vscodePath -MakeFullscreen:$Fullscreen
$deltaRatio = Compare-WindowImages $codexPath $vscodePath
New-SideBySideImage $codexPath $vscodePath $sideBySidePath "Codex hwnd=$($codexInfo.Handle)" "VS Code hwnd=$($vscodeInfo.Handle)" $deltaRatio

$metadata = [ordered]@{
    timestamp = $timestamp
    codex = [ordered]@{
        path = $codexInfo.Path
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $codexInfo.Path).Hash
        processName = $codexInfo.ProcessName
        processId = $codexInfo.ProcessId
        handle = $codexInfo.Handle
        title = $codexInfo.Title
        width = $codexInfo.Width
        height = $codexInfo.Height
    }
    vscode = [ordered]@{
        path = $vscodeInfo.Path
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $vscodeInfo.Path).Hash
        processName = $vscodeInfo.ProcessName
        processId = $vscodeInfo.ProcessId
        handle = $vscodeInfo.Handle
        title = $vscodeInfo.Title
        width = $vscodeInfo.Width
        height = $vscodeInfo.Height
    }
    pixelDeltaRatio = $deltaRatio
    pixelDeltaPercent = [Math]::Round($deltaRatio * 100, 2)
    sideBySidePath = $sideBySidePath
}
$metadata | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $metadataPath -Encoding UTF8

Write-Host "Codex screenshot: $codexPath"
Write-Host "VS Code screenshot: $vscodePath"
Write-Host "Side-by-side: $sideBySidePath"
Write-Host "Metadata: $metadataPath"
Write-Host "Pixel delta: $([Math]::Round($deltaRatio * 100, 2))%"
