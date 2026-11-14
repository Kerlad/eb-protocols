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
		assert.equal(buildOutputFileName({ protocol_year: 2026, protocol_number: 137, full_name_snapshot: "Иванов И.И." }), "Протокол_2026_0137_Иванов_И.И..docx");
		assert.equal(buildOutputFileName({ check_date: "2025-04-01", protocol_number: 5, full_name_snapshot: "Петров П." }), "Протокол_2025_0005_Петров_П..docx");
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

describe("T2.9 safe download, upload, backup", () => {
	const fs = require("fs");
	const path = require("path");
	const ctx = useTempDataDir("eb-test-sync-safety-", ["sync/backupService.js", "sync/syncService.js", "sync/restoreService.js"]);
	const ftpClient = require("../backend/sync/ftpClient");
	const originals = {};
	const config = { transport: "ftp", host: "test" };
	let dbPath, backupsDir;

	const countEmployees = (file) => {
		const { openDbFile } = require("../backend/db/connection");
		const db = openDbFile(file);
		try { return db.prepare("SELECT count(*) AS n FROM employees").get().n; } finally { db.close(); }
	};

	before(() => {
		ctx.setup();
		for (const name of ["uploadFile", "replaceFile", "downloadFile", "fileExists"]) originals[name] = ftpClient[name];
		require("../backend/db/initDb").initDb();
		dbPath = require("../backend/db/connection").DB_PATH;
		backupsDir = path.join(ctx.dbDir, "backups");
	});

	after(() => {
		Object.assign(ftpClient, originals);
		ctx.teardown();
	});

	it("backup is a readable snapshot and old backups are pruned to 30", () => {
		const { createLocalBackup } = require("../backend/sync/backupService");
		fs.mkdirSync(backupsDir, { recursive: true });
		const old = new Date(2020, 0, 1);
		for (let i = 0; i < 35; i++) {
			const f = path.join(backupsDir, `eb_protocols_old_${String(i).padStart(2, "0")}.db`);
			fs.writeFileSync(f, "x");
			fs.utimesSync(f, old, old);
		}
		const result = createLocalBackup({ dbPath, backupsDir, reason: "test" });
		assert.equal(result.method, "snapshot");
		assert.ok(fs.existsSync(result.path));
		assert.equal(fs.readdirSync(backupsDir).filter((n) => n.endsWith(".db")).length, 30);
		assert.equal(countEmployees(result.path), countEmployees(dbPath));
	});

	it("corrupt download leaves the working database untouched", async () => {
		const { downloadDb } = require("../backend/sync/syncService");
		const before = fs.readFileSync(dbPath);
		ftpClient.fileExists = async () => true;
		ftpClient.downloadFile = async (cfg, remote, local) => { fs.writeFileSync(local, Buffer.alloc(8192, 7)); };
		await assert.rejects(downloadDb({ config, dbPath, backupsDir }), /не прошла проверку/);
		assert.ok(before.equals(fs.readFileSync(dbPath)));
		assert.equal(fs.existsSync(dbPath + ".download"), false);
	});

	it("interrupted download leaves the working database untouched", async () => {
		const { downloadDb } = require("../backend/sync/syncService");
		const before = fs.readFileSync(dbPath);
		ftpClient.fileExists = async () => true;
		ftpClient.downloadFile = async (cfg, remote, local) => {
			fs.writeFileSync(local, before.subarray(0, 100));
			throw new Error("connection reset");
		};
		await assert.rejects(downloadDb({ config, dbPath, backupsDir }), /connection reset/);
		assert.ok(before.equals(fs.readFileSync(dbPath)));
		assert.equal(fs.existsSync(dbPath + ".download"), false);
	});

	it("valid download replaces the working database after a backup", async () => {
		const { downloadDb } = require("../backend/sync/syncService");
		const { snapshotDbFile, openDbFile } = require("../backend/db/connection");
		const remoteFile = path.join(ctx.tmpDir, "remote.db");
		snapshotDbFile(dbPath, remoteFile);
		const remote = openDbFile(remoteFile);
		remote.prepare("INSERT INTO employees (last_name, first_name, full_name, created_at, updated_at) VALUES ('Удалённый', 'Работник', 'Удалённый Работник', '2026-01-01', '2026-01-01')").run();
		remote.close();
		const expected = countEmployees(remoteFile);

		ftpClient.fileExists = async () => true;
		ftpClient.downloadFile = async (cfg, remoteName, local) => { fs.copyFileSync(remoteFile, local); };
		const result = await downloadDb({ config, dbPath, backupsDir });
		assert.equal(result.ok, true);
		assert.equal(countEmployees(dbPath), expected);
		assert.ok(fs.readdirSync(backupsDir).some((n) => n.includes("before_download")));
	});

	it("upload sends a snapshot under a temporary name, then renames", async () => {
		const { uploadDb, REMOTE_DB_NAME, REMOTE_DB_TEMP_NAME, REMOTE_META_NAME } = require("../backend/sync/syncService");
		const { openDbFile } = require("../backend/db/connection");
		const calls = [];
		const uploaded = path.join(ctx.tmpDir, "uploaded.db");
		ftpClient.uploadFile = async (cfg, local, remoteName) => {
			calls.push(["upload", remoteName]);
			if (remoteName === REMOTE_DB_TEMP_NAME) fs.copyFileSync(local, uploaded);
		};
		ftpClient.replaceFile = async (cfg, tempName, remoteName) => { calls.push(["rename", tempName, remoteName]); };
		const db = openDbFile(dbPath);
		try {
			await uploadDb({ db, config, dbPath, tempDir: ctx.tmpDir, force: true });
		} finally {
			db.close();
		}
		assert.deepEqual(calls, [
			["upload", REMOTE_DB_TEMP_NAME],
			["rename", REMOTE_DB_TEMP_NAME, REMOTE_DB_NAME],
			["upload", REMOTE_META_NAME]
		]);
		assert.equal(countEmployees(uploaded), countEmployees(dbPath));
		assert.equal(fs.readdirSync(ctx.tmpDir).some((n) => n.startsWith("upload_")), false);
	});

	it("restore rejects a corrupt backup file", () => {
		const { restoreFromBackup } = require("../backend/sync/restoreService");
		const bad = path.join(backupsDir, "broken.db");
		fs.writeFileSync(bad, Buffer.alloc(4096, 1));
		const before = fs.readFileSync(dbPath);
		assert.throws(() => restoreFromBackup({ backupPath: bad, dbPath, backupsDir }));
		assert.ok(before.equals(fs.readFileSync(dbPath)));
	});
});
describe("dateUtils (T2.11)", () => {
	const { mock } = require("node:test");
	const { todayLocal, addDaysLocal, addYearsLocal, isIsoDate } = require("../backend/utils/dateUtils");

	it("addYearsLocal: 29.02 + 1 year in non-leap year gives 28.02", () => {
		assert.equal(addYearsLocal("2028-02-29", 1), "2029-02-28");
		assert.equal(addYearsLocal("2028-02-29", 4), "2032-02-29");
		assert.equal(addYearsLocal("2026-06-15", 3), "2029-06-15");
	});

	it("addDaysLocal crosses month and year boundaries", () => {
		assert.equal(addDaysLocal("2026-12-31", 1), "2027-01-01");
		assert.equal(addDaysLocal("2026-03-01", -1), "2026-02-28");
		assert.equal(addDaysLocal("2026-06-15", 30), "2026-07-15");
	});

	it("isIsoDate validates format and calendar", () => {
		assert.equal(isIsoDate("2026-06-15"), true);
		assert.equal(isIsoDate("2028-02-29"), true);
		assert.equal(isIsoDate("2026-02-30"), false);
		assert.equal(isIsoDate("2026-13-01"), false);
		assert.equal(isIsoDate("15.06.2026"), false);
		assert.equal(isIsoDate("2026-6-5"), false);
		assert.equal(isIsoDate(null), false);
	});

	it("todayLocal returns local date at 23:30 local time", () => {
		mock.timers.enable({ apis: ["Date"], now: new Date(2026, 5, 15, 23, 30, 0) });
		try {
			assert.equal(todayLocal(), "2026-06-15");
		} finally {
			mock.timers.reset();
		}
	});

	it("todayLocal returns local date at 00:30 local time", () => {
		mock.timers.enable({ apis: ["Date"], now: new Date(2026, 0, 1, 0, 30, 0) });
		try {
			assert.equal(todayLocal(), "2026-01-01");
		} finally {
			mock.timers.reset();
		}
	});
});

