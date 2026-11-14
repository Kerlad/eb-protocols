const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const keyStorage = require("./keyStorage");
const { KEYS } = require("./securityConfig");
const { getUserDataDir, ensureDataDir } = require("../paths");

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";
const MIN_PASSWORD_LENGTH = 8;
const SALT_FILE_NAME = "eb_protocols.salt";

function deriveKey(password, salt) {
	if (salt) {
		return crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString("hex");
	}
	// Legacy fallback: голый SHA-256 без соли — только для чтения старых БД
	return crypto.createHash("sha256").update(String(password), "utf8").digest("hex");
}

function generateSalt() {
	return crypto.randomBytes(16).toString("hex");
}

function getSaltFilePath() {
	return path.join(getUserDataDir(), SALT_FILE_NAME);
}

function readSaltFile() {
	try {
		const value = fs.readFileSync(getSaltFilePath(), "utf8").trim();
		return value || null;
	} catch (error) {
		return null;
	}
}

function writeSaltFile(salt) {
	ensureDataDir();
	fs.writeFileSync(getSaltFilePath(), String(salt), "utf8");
}

function deleteSaltFile() {
	try {
		fs.unlinkSync(getSaltFilePath());
	} catch (error) {
		// файла нет
	}
}

async function getStoredDbPassword() {
	return keyStorage.getSecret(KEYS.DB_PASSWORD);
}

// Соль: файл рядом с базой; запасной вариант — старая соль из keytar
async function getStoredSalt() {
	return readSaltFile() || (await keyStorage.getSecret(KEYS.DB_SALT)) || null;
}

function validatePassword(password) {
	if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
		throw new Error(`Пароль базы должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`);
	}
}

// Сохраняет пароль в хранилище и соль в файл. Вызывать только после успешного rekey.
async function setDbPassword(password, salt) {
	if (!salt) throw new Error("Не указана соль для пароля базы");
	await keyStorage.setSecret(KEYS.DB_PASSWORD, password);
	writeSaltFile(salt);
}

async function clearDbPassword() {
	await keyStorage.deleteSecret(KEYS.DB_PASSWORD);
	await keyStorage.deleteSecret(KEYS.DB_SALT);
	deleteSaltFile();
}

async function getRuntimeKey() {
	const password = await getStoredDbPassword();
	if (!password) return null;
	const salt = await getStoredSalt();
	return deriveKey(password, salt);
}

// deps: { backup(reason), rekey(newKey), getCurrentKey(), setRuntimeKey(key) }
async function enableDbPassword(password, deps) {
	validatePassword(password);
	if (!keyStorage.isAvailable()) {
		throw new Error(keyStorage.getAvailabilityMessage());
	}
	deps.backup("before_encrypt");

	const previousKey = deps.getCurrentKey();
	const salt = generateSalt();
	const key = deriveKey(password, salt);

	deps.rekey(key);
	try {
		await setDbPassword(password, salt);
	} catch (error) {
		// не удалось сохранить пароль — возвращаем прежний ключ, чтобы не потерять доступ к базе
		deps.setRuntimeKey(key);
		try { deps.rekey(previousKey); } finally { deps.setRuntimeKey(previousKey); }
		throw error;
	}
	deps.setRuntimeKey(key);
}

async function disableDbPassword(deps) {
	deps.backup("before_decrypt");
	deps.rekey(null);
	deps.setRuntimeKey(null);
	await clearDbPassword();
}

module.exports = {
	MIN_PASSWORD_LENGTH,
	SALT_FILE_NAME,
	deriveKey,
	generateSalt,
	getSaltFilePath,
	getStoredDbPassword,
	getStoredSalt,
	setDbPassword,
	clearDbPassword,
	getRuntimeKey,
	enableDbPassword,
	disableDbPassword
};
