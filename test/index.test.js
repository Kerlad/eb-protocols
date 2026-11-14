const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

describe("protocolNumbering", () => {
	const { getProtocolYear } = require("../backend/protocol/protocolNumbering");

	it("returns correct year from date string", () => {
		assert.equal(getProtocolYear("2026-06-15"), 2026);
		assert.equal(getProtocolYear("2027-01-01"), 2027);
	});

	it("throws on missing date", () => {
		assert.throws(() => getProtocolYear(null));
		assert.throws(() => getProtocolYear(""));
	});
});

describe("placeholderMap", () => {
	const { buildProtocolPlaceholderMap, formatDate } = require("../backend/protocol/placeholderMap");

	it("formats date to DD.MM.YYYY", () => {
		assert.equal(formatDate("2026-06-15"), "15.06.2026");
		assert.equal(formatDate(""), "");
		assert.equal(formatDate(null), "");
	});

	it("builds complete placeholder map", () => {
		const form = {
			protocol_number: 1,
			check_date: "2026-06-15",
			reason: "Очередная",
			commission_name: "Тест",
			chairman_position: "Пред.",
			chairman_name: "Иванов",
			full_name_snapshot: "Петров П.П.",
			electrical_safety_group: "IV",
			knowledge_scope_code: "ЭЧТ"
		};
		const map = buildProtocolPlaceholderMap(form);
		assert.equal(map["Номер"], "1");
		assert.equal(map["Дата"], "15.06.2026");
		assert.equal(map["Причина"], "Очередная");
		assert.equal(map["ФИО"], "Петров П.П.");
		assert.equal(map["Объем_знаний"], "ЭЧТ");
	});

	it("maps instructions_text to инструкции placeholder", () => {
		const form = {
			protocol_number: 137,
			check_date: "2026-06-22",
			instructions_text: "ПТЭЭП; ПОТЭУ; Правила № 123"
		};
		const map = buildProtocolPlaceholderMap(form);
		assert.equal(map["инструкции"], "ПТЭЭП; ПОТЭУ; Правила № 123");
	});

	it("defaults instructions_text to empty string when missing", () => {
		const form = {
			protocol_number: 137,
			check_date: "2026-06-22"
		};
		const map = buildProtocolPlaceholderMap(form);
		assert.equal(map["инструкции"], "");
	});
});

describe("conflictDetector", () => {
	const { compareDbState } = require("../backend/sync/conflictDetector");

	it("returns no_remote when remote is null", () => {
		const result = compareDbState({ syncRevision: 1 }, null);
		assert.equal(result.status, "no_remote");
		assert.equal(result.recommendation, "upload");
	});

	it("returns in_sync when identical", () => {
		const local = { syncRevision: 5, lastModifiedAt: "2026-01-01", journalCountTotal: 10 };
		const remote = { syncRevision: 5, lastModifiedAt: "2026-01-01", journalCountTotal: 10 };
		const result = compareDbState(local, remote);
		assert.equal(result.status, "in_sync");
	});

	it("returns remote_newer when remote has higher revision", () => {
		const local = { syncRevision: 3, lastModifiedAt: "2026-01-01", lastSyncedAt: "2026-01-01", journalCountTotal: 10 };
		const remote = { syncRevision: 5, lastModifiedAt: "2026-06-01", journalCountTotal: 12 };
		const result = compareDbState(local, remote);
		assert.equal(result.status, "remote_newer");
		assert.equal(result.recommendation, "download");
	});
});

describe("rightsDetector", () => {
	const { detectRightsColumns, isRightEnabled } = require("../backend/import/rightsDetector");

	it("excludes base employee columns", () => {
		const headers = ["Фамилия", "Имя", "Отчество", "ФИО", "Место работы", "Должность",
			"Объем знаний", "Категория персонала", "Группа", "Дата проверки",
			"Дата следующей проверки", "Периодичность (лет)", "Оперативные переключения"];
		const result = detectRightsColumns(headers);
		assert.equal(result.length, 1);
		assert.equal(result[0].name, "Оперативные переключения");
	});

	it("detects right enabled values", () => {
		assert.equal(isRightEnabled(1), true);
		assert.equal(isRightEnabled("да"), true);
		assert.equal(isRightEnabled("1"), true);
		assert.equal(isRightEnabled(""), false);
		assert.equal(isRightEnabled(null), false);
		assert.equal(isRightEnabled(0), false);
	});
});

