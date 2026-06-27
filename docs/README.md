# Протоколы ЭБ — v0.2.1

Десктопное приложение (Electron) для учёта проверки знаний по электробезопасности (ЭБ) и автоматической генерации протоколов в формате DOCX.

## Назначение

- Ведём базу работников, сроков и результатов проверки знаний.
- Формируем протоколы по шаблону `Протокол.docx` с подстановкой плейсхолдеров.
- Храним журнал протоколов с автонумерацией по годам.
- Синхронизируем базу между рабочими местами через FTP.

## Стек

| Компонент | Технология |
|----------|------------|
| Оболочка | Electron 33 |
| База данных | SQLite (better-sqlite3-multiple-ciphers) |
| Генерация DOCX | docxtemplater + pizzip |
| Импорт Excel | exceljs |
| Синхронизация | basic-ftp |
| Секреты | keytar (системное хранилище) |
| Сборка | electron-builder (nsis + portable) |

## Структура проекта

```
eb-protocols/
├─ app/                  # Electron: main, preload, renderer (UI)
│  ├─ main.js
│  ├─ preload.js
│  └─ renderer/
│     ├─ index.html
│     └─ app.js          # привязка UI к IPC-бэкенду
├─ backend/
│  ├─ db/
│  │  ├─ connection.js   # подключение, PRAGMA key через конструктор
│  │  ├─ initDb.js       # инициализация схемы
│  │  ├─ schema.sql
│  │  └─ repositories/   # employees, references, journal, events, sync, settings
│  ├─ import/
│  │  ├─ excelImporter.js
│  │  ├─ dataSheetParser.js   # обработка формул Excel
│  │  ├─ inputSheetParser.js
│  │  └─ rightsDetector.js
│  ├─ protocol/
│  │  ├─ protocolService.js
│  │  ├─ protocolNumbering.js
│  │  ├─ placeholderMap.js
│  │  └─ docxGenerator.js
│  ├─ sync/
│  │  ├─ syncService.js
│  │  ├─ ftpClient.js
│  │  ├─ backupService.js
│  │  ├─ restoreService.js
│  │  └─ conflictDetector.js
│  ├─ security/
│  │  ├─ dbPassword.js
│  │  ├─ keyStorage.js
│  │  ├─ ftpCredentials.js
│  │  └─ securityConfig.js
│  └─ paths.js
├─ templates/
│  └─ Протокол.docx
├─ data/                 # БД, бэкапы, готовые протоколы (создаётся автоматически)
├─ dist/                 # Собранные EXE
└─ docs/
```

## Быстрый старт (Windows)

1. Установите Node.js 20+.
2. Распакуйте архив проекта.
3. Откройте папку в терминале и выполните:
   ```bash
   npm install
   npm run init-db
   npm start
   ```
4. Для импорта данных из Excel:
   ```bash
   npm run import-excel -- "C:\path\to\данные.xlsx"
   ```
5. Проверка шаблона и генерации DOCX:
   ```bash
   npm run test-docx
   ```
6. Сборка portable EXE:
   ```bash
   npm run build:win
   ```

## NPM-команды

| Команда | Назначение |
|---------|------------|
| `npm start` | Запуск приложения |
| `npm run init-db` | Создание/инициализация БД |
| `npm run import-excel -- <файл>` | Импорт работников и справочников |
| `npm run test-docx` | Тестовая генерация протокола |
| `npm run build:win` | Сборка установщика Windows |

## IPC-эндпоинты (main.js → preload.js → app.js)

### Работники
| Канал | Описание |
|-------|----------|
| `employees:searchByLastName` | Поиск по фамилии (кириллица, регистронезависимый) |
| `employees:listAll` | Полный список работников (без фильтра) |
| `employees:getById` | Работник по ID + его права |
| `employees:create` | Добавить нового работника |
| `employees:update` | Обновить данные работника и его права |
| `employees:delete` | Удалить работника (soft delete: status='deleted') |

### Справочники
| Канал | Описание |
|-------|----------|
| `references:getAll` | Все активные справочники |
| `references:saveDepartment` | Добавить/обновить подразделение |
| `references:saveCommission` | Добавить/обновить комиссию |
| `references:saveChairman` | Добавить/обновить председателя |
| `references:saveMember` | Добавить/обновить члена комиссии |
| `references:saveKnowledgeScope` | Добавить/обновить объём знаний |
| `references:saveWorkRight` | Добавить/обновить право работ |
| `references:deleteDepartment` | Удалить подразделение |
| `references:deleteChairman` | Удалить председателя комиссии |
| `references:deleteMember` | Удалить члена комиссии |
| `references:deleteKnowledgeScope`| Удалить объём знаний |
| `references:deleteWorkRight` | Удалить право работ |
| `references:deleteCommission` | Удалить комиссию |

