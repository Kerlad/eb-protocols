const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");

const { openDb, setRuntimeDbKey, getRuntimeDbKey, rekeyDb, touchDbModified } = require("../backend/db/connection");
const { initDb } = require("../backend/db/initDb");
const employeesRepository = require("../backend/db/repositories/employeesRepository");
const referencesRepository = require("../backend/db/repositories/referencesRepository");
const journalRepository = require("../backend/db/repositories/journalRepository");
const settingsRepository = require("../backend/db/repositories/settingsRepository");
const eventsRepository = require("../backend/db/repositories/eventsRepository");
const protocolService = require("../backend/protocol/protocolService");
const { getNextProtocolNumber } = require("../backend/protocol/protocolNumbering");
const { todayLocal, addDaysLocal } = require("../backend/utils/dateUtils");
const { createTestProtocol } = require("../backend/protocol/docxGenerator");
const syncService = require("../backend/sync/syncService");
const ftpClient = require("../backend/sync/ftpClient");
const { createLocalBackup, listLocalBackups } = require("../backend/sync/backupService");
const { restoreFromBackup } = require("../backend/sync/restoreService");
const dbPassword = require("../backend/security/dbPassword");
const keyStorage = require("../backend/security/keyStorage");
const { buildFtpConfig, setFtpPassword, getFtpPassword } = require("../backend/security/ftpCredentials");
const paths = require("../backend/paths");

let mainWindow = null;

// Только один экземпляр приложения: второй запуск работает с той же базой и папкой данных
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
	app.quit();
}

function withDb(handler) {
	const db = openDb();
	try {
		return handler(db);
	} finally {
		db.close();
	}
}

function logEvent(event) {
	try {
		withDb((db) => eventsRepository.addEvent(db, event));
	} catch (error) {
		console.error("logEvent failed:", error.message);
	}
}

// Единый источник путей — backend/paths.js
// БД, бэкапы, протоколы хранятся в getUserDataDir()
// (EB_DATA_DIR / PORTABLE_EXECUTABLE_DIR / cwd/data)
const { DB_PATH } = require("../backend/db/connection");
const { getDataDir } = require("../backend/paths");
const DATA_DIR = getDataDir();

function dbPath() {
	return DB_PATH;
}

function dataDir() {
	return DATA_DIR;
}

function templatePath() {
	const packaged = process.resourcesPath
		? path.join(process.resourcesPath, "templates", "Протокол.docx")
		: null;
	if (packaged && fs.existsSync(packaged)) return packaged;
	return path.join(process.cwd(), "templates", "Протокол.docx");
}

function protocolsDir() {
	return path.join(DATA_DIR, "protocols");
}

function backupsDir() {
	return path.join(DATA_DIR, "backups");
}

