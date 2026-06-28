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

function parseDataSheet(worksheet) {
	const headerRow = worksheet.getRow(1);
	const headers = [];

	headerRow.eachCell((cell, colNumber) => {
		headers[colNumber] = String(cell.value || "").trim();
	});

	const rightsColumns = detectRightsColumns(headers);
	const employees = [];
	const employeeRights = [];

	worksheet.eachRow((row, rowNumber) => {
		if (rowNumber === 1) return;

		const lastName = cellText(row, 1);
		const firstName = cellText(row, 2);
		const middleName = cellText(row, 3);

		if (!lastName || !firstName) return;

		const employee = {
			last_name: lastName,
			first_name: firstName,
			middle_name: middleName,
			full_name: [lastName, firstName, middleName].filter(Boolean).join(" "),
			workplace_name: cellText(row, 4),
			workplace_code: cellText(row, 4),
			position: cellText(row, 5),
			knowledge_scope_code: cellText(row, 6),
			personnel_category: cellText(row, 7),
			electrical_safety_group: cellText(row, 8),
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
		employeeRights
	};
}

module.exports = {
	parseDataSheet
};
