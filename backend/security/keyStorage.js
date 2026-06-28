const { SERVICE_NAME } = require("./securityConfig");

let keytar = null;

try {
	keytar = require("keytar");
} catch (error) {
	keytar = null;
}

async function setSecret(account, secret) {
	if (!keytar) {
		throw new Error("Хранилище ключей (keytar) недоступно. Установите native-модули: npm install");
	}
	await keytar.setPassword(SERVICE_NAME, account, secret);
}

async function getSecret(account) {
	if (!keytar) return null;
	return keytar.getPassword(SERVICE_NAME, account);
}

async function deleteSecret(account) {
	if (!keytar) return false;
	return keytar.deletePassword(SERVICE_NAME, account);
}

function isAvailable() {
	return Boolean(keytar);
}

function getAvailabilityMessage() {
	if (keytar) return null;
	return "Хранилище ключей (keytar) недоступно. Пароли не будут сохраняться. Переустановите приложение или выполните npm install.";
}

module.exports = {
	setSecret,
	getSecret,
	deleteSecret,
	isAvailable,
	getAvailabilityMessage
};
