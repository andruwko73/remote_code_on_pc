# Codex / Remote Code UI Gap Analysis

Дата ревизии: 2026-05-12.

## Главная продуктовая цель

Remote Code должен ощущаться как мобильное и VS Code-зеркало Codex Desktop, а не как отдельный агент. Пользователь видит текущий проект, чаты этого проекта, ход работы модели, действия, файлы, проверки и обновление APK без ручной возни с портами.

## Текущий статус

| Зона | VS Code extension | Android app | Статус |
| --- | --- | --- | --- |
| Чат | Codex-like webview, сообщения пользователя справа, hover actions | Единый `CodexScreen`, сообщения пользователя справа, compact composer | Закрыто |
| История | Sidebar с проектами и чатами | Drawer с проектами и чатами | Закрыто |
| Проекты | `workspaceName`, `workspacePath`, `projectId` в thread summaries | Persistent project switcher и сохранение выбранного проекта | Закрыто |
| Live-информация | WebSocket events, live client count, work summary | WebSocket refresh, action timeline, work summary | Закрыто |
| Изменённые файлы | Change card, review, undo, diff/open file | Change card, multi-file diff dialog, review, undo | Закрыто |
| Поиск | `/api/search` + QuickPick по сообщениям и файлам | Search dialog по сообщениям и файлам | Закрыто |
| Обновление APK | `/api/app/apk/status`, SHA-256, bundled APK | Preflight, SHA/signature check, installer handoff | Закрыто |
| Pairing | QR и `remote-code-pair` payload | Импорт/сканирование pairing payload | Закрыто |
| Visual QA | Screenshot capture + baseline compare | Screenshot capture + baseline compare | Закрыто |
| E2E smoke | API/WebSocket/search/tunnel smoke script | Проверяется через тот же серверный smoke | Закрыто |

## Закрытые расхождения

### Проекты и чаты

- Thread summaries получают `workspaceName`, `workspacePath` и `projectId`.
- Codex session `.jsonl` читается до `session_meta.cwd`, поэтому импортированные Codex Desktop сессии тоже имеют проект.
- Новый чат в расширении наследует проект текущего выбранного чата, если проект не передан явно через API.
- Android показывает persistent project switcher рядом с названием чата и сохраняет выбор между перезапусками.
- Drawer Android и sidebar расширения фильтруют проекты/чаты.

### Видимость работы модели

- Сырые скрытые рассуждения не показываются.
- Пользователь видит публичные этапы: сбор контекста, ожидание модели, поток ответа, команды, git, diff, тесты, ошибки.
- Длительность работы и количество выполненных команд считаются сервером по текущему turn и одинаково отображаются в расширении и Android.

### Файлы, diff и review

- Change cards строятся из серверного `changeSummary` и git-директив.
- Карточки компактны по умолчанию и разворачиваются вручную.
- Multi-file diff доступен в Android и расширении.
- Review/undo идут через action flow, а не через скрытую прямую команду.

### Поиск

- `/api/search` ищет по сообщениям Remote Code/Codex и текстовым файлам открытого workspace.
- Расширение открывает результаты через QuickPick: сообщение переключает чат, файл открывается в редакторе.
- Android показывает компактный search dialog: сообщение переключает чат, файл открывается через существующий file viewer.

### Обновления и внешний доступ

- APK endpoint отдаёт метаданные версии, размер и SHA-256.
- Android updater сначала пробует подключенное расширение, затем fallback-источники.
- Install script расширения пересобирает bundle, ставит минимальный payload и проверяет свежий `serverVersion`.
- Внешний доступ требует токен; public status остаётся минимальным.
- QR/pairing payload переносит URL и токен в Android без ручного ввода.

## Оставшиеся риски

- Реальный внешний доступ зависит от роутера, KeenDNS/DDNS, провайдера и токена. `scripts/run-e2e-smoke.ps1` проверяет настроенный public URL, если он есть, но не может заменить проверку с отдельной мобильной сети.
- Visual baseline чувствителен к размеру окна VS Code, системному времени и текущему содержимому чата. Поэтому сравнение допускает небольшой pixel-diff и baseline нужно обновлять только после ручного просмотра новых скриншотов.
- Автоматический UI smoke не отправляет запрос модели, чтобы не тратить лимиты. Live-generation сценарий остаётся ручной проверкой или отдельным тестом перед релизом.

## Следующий порядок проверки перед релизом

1. `npm run compile`
2. `npm run bundle`
3. `node test-extension.js`
4. `powershell -ExecutionPolicy Bypass -File ..\scripts\run-e2e-smoke.ps1` из каталога `extension` или от корня с полным путём
5. `powershell -ExecutionPolicy Bypass -File scripts\capture-visual-regression.ps1`
6. `.\gradlew.bat :app:testDebugUnitTest :app:assembleRelease`
7. Установка VSIX и APK на текущие устройства.