describe("T2.1: import keeps real dates", () => {
	const ctx = useTempDataDir("eb-test-t21-", ["import/excelImporter.js"]);
	const path = require("path");
	const fs = require("fs");
	const ExcelJS = require("exceljs");
	const excelPath = path.join(ctx.tmpDir, "t21.xlsx");

	before(async () => {
		ctx.setup();
		const Database = require("better-sqlite3-multiple-ciphers");
		const preDb = new Database(path.join(ctx.dbDir, "eb_protocols.db"));
		preDb.exec(fs.readFileSync(path.join(__dirname, "..", "backend", "db", "schema.sql"), "utf8"));
		preDb.prepare("INSERT INTO sync_state (id, db_version, sync_revision, sync_status) VALUES (1, 'test', 0, 'test')").run();
		preDb.close();

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Data");
		sheet.getRow(1).values = ["Фамилия", "Имя", "Отчество", "Место работы", "Должность", "Объем знаний", "Категория персонала", "Группа", "Дата проверки", "Дата след. проверки", "Периодичность"];
		sheet.getRow(2).values = ["Безданов", "Иван", "Иванович", "Участок №1", "Электромонтер", "ЭЧТ", "Оперативный", "IV", "", "", 1];
		sheet.getRow(3).values = ["Просрочев", "Петр", "Петрович", "Участок №2", "Инженер", "ЭЧТ", "Оперативный", "III", new Date("2020-01-15"), new Date("2021-01-15"), 1];
		await workbook.xlsx.writeFile(excelPath);
	});

	after(() => ctx.teardown());

	it("row without date keeps last_check_date NULL, overdue next date is unchanged", async () => {
		const { importExcel } = require("../backend/import/excelImporter");
		await importExcel(excelPath);
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try {
			const a = db.prepare("SELECT * FROM employees WHERE full_name LIKE 'Безданов%'").get();
			assert.equal(a.last_check_date, null);
			assert.equal(a.next_check_date, null);
			assert.notEqual(a.note, "DATE_DEFERRED");
			const b = db.prepare("SELECT * FROM employees WHERE full_name LIKE 'Просрочев%'").get();
			assert.equal(b.next_check_date, "2021-01-15");
			assert.notEqual(b.note, "DATE_DEFERRED");
		} finally {
			db.close();
		}
	});

	it("migration clears 2000-01-01 and DATE_DEFERRED, logs an event once", () => {
		const { migrateFakeDates } = require("../backend/db/initDb");
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try {
			db.prepare("UPDATE employees SET last_check_date = '2000-01-01', note = 'DATE_DEFERRED'").run();
			const n = db.prepare("SELECT COUNT(*) AS c FROM employees").get().c;
			assert.equal(migrateFakeDates(db), n);
			assert.equal(db.prepare("SELECT COUNT(*) AS c FROM employees WHERE last_check_date = '2000-01-01' OR note = 'DATE_DEFERRED'").get().c, 0);
			const events = () => db.prepare("SELECT COUNT(*) AS c FROM app_events WHERE event_type = 'migration_fake_dates'").get().c;
			assert.equal(events(), 1);
			assert.equal(migrateFakeDates(db), 0);
			assert.equal(events(), 1);
		} finally {
			db.close();
		}
	});
});

