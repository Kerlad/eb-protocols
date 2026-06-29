const path = require("path");
const ExcelJS = require("exceljs");
const { openDb } = require("../db/connection");
const { initDb } = require("../db/initDb");
const { parseDataSheet } = require("./dataSheetParser");
const employeesRepository = require("../db/repositories/employeesRepository");
const referencesRepository = require("../db/repositories/referencesRepository");
const syncRepository = require("../db/repositories/syncRepository");

function normalizeDate(value) {
	if (!value) return null;

	if (value instanceof Date) {
		return value.toISOString().slice(0, 10);
	}

	if (typeof value === "number") {
		const excelEpoch = new Date(Date.UTC(1899, 11, 30));
		const date = new Date(excelEpoch.getTime() + value * 86400000);
		return date.toISOString().slice(0, 10);
	}

	const text = String(value).trim();
	if (!text) return null;

	const russianDate = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

	if (russianDate) {
		const [, day, month, year] = russianDate;
		return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
	}

	if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
		return text.slice(0, 10);
	}

	return text;
}

	async function importExcel(filePath) {
	initDb();

	const db = openDb();
	try {
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.readFile(filePath);

		let dataSheet = null;
		workbook.eachSheet((sheet) => {
			if (!dataSheet && sheet.rowCount > 1) {
				dataSheet = sheet;
			}
		});

		if (!dataSheet) {
			throw new Error("В Excel-файле не найден лист с данными");
		}

		const report = {
			employeesCreated: 0,
			employeesUpdated: 0,
			workRights: 0,
			employeeRights: 0,
			errors: []
		};

		const tx = db.transaction(() => {

			const data = parseDataSheet(dataSheet);

			if (data.errors && data.errors.length) {
				report.errors.push(...data.errors);
			}

			const rightsMap = new Map();

			data.rightsColumns.forEach((right, index) => {
				const rightId = referencesRepository.upsertWorkRight(db, {
					name: right.name,
					protocol_text: right.name,
					sort_order: index + 1
				});

				rightsMap.set(right.name, rightId);
				report.workRights += 1;
			});

			const employeeIdBySourceRow = new Map();

			for (const employee of data.employees) {
				let lastCheck = normalizeDate(employee.last_check_date);
				let nextCheck = normalizeDate(employee.next_check_date);
				let dateDeferred = false;

				if (!lastCheck) {
					lastCheck = "2000-01-01";
				}

				if (lastCheck === "2000-01-01") {
					const today = new Date();
					today.setDate(today.getDate() + 14);
					nextCheck = today.toISOString().slice(0, 10);
					dateDeferred = true;
				} else if (!nextCheck) {
					const checkDate = new Date(lastCheck + "T00:00:00");
					const period = (employee.personnel_category || "").includes("Административно") ? 3 : 1;
					checkDate.setFullYear(checkDate.getFullYear() + period);
					nextCheck = checkDate.toISOString().slice(0, 10);
				}

				const today = new Date().toISOString().slice(0, 10);
				if (nextCheck && nextCheck < today) {
					const deferred = new Date();
					deferred.setDate(deferred.getDate() + 14);
					nextCheck = deferred.toISOString().slice(0, 10);
					dateDeferred = true;
				}

				const normalizedEmployee = {
					...employee,
					last_check_date: lastCheck,
					next_check_date: nextCheck,
					note: dateDeferred ? "DATE_DEFERRED" : (employee.note || null)
				};

				const result = employeesRepository.upsertEmployee(db, normalizedEmployee);

				if (result.action === "created") report.employeesCreated += 1;
				if (result.action === "updated") report.employeesUpdated += 1;

				employeeIdBySourceRow.set(employee.source_row, result.id);
			}

			for (const link of data.employeeRights) {
				const employeeId = employeeIdBySourceRow.get(link.source_row);
				const rightId = rightsMap.get(link.right_name);

				if (!employeeId || !rightId) continue;

				referencesRepository.setEmployeeRight(db, employeeId, rightId, 1);
				report.employeeRights += 1;
			}

			const stats = syncRepository.getLocalDbStats(db);

			syncRepository.updateSyncState(db, {
				local_journal_count_total: stats.journal_count_total,
				local_journal_count_current_year: stats.journal_count_current_year,
				local_max_protocol_number_current_year: stats.max_protocol_number_current_year,
				sync_status: "excel_imported"
			});

			syncRepository.incrementRevision(db);
		});

		tx();

		return report;
	} finally {
		db.close();
	}
}

