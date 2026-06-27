const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { openDb } = require("../db/connection");
const { getSetting } = require("../db/repositories/settingsRepository");

function findSofficePath() {
	// 1. Try to read from database settings
	let customPath = null;
	const db = openDb();
	try {
		customPath = getSetting(db, "libreoffice_path");
	} catch (e) {
		console.warn("Could not read libreoffice_path from db:", e.message);
	} finally {
		db.close();
	}

	if (customPath && fs.existsSync(customPath)) {
		return customPath;
	}

	// 2. Check standard Windows paths
	const defaults = [
		"C:\\Program Files\\LibreOffice\\program\\soffice.exe",
		"C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
	];

	for (const p of defaults) {
		if (fs.existsSync(p)) {
			return p;
		}
	}

	return null;
}

function generatePdf(docxPath) {
	return new Promise((resolve, reject) => {
		if (!fs.existsSync(docxPath)) {
			return reject(new Error(`DOCX file not found: ${docxPath}`));
		}

		const sofficePath = findSofficePath();
		if (!sofficePath) {
			return reject(new Error("LibreOffice (soffice.exe) не найден. Пожалуйста, укажите путь к нему в настройках."));
		}

		const outDir = path.dirname(docxPath);
		const args = [
			"--headless",
			"--convert-to", "pdf",
			"--outdir", outDir,
			docxPath
		];

		execFile(sofficePath, args, (error, stdout, stderr) => {
			if (error) {
				return reject(new Error(`LibreOffice conversion failed: ${error.message}. Stderr: ${stderr}`));
			}

			const pdfPath = docxPath.replace(/\.docx$/, ".pdf");
			if (fs.existsSync(pdfPath)) {
				resolve(pdfPath);
			} else {
				reject(new Error("PDF file was not created by LibreOffice"));
			}
		});
	});
}

module.exports = {
	generatePdf,
	findSofficePath
};
