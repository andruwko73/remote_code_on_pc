@echo off
:: Запуск Remote Code on PC сервера (автозагрузка)
:: Запускается при входе пользователя в Windows

cd /d "C:\Users\Admin\Documents\git\remote_code_on_pc\extension"

:: Проверяем, не занят ли порт 8799
netstat -ano | findstr ":8799 " >nul 2>&1
if %errorlevel% equ 0 (
    :: Порт занят — сервер уже запущен
    exit /b
)

:: Запускаем сервер в скрытом окне
start /min "" node launcher.js
