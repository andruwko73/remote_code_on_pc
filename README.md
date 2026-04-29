# Remote Code on PC 🚀

**Удаленное управление VS Code с Android-телефона**

Android-приложение для подключения к VS Code на Windows ПК. Позволяет управлять файлами, общаться с AI-агентами (GitHub Copilot), просматривать ошибки и запускать команды прямо с телефона.

## 📱 Возможности

| Функция | Описание |
|---|---|
| 💬 **Чат с AI** | Отправка сообщений в Copilot Chat, выбор агента (Ask, Explain, Fix, Review, Explore и др.) |
| 📂 **Файловый менеджер** | Просмотр дерева папок, открытие/чтение файлов с подсветкой синтаксиса |
| 🔍 **Ошибки** | Мониторинг диагностики VS Code — ошибки и предупреждения проекта |
| ⚡ **Терминал** | Отправка команд в терминал VS Code (в разработке) |
| 🖥 **Статус** | Информация о VS Code — версия, открытые папки, активный файл |

## 🏗 Архитектура

```
┌─────────────────────────┐       HTTP/WS        ┌──────────────────────┐
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
