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

	const host = String(settings[SETTINGS_KEYS.FTP_HOST] || "").trim();
	if (!host) {
		throw new Error("Не указан адрес FTP-сервера. Заполните настройки синхронизации.");
	}

	const rawTransport = String(settings[SETTINGS_KEYS.FTP_TRANSPORT] || "").toLowerCase();
	const transport = ["ftps", "sftp", "ftp"].includes(rawTransport) ? rawTransport : "ftps";
	const port = Number(settings[SETTINGS_KEYS.FTP_PORT]) || (transport === "sftp" ? 22 : 21);

	// отпечаток хранится как "host:port|fingerprint"; при смене сервера считается неизвестным
	const storedFp = String(settings[SETTINGS_KEYS.SFTP_HOST_FINGERPRINT] || "");
	const hostTag = `${host}:${port}`;
	const hostFingerprint = storedFp.startsWith(hostTag + "|") ? storedFp.slice(hostTag.length + 1) : null;

	return {
		host,
		port,
		transport,
		user: settings[SETTINGS_KEYS.FTP_USER] || "",
		password: password || "",
		remoteDir: settings[SETTINGS_KEYS.FTP_REMOTE_DIR] || "/",
		secure: transport === "ftps",
		allowSelfSigned: settings[SETTINGS_KEYS.FTP_ALLOW_SELF_SIGNED] === "true",
		hostFingerprint,
		onNewHostFingerprint: (fingerprint) => {
			const { openDb } = require("../db/connection");
			const hostDb = openDb();
			try {
				settingsRepository.setSetting(hostDb, SETTINGS_KEYS.SFTP_HOST_FINGERPRINT, `${hostTag}|${fingerprint}`);
			} finally {
				hostDb.close();
			}
		}
	};
}

module.exports = {
	setFtpPassword,
	getFtpPassword,
	clearFtpPassword,
	buildFtpConfig
};
