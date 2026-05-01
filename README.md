# Remote Code on PC 🚀

**Удаленное управление VS Code и OpenAI Codex с Android-телефона**

Android-приложение для подключения к VS Code на Windows ПК. Позволяет управлять файлами, общаться с AI-агентами (GitHub Copilot), работать с OpenAI Codex, просматривать ошибки и запускать команды прямо с телефона — **по локальной сети или через интернет**.

## 📱 Возможности

| Функция | Описание |
|---|---|
| 💬 **Чат с AI Copilot** | Отправка сообщений в Copilot Chat, выбор агента (Ask, Explain, Fix, Review, Explore и др.) |
| 🤖 **OpenAI Codex** | Отдельный экран для Codex: выбор модели, отправка запросов, управление тредами |
| 📂 **Файловый менеджер** | Просмотр дерева папок, открытие/чтение файлов с подсветкой синтаксиса |
| 🔍 **Ошибки** | Мониторинг диагностики VS Code — ошибки и предупреждения проекта |
| ⚡ **Терминал** | Отправка команд в терминал VS Code |
| 🌐 **Интернет-доступ** | Встроенная поддержка ngrok для подключения из любой точки мира |
| 🖥 **Статус** | Информация о VS Code — версия, открытые папки, активный файл |

## 🔧 Быстрый старт

### 1. Расширение VS Code

```bash
cd extension
npm install
npm run compile   # или: npx tsc -p ./
```

В VS Code: `F5` (Run Extension) — сервер запустится автоматически на порту `8799`.

### 2. Сборка Android APK

