const { describe, it } = require("node:test");
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
