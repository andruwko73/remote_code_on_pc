param(
    [string]$BaseUrl = "http://127.0.0.1:8799",
    [string]$Token = "",
    [string]$SearchQuery = "Remote Code",
    [int]$TimeoutSeconds = 20,
    [switch]$SkipWebSocket
)

$ErrorActionPreference = "Stop"

function New-Headers {
    $headers = @{}
    if ($Token.Trim()) {
        $headers["Authorization"] = "Bearer $($Token.Trim())"
    }
    return $headers
}

function Resolve-ConfiguredToken {
    if ($Token.Trim()) {
        return
    }
    $settingsPath = Join-Path $env:APPDATA "Code\User\settings.json"
    if (-not (Test-Path $settingsPath)) {
        return
    }
    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $configured = [string]$settings.'remoteCodeOnPC.authToken'
        if ($configured.Trim()) {
            $script:Token = $configured.Trim()
            Write-Host "Using Remote Code token from VS Code settings."
        }
    } catch {
        Write-Host "Could not read Remote Code token from VS Code settings: $($_.Exception.Message)"
    }
}

function Invoke-Json([string]$Path) {
    $uri = "$($BaseUrl.TrimEnd('/'))$Path"
    return Invoke-RestMethod -UseBasicParsing -TimeoutSec $TimeoutSeconds -Headers (New-Headers) -Uri $uri
}

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) {
        throw $Message
    }
    Write-Host "OK: $Message"
}

function Test-WebSocketGreeting {
    if ($SkipWebSocket) {
        Write-Host "SKIP: WebSocket greeting"
        return
    }

    $client = [System.Net.WebSockets.ClientWebSocket]::new()
    if ($Token.Trim()) {
        $client.Options.SetRequestHeader("Authorization", "Bearer $($Token.Trim())")
    }
    $uriText = $BaseUrl.TrimEnd('/') -replace '^http:', 'ws:' -replace '^https:', 'wss:'
    $uri = [Uri]"$uriText/ws"
    $cts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSeconds))
    try {
        [void]$client.ConnectAsync($uri, $cts.Token).GetAwaiter().GetResult()
        $buffer = New-Object byte[] 8192
        $segment = [ArraySegment[byte]]::new($buffer)
        $result = $client.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
        $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
        $json = $text | ConvertFrom-Json
        Assert-True ($json.type -eq "connected") "WebSocket sends connected greeting"
    } finally {
        if ($client.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
            [void]$client.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
        }
        $client.Dispose()
        $cts.Dispose()
    }
}

Resolve-ConfiguredToken

$status = Invoke-Json "/api/status"
Assert-True ($status.serverVersion -ne $null) "status exposes extension serverVersion"
Assert-True ($status.appApk -ne $null -and $status.appApk.sha256) "status exposes verified APK metadata"

$threads = Invoke-Json "/api/codex/threads"
Assert-True ($threads.PSObject.Properties.Name -contains "threads") "codex threads endpoint responds"

$threadId = ""
$threadItems = @($threads.threads)
if ($threads.currentThreadId) {
    $threadId = [string]$threads.currentThreadId
} elseif ($threadItems.Count -gt 0) {
    $threadId = [string]$threadItems[0].id
}

$historyPath = "/api/codex/history"
if ($threadId) {
    $historyPath += "?threadId=$([Uri]::EscapeDataString($threadId))"
}
$history = Invoke-Json $historyPath
Assert-True ($history.PSObject.Properties.Name -contains "messages") "codex history endpoint responds"

$searchPath = "/api/search?q=$([Uri]::EscapeDataString($SearchQuery))&limit=8"
$search = Invoke-Json $searchPath
Assert-True ($search.PSObject.Properties.Name -contains "results") "deep search endpoint responds"

$tunnel = Invoke-Json "/api/tunnel/status"
Assert-True ($tunnel -ne $null) "tunnel status endpoint responds"

Test-WebSocketGreeting

$publicUrl = ""
if ($status.remoteCode -and $status.remoteCode.publicUrl) {
    $publicUrl = [string]$status.remoteCode.publicUrl
} elseif ($status.remoteCode -and $status.remoteCode.tunnelUrl) {
    $publicUrl = [string]$status.remoteCode.tunnelUrl
}
if ($publicUrl.Trim()) {
    $previousBaseUrl = $BaseUrl
    try {
        $BaseUrl = $publicUrl.TrimEnd("/")
        $publicStatus = Invoke-Json "/api/status"
        Assert-True ($publicStatus.remoteCode -ne $null) "configured public URL responds"
    } finally {
        $BaseUrl = $previousBaseUrl
    }
} else {
    Write-Host "SKIP: configured public URL is not set"
}

Write-Host "E2E smoke checks completed."
