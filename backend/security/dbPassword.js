const crypto = require("crypto");
const keyStorage = require("./keyStorage");
const { KEYS } = require("./securityConfig");

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

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

async function getStoredDbPassword() {
	return keyStorage.getSecret(KEYS.DB_PASSWORD);
}

async function getStoredSalt() {
	return keyStorage.getSecret(KEYS.DB_SALT);
}

async function setDbPassword(password) {
	await keyStorage.setSecret(KEYS.DB_PASSWORD, password);
	const salt = generateSalt();
	await keyStorage.setSecret(KEYS.DB_SALT, salt);
}

async function clearDbPassword() {
	await keyStorage.deleteSecret(KEYS.DB_PASSWORD);
	await keyStorage.deleteSecret(KEYS.DB_SALT);
}

async function getRuntimeKey() {
	const password = await getStoredDbPassword();
	if (!password) return null;
	const salt = await getStoredSalt();
	return deriveKey(password, salt);
}

module.exports = {
	deriveKey,
	generateSalt,
	getStoredDbPassword,
	getStoredSalt,
	setDbPassword,
	clearDbPassword,
	getRuntimeKey
};