**Требования:**
- Java JDK 17+ ([скачать](https://adoptium.net/))
- Android Studio ([скачать](https://developer.android.com/studio))

**Способ A — Android Studio (рекомендуется):**
1. File → Open → выбрать `android/` папку
2. Подождать синхронизацию Gradle
3. Build → Build Bundle(s) / APK → Build APK
4. APK появится: `android/app/build/outputs/apk/debug/app-debug.apk`

**Способ B — командная строка:**
```bash
cd android
# Убедитесь, что JAVA_HOME и ANDROID_HOME установлены
gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

### 3. Подключение

1. Установите APK на телефон
2. Убедитесь, что телефон в одной сети Wi-Fi с ПК (или используйте интернет-туннель)
3. В приложении введите IP-адрес ПК и порт 8799
4. Нажмите **"Подключиться"**

---

## 🌐 Интернет-доступ (через ngrok)

Если телефон **не в одной локальной сети** с ПК:

### На ПК:
1. Скачайте ngrok: https://ngrok.com/download
2. Разархивируйте `ngrok.exe` (или установите через `npm i -g ngrok`)
3. Запустите расширение в VS Code (автоматически)

### В VS Code (способ 1 — через палитру команд):
- `Ctrl+Shift+P` → `Remote Code on PC: Запустить/остановить интернет-туннель (ngrok)`
- Статус-бар покажет 🌐 когда туннель активен

### На телефоне (способ 2 — из приложения):
1. Откройте экран **Настройки** (шестерёнка в нижнем меню)
2. Нажмите **"Запустить туннель (ngrok)"**
3. Дождитесь статуса "🟢 Активен"
4. Включите переключатель **"Использовать туннель"**
5. Приложение автоматически переключится на интернет-канал

---

## 🔀 Переключение между VS Code Chat и Codex

| Экран | Функция |
|---|---|
| **Чат** | VS Code Copilot Chat: выбор агентов, история, отправка сообщений |
| **Codex** | OpenAI Codex: выбор модели, отправка запросов, потоки (threads) |

**Состояния полностью НЕЗАВИСИМЫ:**
- Переключение между экранами НЕ сбрасывает чат
- История VS Code и Codex хранятся отдельно
- Выбранные агенты/модели сохраняются при переключении

---

## 📡 API Эндпоинты (21 роут)

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/status` | Статус VS Code |
| GET | `/api/workspace/folders` | Папки проекта |
| POST | `/api/workspace/open` | Открыть папку |
| GET | `/api/workspace/tree` | Дерево файлов |
| GET | `/api/workspace/read-file` | Чтение файла |
| GET | `/api/chat/agents` | Агенты Copilot |
| POST | `/api/chat/send` | Отправить сообщение |
| GET | `/api/chat/history` | История чата |
| POST | `/api/chat/select-agent` | Выбрать агента |
| POST | `/api/chat/new` | Новый чат |
| GET | `/api/chat/conversations` | Список чатов |
| GET | `/api/diagnostics` | Ошибки проекта |
| POST | `/api/terminal/exec` | Команда в терминал |
| GET | `/api/codex/status` | Статус Codex CLI/Desktop |
| POST | `/api/codex/send` | Отправить запрос в Codex |
| GET/POST | `/api/codex/models` | Список/выбор моделей Codex |
| GET | `/api/codex/threads` | Потоки (threads) Codex |
| POST | `/api/codex/launch` | Запустить Codex Desktop |
| GET | `/api/tunnel/status` | Статус интернет-туннеля |
| POST | `/api/tunnel/start` | Запустить туннель ngrok |
| POST | `/api/tunnel/stop` | Остановить туннель |

**WebSocket**: `ws://<host>:8799` — push-уведомления (диагностика, статус чата).

---

## 📁 Структура проекта

```
remote_code_on_pc/
├── extension/                    # VS Code Extension (TypeScript)
│   ├── src/
│   │   ├── server.ts             # HTTP/WS сервер (22 хендлера, ~1200 строк)
│   │   └── extension.ts          # Точка входа, статус-бар, 4 команды
│   ├── test-extension.js         # Набор тестов (94 теста)
│   └── package.json
├── android/                      # Android App (Kotlin + Jetpack Compose)
│   ├── app/
│   │   └── src/main/java/com/remotecodeonpc/app/
│   │       ├── Models.kt                 # Все data-классы
│   │       ├── RemoteCodeApp.kt          # Scaffold, навигация, ConnectionScreen, SettingsScreen
│   │       ├── viewmodel/MainViewModel.kt # Состояние, API-методы, WebSocket
│   │       ├── network/
│   │       │   ├── ApiClient.kt          # Retrofit (все эндпоинты)
│   │       │   └── WebSocketClient.kt    # WS с авто-реконнектом
│   │       ├── ui/screens/
│   │       │   ├── DashboardScreen.kt    # Главная + Codex-карточка
│   │       │   ├── ChatScreen.kt         # Чат Copilot
│   │       │   ├── CodexScreen.kt        # Чат Codex
│   │       │   ├── FilesScreen.kt        # Файловый менеджер
│   │       │   └── DiagnosticsScreen.kt  # Ошибки проекта
│   │       ├── ui/navigation/Screen.kt   # 6 экранов в BottomNav
│   │       └── ui/theme/Color.kt         # Тёмная тема VS Code
│   ├── gradlew.bat               # Gradle Wrapper
│   └── build.gradle.kts           # MinSdk 26, Target 34
└── README.md
```

## ✅ Результаты тестирования

```
📊 94 теста — 94 пройдено ✅
   TypeScript компиляция: 0 ошибок
   API эндпоинты: 21/21
   Android файлы: 13/13
   Codex интеграция: 10/10
   Tunnel/Интернет: 5/5
```

---

## 🤖 Для чего нужен OpenAI Codex

OpenAI Codex — это AI-агент от OpenAI, который умеет:
- Автономно выполнять задачи по кодингу
- Работать с проектами любой сложности
- Выбирать и использовать модели GPT-5, o3, o4-mini и др.
- Создавать и запускать код в изолированной среде

**Установка Codex CLI на ПК:**
```bash
npm i -g @openai/codex
codex --version
```

Либо скачайте Codex Desktop из Microsoft Store.
│  Android App (Kotlin)   │ ◄──────────────────► │  VS Code Extension   │
│  Jetpack Compose UI     │       JSON API        │  TypeScript Server   │
│  Retrofit + OkHttp      │                       │  ws (WebSocket)      │
└─────────────────────────┘                       └──────────────────────┘
```

## 🛠 Установка

### 1. VS Code Extension

```bash
cd extension
npm install
npm run compile
```

Затем откройте папку `extension` в VS Code и нажмите `F5` (Run Extension).
Расширение запустится автоматически — сервер стартует на порту **8799**.

### 2. Android App

Откройте папку `android` в Android Studio:
- Соберите проект
- Установите APK на телефон

### 3. Подключение

1. Убедитесь, что ПК и телефон в одной Wi-Fi сети
2. Узнайте IP ПК (`ipconfig` в командной строке)
3. Откройте приложение, введите IP и порт (по умолчанию `8799`)
4. Нажмите "Подключиться" ✅

## 🔧 Конфигурация VS Code Extension

В настройках VS Code (`settings.json`):
```json
{
  "remoteCodeOnPC.port": 8799,
  "remoteCodeOnPC.host": "0.0.0.0",
  "remoteCodeOnPC.authToken": ""
}
```

## 🔒 Безопасность

- Для продакшна установите `authToken` в настройках расширения
- Приложение может работать только в локальной сети (VPN для удаленного доступа)
- По умолчанию расширение слушает `0.0.0.0:8799`

## 📋 API Эндпоинты

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/status` | Статус VS Code |
| GET | `/api/workspace/folders` | Папки и проекты |
| GET | `/api/workspace/tree?path=` | Дерево файлов |
| GET | `/api/workspace/read-file?path=` | Чтение файла |
| GET | `/api/chat/agents` | Список AI-агентов |
| POST | `/api/chat/send` | Отправить сообщение в чат |
| GET | `/api/chat/history` | История чата |
| POST | `/api/chat/select-agent` | Выбрать агента |
| GET | `/api/diagnostics` | Ошибки проекта |

## 🧪 Технологии

**VS Code Extension:**
- TypeScript, Node.js HTTP Server, ws (WebSocket)

**Android App:**
- Kotlin, Jetpack Compose, Material 3
- Retrofit + OkHttp, Gson
- ViewModel + StateFlow, Navigation Compose

## 📄 Лицензия

MIT