describe("dataSheetParser", () => {
	const { parseDataSheet, normalizeGroup, normalizeCategory } = require("../backend/import/dataSheetParser");

	it("parses employee data with correct column mapping", () => {
		const mockRow = (cells) => ({
			getCell: (idx) => ({ value: cells[idx - 1] || null })
		});

		const mockSheet = {
			getRow: (n) => ({
				eachCell: (cb) => {
					const headers = ["Фамилия", "Имя", "Отчество", "Место работы", "Должность",
						"Объем знаний", "Категория", "Группа", "Дата проверки", "Дата след.", "Периодичность"];
					headers.forEach((h, i) => cb({ value: h }, i + 1));
				}
			}),
			eachRow: (opts, cb) => {
				if (typeof opts === "function") { cb = opts; opts = {}; }
				cb(mockRow(["Иванов", "Иван", "Иванович", "Участок", "Электромонтер", "ЭЧТ", "Опер.", "IV", "2026-01-01", "2027-01-01", "1"]), 2);
			}
		};

		const result = parseDataSheet(mockSheet);
		assert.equal(result.employees.length, 1);
		const emp = result.employees[0];
		assert.equal(emp.last_name, "Иванов");
		assert.equal(emp.workplace_name, "Участок");
		assert.equal(emp.position, "Электромонтер");
		assert.equal(emp.knowledge_scope_code, "ЭЧТ");
		assert.equal(emp.electrical_safety_group, "IV");
		assert.equal(emp.check_period_years, 1);
	});

	it("normalizes group numbers", () => {
		assert.equal(normalizeGroup("2"), "II");
		assert.equal(normalizeGroup("3"), "III");
		assert.equal(normalizeGroup("4"), "IV");
		assert.equal(normalizeGroup("5"), "V");
		assert.equal(normalizeGroup("IV"), "IV");
	});

	it("normalizes category typos", () => {
		assert.equal(normalizeCategory("Административно-техничесуий"), "Административно-технический");
		assert.equal(normalizeCategory("оперативно-ремонт"), "Оперативно-ремонтный");
	});

	it("handles shifted row (empty lastName)", () => {
		const mockRow = (cells) => ({
			getCell: (idx) => ({ value: cells[idx - 1] || null })
		});

		const mockSheet = {
			getRow: (n) => ({
				eachCell: (cb) => {
					const headers = ["Фамилия", "Имя", "Отчество", "Место работы", "Должность",
						"Объем знаний", "Категория", "Группа", "Дата проверки", "Дата след.", "Периодичность",
						"Право1"];
					headers.forEach((h, i) => cb({ value: h }, i + 1));
				}
			}),
			eachRow: (opts, cb) => {
				if (typeof opts === "function") { cb = opts; opts = {}; }
				cb(mockRow([null, "Петров", "Петр", "Павлович", "Участок", "Электромонтер", "Опер.", "IV", "2026-01-01", "2027-01-01", "1", 1]), 2);
			}
		};

		const result = parseDataSheet(mockSheet);
		assert.equal(result.employees.length, 1);
		assert.equal(result.employees[0].last_name, "Петров");
		assert.equal(result.employees[0].first_name, "Петр");
		assert.equal(result.employees[0].workplace_name, "Участок");
		assert.equal(result.errors.length, 1);
		assert.ok(result.errors[0].includes("сдвинуты"));
	});
});

describe("dateUtils", () => {
	const { addYearsLocal, formatDateLocal } = require("../backend/utils/dateUtils");

	it("formats date correctly", () => {
		assert.equal(formatDateLocal(new Date(2026, 5, 15)), "2026-06-15");
		assert.equal(formatDateLocal("2026-06-15"), "2026-06-15");
	});

	it("adds years correctly", () => {
		assert.equal(addYearsLocal("2026-06-15", 1), "2027-06-15");
		assert.equal(addYearsLocal("2026-06-15", 3), "2029-06-15");
		assert.equal(addYearsLocal("2024-01-15", 1), "2025-01-15");
	});

	it("handles year boundary", () => {
		assert.equal(addYearsLocal("2026-12-31", 1), "2027-12-31");
		assert.equal(addYearsLocal("2026-01-01", 1), "2027-01-01");
	});
});

describe("paths", () => {
	const paths = require("../backend/paths");

	it("returns non-null data dir", () => {
		const dir = paths.getDataDir();
		assert.ok(dir);
		assert.ok(typeof dir === "string");
	});

	it("returns non-null DB path", () => {
		const p = paths.getDbPath();
		assert.ok(p);
		assert.ok(p.endsWith("eb_protocols.db"));
	});

	it("returns non-null backups dir", () => {
		const d = paths.getBackupsDir();
		assert.ok(d);
		assert.ok(d.endsWith("backups"));
	});

	it("returns non-null protocols dir", () => {
		const d = paths.getProtocolsDir();
		assert.ok(d);
		assert.ok(d.endsWith("protocols"));
	});
});

describe("ftpClient proxy", () => {
	const { parseProxyRule, parseEnvProxy, isNoProxy } = require("../backend/sync/ftpClient");

	it("parseProxyRule handles SOCKS5", () => {
		const result = parseProxyRule("SOCKS5 127.0.0.1:1080");
		assert.deepEqual(result, { type: "SOCKS", version: "5", host: "127.0.0.1", port: 1080 });
	});

	it("parseProxyRule handles SOCKS4", () => {
		const result = parseProxyRule("SOCKS4 10.0.0.1:1080");
		assert.deepEqual(result, { type: "SOCKS", version: "4", host: "10.0.0.1", port: 1080 });
	});

	it("parseProxyRule handles HTTP PROXY", () => {
		const result = parseProxyRule("PROXY proxy.corp.local:3128");
		assert.deepEqual(result, { type: "HTTP", host: "proxy.corp.local", port: 3128 });
	});

	it("parseProxyRule handles DIRECT", () => {
		assert.equal(parseProxyRule("DIRECT"), null);
	});

	it("parseProxyRule handles null/undefined", () => {
		assert.equal(parseProxyRule(null), null);
		assert.equal(parseProxyRule(undefined), null);
	});

	it("parseProxyRule handles garbage", () => {
		assert.equal(parseProxyRule("random text"), null);
	});

	it("parseEnvProxy handles http proxy", () => {
		const result = parseEnvProxy("http://proxy:8080");
		assert.deepEqual(result, { type: "HTTP", host: "proxy", port: 8080 });
	});

	it("parseEnvProxy handles socks5 proxy", () => {
		const result = parseEnvProxy("socks5://127.0.0.1:1080");
		assert.deepEqual(result, { type: "SOCKS", version: "5", host: "127.0.0.1", port: 1080 });
	});

	it("parseEnvProxy handles socks4 proxy", () => {
		const result = parseEnvProxy("socks4://10.0.0.1:1080");
		assert.deepEqual(result, { type: "SOCKS", version: "4", host: "10.0.0.1", port: 1080 });
	});

	it("parseEnvProxy handles null", () => {
		assert.equal(parseEnvProxy(null), null);
		assert.equal(parseEnvProxy(""), null);
	});

	it("isNoProxy matches exact host", () => {
		assert.equal(isNoProxy("localhost", "localhost"), true);
		assert.equal(isNoProxy("myhost", "localhost"), false);
	});

	it("isNoProxy matches wildcard", () => {
		assert.equal(isNoProxy("anyhost", "*"), true);
	});

	it("isNoProxy matches domain suffix", () => {
		assert.equal(isNoProxy("ftp.corp.local", ".corp.local"), true);
		assert.equal(isNoProxy("ftp.other.com", ".corp.local"), false);
	});

	it("isNoProxy handles empty", () => {
		assert.equal(isNoProxy("host", ""), false);
		assert.equal(isNoProxy("host", null), false);
	});
});

