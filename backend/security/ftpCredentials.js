const keyStorage = require("./keyStorage");
const { KEYS, SETTINGS_KEYS } = require("./securityConfig");
const settingsRepository = require("../db/repositories/settingsRepository");

async function setFtpPassword(password) {
	await keyStorage.setSecret(KEYS.FTP_PASSWORD, password);
}

async function getFtpPassword() {
	return keyStorage.getSecret(KEYS.FTP_PASSWORD);
}

async function clearFtpPassword() {
	return keyStorage.deleteSecret(KEYS.FTP_PASSWORD);
}

async function buildFtpConfig(db) {
	const settings = settingsRepository.getAllSettings(db);
	const password = await getFtpPassword();

	return {
		host: settings[SETTINGS_KEYS.FTP_HOST] || "",
		port: Number(settings[SETTINGS_KEYS.FTP_PORT] || 21),
		user: settings[SETTINGS_KEYS.FTP_USER] || "",
		password: password || "",
		remoteDir: settings[SETTINGS_KEYS.FTP_REMOTE_DIR] || "/",
		secure: settings[SETTINGS_KEYS.FTP_SECURE] === "true"
	};
}

module.exports = {
	setFtpPassword,
	getFtpPassword,
	clearFtpPassword,
	buildFtpConfig
};
