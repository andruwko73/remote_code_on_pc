param(
    [switch]$NoReload
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$Path) {
    return [System.IO.Path]::GetFullPath($Path)
}

function Copy-RequiredFile([string]$Source, [string]$Destination) {
    if (-not (Test-Path $Source)) {
        throw "Required file is missing: $Source"
    }
    Copy-Item -Force -LiteralPath $Source -Destination $Destination
}

function Get-ConfiguredPort([int]$FallbackPort) {
    $settingsPath = Join-Path $env:APPDATA "Code\User\settings.json"
    if (-not (Test-Path $settingsPath)) {
        return $FallbackPort
    }
    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $configured = $settings.'remoteCodeOnPC.port'
        if ($configured -is [int] -and $configured -gt 0) {
            return $configured
        }
        if ($configured -is [long] -and $configured -gt 0) {
            return [int]$configured
        }
    } catch {
        Write-Host "Could not read VS Code settings for Remote Code port: $($_.Exception.Message)"
    }
    return $FallbackPort
}

function Get-RemoteCodeStatus([int]$Port) {
    try {
        return Invoke-RestMethod -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$Port/api/app/apk/status"
    } catch {
        return $null
    }
}

function Restart-VsCodeWindow([int]$Port, [string]$ExpectedVersion, [string]$WorkspacePath) {
    Write-Host "Trying a safe VS Code window restart..."
    $window = Get-Process Code -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle } |
        Sort-Object @{ Expression = { if ($_.MainWindowTitle -match 'remote_code_on_pc') { 0 } else { 1 } } } |
        Select-Object -First 1
    if (-not $window) {
        Write-Host "No visible VS Code window was found."
        return
    }

    $closed = $window.CloseMainWindow()
    if (-not $closed) {
        Write-Host "VS Code did not accept the close request; leaving the window untouched."
        return
    }

    Start-Sleep -Seconds 8
    if (Get-Process -Id $window.Id -ErrorAction SilentlyContinue) {
        Write-Host "VS Code is still open, probably waiting for user confirmation. Not forcing close."
        return
    }

    Start-Process "code" -ArgumentList "`"$WorkspacePath`"" | Out-Null
    Start-Sleep -Seconds 12
    $status = Get-RemoteCodeStatus $Port
    if ($status -and $status.serverVersion -eq $ExpectedVersion) {
        Write-Host "VS Code restarted with Remote Code version $ExpectedVersion."
    } else {
        Write-Host "Installed version $ExpectedVersion. Run Developer: Reload Window if VS Code has not activated it yet."
    }
}

function Restart-RemoteCodeExtensionHost([int]$Port, [string]$ExpectedVersion, [string]$WorkspacePath) {
    if ($NoReload) {
        Write-Host "Skipping VS Code reload because -NoReload was supplied."
        return
    }

    Write-Host "Requesting VS Code window reload..."
    try {
        Start-Process "vscode://command/workbench.action.reloadWindow" | Out-Null
    } catch {
        Write-Host "Could not send VS Code reload URI: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds 8
    $status = Get-RemoteCodeStatus $Port
    if ($status -and $status.serverVersion -eq $ExpectedVersion) {
        Write-Host "Remote Code extension is active at version $ExpectedVersion."
        return
    }

    Write-Host "VS Code still reports version $($status.serverVersion). Restarting the Remote Code extension host process if it owns port $Port..."
    try {
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
        if (-not $listener) {
            Write-Host "No listener on port $Port; VS Code will start Remote Code on next activation."
            return
        }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
        $commandLine = [string]$process.CommandLine
        if ($commandLine -notmatch 'Code\.exe' -or $commandLine -notmatch 'NodeService') {
            Write-Host "Port $Port is not owned by the VS Code extension host; leaving process $($listener.OwningProcess) untouched."
            return
        }
        Stop-Process -Id $listener.OwningProcess
        Start-Sleep -Seconds 10
        $status = Get-RemoteCodeStatus $Port
        if ($status -and $status.serverVersion -eq $ExpectedVersion) {
            Write-Host "Remote Code extension host restarted at version $ExpectedVersion."
        } else {
            Restart-VsCodeWindow -Port $Port -ExpectedVersion $ExpectedVersion -WorkspacePath $WorkspacePath
        }
    } catch {
        Write-Host "Could not restart extension host automatically: $($_.Exception.Message)"
        Restart-VsCodeWindow -Port $Port -ExpectedVersion $ExpectedVersion -WorkspacePath $WorkspacePath
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $repoRoot "extension"
$apkRoot = Join-Path $repoRoot "apk"
$packagePath = Join-Path $extensionRoot "package.json"
$package = Get-Content $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json

$publisher = $package.publisher
$name = $package.name
$version = $package.version
if (-not $publisher -or -not $name -or -not $version) {
    throw "extension/package.json must contain publisher, name, and version."
}

Push-Location $extensionRoot
try {
    npm run vscode:prepublish
} finally {
    Pop-Location
}

$installRoot = Join-Path $env:USERPROFILE ".vscode\extensions"
$target = Join-Path $installRoot "$publisher.$name-$version"
$installRootFull = Resolve-FullPath $installRoot
$targetFull = Resolve-FullPath $target
$targetName = Split-Path -Leaf $targetFull
$expectedTargetName = "$publisher.$name-$version"
if (-not $targetFull.StartsWith($installRootFull, [System.StringComparison]::OrdinalIgnoreCase) -or $targetName -ne $expectedTargetName) {
    throw "Refusing to install outside the VS Code extensions directory: $targetFull"
}

if (Test-Path $targetFull) {
    Remove-Item -LiteralPath $targetFull -Recurse -Force
}

New-Item -ItemType Directory -Force $targetFull | Out-Null
New-Item -ItemType Directory -Force (Join-Path $targetFull "out") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $targetFull "apk") | Out-Null

Copy-RequiredFile (Join-Path $extensionRoot "package.json") (Join-Path $targetFull "package.json")
Copy-RequiredFile (Join-Path $extensionRoot "launcher.js") (Join-Path $targetFull "launcher.js")
Copy-RequiredFile (Join-Path $extensionRoot "LICENSE") (Join-Path $targetFull "LICENSE")
Copy-RequiredFile (Join-Path $extensionRoot "out\extension.js") (Join-Path $targetFull "out\extension.js")
Copy-RequiredFile (Join-Path $extensionRoot "out\standalone-server.js") (Join-Path $targetFull "out\standalone-server.js")
Copy-RequiredFile (Join-Path $apkRoot "app-debug.apk") (Join-Path $targetFull "apk\app-debug.apk")
Copy-RequiredFile (Join-Path $apkRoot "app-debug.apk.sha256") (Join-Path $targetFull "apk\app-debug.apk.sha256")

$sharedApkRoot = Join-Path $installRoot "apk"
New-Item -ItemType Directory -Force $sharedApkRoot | Out-Null
Copy-RequiredFile (Join-Path $apkRoot "app-debug.apk") (Join-Path $sharedApkRoot "app-debug.apk")
Copy-RequiredFile (Join-Path $apkRoot "app-debug.apk.sha256") (Join-Path $sharedApkRoot "app-debug.apk.sha256")

Get-ChildItem -Path $installRoot -Directory -Filter "$publisher.$name-*" | ForEach-Object {
    $installedApkRoot = Join-Path $_.FullName "apk"
    New-Item -ItemType Directory -Force $installedApkRoot | Out-Null
    Copy-RequiredFile (Join-Path $apkRoot "app-debug.apk") (Join-Path $installedApkRoot "app-debug.apk")
    Copy-RequiredFile (Join-Path $apkRoot "app-debug.apk.sha256") (Join-Path $installedApkRoot "app-debug.apk.sha256")
}

Write-Host "Installed $publisher.$name $version to $targetFull"
Restart-RemoteCodeExtensionHost -Port (Get-ConfiguredPort 8799) -ExpectedVersion $version -WorkspacePath $repoRoot