describe("HTTP tunnel status parsing", () => {
	it("parses HTTP/1.1 200 status correctly", () => {
		const statusLine = "HTTP/1.1 200 Connection established";
		const match = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
		assert.ok(match);
		assert.equal(match[1], "200");
	});

	it("rejects non-200 status", () => {
		const statusLine = "HTTP/1.1 502 Bad Gateway";
		const match = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
		assert.ok(match);
		assert.notEqual(match[1], "200");
	});

	it("rejects malformed response", () => {
		const statusLine = "Not HTTP at all";
		const match = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
		assert.equal(match, null);
	});
});

describe("protocol primary reason", () => {
	it("buildProtocolPlaceholderMap includes previous fields", () => {
		const { buildProtocolPlaceholderMap } = require("../backend/protocol/placeholderMap");
		const map = buildProtocolPlaceholderMap({
			protocol_number: 1,
			check_date: "2026-06-15",
			reason: "Первичная",
			previous_check_date: "",
			previous_result: ""
		});
		assert.equal(map["Дата_пред_проверки"], "");
		assert.equal(map["пред_оценка"], "");
	});
});

describe("getProtocolDraft instructions_text", () => {
	const { getProtocolDraft } = require("../backend/protocol/protocolService");

	before(() => {
		require("../backend/db/initDb").initDb();
	});

	it("includes instructions_text in returned draft", () => {
		const draft = getProtocolDraft({
			check_date: "2026-07-01",
			instructions_text: "Тестовые инструкции; ПТЭЭП"
		});
		assert.equal(draft.instructions_text, "Тестовые инструкции; ПТЭЭП");
	});

	it("defaults instructions_text to empty string when missing", () => {
		const draft = getProtocolDraft({
			check_date: "2026-07-01"
		});
		assert.equal(draft.instructions_text, "");
	});
});

describe("exportUpcomingToExcel", () => {
	const os = require("os");
	const path = require("path");
	const fs = require("fs");
	const ExcelJS = require("exceljs");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-upcoming-"));
	const dbDir = path.join(tmpDir, "data");
	const dbPath = path.join(dbDir, "eb_protocols.db");

	const cacheKeys = [
		path.resolve(__dirname, "..", "backend", "db", "connection.js"),
		path.resolve(__dirname, "..", "backend", "db", "initDb.js"),
		path.resolve(__dirname, "..", "backend", "import", "excelImporter.js"),
		path.resolve(__dirname, "..", "backend", "paths.js")
	];

	before(() => {
		process.env.EB_DATA_DIR = dbDir;
		for (const key of cacheKeys) delete require.cache[key];
		fs.mkdirSync(dbDir, { recursive: true });

		const Database = require("better-sqlite3-multiple-ciphers");
		const db = new Database(dbPath);
		const schemaPath = path.join(__dirname, "..", "backend", "db", "schema.sql");
		const schema = fs.readFileSync(schemaPath, "utf8");
		db.exec(schema);

		db.prepare(`INSERT INTO sync_state (id, db_version, sync_revision, sync_status) VALUES (1, 'test', 0, 'test')`).run();

		const in15 = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
		const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
		const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
		const ts = new Date().toISOString();

		const insert = db.prepare(`
			INSERT INTO employees (last_name, first_name, full_name, position, electrical_safety_group,
				personnel_category, knowledge_scope_code, last_check_date, next_check_date,
				check_period_years, status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
		`);
		insert.run("Иванов", "Иван", "Иванов Иван", "Электромонтер", "IV",
			"Оперативно-ремонтный", "ЭЧТ", "2026-01-01", in15, 1, ts, ts);
		insert.run("Петров", "Петр", "Петров Петр", "Инженер", "III",
			"Административно-технический", "Для эл.мех", "2026-03-01", in90, 1, ts, ts);
		insert.run("Сидоров", "Сидр", "Сидоров Сидр", "Мастер", "V",
			"Ремонтный", "ЭЧТ", "2025-12-01", past, 1, ts, ts);
		insert.run("Deleted", "User", "Deleted User", "Тест", "II",
			"Оперативный", "Для эл.мех", "2026-01-01", in15, 1, ts, ts);
		db.prepare("UPDATE employees SET status = 'deleted' WHERE full_name = 'Deleted User'").run();
		insert.run("Смирнов", "Алексей", "Смирнов Алексей", "Электромеханик", "IV",
			"Ремонтный", "ЭЧТ", "2026-02-15", in15, 1, ts, ts);

		db.close();
	});

	after(() => {
		delete process.env.EB_DATA_DIR;
		for (const key of cacheKeys) delete require.cache[key];
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
	});

	it("exports only upcoming employees to Excel", async () => {
		const { exportUpcomingToExcel } = require("../backend/import/excelImporter");
		const outPath = path.join(tmpDir, "upcoming.xlsx");
		const result = await exportUpcomingToExcel(outPath);

		assert.equal(result.ok, true);
		assert.equal(result.count, 2); // Иванов + Смирнов (deleted excluded, Петров >30d, Сидоров <today)

		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.readFile(outPath);
		const sheet = workbook.getWorksheet("Скоро (30 дней)");
		assert.ok(sheet);

		assert.equal(sheet.getRow(1).getCell(1).value, "ФИО");
		assert.equal(sheet.getRow(1).getCell(8).value, "Дата следующей проверки");

		const row2 = sheet.getRow(2);
		const row3 = sheet.getRow(3);
		const names = [row2.getCell(1).value, row3.getCell(1).value].sort();
		assert.deepEqual(names, ["Иванов Иван", "Смирнов Алексей"]);
	});
});