async function exportScheduleToExcel(filePath, year) {
	const db = openDb();
	try {
		const employees = db.prepare(`
			SELECT *
			FROM employees
			WHERE status != 'deleted'
				AND next_check_date LIKE ?
			ORDER BY next_check_date ASC, full_name ASC
		`).all(`${year}-%`);

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet(`График ${year}`);

		sheet.columns = [
			{ header: "ФИО", key: "full_name", width: 35 },
			{ header: "Подразделение", key: "workplace", width: 20 },
			{ header: "Должность", key: "position", width: 25 },
			{ header: "Группа ЭБ", key: "safety_group", width: 12 },
			{ header: "Категория", key: "category", width: 25 },
			{ header: "Объем знаний", key: "scope", width: 15 },
			{ header: "Дата последней проверки", key: "last_check", width: 18 },
			{ header: "Дата следующей проверки", key: "next_check", width: 18 }
		];

		sheet.getRow(1).font = { bold: true };
		sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

		const months = [
			"Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
			"Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
		];

		const employeesByMonth = Array.from({ length: 12 }, () => []);
		for (const emp of employees) {
			if (!emp.next_check_date) continue;
			const parts = emp.next_check_date.split("-");
			const monthIdx = parseInt(parts[1], 10) - 1;
			if (monthIdx >= 0 && monthIdx < 12) {
				employeesByMonth[monthIdx].push(emp);
			}
		}

		for (let m = 0; m < 12; m++) {
			const monthEmployees = employeesByMonth[m];
			if (monthEmployees.length === 0) continue;

			const titleRow = sheet.addRow({ full_name: months[m].toUpperCase() });
			titleRow.font = { bold: true, size: 12, color: { argb: "FF333333" } };
			titleRow.getCell(1).fill = {
				type: 'pattern',
				pattern: 'solid',
				fgColor: { argb: 'FFE0E0E0' }
			};
			sheet.mergeCells(titleRow.number, 1, titleRow.number, 8);

			for (const emp of monthEmployees) {
				sheet.addRow({
					full_name: emp.full_name,
					workplace: emp.workplace_name || emp.workplace_code || "",
					position: emp.position || "",
					safety_group: emp.electrical_safety_group || "",
					category: emp.personnel_category || "",
					scope: emp.knowledge_scope_code || "",
					last_check: emp.last_check_date ? emp.last_check_date.split("-").reverse().join(".") : "",
					next_check: emp.next_check_date ? emp.next_check_date.split("-").reverse().join(".") : ""
				});
			}
		}

		await workbook.xlsx.writeFile(filePath);
		return { ok: true, count: employees.length };
	} finally {
		db.close();
	}
}

async function exportJournalToExcel(filePath) {
	const db = openDb();
	try {
		const rows = db.prepare(`
			SELECT *
			FROM protocol_journal
			ORDER BY check_date DESC, protocol_number DESC
		`).all();

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Журнал проверок");

		sheet.columns = [
			{ header: "№ протокола", key: "protocol_number", width: 15 },
			{ header: "Год", key: "protocol_year", width: 10 },
			{ header: "Дата проверки", key: "check_date", width: 15 },
			{ header: "ФИО работника", key: "full_name_snapshot", width: 35 },
			{ header: "Место работы", key: "workplace_snapshot", width: 20 },
			{ header: "Должность", key: "position_snapshot", width: 25 },
			{ header: "Группа ЭБ", key: "electrical_safety_group", width: 12 },
			{ header: "Категория персонала", key: "personnel_category", width: 25 },
			{ header: "Объем знаний", key: "knowledge_scope_code", width: 15 },
			{ header: "Причина проверки", key: "reason", width: 20 },
			{ header: "Результат (оценка)", key: "final_result", width: 20 },
			{ header: "Дата след. проверки", key: "next_check_date", width: 18 },
			{ header: "Комиссия", key: "commission_name", width: 25 },
			{ header: "Председатель", key: "chairman_name", width: 25 },
			{ header: "Права работ", key: "rights_text", width: 40 }
		];

		sheet.getRow(1).font = { bold: true };
		sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

		for (const r of rows) {
			sheet.addRow({
				protocol_number: r.protocol_number,
				protocol_year: r.protocol_year,
				check_date: r.check_date ? r.check_date.split("-").reverse().join(".") : "",
				full_name_snapshot: r.full_name_snapshot,
				workplace_snapshot: r.workplace_snapshot || "",
				position_snapshot: r.position_snapshot || "",
				electrical_safety_group: r.electrical_safety_group || "",
				personnel_category: r.personnel_category || "",
				knowledge_scope_code: r.knowledge_scope_code || "",
				reason: r.reason || "",
				final_result: r.final_result || "",
				next_check_date: r.next_check_date ? r.next_check_date.split("-").reverse().join(".") : "",
				commission_name: r.commission_name || "",
				chairman_name: r.chairman_name || "",
				rights_text: r.rights_text || ""
			});
		}

		await workbook.xlsx.writeFile(filePath);
		return { ok: true, count: rows.length };
	} finally {
		db.close();
	}
}

