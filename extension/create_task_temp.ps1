# Временный скрипт для создания задачи Remote Code on PC
schtasks /Delete /TN "RemoteCodeOnPC Server" /F 2>$null

$action = New-ScheduledTaskAction -Execute "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"C:\Users\Admin\Documents\git\remote_code_on_pc\extension\start_server.ps1`""
$triggerBoot = New-ScheduledTaskTrigger -AtStartup -RandomDelay "00:00:15"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::MaxValue)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType S4U -RunLevel Highest

Register-ScheduledTask -TaskName "RemoteCodeOnPC Server" -Action $action -Trigger $triggerBoot -Settings $settings -Principal $principal -Description "Remote Code on PC server" -Force

Write-Host "`n=== ГОТОВО ===" -ForegroundColor Green
Get-ScheduledTask -TaskName "RemoteCodeOnPC Server" | Select-Object TaskName, State
pause
