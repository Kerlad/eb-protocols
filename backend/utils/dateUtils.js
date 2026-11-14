function formatDateLocal(date) {
	const d = date instanceof Date ? date : new Date(date);
	const year = d.getFullYear();
	const month = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function todayLocal() {
	return formatDateLocal(new Date());
}

function isIsoDate(s) {
	if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const y = Number(s.slice(0, 4));
	const m = Number(s.slice(5, 7));
	const d = Number(s.slice(8, 10));
	const date = new Date(y, m - 1, d);
	return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function addDaysLocal(dateStr, n) {
	const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
	return formatDateLocal(new Date(y, m - 1, d + n));
}

function addYearsLocal(dateStr, years) {
	const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
	const date = new Date(y + years, m - 1, d);
	// 29.02 в невисокосном году переходит в 01.03 — возвращаем 28.02
	if (date.getMonth() !== m - 1) date.setDate(0);
	return formatDateLocal(date);
}

module.exports = {
	formatDateLocal,
	todayLocal,
	addDaysLocal,
	addYearsLocal,
	isIsoDate
};
