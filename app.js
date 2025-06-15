require('dotenv').config();

const os = require('os');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const morgan = require('morgan');
const express = require('express');
const { chromium } = require('playwright');

let browser;
const app = express();
const PORT = process.env.PORT || 3000;

app.use(morgan('dev'));

async function getBrowser() {
	if (!browser) {
		browser = await chromium.launch({
			headless: true,
			args: ['--no-sandbox']
		});
	}
	return browser;
}

async function openPage(url) {
	const browser = await getBrowser();
	const context = await browser.newContext();
	const page = await context.newPage();
	return { page, context };
}

async function getBrowserHeaders(url) {
	let capturedHeaders = null;
	const { page, context } = await openPage(url);
	await page.route('**/*', (route) => {
		if (!capturedHeaders) {
			capturedHeaders = route.request().headers();
		}
		route.continue();
	});
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
	} catch (e) {}
	await context.close();
	return capturedHeaders;
}

getBrowser();

app.get('/proxy', async (req, res) => {
	const { url } = req.query;
	if (!url) return res.status(400).send('Missing ?url=');
	try {
		const head = await axios.head(url);
		const contentType = head.headers['content-type'] || '';
		
		if (!contentType.includes('text/html')) {
			const browserHeaders = await getBrowserHeaders(url);
			const axiosHeaders = {
				...browserHeaders,
				host: undefined,
				'content-length': undefined,
				'transfer-encoding': undefined,
			};
			const response = await axios.get(url, {
				headers: axiosHeaders,
				responseType: 'stream',
			});
			res.set({
				'Content-Type': response.headers['content-type'] || 'application/octet-stream',
				'Content-Length': response.headers['content-length'] || undefined,
			});
			response.data.pipe(res);
		} else {
			const { page, context } = await openPage(url);
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
			const html = await page.content();
			const $ = cheerio.load(html);
			const base = new URL(url).origin;
			$('*[src], *[href], form[action]').each((_, el) => {
				const attr = el.name === 'form' ? 'action' : el.attribs.src ? 'src' : 'href';
				const val = $(el).attr(attr);
				if (!val) return;
				let newUrl;
				if (val.startsWith('http')) newUrl = val;
				else if (val.startsWith('//')) newUrl = 'https:' + val;
				else if (val.startsWith('/')) newUrl = base + val;
				else newUrl = base + '/' + val;
				
				$(el).attr(attr, `/proxy?url=${encodeURIComponent(newUrl)}`);
			});
			res.setHeader('Content-Type', 'text/html');
			res.send($.html());
			await context.close();
		}
	} catch (e) {
		res.status(500).send(e.message);
	}
});

app.get('/screenshot', async (req, res) => {
	const { url, fullpage = true } = req.query;
	if (!url) return res.status(400).send('Missing ?url=');
	try {
		const { page, context } = await openPage(url);
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
		const buffer = await page.screenshot({ fullPage: fullpage === 'true' });
		res.setHeader('Content-Type', 'image/png');
		res.send(buffer);
		await context.close();
	} catch (e) {
		res.status(500).send(e.message);
	}
});

app.get('/headers', async (req, res) => {
	const { url } = req.query;
	if (!url) return res.status(400).send('Missing ?url=');
	try {
		let data = {};
		const browser = await getBrowser();
		const context = await browser.newContext();
		const page = await context.newPage();
		page.on('response', async (res) => {
			if (res.url() === url) {
				data = res.headers();
			}
		});
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
		res.json(data);
		await context.close();
	} catch (e) {
		res.status(500).send(e.message);
	}
});

app.get('/pdf', async (req, res) => {
	const { url } = req.query;
	if (!url) return res.status(400).send('Missing ?url=');
	try {
		const { page, context } = await openPage(url);
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
		const pdf = await page.pdf({ format: 'A4' });
		res.setHeader('Content-Type', 'application/pdf');
		res.send(pdf);
		await context.close();
	} catch (e) {
		res.status(500).send(e.message);
	}
});

app.use('*', async (req, res) => {
	const uptimeSec = os.uptime();
	const totalMemMB = os.totalmem() / 1024 / 1024;
	const freeMemMB = os.freemem() / 1024 / 1024;
	const cpus = os.cpus();
	
	res.status(200).json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		uptime: {
			human: new Date(uptimeSec * 1000).toISOString().substr(11, 8),
			seconds: uptimeSec.toFixed(2),
		},
		memory: {
			totalMB: totalMemMB.toFixed(2),
			freeMB: freeMemMB.toFixed(2),
			usagePercent: (100 - (freeMemMB / totalMemMB) * 100).toFixed(2),
		},
		cpu: {
			model: cpus[0]?.model || 'unknown',
			cores: cpus.length,
		},
		system: {
			hostname: os.hostname(),
			platform: os.platform(),
			arch: os.arch(),
			release: os.release(),
			loadavg: os.loadavg(),
		},
		network: {
			ip: Object.values(os.networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address || 'unknown',
			interfaces: os.networkInterfaces(),
		},
		env: {
			pid: process.pid,
			node: process.version,
			cwd: process.cwd(),
			memoryUsageMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(2),
		},
		docs: {
			proxy: '/proxy?url=',
			screenshot: '/screenshot?url=&fullpage=true',
			headers: '/headers?url=',
			pdf: '/pdf?url='
		}
	})
});

app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});

const cleanup = async () => {
	console.log('Server closed. Exiting...')
	if (browser) await browser.close();
	process.exit(0);
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('exit', cleanup)
