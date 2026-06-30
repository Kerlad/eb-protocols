const SftpClient = require('ssh2-sftp-client');
const net = require('net');
const { SocksClient } = require('socks');

function normalizeRemotePath(remotePath) {
	return String(remotePath || "/")
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/");
}

async function createSocksProxy(proxy, targetHost, targetPort) {
	const { socket } = await SocksClient.createConnection({
		proxy: { host: proxy.host, port: proxy.port, type: proxy.version === "4" ? 4 : 5 },
		command: "connect",
		destination: { host: targetHost, port: targetPort }
	});
	return socket;
}

async function createHttpTunnel(proxy, targetHost, targetPort) {
	return new Promise((resolve, reject) => {
		const socket = net.connect(proxy.port, proxy.host, () => {
			socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n\r\n`);
			let data = "";
			socket.on("data", (chunk) => {
				data += chunk.toString();
				if (data.includes("\r\n\r\n")) {
					const statusLine = data.split("\r\n")[0];
					const match = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
					if (match && match[1] === "200") {
						resolve(socket);
					} else {
						socket.destroy();
						reject(new Error(`HTTP CONNECT failed: ${statusLine}`));
					}
				}
			});
			socket.setTimeout(10000, () => {
				socket.destroy();
				reject(new Error("HTTP CONNECT timeout"));
			});
		});
		socket.on("error", reject);
	});
}

async function withSftpClient(config, handler) {
	const sftp = new SftpClient();
	try {
		const connConfig = {
			host: config.host,
			port: config.port || 22,
			username: config.user,
			password: config.password,
			readyTimeout: config.timeout || 10000,
			strictVendor: false
		};

		if (config._proxyInfo) {
			const proxy = config._proxyInfo;
			if (proxy.type === "SOCKS") {
				const socket = await createSocksProxy(proxy, config.host, config.port || 22);
				connConfig.socket = socket;
			} else if (proxy.type === "HTTP") {
				const socket = await createHttpTunnel(proxy, config.host, config.port || 22);
				connConfig.socket = socket;
			}
		}

		await sftp.connect(connConfig);
		return await handler(sftp);
	} finally {
		try { await sftp.end(); } catch (e) {}
	}
}

async function testConnection(config) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const exists = await sftp.exists(remoteDir);
		if (!exists) {
			await sftp.mkdir(remoteDir, true);
		}
		const list = await sftp.list(remoteDir);
		return {
			ok: true,
			remoteDir,
			entries: list.length,
			transport: "SFTP",
			proxy: config._proxyInfo ? `${config._proxyInfo.type} ${config._proxyInfo.host}:${config._proxyInfo.port}` : "DIRECT"
		};
	});
}

async function uploadFile(config, localPath, remoteName) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const exists = await sftp.exists(remoteDir);
		if (!exists) await sftp.mkdir(remoteDir, true);
		const remotePath = normalizeRemotePath(remoteDir + "/" + remoteName);
		await sftp.put(localPath, remotePath);
		return { ok: true, remoteName };
	});
}

async function downloadFile(config, remoteName, localPath) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const remotePath = normalizeRemotePath(remoteDir + "/" + remoteName);
		await sftp.get(remotePath, localPath);
		return { ok: true, localPath };
	});
}

async function fileExists(config, remoteName) {
	return withSftpClient(config, async (sftp) => {
		const remoteDir = normalizeRemotePath(config.remoteDir || "/");
		const remotePath = normalizeRemotePath(remoteDir + "/" + remoteName);
		const exists = await sftp.exists(remotePath);
		return exists;
	});
}

module.exports = {
	normalizeRemotePath,
	testConnection,
	uploadFile,
	downloadFile,
	fileExists
};
