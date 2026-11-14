// Периодичность очередной проверки знаний и срок повторной проверки после «Неуд».
// Решения владельца — docs/ROADMAP.md, раздел 9, строки 4 и 5.
// Основание: приказ Минэнерго России от 22.09.2020 № 796, пп. 45, 63; ПТЭЭП (приказ № 811), п. 43.
// Копия правил для интерфейса — app/renderer/app.js (window.ebCheckPeriod); менять вместе.
const { addYearsLocal, addDaysLocal } = require("./dateUtils");

const FAILED_RECHECK_DAYS = 29;

// Право работ, дающее срок 12 месяцев административно-техническому персоналу:
// права оперативного, оперативно-ремонтного или ремонтного персонала (по названию права)
function isAnnualRight(name) {
	const text = String(name || "").toLowerCase();
	return text.includes("оператив") || text.includes("ремонт");
}

function defaultPeriodYears(category, rightNames = []) {
	const cat = String(category || "").toLowerCase().trim();
	if (cat.startsWith("административно")) {
		return (rightNames || []).some(isAnnualRight) ? 1 : 3;
	}
	if (cat.startsWith("инспектирующ")) return 3;
	// диспетчерский, оперативный, оперативно-ремонтный, ремонтный, не указано — 12 месяцев
	return 1;
}

function nextCheckDate(lastCheck, periodYears) {
	if (!lastCheck) return null;
	return addYearsLocal(lastCheck, Number(periodYears) || 1);
}

// «Неуд»: дата проверки + 29 календарных дней; суббота и воскресенье сдвигаются на пятницу
function failedRecheckDate(checkDate) {
	if (!checkDate) return null;
	let date = addDaysLocal(checkDate, FAILED_RECHECK_DAYS);
	const [y, m, d] = date.split("-").map(Number);
	const weekday = new Date(y, m - 1, d).getDay();
	if (weekday === 6) date = addDaysLocal(date, -1);
	if (weekday === 0) date = addDaysLocal(date, -2);
	return date;
}

function isFailedResult(result) {
	return /^неуд/i.test(String(result || "").trim());
}

module.exports = {
	FAILED_RECHECK_DAYS,
	isAnnualRight,
	defaultPeriodYears,
	nextCheckDate,
	failedRecheckDate,
	isFailedResult
};