describe("dashboard:stats overdue logic", () => {
	const os = require("os");
	const path = require("path");
	const fs = require("fs");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-overdue-"));
	const dbDir = path.join(tmpDir, "data");
	const dbPath = path.join(dbDir, "eb_protocols.db");

	const cacheKeys = [
		path.resolve(__dirname, "..", "backend", "db", "connection.js"),
		path.resolve(__dirname, "..", "backend", "paths.js")
	];

	before(() => {
		process.env.EB_DATA_DIR = dbDir;
		for (const key of cacheKeys) delete require.cache[key];
		fs.mkdirSync(dbDir, { recursive: true });

		const Database = require("better-sqlite3-multiple-ciphers");
		const db = new Database(dbPath);
		const schemaPath = path.join(__dirname, "..", "backend", "db", "schema.sql");
		const schema = fs.readFileSync(schemaPath, "utf8");
		db.exec(schema);

		db.prepare(`INSERT INTO sync_state (id, db_version, sync_revision, sync_status) VALUES (1, 'test', 0, 'test')`).run();

		const pastDate = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
		const futureDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
		const ts = new Date().toISOString();
		const insert = db.prepare(`
			INSERT INTO employees (last_name, first_name, full_name, next_check_date, status, created_at, updated_at)
			VALUES (?, ?, ?, ?, 'active', ?, ?)
		`);
		insert.run("Overdue", "User", "Overdue User", pastDate, ts, ts);
		insert.run("Deferred", "User", "Deferred User", futureDate, ts, ts);
		db.prepare("UPDATE employees SET note = 'DATE_DEFERRED' WHERE full_name = 'Deferred User'").run();
		insert.run("Normal", "User", "Normal User", futureDate, ts, ts);

		db.close();
	});

	after(() => {
		delete process.env.EB_DATA_DIR;
		for (const key of cacheKeys) delete require.cache[key];
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
	});

	it("counts overdue + DATE_DEFERRED as overdue", () => {
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try {
			const now = new Date().toISOString().slice(0, 10);
			const overdue = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted' AND (next_check_date < ? OR note = 'DATE_DEFERRED')").get(now).c;
			assert.equal(overdue, 2); // Overdue User (past date) + Deferred User (DATE_DEFERRED)
		} finally {
			db.close();
		}
	});
});

describe("computeNextCheckDate", () => {
	const { computeNextCheckDate } = require("../backend/protocol/protocolService");

	it("returns null for missing checkDate", () => {
		assert.equal(computeNextCheckDate(null, 1), null);
		assert.equal(computeNextCheckDate("", 1), null);
	});

	it("returns same day next year for 1-year period", () => {
		assert.equal(computeNextCheckDate("2026-06-15", 1), "2027-06-15");
		assert.equal(computeNextCheckDate("2026-01-01", 1), "2027-01-01");
	});

	it("returns same day +3 years for 3-year period", () => {
		assert.equal(computeNextCheckDate("2026-06-15", 3), "2029-06-15");
	});

	it("defaults to 1 year when periodYears is missing", () => {
		assert.equal(computeNextCheckDate("2026-06-15"), "2027-06-15");
		assert.equal(computeNextCheckDate("2026-06-15", 0), "2027-06-15");
	});
});

describe("docxGenerator utilities", () => {
	const { safeFilePart, buildOutputFileName, validatePlaceholderMap, REQUIRED_PLACEHOLDERS } = require("../backend/protocol/docxGenerator");

	it("safeFilePart removes invalid filename characters", () => {
		assert.equal(safeFilePart("Иванов"), "Иванов");
		assert.equal(safeFilePart("file:name?*.docx"), "file_name__.docx");
		assert.equal(safeFilePart(""), "");
	});

	it("buildOutputFileName builds correct filename", () => {
		assert.equal(buildOutputFileName({ protocol_number: 137, full_name_snapshot: "Иванов И.И." }), "Протокол_137_Иванов_И.И..docx");
	});

	it("buildOutputFileName handles missing fields", () => {
		assert.ok(buildOutputFileName({}).includes("Протокол"));
		assert.ok(buildOutputFileName({ protocol_number: 1 }).includes("1"));
	});

	it("validatePlaceholderMap returns empty when all required present", () => {
		const data = {};
		REQUIRED_PLACEHOLDERS.forEach(k => data[k] = "value");
		assert.deepEqual(validatePlaceholderMap(data), []);
	});

	it("validatePlaceholderMap reports missing placeholders", () => {
		const missing = validatePlaceholderMap({});
		assert.ok(missing.length > 0);
		assert.ok(missing.includes("Номер"));
		assert.ok(missing.includes("ФИО"));
	});
});