describe("protocol save validation and rollback (T2.4)", () => {
	const fs = require("fs");
	const path = require("path");
	const ctx = useTempDataDir("eb-test-save-protocol-", ["protocol/protocolService.js"]);
	let protocolsDir;

	const validForm = (extra = {}) => ({
		employee_id: null,
		protocol_number: 1,
		check_date: "2026-06-15",
		next_check_date: "2027-06-15",
		full_name_snapshot: "Сидоров Сергей Сергеевич",
		reason: "Очередная",
		electrical_safety_group: "III",
		final_result: "сдал",
		commission_name: "Комиссия",
		chairman_name: "Иванов И.И.",
		member_1_name: "Петров П.П.",
		...extra
	});

	const journalCount = () => {
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try { return db.prepare("SELECT count(*) AS n FROM protocol_journal").get().n; } finally { db.close(); }
	};

	before(() => {
		ctx.setup();
		require("../backend/db/initDb").initDb();
		protocolsDir = path.join(ctx.tmpDir, "protocols");
	});
	after(() => ctx.teardown());

	it("validateProtocolForm lists all missing fields in Russian", () => {
		const { validateProtocolForm } = require("../backend/protocol/protocolService");
		assert.throws(
			() => validateProtocolForm(validForm({ electrical_safety_group: "", chairman_name: "" })),
			(e) => /Не заполнены поля: группа ЭБ, председатель комиссии/.test(e.message)
		);
		assert.doesNotThrow(() => validateProtocolForm(validForm()));
	});

	it("validateProtocolForm rejects next_check_date <= check_date and bad number", () => {
		const { validateProtocolForm } = require("../backend/protocol/protocolService");
		assert.throws(() => validateProtocolForm(validForm({ next_check_date: "2026-06-15" })), /дата следующей проверки/);
		assert.throws(() => validateProtocolForm(validForm({ next_check_date: "2026-01-01" })), /дата следующей проверки/);
		assert.throws(() => validateProtocolForm(validForm({ next_check_date: "" })), /Не заполнены поля: дата следующей проверки/);
		assert.throws(() => validateProtocolForm(validForm({ protocol_number: 0 })), /номер протокола/);
		assert.throws(() => validateProtocolForm(validForm({ protocol_number: 1.5 })), /номер протокола/);
		assert.throws(() => validateProtocolForm(validForm({ protocol_number: "abc" })), /номер протокола/);
		assert.throws(() => validateProtocolForm(validForm({ electrical_safety_group: "I" })), /группа ЭБ/);
	});

	it("saveProtocol with empty group throws, no journal row and no DOCX", async () => {
		const { saveProtocol } = require("../backend/protocol/protocolService");
		await assert.rejects(
			saveProtocol(validForm({ electrical_safety_group: "" }), { protocolsDir }),
			/группа ЭБ/
		);
		assert.equal(journalCount(), 0);
		assert.equal(fs.existsSync(protocolsDir) ? fs.readdirSync(protocolsDir).length : 0, 0);
	});

	it("DOCX failure removes journal row and restores employee fields", async () => {
		const docxGenerator = require("../backend/protocol/docxGenerator");
		const employeesRepository = require("../backend/db/repositories/employeesRepository");
		const { openDb } = require("../backend/db/connection");
		const { saveProtocol } = require("../backend/protocol/protocolService");

		let db = openDb();
		let empId;
		try {
			empId = employeesRepository.createEmployee(db, {
				last_name: "Тестов", first_name: "Тест", middle_name: "Тестович", full_name: "Тестов Тест Тестович",
				last_check_date: "2025-06-15", next_check_date: "2026-06-15", last_result: "сдал"
			});
			empId = typeof empId === "object" && empId !== null ? (empId.id ?? empId.lastInsertRowid) : empId;
		} finally { db.close(); }

		const original = docxGenerator.renderProtocolDocx;
		docxGenerator.renderProtocolDocx = () => { throw new Error("docx boom"); };
		try {
			await assert.rejects(saveProtocol(validForm({ employee_id: empId, final_result: "не сдал" }), { protocolsDir }), /docx boom/);
		} finally {
			docxGenerator.renderProtocolDocx = original;
		}

		assert.equal(journalCount(), 0);
		db = openDb();
		try {
			const emp = employeesRepository.findById(db, empId);
			assert.equal(emp.last_check_date, "2025-06-15");
			assert.equal(emp.next_check_date, "2026-06-15");
			assert.equal(emp.last_result, "сдал");
		} finally { db.close(); }
	});
});

