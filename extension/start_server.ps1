# start_server.ps1 — Запуск Remote Code on PC сервера
# Этот скрипт вызывается Планировщиком задач при старте ПК и выходе из сна

$logFile = "$env:USERPROFILE\.remote_code_server.log"
$serverDir = "C:\Users\Admin\Documents\git\remote_code_on_pc\extension"

function Write-Log {
    param([string]$msg)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp $msg" | Out-File -FilePath $logFile -Encoding UTF8 -Append
}

Write-Log "=== Запуск Remote Code Server ==="

# Проверяем, не запущен ли уже
$existing = Get-NetTCPConnection -LocalPort 8799 -ErrorAction SilentlyContinue
if ($existing) {
    Write-Log "Порт 8799 уже занят (процесс уже запущен). Выход."
    exit 0
}

# Переходим в директорию сервера
try {
    Push-Location $serverDir
    Write-Log "Запуск: node launcher.js"
    
    # Запускаем в скрытом окне (без видимого терминала)
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "node.exe"
    $psi.Arguments = "launcher.js"
    $psi.WorkingDirectory = $serverDir
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    
    $proc = [System.Diagnostics.Process]::Start($psi)
    Write-Log "Процесс запущен, PID: $($proc.Id)"
    
    # Небольшая задержка и проверка
    Start-Sleep -Seconds 2
    $check = Get-NetTCPConnection -LocalPort 8799 -ErrorAction SilentlyContinue
    if ($check) {
        Write-Log "✅ Сервер успешно запущен на порту 8799"
    } else {
        Write-Log "⚠️ Сервер не обнаружен на порту 8799 — возможно, ошибка запуска"
    }
} catch {
    Write-Log "❌ Ошибка: $_"
} finally {
    Pop-Location
}
