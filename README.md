# Remote Code on PC

Remote Code on PC связывает Android-приложение с расширением VS Code. Телефон работает как удаленный интерфейс к Codex-подобному чату: можно выбирать проект, вести чаты, видеть ход работы, подтверждать действия, открывать изменения и обновлять APK из самого приложения.

## Состав

- `extension/` - расширение VS Code с HTTP/WebSocket API и webview-чатом.
- `android/` - Android-приложение на Kotlin и Jetpack Compose.
- `apk/app-debug.apk` - актуальный APK для sideload-установки и обновления через расширение.

## Текущее состояние

- Android APK: `1.0.105`.
- VS Code extension: `1.1.103`.
- Порт API по умолчанию: `8799`.
- Внешний доступ требует публичный URL и токен.
- Последняя проверка: `npm run compile`, `node test-extension.js`, `:app:testDebugUnitTest`, `:app:assembleRelease`.

## Что реализовано

- Единый Codex-экран в Android вместо отдельных старых экранов чата и VS Code.
- Старые UI-файлы `ChatScreen` и `VSCodeScreen` удалены; старые маршруты совместимости ведут в `CodexScreen`.
- Проекты и чаты связаны через `projectId`, `workspaceName` и `workspacePath`; новый чат из Android создается в выбранном проекте.
- Чат в расширении и приложении приближен к Codex: компактный composer, список проектов/чатов, centered user bubble, toolbar сообщений, stop generation, вложения, голосовой ввод.
- В расширении служебные Remote Code действия убраны из основной шапки чата в меню `...`, чтобы webview был ближе к Codex: навигация, лента сообщений и composer без лишней панели управления.
- Правая панель работы в расширении теперь не занимает экран постоянно: ее можно открыть кнопкой панели в шапке или через меню `...`, состояние сохраняется при перерисовке webview.
- Визуальная лента чата доработана: выровнены размеры текста, боковые панели, composer, hover-toolbar сообщений, карточки вложений и отображение нумерованных списков.
- Чат показывает fenced code blocks и preview изображений: thumbnails в сообщениях, fullscreen preview по нажатию в расширении и Android.
- Activity timeline показывает публичные шаги работы: Codex, команды, git, тесты, diagnostics, файлы и изменения.
- Change card поддерживает список файлов, multi-file diff viewer с переключением файлов, подсветку diff, review и undo. Undo идет через approve/deny flow.
- Статистика change card в расширении и Android привязана к явному commit hash, не пересчитывается от текущего `HEAD`, показывает reviewable-файлы без бинарных APK/VSIX-артефактов и держит `+/-` в однострочном Codex-like header.
- Терминальные команды через API не запускаются напрямую: они создают approval action.
- Внешний HTTP/WebSocket доступ защищен токеном; без токена публичные endpoints отдают только минимальный статус.
- В приложении убрано ручное поле порта для подключения; внешний режим работает через полный публичный URL.
- Код подключения поддерживается двумя способами: `QR для телефона` из меню подключения расширения или вставка строки `remote-code-pair:...`.
- При ошибке внешнего подключения Android показывает диагностические шаги: URL/DNS, токен, `/api/status`, WebSocket/чат и APK endpoint.
- Обновление APK сначала пробует endpoint подключенного расширения, делает preflight `/api/app/apk/status`, проверяет SHA-256 и подпись, показывает источник/версию/размер/SHA, затем открывает системный установщик.

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
4. Выберите `QR для телефона`, чтобы открыть QR и одновременно скопировать код подключения.
5. В приложении включите внешний режим и нажмите `QR`; если камера недоступна, нажмите `Код` и вставьте скопированную строку. Под кнопками приложение напоминает, где взять QR и код в VS Code.

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

Скриншоты ручной проверки сохраняйте в:

```text
artifacts/screenshots/
```

Папка намеренно не хранит временные PNG в Git. При отчете прикладывайте нужные изображения из этой папки прямо в чат.

## UI review notes

- Расширение держит Codex-like структуру: левая навигация проектов/чатов, чистая верхняя панель, centered user bubble, action timeline, hover-actions, change-card и выводимая правая панель работы.
- Android повторяет тот же рабочий сценарий в мобильной компоновке: drawer проектов/чатов, компактный composer, inline action timeline, approval blocks, message toolbar и change-card.
- Намеренные отличия от Codex: экраны подключения, pairing, updater APK, диагностика внешнего доступа и служебные пункты Remote Code в меню `...`.
- Change-card считает reviewable text files как Codex; бинарные APK/VSIX-артефакты остаются в Git и обновлениях, но не увеличивают число файлов в header карточки.

## Публикация

Перед push:

1. Соберите расширение и Android release APK.
2. Обновите `apk/app-debug.apk` и `apk/app-debug.apk.sha256`.
3. Запустите тесты.
4. Установите локальную копию расширения или выполните reload VS Code.
5. Проверьте `/api/app/apk/status`, чтобы расширение отдавало новую версию APK.

## Осталось проверять регулярно

- Реальное внешнее подключение с телефона через мобильную сеть.
- Обновление APK кнопкой в приложении после каждого bump версии.
- QR pairing на реальном устройстве с камерой.
- Change card на реальном чате с несколькими измененными файлами.