describe("checkPeriod rules (T2.3, T2.5)", () => {
	const { defaultPeriodYears, failedRecheckDate, isAnnualRight, isFailedResult } = require("../backend/utils/checkPeriod");

	it("administrative staff: 3 years, 12 months with operative or repair rights", () => {
		assert.equal(defaultPeriodYears("Административно-технический", []), 3);
		assert.equal(defaultPeriodYears("Административно-технический", ["Выдача нарядов"]), 3);
		assert.equal(defaultPeriodYears("Административно-технический", ["Права оперативного персонала"]), 1);
		assert.equal(defaultPeriodYears("Административно-технический", ["Оперативно-ремонтный персонал"]), 1);
		assert.equal(defaultPeriodYears("Административно-технический", ["Ремонтный персонал"]), 1);
		assert.equal(isAnnualRight("ОПЕРАТИВНЫЕ переключения"), true);
	});

	it("other categories", () => {
		for (const c of ["Оперативный", "Оперативно-ремонтный", "Ремонтный", "Диспетчерский", "", null]) {
			assert.equal(defaultPeriodYears(c, []), 1, String(c));
		}
		assert.equal(defaultPeriodYears("Инспектирующий", ["Оперативный"]), 3);
	});

	it("failed check: +29 days, weekend moves back to Friday", () => {
		assert.equal(failedRecheckDate("2026-11-02"), "2026-12-01"); // вторник
		assert.equal(failedRecheckDate("2026-11-06"), "2026-12-04"); // суббота -> пятница
		assert.equal(failedRecheckDate("2026-11-07"), "2026-12-04"); // воскресенье -> пятница
		assert.equal(failedRecheckDate("2026-12-31"), "2027-01-29");
		assert.equal(isFailedResult("Неуд"), true);
		assert.equal(isFailedResult("неудовлетворительно"), true);
		assert.equal(isFailedResult("Уд"), false);
	});
});

describe("import applies default period (T2.3)", () => {
	const ctx = useTempDataDir("eb-test-t23-", ["import/excelImporter.js"]);
	const path = require("path");
	const fs = require("fs");
	const ExcelJS = require("exceljs");
	const excelPath = path.join(ctx.tmpDir, "t23.xlsx");

	before(async () => {
		ctx.setup();
		require("../backend/db/initDb").initDb();
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Data");
		sheet.getRow(1).values = ["Фамилия", "Имя", "Отчество", "Место работы", "Должность", "Объем знаний", "Категория персонала", "Группа", "Дата проверки", "Дата след. проверки", "Периодичность", "Оперативные переключения"];
		sheet.getRow(2).values = ["Атп", "Без", "Прав", "Цех", "Инженер", "ЭЧТ", "Административно-технический", "IV", new Date(Date.UTC(2026, 2, 10)), "", "", ""];
		sheet.getRow(3).values = ["Атп", "С", "Правом", "Цех", "Мастер", "ЭЧТ", "Административно-технический", "IV", new Date(Date.UTC(2026, 2, 10)), "", "", "да"];
		sheet.getRow(4).values = ["Атп", "Явный", "Период", "Цех", "Инженер", "ЭЧТ", "Административно-технический", "IV", new Date(Date.UTC(2026, 2, 10)), "", 2, ""];
		await workbook.xlsx.writeFile(excelPath);
	});

	after(() => ctx.teardown());

	it("empty period column uses category and rights; explicit period wins", async () => {
		const { importExcel } = require("../backend/import/excelImporter");
		await importExcel(excelPath);
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try {
			const get = (first) => db.prepare("SELECT check_period_years p, next_check_date n FROM employees WHERE first_name = ?").get(first);
			assert.deepEqual({ ...get("Без") }, { p: 3, n: "2029-03-10" });
			assert.deepEqual({ ...get("С") }, { p: 1, n: "2027-03-10" });
			assert.deepEqual({ ...get("Явный") }, { p: 2, n: "2028-03-10" });
		} finally {
			db.close();
		}
	});
});

describe("protocol result updates employee group (T2.5)", () => {
	const path = require("path");
	const ctx = useTempDataDir("eb-test-t25-", ["protocol/protocolService.js"]);
	let protocolsDir, empId;
	const docxGenerator = require("../backend/protocol/docxGenerator");
	const originalRender = docxGenerator.renderProtocolDocx;

	const form = (extra) => ({
		protocol_number: 1, check_date: "2026-11-02", next_check_date: "2027-11-02",
		full_name_snapshot: "Группов Г.Г.", reason: "Очередная", electrical_safety_group: "IV",
		final_result: "Уд", commission_name: "Комиссия", chairman_name: "Иванов И.И.", member_1_name: "Петров П.П.",
		...extra
	});
	const employee = () => {
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try { return db.prepare("SELECT * FROM employees WHERE id = ?").get(empId); } finally { db.close(); }
	};

	before(() => {
		ctx.setup();
		require("../backend/db/initDb").initDb();
		protocolsDir = path.join(ctx.tmpDir, "protocols");
		const { openDb } = require("../backend/db/connection");
		const employeesRepository = require("../backend/db/repositories/employeesRepository");
		const db = openDb();
		try {
			empId = employeesRepository.createEmployee(db, {
				last_name: "Группов", first_name: "Г", full_name: "Группов Г", electrical_safety_group: "III"
			});
		} finally { db.close(); }
		docxGenerator.renderProtocolDocx = () => {};
	});
	after(() => {
		docxGenerator.renderProtocolDocx = originalRender;
		ctx.teardown();
	});

	it("Неуд with next date later than +29 days is rejected", () => {
		const { validateProtocolForm } = require("../backend/protocol/protocolService");
		assert.throws(() => validateProtocolForm(form({ final_result: "Неуд", next_check_date: "2026-12-02" })), /после «Неуд»/);
		assert.doesNotThrow(() => validateProtocolForm(form({ final_result: "Неуд", next_check_date: "2026-12-01" })));
	});

	it("Неуд keeps the group, positive result assigns it", async () => {
		const { saveProtocol } = require("../backend/protocol/protocolService");
		await saveProtocol(form({ employee_id: empId, final_result: "Неуд", next_check_date: "2026-12-01" }), { protocolsDir });
		assert.equal(employee().electrical_safety_group, "III");
		assert.equal(employee().next_check_date, "2026-12-01");
		await saveProtocol(form({ employee_id: empId, protocol_number: 2, check_date: "2026-11-20", next_check_date: "2027-11-20" }), { protocolsDir });
		assert.equal(employee().electrical_safety_group, "IV");
	});
});