describe("full placeholderMap coverage", () => {
	const { buildProtocolPlaceholderMap } = require("../backend/protocol/placeholderMap");

	it("returns all 24 placeholders with correct values", () => {
		const form = {
			protocol_number: 137,
			check_date: "2026-06-22",
			reason: "Очередная",
			commission_name: "Центральная ЭК",
			chairman_position: "Главный инженер",
			chairman_name: "Иванов И.И.",
			member_1_position: "Зам. гл. инженера",
			member_1_name: "Петров П.П.",
			member_2_position: "Начальник ОТ",
			member_2_name: "Сидоров С.С.",
			member_3_position: "Инженер по ЭБ",
			member_3_name: "Николаев Н.Н.",
			full_name_snapshot: "Смирнов А.А.",
			workplace_snapshot: "Участок №5",
			position_snapshot: "Электромонтер",
			previous_check_date: "2025-06-22",
			previous_result: "уд",
			result_eb: "Хор",
			result_ot: "Уд",
			result_pb: "Хор",
			result_other: "Отл",
			final_result: "Хор",
			electrical_safety_group: "IV",
			duplicate_duration: "2 недели",
			personnel_category: "Оперативно-ремонтный",
			rights_text: "производитель работ; член бригады",
			voltage_category: "до и свыше 1000В",
			next_check_date: "2027-06-22",
			knowledge_scope_code: "ЭЧТ-4",
			instructions_text: "ПТЭЭП; ПОТЭУ; Правила № 123"
		};
		const map = buildProtocolPlaceholderMap(form);
		assert.equal(map["Номер"], "137");
		assert.equal(map["Дата"], "22.06.2026");
		assert.equal(map["Причина"], "Очередная");
		assert.equal(map["Комиссия"], "Центральная ЭК");
		assert.equal(map["Должность_ПК"], "Главный инженер");
		assert.equal(map["ПК"], "Иванов И.И.");
		assert.equal(map["Должность_ЧК_1"], "Зам. гл. инженера");
		assert.equal(map["ЧК_1"], "Петров П.П.");
		assert.equal(map["Должность_ЧК_2"], "Начальник ОТ");
		assert.equal(map["ЧК_2"], "Сидоров С.С.");
		assert.equal(map["Должность_ЧК_3"], "Инженер по ЭБ");
		assert.equal(map["ЧК_3"], "Николаев Н.Н.");
		assert.equal(map["ФИО"], "Смирнов А.А.");
		assert.equal(map["Место_Работы"], "Участок №5");
		assert.equal(map["Должность"], "Электромонтер");
		assert.equal(map["Дата_пред_проверки"], "22.06.2025");
		assert.equal(map["пред_оценка"], "уд");
		assert.equal(map["оценка_ЭБ"], "Хор");
		assert.equal(map["оценка_ОТ"], "Уд");
		assert.equal(map["оценка_ПБ"], "Хор");
		assert.equal(map["другие_ИОТ"], "Отл");
		assert.equal(map["оценка"], "Хор");
		assert.equal(map["Группа_ЭБ"], "IV");
		assert.equal(map["Прод_Дублир"], "2 недели");
		assert.equal(map["категория"], "Оперативно-ремонтный");
		assert.equal(map["права"], "производитель работ; член бригады");
		assert.equal(map["категория_ЭУ"], "до и свыше 1000В");
		assert.equal(map["Объем_знаний"], "ЭЧТ-4");
		assert.equal(map["След_Дата"], "22.06.2027");
		assert.equal(map["инструкции"], "ПТЭЭП; ПОТЭУ; Правила № 123");
		assert.equal(Object.keys(map).length, 30); // 30 keys
	});
});

describe("exportScheduleToExcel", () => {
	const os = require("os");
	const path = require("path");
	const fs = require("fs");
	const ExcelJS = require("exceljs");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-schedule-"));
	const dbDir = path.join(tmpDir, "data");
	const cacheKeys = [
		path.resolve(__dirname, "..", "backend", "db", "connection.js"),
		path.resolve(__dirname, "..", "backend", "db", "initDb.js"),
		path.resolve(__dirname, "..", "backend", "import", "excelImporter.js"),
		path.resolve(__dirname, "..", "backend", "paths.js")
	];

	before(() => {
		process.env.EB_DATA_DIR = dbDir;
		for (const key of cacheKeys) delete require.cache[key];
		fs.mkdirSync(dbDir, { recursive: true });

		const Database = require("better-sqlite3-multiple-ciphers");
		const db = new Database(path.join(dbDir, "eb_protocols.db"));
		const schema = fs.readFileSync(path.join(__dirname, "..", "backend", "db", "schema.sql"), "utf8");
		db.exec(schema);
		db.prepare(`INSERT INTO sync_state (id, db_version, sync_revision, sync_status) VALUES (1, 'test', 0, 'test')`).run();

		const ts = new Date().toISOString();
		const insert = db.prepare(`INSERT INTO employees (last_name, first_name, full_name, workplace_name, position, electrical_safety_group, personnel_category, knowledge_scope_code, last_check_date, next_check_date, check_period_years, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`);
		insert.run("Иванов", "Иван", "Иванов Иван", "Цех №1", "Электромонтер", "IV", "Оперативно-ремонтный", "ЭЧТ", "2026-01-01", "2026-06-15", 1, ts, ts);
		insert.run("Петров", "Петр", "Петров Петр", "Цех №2", "Инженер", "III", "Административно-технический", "Для эл.мех", "2026-03-01", "2026-07-20", 1, ts, ts);
		insert.run("Сидоров", "Сидр", "Сидоров Сидр", "Цех №3", "Мастер", "V", "Ремонтный", "ЭЧТ", "2025-12-01", "2026-08-10", 1, ts, ts);
		db.close();
	});

	after(() => {
		delete process.env.EB_DATA_DIR;
		for (const key of cacheKeys) delete require.cache[key];
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
	});

	it("exports schedule with month grouping to Excel", async () => {
		const { exportScheduleToExcel } = require("../backend/import/excelImporter");
		const outPath = path.join(tmpDir, "schedule.xlsx");
		const result = await exportScheduleToExcel(outPath, 2026);
		assert.equal(result.ok, true);
		assert.equal(result.count, 3);

		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.readFile(outPath);
		const sheet = workbook.getWorksheet("График 2026");
		assert.ok(sheet);

		assert.equal(sheet.getRow(1).getCell(1).value, "ФИО");
		assert.equal(sheet.getRow(1).getCell(8).value, "Дата следующей проверки");

		const names = [];
		sheet.eachRow((row, rowNum) => {
			if (rowNum > 1 && !row.getCell(2).fill) names.push(row.getCell(1).value);
		});
		assert.ok(names.includes("Иванов Иван"));
		assert.ok(names.includes("Петров Петр"));
		assert.ok(names.includes("Сидоров Сидр"));
	});
});

