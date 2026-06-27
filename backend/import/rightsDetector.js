const BASE_EMPLOYEE_COLUMNS = [
	"Фамилия",
	"Имя",
	"Отчество",
	"ФИО",
	"Место работы",
	"Должность",
	"Объем знаний",
	"Объём знаний",
	"Категория персонала",
	"Группа",
	"Группа ЭБ",
	"Дата проверки",
	"Дата проверки знаний",
	"Дата следующей проверки",
	"Дата след. проверки",
	"Дата след проверки",
	"Дата следующей проверки знаний",
	"Дата след проверки знаний",
	"Периодичность",
	"Периодичность (лет)",
	"Периодичность проверки знаний, лет",
	"Последняя оценка",
	"Последний результат",
	"Статус",
	"Примечание",
	"Прим."
];

function normalizeHeader(value) {
	return String(value || "").trim();
}

function detectRightsColumns(headers) {
	const baseLower = BASE_EMPLOYEE_COLUMNS.map(c => c.toLowerCase());
	return headers
		.map((header, index) => ({ index, name: normalizeHeader(header) }))
		.filter((column) => {
			if (!column.name) return false;
			const lower = column.name.toLowerCase();
			if (baseLower.includes(lower)) return false;
			if (lower.startsWith("пусто")) return false;
			if (lower.startsWith("дата ")) return false;
			if (lower.startsWith("периодичность")) return false;
			if (lower.startsWith("последн")) return false;
			return true;
		});
}

function isRightEnabled(value) {
	if (value === 1 || value === true) return true;
	const normalized = String(value || "").trim().toLowerCase();
	return ["1", "да", "true", "истина", "x", "+", "есть"].includes(normalized);
}

module.exports = {
	detectRightsColumns,
	isRightEnabled
};