describe("sync conflicts by change id (T2.8)", () => {
	const fs = require("fs");
	const path = require("path");
	const { compareDbState } = require("../backend/sync/conflictDetector");
	const ctx = useTempDataDir("eb-test-t28-", ["sync/backupService.js", "sync/syncService.js"]);
	const ftpClient = require("../backend/sync/ftpClient");
	const originals = {};
	const config = { transport: "ftp", host: "test" };

	it("compareDbState: four branches and legacy metadata", () => {
		assert.equal(compareDbState({ changeId: "a", baseChangeId: "x" }, { changeId: "a" }).status, "in_sync");
		assert.equal(compareDbState({ changeId: "b", baseChangeId: "a" }, { changeId: "a" }).status, "local_newer");
		assert.equal(compareDbState({ changeId: "a", baseChangeId: "a" }, { changeId: "c" }).status, "remote_newer");
		assert.equal(compareDbState({ changeId: "b", baseChangeId: "a" }, { changeId: "c" }).status, "conflict");
		assert.equal(compareDbState({ changeId: "b", baseChangeId: null }, { changeId: "c" }).status, "conflict");
		// одинаковые счётчики ревизий больше не маскируют расхождение
		assert.equal(compareDbState(
			{ changeId: "b", baseChangeId: "a", syncRevision: 5, journalCountTotal: 3 },
			{ changeId: "c", syncRevision: 5, journalCountTotal: 3 }
		).status, "conflict");
		assert.equal(compareDbState({ syncRevision: 1, journalCountTotal: 1 }, { syncRevision: 1, journalCountTotal: 1 }).status, "in_sync");
	});

	before(() => {
		ctx.setup();
		for (const name of ["uploadFile", "replaceFile", "downloadFile", "fileExists"]) originals[name] = ftpClient[name];
		require("../backend/db/initDb").initDb();
	});
	after(() => {
		Object.assign(ftpClient, originals);
		ctx.teardown();
	});

	const state = () => {
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try { return db.prepare("SELECT db_uid, change_id, base_change_id FROM sync_state WHERE id = 1").get(); } finally { db.close(); }
	};

	it("any data change gets a new change_id, settings do not", () => {
		const { openDb } = require("../backend/db/connection");
		const before = state();
		assert.ok(before.db_uid && before.change_id);
		const db = openDb();
		try {
			db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('x', 'y', 'z')").run();
		} finally { db.close(); }
		assert.equal(state().change_id, before.change_id);
		const db2 = openDb();
		try {
			db2.prepare("INSERT INTO protocol_journal (protocol_year, protocol_number, full_name_snapshot, check_date, created_at, updated_at) VALUES (2026, 1, 'А', '2026-01-01', 'x', 'x')").run();
		} finally { db2.close(); }
		assert.notEqual(state().change_id, before.change_id);
	});

	it("upload refuses when server has foreign changes, force uploads and records base", async () => {
		const { uploadDb } = require("../backend/sync/syncService");
		const { openDb } = require("../backend/db/connection");
		const remoteMeta = { changeId: "foreign", device: "PC-2", lastModifiedAt: "2026-11-10T10:00:00.000Z" };
		ftpClient.fileExists = async () => true;
		ftpClient.downloadFile = async (cfg, remote, local) => { fs.writeFileSync(local, JSON.stringify(remoteMeta)); };
		ftpClient.uploadFile = async () => {};
		ftpClient.replaceFile = async () => {};
		const db = openDb();
		try {
			await assert.rejects(uploadDb({ db, config, dbPath: require("../backend/db/connection").DB_PATH, tempDir: ctx.tmpDir }),
				(e) => e.code === "SYNC_CONFLICT" && e.remoteDevice === "PC-2");
			await uploadDb({ db, config, dbPath: require("../backend/db/connection").DB_PATH, tempDir: ctx.tmpDir, force: true });
		} finally { db.close(); }
		const s = state();
		assert.equal(s.base_change_id, s.change_id);
	});
});