async function main() {
	const filePath = process.argv[2];

	if (!filePath) {
		console.error("Укажите путь к Excel-файлу");
		process.exit(1);
	}

	const absolutePath = path.resolve(filePath);
	const report = await importExcel(absolutePath);

	console.log("Импорт завершен:");
	console.log(`- работников добавлено: ${report.employeesCreated}`);
	console.log(`- работников обновлено: ${report.employeesUpdated}`);
	console.log(`- подразделений: ${report.departments}`);
	console.log(`- председателей: ${report.chairmen}`);
	console.log(`- членов комиссии: ${report.members}`);
	console.log(`- объемов знаний: ${report.knowledgeScopes}`);
	console.log(`- прав работ: ${report.workRights}`);
	console.log(`- связей работник-право: ${report.employeeRights}`);
	console.log(`- ошибок: ${report.errors.length}`);
}

if (require.main === module) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}

async function exportEmployeesToExcel(filePath) {
	const db = openDb();
	try {
		const rows = db.prepare(`
			SELECT * FROM employees WHERE status != 'deleted' ORDER BY full_name ASC
		`).all();

		const allRights = db.prepare(`
			SELECT id, name FROM work_rights WHERE status = 'active' ORDER BY sort_order ASC, name ASC
		`).all();

		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Работники");

		const columns = [
			{ header: "Фамилия", key: "last_name", width: 20 },
			{ header: "Имя", key: "first_name", width: 15 },
			{ header: "Отчество", key: "middle_name", width: 20 },
			{ header: "Место работы", key: "workplace_name", width: 25 },
			{ header: "Должность", key: "position", width: 25 },
			{ header: "Объём знаний", key: "knowledge_scope_code", width: 15 },
			{ header: "Категория персонала", key: "personnel_category", width: 25 },
			{ header: "Группа ЭБ", key: "electrical_safety_group", width: 12 },
			{ header: "Дата проверки", key: "last_check_date", width: 15 },
			{ header: "Следующая проверка", key: "next_check_date", width: 15 },
			{ header: "Периодичность (лет)", key: "check_period_years", width: 15 },
			{ header: "Последняя оценка", key: "last_result", width: 15 }
		];

		allRights.forEach(r => {
			columns.push({ header: r.name, key: `right_${r.id}`, width: 15 });
		});

		sheet.columns = columns;
		sheet.getRow(1).font = { bold: true };
		sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

		for (const r of rows) {
			const empRights = db.prepare(`
				SELECT right_id FROM employee_rights WHERE employee_id = ? AND value = 1
			`).all(r.id);
			const rightsSet = new Set(empRights.map(er => er.right_id));

			const rowData = {
				last_name: r.last_name || "",
				first_name: r.first_name || "",
				middle_name: r.middle_name || "",
				workplace_name: r.workplace_name || r.workplace_code || "",
				position: r.position || "",
				knowledge_scope_code: r.knowledge_scope_code || "",
				personnel_category: r.personnel_category || "",
				electrical_safety_group: r.electrical_safety_group || "",
				last_check_date: r.last_check_date ? r.last_check_date.split("-").reverse().join(".") : "",
				next_check_date: r.next_check_date ? r.next_check_date.split("-").reverse().join(".") : "",
				check_period_years: r.check_period_years || 1,
				last_result: r.last_result || ""
			};

			allRights.forEach(right => {
				rowData[`right_${right.id}`] = rightsSet.has(right.id) ? "да" : "";
			});

			sheet.addRow(rowData);
		}

		await workbook.xlsx.writeFile(filePath);
		return { ok: true, count: rows.length };
	} finally {
		db.close();
	}
}

async function createEmployeesTemplate(filePath) {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet("Data");

	sheet.columns = [
		{ header: "Фамилия", key: "last_name", width: 20 },
		{ header: "Имя", key: "first_name", width: 15 },
		{ header: "Отчество", key: "middle_name", width: 20 },
		{ header: "Место работы", key: "workplace", width: 25 },
		{ header: "Должность", key: "position", width: 25 },
		{ header: "Объём знаний", key: "scope", width: 15 },
		{ header: "Категория персонала", key: "category", width: 25 },
		{ header: "Группа", key: "group", width: 12 },
		{ header: "Дата проверки", key: "last_check", width: 15 },
		{ header: "Дата след. проверки", key: "next_check", width: 15 },
		{ header: "Периодичность (лет)", key: "period", width: 15 }
	];

	sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
	sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D75D8' } };
	sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

	const example = sheet.addRow({
		last_name: "Иванов",
		first_name: "Иван",
		middle_name: "Иванович",
		workplace: "Участок электрооборудования",
		position: "Электромонтер",
		scope: "Для эл.мех",
		category: "Оперативно-ремонтный",
		group: "IV",
		last_check: "2026-06-15",
		next_check: "2027-06-15",
		period: 1
	});
	example.font = { italic: true, color: { argb: "FF999999" } };

	await workbook.xlsx.writeFile(filePath);
	return { ok: true };
}

module.exports = {
	importExcel,
	exportScheduleToExcel,
	exportJournalToExcel,
	exportEmployeesToExcel,
	createEmployeesTemplate
};
