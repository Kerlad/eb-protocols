const { detectRightsColumns, isRightEnabled } = require("./rightsDetector");

function cellText(row, index) {
	const value = row.getCell(index).value;

	if (value && typeof value === "object" && value.formula !== undefined) {
		return String(value.result != null ? value.result : "").trim();
	}

	if (value && typeof value === "object" && value.text) {
		return String(value.text).trim();
	}

	if (value instanceof Date) {
		return value.toISOString().slice(0, 10);
	}

	return String(value || "").trim();
}

const GROUP_MAP = { "2": "II", "3": "III", "4": "IV", "5": "V" };

function normalizeGroup(value) {
	if (!value) return value;
	const trimmed = value.trim();
	if (GROUP_MAP[trimmed]) return GROUP_MAP[trimmed];
	if (/^[IVX]+$/.test(trimmed)) return trimmed;
	return trimmed;
}

const CATEGORY_MAP = {
	"административно-техничесуий": "Административно-технический",
	"административно-техническ": "Административно-технический",
	"оперативно-ремонт": "Оперативно-ремонтный",
	"оперативный": "Оперативный",
	"ремонтный": "Ремонтный",
	"диспетчерский": "Диспетчерский"
};

function normalizeCategory(value) {
	if (!value) return value;
	const lower = value.trim().toLowerCase();
	for (const [key, norm] of Object.entries(CATEGORY_MAP)) {
		if (lower.includes(key)) return norm;
	}
	return value.trim();
}

function parseDataSheet(worksheet) {
	const headerRow = worksheet.getRow(1);
	const headers = [];

	headerRow.eachCell((cell, colNumber) => {
		headers[colNumber] = String(cell.value || "").trim();
	});

	const rightsColumns = detectRightsColumns(headers);
	const employees = [];
	const employeeRights = [];
	const errors = [];

	worksheet.eachRow((row, rowNumber) => {
		if (rowNumber === 1) return;

		let colOffset = 0;
		let lastName = cellText(row, 1);
		const firstName = cellText(row, 2);
		const middleName = cellText(row, 3);

		if (!lastName && firstName) {
			colOffset = -1;
			lastName = cellText(row, 2);
			const shiftedFirst = cellText(row, 3);
			const shiftedMiddle = cellText(row, 4);
			errors.push(`Строка ${rowNumber}: Фамилия отсутствует, данные сдвинуты (фамилия взята из столбца Имя)`);
			const employee = {
				last_name: lastName,
				first_name: shiftedFirst,
				middle_name: shiftedMiddle,
				full_name: [lastName, shiftedFirst, shiftedMiddle].filter(Boolean).join(" "),
				workplace_name: cellText(row, 5),
				workplace_code: cellText(row, 5),
				position: cellText(row, 6),
				knowledge_scope_code: cellText(row, 7),
				personnel_category: normalizeCategory(cellText(row, 8)),
				electrical_safety_group: normalizeGroup(cellText(row, 9)),
				last_check_date: cellText(row, 10),
				next_check_date: cellText(row, 11),
				check_period_years: Number(cellText(row, 12) || 1),
				source_row: rowNumber
			};
			employees.push(employee);
			for (const column of rightsColumns) {
				const value = row.getCell(column.index + colOffset).value;
				if (isRightEnabled(value)) {
					employeeRights.push({
						source_row: rowNumber,
						employee_full_name: employee.full_name,
						right_name: column.name
					});
				}
			}
			return;
		}

		if (!lastName && !firstName) return;

		if (!lastName) {
			lastName = "Неизвестный";
			errors.push(`Строка ${rowNumber}: нет фамилии, использован placeholder "Неизвестный"`);
		}
		if (!firstName) {
			errors.push(`Строка ${rowNumber}: нет имени, пропущена`);
			return;
		}

		const group = normalizeGroup(cellText(row, 8));
		const category = normalizeCategory(cellText(row, 7));

		const employee = {
			last_name: lastName,
			first_name: firstName,
			middle_name: middleName,
			full_name: [lastName, firstName, middleName].filter(Boolean).join(" "),
			workplace_name: cellText(row, 4),
			workplace_code: cellText(row, 4),
			position: cellText(row, 5),
			knowledge_scope_code: cellText(row, 6),
			personnel_category: category,
			electrical_safety_group: group,
			last_check_date: cellText(row, 9),
			next_check_date: cellText(row, 10),
			check_period_years: Number(cellText(row, 11) || 1),
			source_row: rowNumber
		};

		employees.push(employee);

		for (const column of rightsColumns) {
			const value = row.getCell(column.index).value;

			if (isRightEnabled(value)) {
				employeeRights.push({
					source_row: rowNumber,
					employee_full_name: employee.full_name,
					right_name: column.name
				});
			}
		}
	});

	return {
		employees,
		rightsColumns,
		employeeRights,
		errors
	};
}

module.exports = {
	parseDataSheet,
	normalizeGroup,
	normalizeCategory
};