describe("normalizeDate (T2.12)", () => {
	const { normalizeDate } = require("../backend/import/excelImporter");

	it("accepts the supported text formats", () => {
		assert.deepEqual(normalizeDate("15.06.2026"), { value: "2026-06-15", error: null });
		assert.deepEqual(normalizeDate("15.06.26"), { value: "2026-06-15", error: null });
		assert.deepEqual(normalizeDate("15/06/2026"), { value: "2026-06-15", error: null });
		assert.deepEqual(normalizeDate("2026-06-15"), { value: "2026-06-15", error: null });
		assert.deepEqual(normalizeDate(" 5.6.2026 "), { value: "2026-06-05", error: null });
	});

	it("treats empty values as empty, not as errors", () => {
		for (const v of [null, undefined, "", "   "]) {
			assert.deepEqual(normalizeDate(v), { value: null, error: null });
		}
	});

	it("accepts Date objects and Excel serial numbers via UTC", () => {
		assert.deepEqual(normalizeDate(new Date(Date.UTC(2026, 5, 15))), { value: "2026-06-15", error: null });
		const serial = (Date.UTC(2026, 5, 15) - Date.UTC(1899, 11, 30)) / 86400000;
		assert.deepEqual(normalizeDate(serial), { value: "2026-06-15", error: null });
		assert.deepEqual(normalizeDate(String(serial)), { value: "2026-06-15", error: null });
	});

	it("rejects impossible calendar dates and unknown formats", () => {
		for (const v of ["31.02.2026", "2026-02-30", "2026-13-01", "15.06.2026.", "hello", "15-06-2026", "31/02/2026"]) {
			const r = normalizeDate(v);
			assert.equal(r.value, null, v);
			assert.equal(r.error, `не распознана дата "${v}"`, v);
		}
	});

	it("rejects invalid Date objects without throwing", () => {
		const r = normalizeDate(new Date("bogus"));
		assert.equal(r.value, null);
		assert.ok(r.error);
	});
});

describe("import reports bad dates without aborting (T2.12)", () => {
	const ctx = useTempDataDir("eb-test-t212-", ["import/excelImporter.js"]);
	const path = require("path");
	const ExcelJS = require("exceljs");
	const excelPath = path.join(ctx.tmpDir, "t212.xlsx");

	before(async () => {
		ctx.setup();
		require("../backend/db/initDb").initDb();
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Data");
		sheet.getRow(1).values = ["Фамилия", "Имя", "Отчество", "Место работы", "Должность", "Объем знаний", "Категория персонала", "Группа", "Дата проверки", "Дата след. проверки", "Периодичность", "Оперативные переключения"];
		sheet.getRow(2).values = ["Датов", "Первый", "Тест", "Цех", "Инженер", "ЭЧТ", "Административно-технический", "IV", "15/06/2026", "", 1, ""];
		sheet.getRow(3).values = ["Датов", "Второй", "Тест", "Цех", "Инженер", "ЭЧТ", "Административно-технический", "IV", "31.02.2026", "", 1, ""];
		await workbook.xlsx.writeFile(excelPath);
	});

	after(() => ctx.teardown());

	it("accepts 15/06/2026, nulls 31.02.2026 and keeps importing", async () => {
		const { importExcel } = require("../backend/import/excelImporter");
		const report = await importExcel(excelPath);
		assert.equal(report.employeesCreated, 2);
		assert.deepEqual(
			report.errors.filter((e) => e.includes("не распознана дата")),
			['Строка 3: не распознана дата "31.02.2026"']
		);

		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try {
			const get = (first) => db.prepare("SELECT last_check_date l, next_check_date n FROM employees WHERE first_name = ?").get(first);
			assert.deepEqual({ ...get("Первый") }, { l: "2026-06-15", n: "2027-06-15" });
			assert.deepEqual({ ...get("Второй") }, { l: null, n: null });
		} finally {
			db.close();
		}
	});
});

describe("normalizeDate rejects a bare year (T2.12 review)", () => {
	const { normalizeDate } = require("../backend/import/excelImporter");
	it("'2026' is an error, '46188' is an Excel serial", () => {
		assert.equal(normalizeDate("2026").value, null);
		assert.ok(normalizeDate("2026").error);
		assert.equal(normalizeDate("46188").value, "2026-06-15");
	});
});

describe("deleting a protocol restores the employee card (T2.6)", () => {
	const path = require("path");
	const fs = require("fs");
	const ctx = useTempDataDir("eb-test-t26-", ["protocol/protocolService.js", "db/repositories/journalRepository.js"]);
	let protocolsDir, empId;
	const docxGenerator = require("../backend/protocol/docxGenerator");
	const originalRender = docxGenerator.renderProtocolDocx;

	const form = (extra) => ({
		protocol_number: 1, check_date: "2026-03-02", next_check_date: "2027-03-02",
		full_name_snapshot: "Удалов У.У.", reason: "Очередная", electrical_safety_group: "IV",
		final_result: "Уд", commission_name: "Комиссия", chairman_name: "Иванов И.И.", member_1_name: "Петров П.П.",
		...extra
	});
	const withDb = (fn) => {
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try { return fn(db); } finally { db.close(); }
	};

	before(() => {
		ctx.setup();
		require("../backend/db/initDb").initDb();
		protocolsDir = path.join(ctx.tmpDir, "protocols");
		const employeesRepository = require("../backend/db/repositories/employeesRepository");
		empId = withDb((db) => employeesRepository.createEmployee(db, {
			last_name: "Удалов", first_name: "У", full_name: "Удалов У", electrical_safety_group: "III"
		}));
		docxGenerator.renderProtocolDocx = ({ outputPath }) => {
			fs.mkdirSync(path.dirname(outputPath), { recursive: true });
			fs.writeFileSync(outputPath, "x");
		};
	});
	after(() => {
		docxGenerator.renderProtocolDocx = originalRender;
		ctx.teardown();
	});

	it("restores dates, result and group from the previous protocol and keeps files as .deleted", async () => {
		const { saveProtocol } = require("../backend/protocol/protocolService");
		const journalRepository = require("../backend/db/repositories/journalRepository");
		await saveProtocol(form({ employee_id: empId }), { protocolsDir });
		const second = await saveProtocol(form({
			employee_id: empId, protocol_number: 2, check_date: "2026-09-02", next_check_date: "2027-09-02",
			electrical_safety_group: "V"
		}), { protocolsDir });
		assert.ok(fs.existsSync(second.docx_path));

		const result = withDb((db) => journalRepository.deleteJournalRecord(db, second.id, { protocolsDir }));
		assert.equal(result.warning, null);
		assert.equal(result.renamed_files.length, 1);
		assert.ok(!fs.existsSync(second.docx_path));
		assert.ok(fs.existsSync(second.docx_path + ".deleted"));

		const emp = withDb((db) => db.prepare("SELECT * FROM employees WHERE id = ?").get(empId));
		assert.equal(emp.last_check_date, "2026-03-02");
		assert.equal(emp.next_check_date, "2027-03-02");
		assert.equal(emp.last_result, "Уд");
		assert.equal(emp.electrical_safety_group, "IV");
		const events = withDb((db) => db.prepare("SELECT * FROM app_events WHERE event_type = 'protocol_deleted'").all());
		assert.equal(events.length, 1);
	});

	it("returns a warning and leaves the card untouched when no protocols remain", () => {
		const journalRepository = require("../backend/db/repositories/journalRepository");
		const firstId = withDb((db) => db.prepare("SELECT id FROM protocol_journal WHERE employee_id = ?").get(empId).id);
		const result = withDb((db) => journalRepository.deleteJournalRecord(db, firstId, { protocolsDir }));
		assert.match(result.warning, /не осталось/);
		const emp = withDb((db) => db.prepare("SELECT * FROM employees WHERE id = ?").get(empId));
		assert.equal(emp.last_check_date, "2026-03-02");
		assert.equal(emp.electrical_safety_group, "IV");
	});
});

