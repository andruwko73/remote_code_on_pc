# Remote Code on PC

Remote Code on PC связывает Android-приложение с расширением VS Code. Телефон работает как удаленный интерфейс к Codex-подобному чату: можно выбирать проект, вести чаты, видеть ход работы, подтверждать действия, открывать изменения и обновлять APK из самого приложения.

## Состав

- `extension/` - расширение VS Code с HTTP/WebSocket API и webview-чатом.
- `android/` - Android-приложение на Kotlin и Jetpack Compose.
- `apk/app-debug.apk` - актуальный APK для sideload-установки и обновления через расширение.

## Текущее состояние

- Android APK: `1.0.98`.
- VS Code extension: `1.1.95`.
- Порт API по умолчанию: `8799`.
- Внешний доступ требует публичный URL и токен.
- Последняя проверка: `npm run compile`, `node test-extension.js` (`193/193`), `:app:testDebugUnitTest`, `:app:assembleRelease`.

## Что реализовано

- Единый Codex-экран в Android вместо отдельных входов для старого чата и VS Code-экрана.
- Проекты и чаты связаны через `projectId`, `workspaceName` и `workspacePath`; новый чат из Android создается в выбранном проекте.
- Чат в расширении и приложении приближен к Codex: компактный composer, список проектов/чатов, centered user bubble, toolbar сообщений, stop generation, вложения, голосовой ввод.
- Activity timeline показывает публичные шаги работы: Codex, команды, git, тесты, diagnostics, файлы и изменения.
- Change card поддерживает список файлов, просмотр diff по файлу, review и undo. Undo идет через approve/deny flow, а не выполняется сразу.
- Терминальные команды через API не запускаются напрямую: они создают approval action.
- Внешний HTTP/WebSocket доступ защищен токеном; без токена публичные endpoints отдают только минимальный статус.
- В приложении убрано ручное поле порта для подключения; внешний режим работает через полный публичный URL.
- Добавлен pairing payload: расширение копирует одну строку `remote-code-pair:...`, приложение может вставить ее и заполнить URL/токен.
- Обновление APK сначала пробует endpoint подключенного расширения, делает preflight `/api/app/apk/status`, проверяет SHA-256 и подпись, затем открывает системный установщик.

## Установка расширения

Для локальной разработки:

```powershell
cd extension
npm run install:local
```

После обновления установленной копии расширения в уже открытом VS Code выполните `Developer: Reload Window`.

Из VSIX:

```powershell
code --install-extension extension/remote-code-on-pc-*.vsix --force
```

## Установка Android APK

Готовый APK лежит здесь:

```text
apk/app-debug.apk
```

При sideload-установке Android может запросить разрешение на установку из неизвестного источника или показать проверку Play Protect. Это ожидаемо для APK вне Play Store.

## Подключение

Локальная сеть:

1. Запустите расширение в VS Code.
2. Убедитесь, что телефон и ПК в одной сети.
3. В приложении выберите локальный режим.
4. Укажите IP ПК и токен, если он включен в расширении.
5. Нажмите `Подключиться`.

Внешняя сеть:

1. Настройте постоянный публичный URL на роутере/DDNS/reverse proxy.
2. Пробросьте или проксируйте запросы на API расширения.
3. В VS Code откройте `Remote Code on PC: Подключение`.
4. Создайте/скопируйте токен или `Copy Android pairing payload`.
5. В приложении включите внешний режим и вставьте URL/токен либо pairing payload.

Рекомендуемый формат URL:

```text
https://your-domain.example
http://your-domain.example:8799
```

## Проверка

Расширение:

```powershell
cd extension
npm run compile
node test-extension.js
```

Android:

```powershell
cd android
./gradlew :app:testDebugUnitTest :app:assembleRelease
```

Обновление APK-артефакта:

```powershell
Copy-Item android/app/build/outputs/apk/release/app-release.apk apk/app-debug.apk -Force
Get-FileHash apk/app-debug.apk -Algorithm SHA256
```

Запишите SHA-256 в:

```text
apk/app-debug.apk.sha256
```

## Публикация

Перед push:

1. Соберите расширение и Android release APK.
2. Обновите `apk/app-debug.apk` и `apk/app-debug.apk.sha256`.
3. Запустите тесты.
4. Установите локальную копию расширения или выполните reload VS Code.
5. Проверьте `/api/app/apk/status`, чтобы расширение отдавало новую версию APK.

## Что осталось улучшить

- Добавить QR-сканер поверх уже готового pairing payload.
- Расширить diff viewer до полноценного просмотра нескольких файлов с подсветкой.
- Сделать отдельные визуальные группы activity timeline еще ближе к Codex desktop.
- Провести дополнительный ручной прогон на реальном устройстве после каждого изменения updater/connectivity.
