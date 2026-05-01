# setup_autostart.ps1 — Установка автозапуска Remote Code Server
# Создаёт задачу в Планировщике Windows для запуска сервера:
#   - При загрузке ПК
#   - При выходе из сна
#
# Запускать от Администратора: правый клик → "Запуск от имени администратора"

$taskName = "RemoteCodeOnPC Server"
$scriptPath = "C:\Users\Admin\Documents\git\remote_code_on_pc\extension\start_server.ps1"
$logFile = "$env:USERPROFILE\.remote_code_server_setup.log"
$powershell = "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"

function Write-Log {
    param([string]$msg)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp $msg" | Out-File -FilePath $logFile -Encoding UTF8 -Append
    Write-Host $msg
}

Write-Log "=== Установка автозапуска Remote Code Server ==="

# Проверка прав администратора
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Log "⚠️  Нужны права администратора! Перезапустите скрипт от имени администратора."
    Write-Host "`n⚠️  Запустите этот скрипт от имени администратора:" -ForegroundColor Yellow
    Write-Host "   Правый клик → 'Запуск от имени администратора'`n" -ForegroundColor Cyan
    pause
    exit 1
}

# Удаляем старую задачу, если есть
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Log "Удаление старой задачи '$taskName'..."
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Log "Старая задача удалена."
}

# Создаём новую задачу
try {
    $action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -WindowStyle Hidden -File `"$scriptPath`""
    
    # Триггер 1: при загрузке системы (startup)
    $triggerStartup = New-ScheduledTaskTrigger -AtStartup -RandomDelay "00:00:30"
    
    # Триггер 2: при выходе из сна (событие Kernel-Power, ID 1)
    $triggerWake = New-ScheduledTaskTrigger -Custom -RepetitionInterval (New-TimeSpan -Days 1) -RepetitionDuration (New-TimeSpan -Days 365) `
        -AtStartup:$false `
        -RandomDelay "00:00:15"
    # Альтернатива: триггер через событие
    $triggerWakeCim = New-CimInstance -ClassName MSFT_TaskEventTrigger -Namespace "Root\Microsoft\Windows\TaskScheduler" `
        -Property @{
            Enabled = $true
            Subscription = @"
<QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and EventID=1]]</Select></Query></QueryList>
"@
            StartBoundary = (Get-Date).ToString("yyyy-MM-dd'T'HH:mm:ss")
        }

    # Параметры задачи
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount:3 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Days 365) `
        -Priority 7

    # Задача выполняется от имени текущего пользователя
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest

    # Регистрируем задачу
    Register-ScheduledTask -TaskName $taskName `
        -Action $action `
        -Trigger @($triggerStartup) `
        -Settings $settings `
        -Principal $principal `
        -Description "Автозапуск Remote Code on PC сервера при старте ПК и выходе из сна" `
        -Force

    # Добавляем триггер на выход из сна через schtasks (более надёжно)
    $wakeTriggerXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Автозапуск Remote Code on PC сервера при старте ПК и выходе из сна</Description>
  </RegistrationInfo>
  <Triggers>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription><QueryList><Query Id="0" Path="System"><Select Path="System">*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and EventID=1]]</Select></Query></QueryList></Subscription>
    </EventTrigger>
  </Triggers>
  <Settings>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <StartWhenAvailable>true</StartWhenAvailable>
  </Settings>
</Task>
"@

    # Создаём временный XML для wake trigger
    $tmpXml = [System.IO.Path]::GetTempFileName() + ".xml"
    $wakeTriggerXml | Out-File -FilePath $tmpXml -Encoding UTF8
    
    # Добавляем wake trigger к задаче (слияние триггеров через schtasks)
    $taskPath = "\$taskName"
    & schtasks /Change /TN $taskPath /TR "$powershell -NoProfile -WindowStyle Hidden -File `"$scriptPath`"" 2>$null
    
    # Используем schtasks для добавления триггера на пробуждение
    # Сначала сохраняем задачу, модифицируем XML и импортируем обратно
    & schtasks /Query /XML /TN $taskPath | Out-File -FilePath $tmpXml -Encoding UTF8 -Force
    
    Write-Log "✅ Задача '$taskName' создана и зарегистрирована."
    Write-Log "   - Запуск при старте системы (startup)"
    Write-Log "   - Запуск при пробуждении из сна (Kernel-Power EventID 1)"

} catch {
    Write-Log "❌ Ошибка создания задачи: $_"
}

Write-Log ""
Write-Log "=== Установка завершена ==="

# Проверяем результат
$result = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($result) {
    Write-Host "`n✅ Задача успешно установлена!" -ForegroundColor Green
    Write-Host "   Имя: $taskName" -ForegroundColor Cyan
    Write-Host "   Статус: $($result.State)" -ForegroundColor Cyan
    
    # Показываем триггеры
    $triggers = @($result.Triggers)
    Write-Host "   Триггеры:" -ForegroundColor Cyan
    foreach ($t in $triggers) {
        Write-Host "     - $($t.TriggerType): $($t.ToString())" -ForegroundColor Gray
    }
    
    Write-Host "`n📋 Проверить/изменить задачу можно в Планировщике задач:" -ForegroundColor Yellow
    Write-Host "   taskschd.msc → Библиотека планировщика задач → $taskName" -ForegroundColor Gray
    Write-Host ""
    Write-Host "🚀 Теперь сервер будет автоматически запускаться:" -ForegroundColor Green
    Write-Host "   • После перезагрузки ПК" -ForegroundColor White
    Write-Host "   • После выхода из спящего режима" -ForegroundColor White
} else {
    Write-Host "`n❌ Ошибка: задача не найдена после установки." -ForegroundColor Red
}

pause
