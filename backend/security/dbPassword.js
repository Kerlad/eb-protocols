const crypto = require("crypto");
const keyStorage = require("./keyStorage");
const { KEYS } = require("./securityConfig");

function deriveKey(password) {
	return crypto.createHash("sha256").update(String(password), "utf8").digest("hex");
}

async function getStoredDbPassword() {
	return keyStorage.getSecret(KEYS.DB_PASSWORD);
}

async function setDbPassword(password) {
	await keyStorage.setSecret(KEYS.DB_PASSWORD, password);
}

async function clearDbPassword() {
	return keyStorage.deleteSecret(KEYS.DB_PASSWORD);
}

async function getRuntimeKey() {
	const password = await getStoredDbPassword();
	if (!password) return null;
	return deriveKey(password);
}

module.exports = {
	deriveKey,
	getStoredDbPassword,
	setDbPassword,
	clearDbPassword,
	getRuntimeKey
};
