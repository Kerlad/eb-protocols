const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");

const { openDb, setRuntimeDbKey, touchDbModified } = require("../backend/db/connection");
const { initDb } = require("../backend/db/initDb");
const employeesRepository = require("../backend/db/repositories/employeesRepository");
const referencesRepository = require("../backend/db/repositories/referencesRepository");
const journalRepository = require("../backend/db/repositories/journalRepository");
const settingsRepository = require("../backend/db/repositories/settingsRepository");
const eventsRepository = require("../backend/db/repositories/eventsRepository");
const protocolService = require("../backend/protocol/protocolService");
const { getNextProtocolNumber } = require("../backend/protocol/protocolNumbering");
const { createTestProtocol } = require("../backend/protocol/docxGenerator");
const syncService = require("../backend/sync/syncService");
const ftpClient = require("../backend/sync/ftpClient");
const { createLocalBackup, listLocalBackups } = require("../backend/sync/backupService");
const { restoreFromBackup } = require("../backend/sync/restoreService");
const dbPassword = require("../backend/security/dbPassword");
const keyStorage = require("../backend/security/keyStorage");
const { buildFtpConfig, setFtpPassword } = require("../backend/security/ftpCredentials");
const paths = require("../backend/paths");

let mainWindow = null;

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

// Keep all data under one directory consistent with backend/db/connection.js
// (which uses process.cwd()/data). This ensures the DB used by repositories,
// backups, sync and generated protocols all live in the same place.
const { DB_PATH } = require("../backend/db/connection");
const DATA_DIR = path.dirname(DB_PATH);

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

async function applyDbEncryptionKey() {
	try {
		const key = await dbPassword.getRuntimeKey();
		if (key) {
			setRuntimeDbKey(key);
		}
	} catch (error) {
		console.error("applyDbEncryptionKey failed:", error.message);
	}
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
		withDb((db) => getNextProtocolNumber(db, checkDate || new Date().toISOString().slice(0, 10)))
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

	ipcMain.handle("journal:delete", (event, id) =>
		withDb((db) => {
			const result = journalRepository.deleteJournalRecord(db, id);
			touchDbModified(db);
			logEvent({
				event_type: "protocol_deleted",
				level: "info",
				message: `Удален протокол №${result.protocol_number}/${result.protocol_year}`,
				details: result
			});
			return result;
		})
	);

	ipcMain.handle("settings:getAll", () =>
		withDb((db) => settingsRepository.getAllSettings(db))
	);

	ipcMain.handle("settings:save", (event, settings) =>
		withDb((db) => settingsRepository.saveSettings(db, settings || {}))
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

	ipcMain.handle("backups:createLocal", (event, reason) =>
		createLocalBackup({ dbPath: dbPath(), backupsDir: backupsDir(), reason: reason || "manual" })
	);

	ipcMain.handle("backups:restoreLocal", (event, backupPath) =>
		restoreFromBackup({ backupPath, dbPath: dbPath(), backupsDir: backupsDir() })
	);

	ipcMain.handle("sync:getState", () =>
		withDb((db) => require("../backend/db/repositories/syncRepository").getSyncState(db))
	);

	ipcMain.handle("sync:test", async () => {
		const config = await withDbAsync((db) => buildFtpConfig(db));
		return ftpClient.testConnection(config);
	});

	ipcMain.handle("sync:status", async () => {
		const db = openDb();
		try {
			const config = await buildFtpConfig(db);
			return await syncService.getStatus({ db, config });
		} finally {
			db.close();
		}
	});

	ipcMain.handle("sync:upload", async () => {
		const db = openDb();
		try {
			const config = await buildFtpConfig(db);
			const result = await syncService.uploadDb({ db, config, dbPath: dbPath() });
			return result;
		} finally {
			db.close();
		}
	});

	ipcMain.handle("sync:download", async () => {
		let config;
		const db = openDb();
		try {
			config = await buildFtpConfig(db);
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
		return {
			keytarAvailable: keyStorage.isAvailable(),
			dbPasswordEnabled: Boolean(stored)
		};
	});

	ipcMain.handle("security:enableDbPassword", async (event, password) => {
		await dbPassword.setDbPassword(password);
		setRuntimeDbKey(dbPassword.deriveKey(password));
		return { ok: true };
	});

	ipcMain.handle("security:disableDbPassword", async () => {
		await dbPassword.clearDbPassword();
		setRuntimeDbKey(null);
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

	ipcMain.handle("shell:openFile", async (event, filePath) => {
		if (!filePath || !fs.existsSync(filePath)) {
			throw new Error("Файл не найден: " + filePath);
		}
		await shell.openPath(filePath);
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
			const now = new Date().toISOString().slice(0, 10);
			const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
			const upcoming = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date IS NOT NULL AND next_check_date >= ? AND next_check_date <= ?").get(now, in30).c;
			const overdue = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date IS NOT NULL AND next_check_date < ?").get(now).c;
			const actual = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date IS NOT NULL AND next_check_date > ?").get(in30).c;
			
			const monthCounts = [];
			for (let m = 1; m <= 12; m++) {
				const monthStr = String(m).padStart(2, "0");
				const count = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND next_check_date LIKE ?").get(`${year}-${monthStr}-%`).c;
				monthCounts.push(count);
			}
			
			return { total, journalCount: journalStats.count, maxNumber: journalStats.max_num, upcoming, overdue, actual, monthCounts, year };
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
			nodeIntegration: false
		}
	});

	mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}

app.whenReady().then(async () => {
	await applyDbEncryptionKey();

	try {
		initDb();
	} catch (error) {
		console.error("initDb failed:", error.message);
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
