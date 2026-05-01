# Создание задачи в Планировщике Windows
# Запустите этот файл от имени администратора:
#   Правый клик → "Запуск от имени администратора"
# Создаёт задачу с двумя триггерами:
#   1. При загрузке ПК (через 15с)
#   2. При выходе из спящего режима

$taskName = "RemoteCodeOnPC Server"
$scriptPath = "C:\Users\Admin\Documents\git\remote_code_on_pc\extension\start_server.cmd"

Write-Host "=== Установка задачи в Планировщик Windows ===" -ForegroundColor Cyan
Write-Host "Запуск: $scriptPath" -ForegroundColor Gray
Write-Host ""

# Удаляем старую задачу (если есть)
schtasks /Delete /TN $taskName /F 2>$null

# Создаём задачу через XML для поддержки двух триггеров
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>Admin</Author>
    <Description>Автозапуск сервера RemoteCodeOnPC при загрузке и выходе из сна</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT15S</Delay>
    </BootTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="System"&gt;&lt;Select Path="System"&gt;*[System[Provider[@Name='Microsoft-Windows-Kernel-Power'] and (EventID=1)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
      <Delay>PT10S</Delay>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>Admin</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <Enabled>true</Enabled>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>cmd</Command>
      <Arguments>/c "$scriptPath"</Arguments>
    </Exec>
  </Actions>
</Task>
"@

# Сохраняем XML во временный файл
$tmpXml = [System.IO.Path]::GetTempFileName() + ".xml"
[System.IO.File]::WriteAllText($tmpXml, $xml, [System.Text.Encoding]::Unicode)

# Регистрируем задачу из XML
schtasks /Create /TN $taskName /XML $tmpXml /F

# Чистим временный файл
Remove-Item $tmpXml -Force

if ($LASTEXITCODE -eq 0) {
    Write-Host "Задача создана:" -ForegroundColor Green
    Write-Host "   - При загрузке ПК (через 15с)" -ForegroundColor White
    Write-Host "   - При выходе из сна (через 10с)" -ForegroundColor White
    Write-Host "   - От имени текущего пользователя" -ForegroundColor White
    Write-Host "   - С наивысшими правами" -ForegroundColor White
} else {
    Write-Host "Ошибка создания задачи (код: $LASTEXITCODE)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Убедитесь, что запустили скрипт от имени администратора:" -ForegroundColor Yellow
    Write-Host "   Правый клик -> 'Запуск от имени администратора'" -ForegroundColor Cyan
}

pause