describe("protocol file paths (T2.7)", () => {
	const path = require("path");
	const fs = require("fs");
	const ctx = useTempDataDir("eb-test-t27-", ["protocol/protocolService.js"]);
	let protocolsDir;
	const docxGenerator = require("../backend/protocol/docxGenerator");
	const originalRender = docxGenerator.renderProtocolDocx;

	const form = (extra) => ({
		protocol_number: 7, check_date: "2026-05-04", next_check_date: "2027-05-04",
		full_name_snapshot: "Путёв П.П.", reason: "Очередная", electrical_safety_group: "IV",
		final_result: "Уд", commission_name: "Комиссия", chairman_name: "Иванов И.И.", member_1_name: "Петров П.П.",
		previous_check_date: "2025-05-04", previous_result: "Уд",
		...extra
	});
	const withDb = (fn) => {
		const { openDb } = require("../backend/db/connection");
		const db = openDb();
		try { return fn(db); } finally { db.close(); }
	};
	const stubWrite = ({ outputPath }) => {
		fs.mkdirSync(path.dirname(outputPath), { recursive: true });
		fs.writeFileSync(outputPath, "x");
	};

	before(() => {
		ctx.setup();
		require("../backend/db/initDb").initDb();
		protocolsDir = path.join(ctx.tmpDir, "protocols");
		docxGenerator.renderProtocolDocx = stubWrite;
	});
	after(() => {
		docxGenerator.renderProtocolDocx = originalRender;
		ctx.teardown();
	});

	it("stores a relative path in a year folder and the previous check fields", async () => {
		const { saveProtocol } = require("../backend/protocol/protocolService");
		const res = await saveProtocol(form(), { protocolsDir });
		const row = withDb((db) => db.prepare("SELECT * FROM protocol_journal WHERE id = ?").get(res.id));
		assert.equal(row.docx_path, "2026/Протокол_2026_0007_Путёв_П.П..docx");
		assert.ok(fs.existsSync(path.join(protocolsDir, row.docx_path)));
		assert.equal(row.previous_check_date, "2025-05-04");
		assert.equal(row.previous_result, "Уд");
	});

	it("resolveProtocolFile handles relative, legacy absolute and missing paths", () => {
		const { resolveProtocolFile } = require("../backend/protocol/protocolFiles");
		const rel = "2026/Протокол_2026_0007_Путёв_П.П..docx";
		assert.equal(resolveProtocolFile(protocolsDir, rel), fs.realpathSync.native(path.join(protocolsDir, rel)));
		// старый абсолютный путь с другого компьютера: ищем по имени в папке года
		const legacy = "C:\\Other\\data\\protocols\\Протокол_2026_0007_Путёв_П.П..docx";
		assert.equal(resolveProtocolFile(protocolsDir, legacy), fs.realpathSync.native(path.join(protocolsDir, rel)));
		assert.equal(resolveProtocolFile(protocolsDir, "2026/нет_такого.docx"), null);
		assert.throws(() => resolveProtocolFile(protocolsDir, "2026/file.exe"), /Недопустимый/);
		const outside = path.join(ctx.tmpDir, "outside.docx");
		fs.writeFileSync(outside, "x");
		assert.throws(() => resolveProtocolFile(protocolsDir, outside), /вне папки/);
	});

	it("never overwrites an existing file and leaves no journal row", async () => {
		const { saveProtocol } = require("../backend/protocol/protocolService");
		const target = path.join(protocolsDir, "2026", "Протокол_2026_0008_Путёв_П.П..docx");
		fs.writeFileSync(target, "чужой файл");
		await assert.rejects(() => saveProtocol(form({ protocol_number: 8 }), { protocolsDir }), /уже существует/);
		assert.equal(fs.readFileSync(target, "utf8"), "чужой файл");
		const count = withDb((db) => db.prepare("SELECT COUNT(*) AS c FROM protocol_journal WHERE protocol_number = 8").get().c);
		assert.equal(count, 0);
	});

	it("regenerate creates the missing file from the journal row", async () => {
		const { regenerateProtocolDocx } = require("../backend/protocol/protocolService");
		const { protocolFileExists } = require("../backend/protocol/protocolFiles");
		const id = withDb((db) => db.prepare("SELECT id FROM protocol_journal WHERE protocol_number = 7").get().id);
		const file = path.join(protocolsDir, "2026", "Протокол_2026_0007_Путёв_П.П..docx");
		fs.unlinkSync(file);
		assert.equal(protocolFileExists(protocolsDir, "2026/Протокол_2026_0007_Путёв_П.П..docx"), false);
		let captured;
		docxGenerator.renderProtocolDocx = (opts) => { captured = opts; stubWrite(opts); };
		const res = withDb((db) => regenerateProtocolDocx(db, id, { protocolsDir }));
		assert.equal(res.docx_path, "2026/Протокол_2026_0007_Путёв_П.П..docx");
		assert.ok(fs.existsSync(file));
		assert.equal(captured.placeholderMap["пред_оценка"], "Уд");
		docxGenerator.renderProtocolDocx = stubWrite;
		assert.throws(() => withDb((db) => regenerateProtocolDocx(db, id, { protocolsDir })), /уже существует/);
	});
});