### Протоколы
| Канал | Описание |
|-------|----------|
| `protocols:getDraft` | Черновик протокола по форме |
| `protocols:getNextNumber` | Автономер по дате |
| `protocols:save` | Сохранить протокол (DOCX + журнал + автогенерация PDF) |
| `protocols:generatePdf` | Сгенерировать PDF на основе сохраненного DOCX |

### Журнал / Синхронизация / Безопасность / Дополнительно
| Канал | Описание |
|-------|----------|
| `journal:list` | Список журнала с фильтрами |
| `journal:stats` | Статистика по году |
| `sync:test` / `sync:upload` / `sync:download` | FTP-операции |
| `security:enableDbPassword` / `disableDbPassword` | Шифрование БД |
| `security:setFtpPassword` | Сохранить FTP-пароль в keytar |
| `shell:openFile` | Открыть сгенерированный DOCX или PDF файл |
| `schedule:exportExcel` | Экспорт графика на год в Excel с группировкой по месяцам |
| `dashboard:stats` | Получить статистику для Панели управления |

## Плейсхолдеры шаблона

Шаблон использует фигурные скобки `{...}`. Основные группы:

- **Реквизиты:** `{Номер}`, `{Дата}`, `{Причина}`, `{След_Дата}`
- **Комиссия:** `{Комиссия}`, `{Должность_ПК}`, `{ПК}`, `{Должность_ЧК_1..3}`, `{ЧК_1..3}`, `{инструкции}`
- **Проверяемый:** `{ФИО}`, `{Место_Работы}`, `{Должность}`, `{Дата_пред_проверки}`, `{пред_оценка}`
- **Результаты:** `{оценка_ЭБ}`, `{оценка_ОТ}`, `{оценка_ПБ}`, `{другие_ИОТ}`
- **Заключение:** `{оценка}`, `{Группа_ЭБ}`, `{Прод_Дублир}`, `{категория}`, `{права}`, `{категория_ЭУ}`

## Формат импорта Excel

Импортируется первый лист с данными (название листа не важно).

| Столбец | Содержание |
|---------|-----------|
| 1 | Фамилия |
| 2 | Имя |
| 3 | Отчество |
| 4 | ФИО (формула или текст) |
| 5 | Место работы (код подразделения) |
| 6 | Должность |
| 7 | Объём знаний (код) |
| 8 | Категория персонала |
| 9 | Группа по ЭБ (II–V) |
| 10 | Дата проверки знаний |
| 11 | Дата следующей проверки |
| 12 | Периодичность (лет) |
| 13+ | Столбцы прав (1 = да, пусто = нет) |

## База данных и безопасность

- Данные хранятся в SQLite (`eb_protocols.db` в каталоге с импортируемым Excel-файлом / в папке запуска портативного EXE).
- Ключ шифрования передаётся через опции конструктора `Database(path, {key})`.
- Пароли БД и FTP хранятся в системном хранилище (keytar), а не в БД.

## Синхронизация (FTP)

- База и `eb_protocols.meta.json` выгружаются/загружаются целиком.
- Перед загрузкой с сервера создаётся локальный бэкап.
- После скачивания БД открывается свежее подключение для обновления sync_state.
- Конфликты выявляются по ревизиям и датам изменения (`conflictDetector`).

## Сборка

```bash
npm run build:win
```

Результат в `dist/`:
- `Протоколы-ЭБ-0.1.0-x64.exe` — портативная версия

> **Важно:** `npmRebuild: false` в `package.json` отключает автоматический rebuild нативных модулей в electron-builder. Перед сборкой нужно вручную подставить правильные prebuilt для Electron:
> ```bash
> cd node_modules/better-sqlite3-multiple-ciphers
> npx prebuild-install --runtime electron --target 33.4.11 --arch x64 --platform win32
> ```
> Без этого electron-builder скачивает prebuilt для системного Node.js, и приложение падает с ошибкой `NODE_MODULE_VERSION mismatch`.
