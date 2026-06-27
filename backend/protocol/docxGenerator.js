const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { buildProtocolPlaceholderMap } = require("./placeholderMap");

const REQUIRED_PLACEHOLDERS = [
	"Номер", "Дата", "Причина", "След_Дата",
	"Комиссия", "Должность_ПК", "ПК",
	"Должность_ЧК_1", "ЧК_1",
	"ФИО", "Место_Работы", "Должность",
	"оценка_ЭБ", "оценка", "Группа_ЭБ"
];

function defaultTemplatePath() {
	if (process.resourcesPath) {
		const packaged = path.join(process.resourcesPath, "templates", "Протокол.docx");
		if (fs.existsSync(packaged)) return packaged;
	}

	return path.join(process.cwd(), "templates", "Протокол.docx");
}

function safeFilePart(value) {
	return String(value || "")
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/\s+/g, "_")
		.trim();
}

function validatePlaceholderMap(map) {
	const missing = REQUIRED_PLACEHOLDERS.filter((key) => {
		const value = map[key];
		return value === undefined || value === null || String(value).trim() === "";
	});

	return missing;
}

function renderProtocolDocx(options) {
	const templatePath = options.templatePath || defaultTemplatePath();

	if (!fs.existsSync(templatePath)) {
		throw new Error(`Шаблон протокола не найден: ${templatePath}`);
	}

	const content = fs.readFileSync(templatePath, "binary");
	const zip = new PizZip(content);

	const doc = new Docxtemplater(zip, {
		paragraphLoop: true,
		linebreaks: true,
		delimiters: { start: "{", end: "}" }
	});

	const map = options.placeholderMap || buildProtocolPlaceholderMap(options.form || {});

	if (options.validate !== false) {
		const missing = validatePlaceholderMap(map);
		if (missing.length && options.strict) {
			throw new Error(`Не заполнены обязательные поля: ${missing.join(", ")}`);
		}
	}

	doc.render(map);

	const buffer = doc.getZip().generate({
		type: "nodebuffer",
		compression: "DEFLATE"
	});

	if (options.outputPath) {
		fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
		fs.writeFileSync(options.outputPath, buffer);
	}

	return { buffer, placeholderMap: map };
}

function buildOutputFileName(form) {
	const number = safeFilePart(form.protocol_number || "б_н");
	const name = safeFilePart(form.full_name_snapshot || "протокол");
	return `Протокол_${number}_${name}.docx`;
}

function createTestProtocol(outputDir) {
	const form = {
		protocol_number: 1,
		check_date: new Date().toISOString().slice(0, 10),
		reason: "Очередная проверка",
		next_check_date: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
		commission_name: "Комиссия по проверке знаний",
		chairman_position: "Председатель",
		chairman_name: "Иванов И.И.",
		member_1_position: "Член комиссии",
		member_1_name: "Петров П.П.",
		instructions_text: "ПТЭЭП, ПОТ ЭЭ",
		full_name_snapshot: "Сидоров Сергей Сергеевич",
		workplace_snapshot: "Участок электрооборудования",
		position_snapshot: "Электромонтер",
		result_eb: "сдал",
		final_result: "сдал",
		electrical_safety_group: "IV",
		personnel_category: "Оперативно-ремонтный",
		rights_text: "Право выдачи нарядов",
		voltage_category: "до и выше 1000 В"
	};

	const outputPath = path.join(outputDir || path.join(process.cwd(), "data", "protocols"), buildOutputFileName(form));

	return renderProtocolDocx({ form, outputPath });
}

if (require.main === module) {
	try {
		const result = createTestProtocol();
		console.log("Тестовый протокол сформирован");
		console.log("Плейсхолдеры:", Object.keys(result.placeholderMap).length);
	} catch (error) {
		console.error("Ошибка генерации:", error.message);
		process.exit(1);
	}
}

module.exports = {
	renderProtocolDocx,
	buildOutputFileName,
	buildProtocolPlaceholderMap,
	validatePlaceholderMap,
	createTestProtocol,
	safeFilePart,
	REQUIRED_PLACEHOLDERS
};
