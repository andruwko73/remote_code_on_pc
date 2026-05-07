$ErrorActionPreference = "Stop"

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
    npm run compile
} finally {
    Pop-Location
}

$installRoot = Join-Path $env:USERPROFILE ".vscode\extensions"
$target = Join-Path $installRoot "$publisher.$name-$version"
New-Item -ItemType Directory -Force $target | Out-Null
New-Item -ItemType Directory -Force (Join-Path $target "out") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $target "apk") | Out-Null

Copy-Item -Force (Join-Path $extensionRoot "package.json") (Join-Path $target "package.json")
Copy-Item -Force (Join-Path $extensionRoot "launcher.js") (Join-Path $target "launcher.js")
Copy-Item -Recurse -Force (Join-Path $extensionRoot "out\*") (Join-Path $target "out")

$sourceNodeModules = Join-Path $extensionRoot "node_modules"
if (Test-Path $sourceNodeModules) {
    Copy-Item -Recurse -Force $sourceNodeModules (Join-Path $target "node_modules")
}

Copy-Item -Force (Join-Path $apkRoot "app-debug.apk") (Join-Path $target "apk\app-debug.apk")
Copy-Item -Force (Join-Path $apkRoot "app-debug.apk.sha256") (Join-Path $target "apk\app-debug.apk.sha256")

$sharedApkRoot = Join-Path $installRoot "apk"
New-Item -ItemType Directory -Force $sharedApkRoot | Out-Null
Copy-Item -Force (Join-Path $apkRoot "app-debug.apk") (Join-Path $sharedApkRoot "app-debug.apk")
Copy-Item -Force (Join-Path $apkRoot "app-debug.apk.sha256") (Join-Path $sharedApkRoot "app-debug.apk.sha256")

Get-ChildItem -Path $installRoot -Directory -Filter "$publisher.$name-*" | ForEach-Object {
    $installedApkRoot = Join-Path $_.FullName "apk"
    New-Item -ItemType Directory -Force $installedApkRoot | Out-Null
    Copy-Item -Force (Join-Path $apkRoot "app-debug.apk") (Join-Path $installedApkRoot "app-debug.apk")
    Copy-Item -Force (Join-Path $apkRoot "app-debug.apk.sha256") (Join-Path $installedApkRoot "app-debug.apk.sha256")
}

Write-Host "Installed $publisher.$name $version to $target"
Write-Host "Run Developer: Reload Window in VS Code to activate updated extension code."