function isInsideDir(baseDir, targetPath) {
	const rel = path.relative(baseDir, targetPath);
	return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function realOrSame(p) {
	try {
		return fs.realpathSync.native(p);
	} catch (error) {
		return p;
	}
}

// Путь к файлу протокола из записи журнала; только внутри папки протоколов, только .docx/.pdf
function resolveProtocolFile(storedPath, kind) {
	if (!storedPath) {
		throw new Error(kind === "pdf" ? "PDF для этого протокола не создан" : "Файл протокола не указан в журнале");
	}
	const baseDir = protocolsDir();
	const stored = String(storedPath);
	let full = path.isAbsolute(stored) ? path.resolve(stored) : path.resolve(baseDir, stored);
	if (!fs.existsSync(full)) {
		full = path.join(baseDir, path.basename(stored));
	}
	const ext = path.extname(full).toLowerCase();
	if (ext !== ".docx" && ext !== ".pdf") {
		throw new Error("Недопустимый тип файла протокола");
	}
	if (!fs.existsSync(full)) {
		throw new Error("Файл не найден на этом компьютере: " + path.basename(stored));
	}
	const realFull = realOrSame(full);
	if (!isInsideDir(realOrSame(baseDir), realFull)) {
		throw new Error("Файл находится вне папки протоколов, открытие запрещено");
	}
	return realFull;
}

async function applyDbEncryptionKey() {
	const password = await dbPassword.getStoredDbPassword();
	if (!password) {
		if (!keyStorage.isAvailable()) {
			console.warn("[security]", keyStorage.getAvailabilityMessage());
		}
		return;
	}

	const key = await dbPassword.getRuntimeKey();
	setRuntimeDbKey(key);
	if (!fs.existsSync(DB_PATH)) return;
	try {
		openDb().close();
		return;
	} catch (error) {
		// ниже — проверка, не осталась ли база открытой после версий до 1.0
	}

	// До 1.0 пароль сохранялся, но файл базы не шифровался. Шифруем его сейчас.
	setRuntimeDbKey(null);
	try {
		const plain = openDb();
		try {
			plain.prepare("SELECT count(*) FROM sqlite_master").get();
		} finally {
			plain.close();
		}
	} catch (error) {
		// база не открывается ни с ключом, ни без него — пусть initDb покажет ошибку с ключом
		setRuntimeDbKey(key);
		return;
	}

	createLocalBackup({ dbPath: DB_PATH, backupsDir: backupsDir(), reason: "before_encrypt" });
	const salt = (await dbPassword.getStoredSalt()) || dbPassword.generateSalt();
	const newKey = dbPassword.deriveKey(password, salt);
	rekeyDb(newKey);
	setRuntimeDbKey(newKey);
	await dbPassword.setDbPassword(password, salt);
	console.log("[security] База зашифрована сохранённым паролем (миграция со старой версии)");
}

async function resolveFtpProxy(config) {
	const { session } = require("electron");
	const proxyUrl = `ftp://${config.host}:${config.port || 21}`;
	try {
		const rule = await session.defaultSession.resolveProxy(proxyUrl);
		config._proxyRule = rule;
	} catch (e) {
		console.log("[proxy] resolveProxy failed:", e.message);
	}
	config._envProxy = process.env.FTP_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || null;
	config._noProxy = process.env.NO_PROXY || process.env.no_proxy || "";
}

function registerIpc() {
	ipcMain.handle("employees:searchByLastName", (event, lastName) =>
		withDb((db) => employeesRepository.findByLastName(db, lastName || ""))
	);

	ipcMain.handle("employees:listAll", () =>
		withDb((db) => employeesRepository.listAll(db))
	);

	ipcMain.handle("employees:getById", (event, id) =>
		withDb((db) => employeesRepository.findById(db, id))
	);

	ipcMain.handle("references:getAll", () =>
		withDb((db) => referencesRepository.listReferences(db))
	);

	ipcMain.handle("references:saveDepartment", (event, department) =>
		withDb((db) => referencesRepository.upsertDepartment(db, department))
	);

	ipcMain.handle("references:saveCommission", (event, commission) =>
		withDb((db) => referencesRepository.upsertCommission(db, commission))
	);

	ipcMain.handle("references:saveChairman", (event, chairman) =>
		withDb((db) => referencesRepository.upsertChairman(db, chairman))
	);

	ipcMain.handle("references:saveMember", (event, member) =>
		withDb((db) => referencesRepository.upsertMember(db, member))
	);

	ipcMain.handle("references:saveKnowledgeScope", (event, scope) =>
		withDb((db) => referencesRepository.upsertKnowledgeScope(db, scope))
	);

	ipcMain.handle("references:saveWorkRight", (event, right) =>
		withDb((db) => referencesRepository.upsertWorkRight(db, right))
	);

	ipcMain.handle("protocols:getDraft", (event, form) =>
		protocolService.getProtocolDraft(form || {})
	);

	ipcMain.handle("protocols:getNextNumber", (event, checkDate) =>
		withDb((db) => getNextProtocolNumber(db, checkDate || todayLocal()))
	);

	ipcMain.handle("protocols:save", async (event, form) => {
		const result = await protocolService.saveProtocol(form || {}, { protocolsDir: protocolsDir() });
		logEvent({
			event_type: "protocol_saved",
			level: "info",
			message: `Протокол №${result.protocol_number}/${result.protocol_year} сохранен`,
			details: result
		});
		return result;
	});

	ipcMain.handle("protocols:preview", async (event, form) => {
		return await protocolService.generatePreviewDocx(form || {});
	});

	ipcMain.handle("journal:list", (event, filters) =>
		withDb((db) => journalRepository.listJournal(db, filters || {}))
	);

	ipcMain.handle("journal:stats", (event, year) =>
		withDb((db) => journalRepository.getJournalStatsByYear(db, year || new Date().getFullYear()))
	);

	ipcMain.handle("journal:getLastByEmployee", (event, employeeId) =>
		withDb((db) => journalRepository.getLastByEmployeeId(db, employeeId))
	);

	ipcMain.handle("journal:delete", (event, id) =>
		withDb((db) => {
			// событие журнала пишется внутри deleteJournalRecord, в одной транзакции с удалением
			const result = journalRepository.deleteJournalRecord(db, id, { protocolsDir: protocolsDir() });
			touchDbModified(db);
			return result;
		})
	);

	ipcMain.handle("settings:getAll", () =>
		withDb((db) => settingsRepository.getAllSettings(db))
	);

	ipcMain.handle("settings:save", (event, settings) =>
		withDb((db) => {
			// пароли в таблицу настроек не пишем никогда
			const safe = {};
			for (const [key, value] of Object.entries(settings || {})) {
				if (/password/i.test(key)) continue;
				safe[key] = value;
			}
			return settingsRepository.saveSettings(db, safe);
		})
	);

	ipcMain.handle("settings:openDataDir", async () => {
		fs.mkdirSync(dataDir(), { recursive: true });
		await shell.openPath(dataDir());
		return { ok: true };
	});

	ipcMain.handle("settings:openProtocolsDir", async () => {
		fs.mkdirSync(protocolsDir(), { recursive: true });
		await shell.openPath(protocolsDir());
		return { ok: true };
	});

	ipcMain.handle("backups:listLocal", () => listLocalBackups(backupsDir()));

	ipcMain.handle("backups:createLocal", (event, reason) => {
		const safeReason = String(reason || "manual").replace(/[^a-z0-9_]/gi, "_").slice(0, 30) || "manual";
		return createLocalBackup({ dbPath: dbPath(), backupsDir: backupsDir(), reason: safeReason });
	});

	// Принимает имя файла или путь, но использует только имя внутри папки резервных копий
	ipcMain.handle("backups:restoreLocal", (event, fileName) => {
		const name = path.basename(String(fileName || ""));
		if (!name || path.extname(name).toLowerCase() !== ".db") {
			throw new Error("Недопустимое имя файла резервной копии");
		}
		const backupPath = path.join(backupsDir(), name);
		return restoreFromBackup({ backupPath, dbPath: dbPath(), backupsDir: backupsDir() });
	});

	ipcMain.handle("sync:getState", () =>
		withDb((db) => require("../backend/db/repositories/syncRepository").getSyncState(db))
	);

	ipcMain.handle("sync:test", async () => {
		const config = await withDbAsync((db) => buildFtpConfig(db));
		await resolveFtpProxy(config);
		return ftpClient.testConnection(config);
	});

	ipcMain.handle("sync:diagnose", async () => {
		const config = await withDbAsync((db) => buildFtpConfig(db));
		await resolveFtpProxy(config);
		return ftpClient.diagnoseConnection(config);
	});

	ipcMain.handle("sync:status", async () => {
		const db = openDb();
		try {
			const config = await buildFtpConfig(db);
			await resolveFtpProxy(config);
			return await syncService.getStatus({ db, config });
		} finally {
			db.close();
		}
	});

	ipcMain.handle("sync:upload", async (event, options) => {
		const db = openDb();
		try {
			const config = await buildFtpConfig(db);
			await resolveFtpProxy(config);
			const force = Boolean(options && options.force);
			try {
				return await syncService.uploadDb({ db, config, dbPath: dbPath(), force });
			} catch (error) {
				// T2.8: конфликт возвращается данными — свойства ошибки через IPC не доходят
				if (error.code === "SYNC_CONFLICT") {
					return {
						ok: false,
						code: "SYNC_CONFLICT",
						status: error.status,
						error: error.message,
						remoteDevice: error.remoteDevice,
						remoteModifiedAt: error.remoteModifiedAt
					};
				}
				throw error;
			}
		} finally {
			db.close();
		}
	});

	ipcMain.handle("sync:download", async () => {
		let config;
		const db = openDb();
		try {
			config = await buildFtpConfig(db);
			await resolveFtpProxy(config);
		} finally {
			db.close();
		}

		const result = await syncService.downloadDb({
			config,
			dbPath: dbPath(),
			backupsDir: backupsDir()
		});
		return result;
	});

	ipcMain.handle("security:getStatus", async () => {
		const stored = await dbPassword.getStoredDbPassword();
		const keytarOk = keyStorage.isAvailable();
		const ftpPassword = await getFtpPassword();
		return {
			keytarAvailable: keytarOk,
			dbPasswordEnabled: Boolean(stored),
			ftpPasswordSet: Boolean(ftpPassword),
			warning: !keytarOk && stored ? keyStorage.getAvailabilityMessage() : null
		};
	});

	const encryptionDeps = () => ({
		backup: (reason) => createLocalBackup({ dbPath: dbPath(), backupsDir: backupsDir(), reason }),
		rekey: (key) => rekeyDb(key),
		getCurrentKey: () => getRuntimeDbKey(),
		setRuntimeKey: (key) => setRuntimeDbKey(key)
	});

	ipcMain.handle("security:enableDbPassword", async (event, password) => {
		await dbPassword.enableDbPassword(password, encryptionDeps());
		return { ok: true };
	});

	ipcMain.handle("security:disableDbPassword", async () => {
		await dbPassword.disableDbPassword(encryptionDeps());
		return { ok: true };
	});

	ipcMain.handle("security:setFtpPassword", async (event, password) => {
		await setFtpPassword(password);
		return { ok: true };
	});

	ipcMain.handle("events:list", (event, filters) =>
		withDb((db) => eventsRepository.listEvents(db, filters || {}))
	);

	ipcMain.handle("template:check", () => {
		const exists = fs.existsSync(templatePath());
		return { exists, path: templatePath() };
	});

	ipcMain.handle("template:testDocx", () => {
		const result = createTestProtocol(protocolsDir());
		return { ok: true, placeholders: Object.keys(result.placeholderMap).length };
	});

	ipcMain.handle("import:excel", async () => {
		const result = await dialog.showOpenDialog(mainWindow, {
			properties: ["openFile"],
			filters: [{ name: "Excel", extensions: ["xlsx", "xls"] }]
		});
		if (result.canceled || !result.filePaths.length) return { canceled: true };
		const { importExcel } = require("../backend/import/excelImporter");
		const report = await importExcel(result.filePaths[0]);
		logEvent({ event_type: "excel_imported", level: "info", message: `Импорт: ${report.employeesCreated} добавлено`, details: report });
		return report;
	});

	ipcMain.handle("employees:create", (event, employee) =>
		withDb((db) => employeesRepository.createEmployee(db, employee))
	);

	ipcMain.handle("employees:update", (event, id, patch) =>
		withDb((db) => { employeesRepository.updateEmployee(db, id, patch); return { ok: true }; })
	);

	ipcMain.handle("employees:delete", (event, id) =>
		withDb((db) => {
			db.prepare("UPDATE employees SET status = 'deleted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
			touchDbModified(db);
			return { ok: true };
		})
	);

	ipcMain.handle("references:deleteDepartment", (event, id) =>
		withDb((db) => { db.prepare("UPDATE departments SET status = 'deleted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id); touchDbModified(db); return { ok: true }; })
	);

	ipcMain.handle("references:deleteChairman", (event, id) =>
		withDb((db) => { db.prepare("UPDATE commission_chairmen SET status = 'deleted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id); touchDbModified(db); return { ok: true }; })
	);

	ipcMain.handle("references:deleteMember", (event, id) =>
		withDb((db) => { db.prepare("UPDATE commission_members SET status = 'deleted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id); touchDbModified(db); return { ok: true }; })
	);

	ipcMain.handle("references:deleteKnowledgeScope", (event, id) =>
		withDb((db) => { db.prepare("UPDATE knowledge_scopes SET status = 'deleted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id); touchDbModified(db); return { ok: true }; })
	);

	ipcMain.handle("references:deleteWorkRight", (event, id) =>
		withDb((db) => { db.prepare("UPDATE work_rights SET status = 'deleted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id); touchDbModified(db); return { ok: true }; })
	);

	ipcMain.handle("references:deleteCommission", (event, id) =>
		withDb((db) => {
			db.prepare("UPDATE commissions SET status = 'deleted', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
			touchDbModified(db);
			return { ok: true };
		})
	);

	// Только предпросмотр: файл Preview_*.docx во временной папке ОС
	ipcMain.handle("shell:openFile", async (event, filePath) => {
		if (!filePath || typeof filePath !== "string" || !fs.existsSync(filePath)) {
			throw new Error("Файл не найден");
		}
		const full = realOrSame(path.resolve(filePath));
		const name = path.basename(full);
		if (!isInsideDir(realOrSame(os.tmpdir()), full) || !name.startsWith("Preview_") || path.extname(name).toLowerCase() !== ".docx") {
			throw new Error("Открытие этого файла запрещено");
		}
		const error = await shell.openPath(full);
		if (error) throw new Error("Не удалось открыть файл: " + error);
		return { ok: true };
	});

	// kind: "docx" | "pdf"; путь берётся из журнала по id и проверяется на вхождение в папку протоколов
	ipcMain.handle("journal:openFile", async (event, id, kind) => {
		if (kind !== "docx" && kind !== "pdf") {
			throw new Error("Неизвестный тип файла: " + kind);
		}
		const row = withDb((db) =>
			db.prepare("SELECT docx_path, pdf_path FROM protocol_journal WHERE id = ?").get(Number(id))
		);
		if (!row) throw new Error("Запись журнала не найдена");
		const full = resolveProtocolFile(kind === "pdf" ? row.pdf_path : row.docx_path, kind);
		if (path.extname(full).toLowerCase() !== "." + kind) {
			throw new Error("Тип файла не соответствует записи журнала");
		}
		const error = await shell.openPath(full);
		if (error) throw new Error("Не удалось открыть файл: " + error);
		return { ok: true };
	});

	ipcMain.handle("schedule:exportExcel", async (event, year) => {
		const result = await dialog.showSaveDialog(mainWindow, {
			title: "Сохранить график проверок",
			defaultPath: path.join(app.getPath("documents"), `График_проверок_${year}.xlsx`),
			filters: [{ name: "Excel", extensions: ["xlsx"] }]
		});
		if (result.canceled || !result.filePath) return { canceled: true };
		const { exportScheduleToExcel } = require("../backend/import/excelImporter");
		const report = await exportScheduleToExcel(result.filePath, year);
		return { ok: true, filePath: result.filePath, count: report.count };
	});

	ipcMain.handle("journal:exportExcel", async () => {
		const result = await dialog.showSaveDialog(mainWindow, {
			title: "Сохранить журнал проверок",
			defaultPath: path.join(app.getPath("documents"), `Журнал_проверок_${new Date().getFullYear()}.xlsx`),
			filters: [{ name: "Excel", extensions: ["xlsx"] }]
		});
		if (result.canceled || !result.filePath) return { canceled: true };
		const { exportJournalToExcel } = require("../backend/import/excelImporter");
		const report = await exportJournalToExcel(result.filePath);
		return { ok: true, filePath: result.filePath, count: report.count };
	});

	ipcMain.handle("employees:exportExcel", async () => {
		const result = await dialog.showSaveDialog(mainWindow, {
			title: "Экспорт работников в Excel",
			defaultPath: path.join(app.getPath("documents"), `Работники_${new Date().getFullYear()}.xlsx`),
			filters: [{ name: "Excel", extensions: ["xlsx"] }]
		});
		if (result.canceled || !result.filePath) return { canceled: true };
		const { exportEmployeesToExcel } = require("../backend/import/excelImporter");
		const report = await exportEmployeesToExcel(result.filePath);
		return { ok: true, filePath: result.filePath, count: report.count };
	});

	ipcMain.handle("employees:exportUpcomingExcel", async () => {
		const result = await dialog.showSaveDialog(mainWindow, {
			title: "Экспорт списка «Скоро» (30 дней)",
			defaultPath: path.join(app.getPath("documents"), `Скоро_обучение_30дней_${new Date().getFullYear()}.xlsx`),
			filters: [{ name: "Excel", extensions: ["xlsx"] }]
		});
		if (result.canceled || !result.filePath) return { canceled: true };
		const { exportUpcomingToExcel } = require("../backend/import/excelImporter");
		const report = await exportUpcomingToExcel(result.filePath);
		return { ok: true, filePath: result.filePath, count: report.count };
	});

	ipcMain.handle("employees:createTemplate", async () => {
		const result = await dialog.showSaveDialog(mainWindow, {
			title: "Создать шаблон для импорта",
			defaultPath: path.join(app.getPath("documents"), `Шаблон_импорта.xlsx`),
			filters: [{ name: "Excel", extensions: ["xlsx"] }]
		});
		if (result.canceled || !result.filePath) return { canceled: true };
		const { createEmployeesTemplate } = require("../backend/import/excelImporter");
		await createEmployeesTemplate(result.filePath);
		return { ok: true, filePath: result.filePath };
	});

	ipcMain.handle("dashboard:stats", () =>
		withDb((db) => {
			const total = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted'").get().c;
			const year = new Date().getFullYear();
			const journalStats = db.prepare("SELECT COUNT(*) as count, COALESCE(MAX(protocol_number), 0) as max_num FROM protocol_journal WHERE protocol_year = ?").get(year);
			const now = todayLocal();
			const in30 = addDaysLocal(now, 30);
			const upcoming = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date IS NOT NULL AND next_check_date >= ? AND next_check_date <= ?").get(now, in30).c;
			const overdue = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date < ?").get(now).c;
			const noDate = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date IS NULL").get().c;
			const actual = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date IS NOT NULL AND next_check_date > ?").get(in30).c;
			
			const monthCounts = [];
			for (let m = 1; m <= 12; m++) {
				const monthStr = String(m).padStart(2, "0");
				const count = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date LIKE ?").get(`${year}-${monthStr}-%`).c;
				monthCounts.push(count);
			}
			
			return { total, journalCount: journalStats.count, maxNumber: journalStats.max_num, upcoming, overdue, noDate, actual, monthCounts, year };
		})
	);
}

async function withDbAsync(handler) {
	const db = openDb();
	try {
		return await handler(db);
	} finally {
		db.close();
	}
}

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1280,
		height: 860,
		minWidth: 1024,
		minHeight: 700,
		title: "НормаОТ: Протокол ЭБ",
		icon: path.join(__dirname, "icon.png"),
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
	});

	// Новые окна запрещены; ссылки на сайт программы открываются в браузере
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https:\/\/normaot\.ru(\/|$)/i.test(String(url))) {
			shell.openExternal(url);
		}
		return { action: "deny" };
	});
	mainWindow.webContents.on("will-navigate", (event) => {
		event.preventDefault();
	});

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

app.on("second-instance", () => {
	if (mainWindow) {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	}
});

if (gotSingleInstanceLock) app.whenReady().then(async () => {
	console.log(`[startup] DB path: ${DB_PATH}`);
	console.log(`[startup] Data dir: ${DATA_DIR}`);
	try {
		await applyDbEncryptionKey();
		initDb();
	} catch (error) {
		console.error("initDb failed:", error.message);
		let message = error.message + "\n\nПуть: " + DB_PATH;
		if (/not a database/i.test(error.message)) {
			message += "\n\nВозможно, база зашифрована паролем, а пароль не получен из хранилища ключей, либо файл повреждён.";
		}
		dialog.showErrorBox("База данных не открывается", message);
		app.quit();
		return;
	}

	registerIpc();
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
