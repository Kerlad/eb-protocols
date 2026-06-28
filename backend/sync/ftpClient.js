const ftp = require("basic-ftp");

function normalizeRemotePath(remotePath) {
	return String(remotePath || "/")
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/");
}

async function withClient(config, handler) {
	const client = new ftp.Client(config.timeout || 30000);
	client.ftp.verbose = Boolean(config.verbose);

	try {
		await client.access({
			host: config.host,
			port: config.port || 21,
			user: config.user,
			password: config.password,
			secure: config.secure || false,
			secureOptions: config.secure ? { rejectUnauthorized: config.allowSelfSigned ? false : true } : undefined
		});

		return await handler(client);
	} catch (error) {
		const msg = error.message || String(error);
		if (msg.includes("EPSV") && !config._pasvRetried) {
			client.ftp.verbose = true;
			await client.access({
				host: config.host,
				port: config.port || 21,
				user: config.user,
				password: config.password,
				secure: config.secure || false,
				secureOptions: config.secure ? { rejectUnauthorized: config.allowSelfSigned ? false : true } : undefined
			});
			const retryConfig = { ...config, _pasvRetried: true };
			return await handler(client);
		}
		throw error;
	} finally {
		client.close();
	}
}

async function testConnection(config) {
	return withClient(config, async (client) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		await client.ensureDir(remoteDir);
		const list = await client.list();
		return {
			ok: true,
			remoteDir,
			entries: list.length
		};
	});
}

async function uploadFile(config, localPath, remoteName) {
	return withClient(config, async (client) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		await client.ensureDir(remoteDir);
		await client.uploadFrom(localPath, remoteName);
		return { ok: true, remoteName };
	});
}

async function downloadFile(config, remoteName, localPath) {
	return withClient(config, async (client) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		await client.ensureDir(remoteDir);
		await client.downloadTo(localPath, remoteName);
		return { ok: true, localPath };
	});
}

async function fileExists(config, remoteName) {
	return withClient(config, async (client) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		await client.ensureDir(remoteDir);
		const list = await client.list();
		return list.some((entry) => entry.name === remoteName);
	});
}

module.exports = {
	normalizeRemotePath,
	testConnection,
	uploadFile,
	downloadFile,
	fileExists
};