describe("exportJournalToExcel", () => {
	const os = require("os");
	const path = require("path");
	const fs = require("fs");
	const ExcelJS = require("exceljs");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-journal-"));
	const dbDir = path.join(tmpDir, "data");
	const cacheKeys = [
		path.resolve(__dirname, "..", "backend", "db", "connection.js"),
		path.resolve(__dirname, "..", "backend", "db", "initDb.js"),
		path.resolve(__dirname, "..", "backend", "import", "excelImporter.js"),
		path.resolve(__dirname, "..", "backend", "paths.js")
	];

	before(() => {
		process.env.EB_DATA_DIR = dbDir;
		for (const key of cacheKeys) delete require.cache[key];
		fs.mkdirSync(dbDir, { recursive: true });

		const Database = require("better-sqlite3-multiple-ciphers");
		const db = new Database(path.join(dbDir, "eb_protocols.db"));
		const schema = fs.readFileSync(path.join(__dirname, "..", "backend", "db", "schema.sql"), "utf8");
		db.exec(schema);
		db.prepare(`INSERT INTO sync_state (id, db_version, sync_revision, sync_status) VALUES (1, 'test', 0, 'test')`).run();

		const ts = new Date().toISOString();
		db.prepare(`INSERT INTO protocol_journal (protocol_year, protocol_number, full_name_snapshot, check_date, next_check_date, reason, electrical_safety_group, final_result, commission_name, chairman_name, workplace_snapshot, position_snapshot, knowledge_scope_code, personnel_category, rights_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			2026, 1, "Иванов Иван", "2026-06-15", "2027-06-15", "Очередная", "IV", "Хор", "ЦЭК", "Иванов И.И.", "Цех №1", "Электромонтер", "ЭЧТ", "Оперативно-ремонтный", "право", ts, ts
		);
		db.prepare(`INSERT INTO protocol_journal (protocol_year, protocol_number, full_name_snapshot, check_date, next_check_date, reason, electrical_safety_group, final_result, commission_name, chairman_name, workplace_snapshot, position_snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
			2026, 2, "Петров Петр", "2026-07-20", "2027-07-20", "Внеочередная", "III", "Уд", "ЦЭК", "Иванов И.И.", "Цех №2", "Инженер", ts, ts
		);
		db.close();
	});

	after(() => {
		delete process.env.EB_DATA_DIR;
		for (const key of cacheKeys) delete require.cache[key];
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
	});

	it("exports journal to Excel", async () => {
		const { exportJournalToExcel } = require("../backend/import/excelImporter");
		const outPath = path.join(tmpDir, "journal.xlsx");
		const result = await exportJournalToExcel(outPath);
		assert.equal(result.ok, true);
		assert.equal(result.count, 2);

		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.readFile(outPath);
		const sheet = workbook.getWorksheet("Журнал проверок");
		assert.ok(sheet);

		assert.equal(sheet.getRow(1).getCell(1).value, "№ протокола");
		assert.equal(sheet.getRow(1).getCell(5).value, "Место работы");

		const names = [];
		sheet.eachRow((row, rowNum) => {
			if (rowNum > 1) names.push(row.getCell(4).value);
		});
		assert.deepEqual(names.sort(), ["Иванов Иван", "Петров Петр"]);
	});
});

describe("exportEmployeesToExcel", () => {
	const os = require("os");
	const path = require("path");
	const fs = require("fs");
	const ExcelJS = require("exceljs");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-employees-"));
	const dbDir = path.join(tmpDir, "data");
	const cacheKeys = [
		path.resolve(__dirname, "..", "backend", "db", "connection.js"),
		path.resolve(__dirname, "..", "backend", "db", "initDb.js"),
		path.resolve(__dirname, "..", "backend", "import", "excelImporter.js"),
		path.resolve(__dirname, "..", "backend", "paths.js")
	];

	before(() => {
		process.env.EB_DATA_DIR = dbDir;
		for (const key of cacheKeys) delete require.cache[key];
		fs.mkdirSync(dbDir, { recursive: true });

		const Database = require("better-sqlite3-multiple-ciphers");
		const db = new Database(path.join(dbDir, "eb_protocols.db"));
		const schema = fs.readFileSync(path.join(__dirname, "..", "backend", "db", "schema.sql"), "utf8");
		db.exec(schema);
		db.prepare(`INSERT INTO sync_state (id, db_version, sync_revision, sync_status) VALUES (1, 'test', 0, 'test')`).run();

		const ts = new Date().toISOString();
		db.prepare(`INSERT INTO work_rights (id, name, protocol_text, sort_order, status, created_at, updated_at) VALUES (1, 'Право выдачи нарядов', 'выдача нарядов-допусков и распоряжений;', 1, 'active', ?, ?)`).run(ts, ts);
		db.prepare(`INSERT INTO employees (id, last_name, first_name, full_name, workplace_name, position, electrical_safety_group, personnel_category, knowledge_scope_code, last_check_date, next_check_date, check_period_years, last_result, status, created_at, updated_at) VALUES (1, 'Иванов', 'Иван', 'Иванов Иван', 'Цех №1', 'Электромонтер', 'IV', 'Оперативно-ремонтный', 'ЭЧТ', '2026-01-01', '2027-01-01', 1, 'хор', 'active', ?, ?)`).run(ts, ts);
		db.prepare(`INSERT INTO employee_rights (employee_id, right_id, value, created_at, updated_at) VALUES (1, 1, 1, ?, ?)`).run(ts, ts);
		db.close();
	});

	after(() => {
		delete process.env.EB_DATA_DIR;
		for (const key of cacheKeys) delete require.cache[key];
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
	});

	it("exports employees with rights to Excel", async () => {
		const { exportEmployeesToExcel } = require("../backend/import/excelImporter");
		const outPath = path.join(tmpDir, "employees.xlsx");
		const result = await exportEmployeesToExcel(outPath);
		assert.equal(result.ok, true);
		assert.equal(result.count, 1);

		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.readFile(outPath);
		const sheet = workbook.getWorksheet("Работники");
		assert.ok(sheet);

		assert.equal(sheet.getRow(1).getCell(1).value, "Фамилия");
		assert.equal(sheet.getRow(1).getCell(5).value, "Должность");
	});
});

describe("importExcel end-to-end", () => {
	const os = require("os");
	const path = require("path");
	const fs = require("fs");
	const ExcelJS = require("exceljs");

	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eb-test-import-"));
	const dbDir = path.join(tmpDir, "data");
	const excelPath = path.join(tmpDir, "test_import.xlsx");
	const cacheKeys = [
		path.resolve(__dirname, "..", "backend", "db", "connection.js"),
		path.resolve(__dirname, "..", "backend", "db", "initDb.js"),
		path.resolve(__dirname, "..", "backend", "import", "excelImporter.js"),
		path.resolve(__dirname, "..", "backend", "paths.js")
	];

	before(async () => {
		process.env.EB_DATA_DIR = dbDir;
		for (const key of cacheKeys) delete require.cache[key];
		fs.mkdirSync(dbDir, { recursive: true });

		// Create proper DB file so migrateFromLegacy() sees it exists and skips copying production DB
		const Database = require("better-sqlite3-multiple-ciphers");
		const preDb = new Database(path.join(dbDir, "eb_protocols.db"));
		const schema = fs.readFileSync(path.join(__dirname, "..", "backend", "db", "schema.sql"), "utf8");
		preDb.exec(schema);
		preDb.prepare(`INSERT INTO sync_state (id, db_version, sync_revision, sync_status) VALUES (1, 'test', 0, 'test')`).run();
		preDb.close();

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Data");

		sheet.getRow(1).values = ["Фамилия", "Имя", "Отчество", "Место работы", "Должность", "Объем знаний", "Категория персонала", "Группа", "Дата проверки", "Дата след. проверки", "Периодичность", "Оперативные переключения", "Выдача нарядов"];
		sheet.getRow(2).values = ["Иванов", "Иван", "Иванович", "Участок №1", "Электромонтер", "ЭЧТ", "Оперативно-ремонтный", "IV", new Date("2026-01-15"), new Date("2027-01-15"), 1, 1, "да"];
		sheet.getRow(3).values = ["Петров", "Петр", "Петрович", "Участок №2", "Инженер", "Для эл.мех", "Административно-технический", "III", new Date("2026-03-01"), new Date("2027-03-01"), 1, "", ""];
		sheet.getRow(4).values = ["", "Сидоров", "Сидр", "Сидорович", "Участок №3", "Мастер", "ЭЧТ", "Ремонтный", "V", new Date("2026-06-01"), new Date("2027-06-01"), 1, "", ""];

		await workbook.xlsx.writeFile(excelPath);
	});

	after(() => {
		delete process.env.EB_DATA_DIR;
		for (const key of cacheKeys) delete require.cache[key];
		try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
	});

	it("imports Excel file and creates employees + rights in DB", async () => {
		const { importExcel } = require("../backend/import/excelImporter");
		const report = await importExcel(excelPath);

		assert.equal(report.employeesCreated, 3);
		assert.equal(report.employeesUpdated, 0);
		assert.equal(report.employeeRights, 2); // 1st emp has 2 rights, 2nd has 0, 3rd has 0
		assert.equal(report.workRights, 2); // 2 right columns detected

		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try {
			const total = db.prepare("SELECT COUNT(*) as c FROM employees WHERE status != 'deleted'").get().c;
			assert.equal(total, 3);

			const ivanov = db.prepare("SELECT * FROM employees WHERE full_name = ?").get("Иванов Иван Иванович");
			assert.ok(ivanov);
			assert.equal(ivanov.position, "Электромонтер");
			assert.equal(ivanov.electrical_safety_group, "IV");
			assert.equal(ivanov.personnel_category, "Оперативно-ремонтный");

			const rights = db.prepare(`SELECT wr.name FROM employee_rights er JOIN work_rights wr ON wr.id = er.right_id WHERE er.employee_id = ? AND er.value = 1`).all(ivanov.id);
			const rightNames = rights.map(r => r.name).sort();
			assert.deepEqual(rightNames, ["Выдача нарядов", "Оперативные переключения"]);

			const petrov = db.prepare("SELECT * FROM employees WHERE full_name = ?").get("Петров Петр Петрович");
			assert.ok(petrov);
			assert.equal(petrov.position, "Инженер");
			assert.equal(petrov.electrical_safety_group, "III");

			const shiftedRow = db.prepare("SELECT * FROM employees WHERE full_name = ?").get("Сидоров Сидр Сидорович");
			assert.ok(shiftedRow);
			assert.equal(shiftedRow.workplace_name, "Участок №3");
		} finally {
			db.close();
		}
	});
});

// Общая подготовка для тестов, которым нужна своя папка данных
function useTempDataDir(prefix, extraModules = []) {
	const os = require("os");
	const path = require("path");
	const fs = require("fs");
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	const dbDir = path.join(tmpDir, "data");
	const cacheKeys = [
		"db/connection.js", "db/initDb.js", "paths.js", "security/dbPassword.js",
		"security/ftpCredentials.js", "db/repositories/settingsRepository.js", ...extraModules
	].map((p) => path.resolve(__dirname, "..", "backend", p));
	const clearCache = () => { for (const key of cacheKeys) delete require.cache[key]; };
	return {
		tmpDir,
		dbDir,
		setup() {
			process.env.EB_DATA_DIR = dbDir;
			clearCache();
			fs.mkdirSync(dbDir, { recursive: true });
		},
		teardown() {
			delete process.env.EB_DATA_DIR;
			clearCache();
			try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
		}
	};
}

describe("settings migration and FTP config", () => {
	const ctx = useTempDataDir("eb-test-settings-");
	const keyStorage = require("../backend/security/keyStorage");
	const originalGetSecret = keyStorage.getSecret;

	before(() => {
		ctx.setup();
		keyStorage.getSecret = async () => null;
	});

	after(() => {
		keyStorage.getSecret = originalGetSecret;
		ctx.teardown();
	});

	it("migrates old FTP keys, keeps existing new keys, removes passwords", () => {
		const { openDb } = require("../backend/db/connection");
		const { initDb } = require("../backend/db/initDb");

		initDb();
		let db = openDb();
		const ins = db.prepare("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, 'x')");
		ins.run("ftp_host", "old.example.com");
		ins.run("ftp_port", "2121");
		ins.run("ftp_user", "olduser");
		ins.run("ftp_path", "/old");
		ins.run("ftp.user", "newuser"); // новый ключ уже есть — не затираем
		ins.run("ftp_password", "secret");
		ins.run("ftp.password", "secret2");
		db.close();

		initDb();
		db = openDb();
		try {
			const all = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, r.value]));
			assert.equal(all["ftp.host"], "old.example.com");
			assert.equal(all["ftp.port"], "2121");
			assert.equal(all["ftp.user"], "newuser");
			assert.equal(all["ftp.remote_dir"], "/old");
			for (const key of ["ftp_host", "ftp_port", "ftp_user", "ftp_path", "ftp_password", "ftp.password"]) {
				assert.equal(key in all, false, key);
			}
			assert.equal(db.prepare("SELECT COUNT(*) AS c FROM settings WHERE key LIKE '%pass%'").get().c, 0);
		} finally {
			db.close();
		}
	});

	it("buildFtpConfig reads new keys", async () => {
		const { openDb } = require("../backend/db/connection");
		const { buildFtpConfig } = require("../backend/security/ftpCredentials");
		const db = openDb();
		try {
			const config = await buildFtpConfig(db);
			assert.equal(config.host, "old.example.com");
			assert.equal(config.port, 2121);
			assert.equal(config.user, "newuser");
			assert.equal(config.remoteDir, "/old");
		} finally {
			db.close();
		}
	});

	it("buildFtpConfig throws on empty host", async () => {
		const { openDb } = require("../backend/db/connection");
		const { buildFtpConfig } = require("../backend/security/ftpCredentials");
		const db = openDb();
		try {
			db.prepare("DELETE FROM settings WHERE key = 'ftp.host'").run();
			await assert.rejects(
				() => buildFtpConfig(db),
				{ message: "Не указан адрес FTP-сервера. Заполните настройки синхронизации." }
			);
		} finally {
			db.close();
		}
	});
});

