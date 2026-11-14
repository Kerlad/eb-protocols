const path = require("path");
const fs = require("fs");

function realOrSame(p) {
	try {
		return fs.realpathSync.native(p);
	} catch (error) {
		return p;
	}
}

function isInsideDir(baseDir, targetPath) {
	const rel = path.relative(baseDir, targetPath);
	return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// Путь для хранения в базе: относительно папки протоколов, со слэшами «/»
function toRelativeProtocolPath(protocolsDir, fullPath) {
	return path.relative(protocolsDir, fullPath).split(path.sep).join("/");
}

function findByBasename(baseDir, name) {
	const direct = path.join(baseDir, name);
	if (fs.existsSync(direct)) return direct;
	let entries = [];
	try {
		entries = fs.readdirSync(baseDir, { withFileTypes: true });
	} catch (error) {
		return null;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const candidate = path.join(baseDir, entry.name, name);
		if (fs.existsSync(candidate)) return candidate;
	}
	return null;
}

// Находит файл протокола по значению из журнала (относительный или старый абсолютный путь).
// Возвращает реальный абсолютный путь или null, если файла нет на этом компьютере.
// Бросает ошибку для недопустимого расширения и пути вне папки протоколов.
function resolveProtocolFile(protocolsDir, storedPath) {
	if (!storedPath) return null;
	const baseDir = path.resolve(protocolsDir);
	const stored = String(storedPath);
	const ext = path.extname(stored).toLowerCase();
	if (ext !== ".docx" && ext !== ".pdf") {
		throw new Error("Недопустимый тип файла протокола");
	}
	let full = path.isAbsolute(stored) ? path.resolve(stored) : path.resolve(baseDir, stored);
	if (!fs.existsSync(full)) {
		full = findByBasename(baseDir, path.basename(stored.replace(/\\/g, "/")));
		if (!full) return null;
	}
	const realFull = realOrSame(full);
	if (!isInsideDir(realOrSame(baseDir), realFull)) {
		throw new Error("Файл находится вне папки протоколов, открытие запрещено");
	}
	return realFull;
}

function protocolFileExists(protocolsDir, storedPath) {
	try {
		return Boolean(resolveProtocolFile(protocolsDir, storedPath));
	} catch (error) {
		return false;
	}
}

module.exports = { resolveProtocolFile, protocolFileExists, toRelativeProtocolPath };