describe("T2.10 transports and SFTP host key", () => {
	const ctx = useTempDataDir("eb-test-transport-", ["sync/syncService.js"]);
	const keyStorage = require("../backend/security/keyStorage");
	const originalGetSecret = keyStorage.getSecret;

	before(() => {
		ctx.setup();
		keyStorage.getSecret = async () => null;
		const { initDb } = require("../backend/db/initDb");
		initDb();
	});

	after(() => {
		keyStorage.getSecret = originalGetSecret;
		ctx.teardown();
	});

	async function configWith(settings) {
		const { openDb } = require("../backend/db/connection");
		const { buildFtpConfig } = require("../backend/security/ftpCredentials");
		const db = openDb();
		try {
			db.prepare("DELETE FROM settings WHERE key LIKE 'ftp.%' OR key LIKE 'sftp.%'").run();
			const ins = db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 'x')");
			for (const [k, v] of Object.entries({ "ftp.host": "h.example.com", ...settings })) ins.run(k, v);
			return await buildFtpConfig(db);
		} finally {
			db.close();
		}
	}

	it("buildFtpConfig defaults to FTPS on port 21", async () => {
		const c = await configWith({});
		assert.equal(c.transport, "ftps");
		assert.equal(c.secure, true);
		assert.equal(c.port, 21);
		assert.equal(c.allowSelfSigned, false);
		const bad = await configWith({ "ftp.transport": "bogus" });
		assert.equal(bad.transport, "ftps");
	});

	it("buildFtpConfig: sftp port 22, explicit port wins, ftp not secure, self-signed", async () => {
		let c = await configWith({ "ftp.transport": "sftp" });
		assert.equal(c.transport, "sftp");
		assert.equal(c.secure, false);
		assert.equal(c.port, 22);
		c = await configWith({ "ftp.transport": "sftp", "ftp.port": "2222" });
		assert.equal(c.port, 2222);
		c = await configWith({ "ftp.transport": "ftp" });
		assert.equal(c.secure, false);
		assert.equal(c.port, 21);
		c = await configWith({ "ftp.allow_self_signed": "true" });
		assert.equal(c.allowSelfSigned, true);
	});

	it("getTransport maps sftp to sftpClient, everything else to ftpClient", () => {
		const syncService = require("../backend/sync/syncService");
		const sftpClient = require("../backend/sync/sftpClient");
		const ftpClient = require("../backend/sync/ftpClient");
		assert.equal(syncService.getTransport({ transport: "sftp" }), sftpClient);
		assert.equal(syncService.getTransport({ transport: "ftps" }), ftpClient);
		assert.equal(syncService.getTransport({ transport: "ftp" }), ftpClient);
		assert.equal(syncService.getTransport({ _proxyInfo: { type: "SOCKS" } }), ftpClient);
	});

	it("fetchRemoteMeta uses sftpClient when transport=sftp", async () => {
		const syncService = require("../backend/sync/syncService");
		const sftpClient = require("../backend/sync/sftpClient");
		const ftpClient = require("../backend/sync/ftpClient");
		const orig = { s: sftpClient.fileExists, f: ftpClient.fileExists };
		const calls = [];
		sftpClient.fileExists = async () => { calls.push("sftp"); return false; };
		ftpClient.fileExists = async () => { calls.push("ftp"); return false; };
		try {
			assert.equal(await syncService.fetchRemoteMeta({ transport: "sftp" }, require("os").tmpdir()), null);
			assert.deepEqual(calls, ["sftp"]);
		} finally {
			sftpClient.fileExists = orig.s;
			ftpClient.fileExists = orig.f;
		}
	});

	it("verifyHostKey: first use is new, same key ok, changed key rejected", () => {
		const { verifyHostKey } = require("../backend/sync/sftpClient");
		const key = Buffer.from("host-key-A");
		const first = verifyHostKey(null, key);
		assert.equal(first.ok, true);
		assert.equal(first.isNew, true);
		assert.equal(first.fingerprint, require("crypto").createHash("sha256").update(key).digest("base64"));
		const same = verifyHostKey(first.fingerprint, key);
		assert.deepEqual({ ok: same.ok, isNew: same.isNew }, { ok: true, isNew: false });
		const other = verifyHostKey(first.fingerprint, Buffer.from("host-key-B"));
		assert.deepEqual({ ok: other.ok, isNew: other.isNew }, { ok: false, isNew: false });
	});
});