describe("database encryption", () => {
	const ctx = useTempDataDir("eb-test-encrypt-", ["sync/backupService.js"]);
	const keyStorage = require("../backend/security/keyStorage");
	const originals = {};
	const secrets = new Map();
	const SQLITE_HEADER = "SQLite format 3\0";

	function readHeader() {
		const fs = require("fs");
		const path = require("path");
		const fd = fs.openSync(path.join(ctx.dbDir, "eb_protocols.db"), "r");
		try {
			const buf = Buffer.alloc(16);
			fs.readSync(fd, buf, 0, 16, 0);
			return buf.toString("latin1");
		} finally {
			fs.closeSync(fd);
		}
	}

	function makeDeps() {
		const connection = require("../backend/db/connection");
		const { createLocalBackup } = require("../backend/sync/backupService");
		const path = require("path");
		return {
			backup: (reason) => createLocalBackup({ dbPath: connection.DB_PATH, backupsDir: path.join(ctx.dbDir, "backups"), reason }),
			rekey: (key) => connection.rekeyDb(key),
			getCurrentKey: () => connection.getRuntimeDbKey(),
			setRuntimeKey: (key) => connection.setRuntimeDbKey(key)
		};
	}

	before(() => {
		ctx.setup();
		for (const name of ["isAvailable", "getAvailabilityMessage", "setSecret", "getSecret", "deleteSecret"]) {
			originals[name] = keyStorage[name];
		}
		keyStorage.isAvailable = () => true;
		keyStorage.getAvailabilityMessage = () => null;
		keyStorage.setSecret = async (account, secret) => { secrets.set(account, secret); };
		keyStorage.getSecret = async (account) => secrets.get(account) || null;
		keyStorage.deleteSecret = async (account) => secrets.delete(account);

		const { initDb } = require("../backend/db/initDb");
		const { openDb } = require("../backend/db/connection");
		initDb();
		const db = openDb();
		db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('probe', 'hello', 'x')").run();
		db.close();
	});

	after(() => {
		Object.assign(keyStorage, originals);
		ctx.teardown();
	});

	it("plain database starts with SQLite header", () => {
		assert.equal(readHeader(), SQLITE_HEADER);
	});

	it("rejects password shorter than 8 characters", async () => {
		const dbPassword = require("../backend/security/dbPassword");
		await assert.rejects(() => dbPassword.enableDbPassword("short", makeDeps()), /не менее 8/);
		assert.equal(readHeader(), SQLITE_HEADER);
	});

	it("enable: file is encrypted, readable only with the key, key survives restart", async () => {
		const fs = require("fs");
		const path = require("path");
		const dbPassword = require("../backend/security/dbPassword");
		const connection = require("../backend/db/connection");

		await dbPassword.enableDbPassword("correct horse battery", makeDeps());

		assert.notEqual(readHeader(), SQLITE_HEADER);
		assert.ok(fs.existsSync(path.join(ctx.dbDir, "eb_protocols.salt")));
		assert.ok(fs.readdirSync(path.join(ctx.dbDir, "backups")).some((n) => n.includes("before_encrypt")));

		// без ключа — ошибка
		connection.setRuntimeDbKey(null);
		let db = connection.openDb();
		try {
			assert.throws(() => db.prepare("SELECT count(*) FROM sqlite_master").get());
		} finally {
			db.close();
		}

		// «перезапуск»: ключ восстанавливается из пароля и соли
		const key = await dbPassword.getRuntimeKey();
		assert.match(key, /^[0-9a-f]{64}$/);
		connection.setRuntimeDbKey(key);
		db = connection.openDb();
		try {
			assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'probe'").get().value, "hello");
		} finally {
			db.close();
		}

		// неверный ключ — понятная ошибка
		connection.setRuntimeDbKey("00".repeat(32));
		assert.throws(() => connection.openDb(), /неверный пароль или база повреждена/);
		connection.setRuntimeDbKey(key);
	});

	it("disable: database is plain again, salt removed", async () => {
		const fs = require("fs");
		const path = require("path");
		const dbPassword = require("../backend/security/dbPassword");
		const connection = require("../backend/db/connection");

		await dbPassword.disableDbPassword(makeDeps());

		assert.equal(readHeader(), SQLITE_HEADER);
		assert.equal(fs.existsSync(path.join(ctx.dbDir, "eb_protocols.salt")), false);
		assert.equal(await dbPassword.getRuntimeKey(), null);
		const db = connection.openDb();
		try {
			assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'probe'").get().value, "hello");
		} finally {
			db.close();
		}
	});
});
