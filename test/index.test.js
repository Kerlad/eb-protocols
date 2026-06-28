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
	const { parseDataSheet } = require("../backend/import/dataSheetParser");

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
			eachRow: (cb) => {
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
});
