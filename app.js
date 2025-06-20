require('dotenv').config();

const os = require('os');
const path = require('path');
const axios = require('axios');
const https = require('https');
const cheerio = require('cheerio');
const morgan = require('morgan');
const express = require('express');
const { chromium } = require('playwright');

let browser;
const app = express();
const PORT = process.env.PORT || 3000;

const agent = new https.Agent({ rejectUnauthorized: false });

app.set('json spaces', 4);
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
	const context = await browser.newContext({
		bypassCSP: true,
		ignoreHTTPSErrors: true
	});
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
	const { url, get } = req.query;
	if (!url) return res.status(400).send('Missing ?url=');
	const u = new URL(url);
	if (['localhost', '127.0.0.1'].includes(u.hostname)) return res.status(403).send('Forbidden');
	try {
		const head = await axios.head(url, { httpsAgent: agent });
		const contentType = head.headers['content-type'] || '';
		const browserHeaders = await getBrowserHeaders(url);
		if (!contentType.includes('text/html')) {
			if (get) {
				const response = await axios.get(url, {
					httpsAgent: agent,
					headers: browserHeaders,
					responseType: 'arraybuffer',
				});
				res.set({
					'Access-Control-Allow-Origin': '*',
					'Content-Type': response.headers['content-type'] || 'application/octet-stream',
				});
				res.status(200).send(response.data);
			} else {
				const response = await axios.get(url, {
					httpsAgent: agent,
					headers: browserHeaders,
					responseType: 'stream',
				});
				res.set({
					'Access-Control-Allow-Origin': '*',
					'Content-Type': response.headers['content-type'] || 'application/octet-stream',
				});
				if (response.headers['content-length']) {
					res.setHeader('Content-Length', response.headers['content-length']);
				}
				response.data.pipe(res);
			}
		} else {
			const { page, context } = await openPage(url);
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
			const html = await page.content();
			if (get) {
				res.setHeader('Content-Type', 'text/html');
				return res.send(html);
			}
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
		}
	} catch (e) {
		res.status(500).send(e.message);
	} finally {
		await context.close();
	}
});

app.get('/screenshot', async (req, res) => {
	const { url, preset = 'desktop', fullpage = 'false', size, width, height } = req.query;
	if (!url) return res.status(400).send('Missing ?url=');
	try {
		const viewports = {
			pixel: { width: 411, height: 823 },
			iphone: { width: 375, height: 812 },
			tablet: { width: 768, height: 1024 },
			android: { width: 360, height: 740 },
			fullhd: { width: 1920, height: 1080 },
			website: { width: 1280, height: 800 },
			desktop: { width: 1366, height: 768 },
			macbook: { width: 1440, height: 900 },
		};
		
		const { page, context } = await openPage(url);
		let viewport = { width: 1280, height: 800 };
		if (width && height) {
			viewport = { width: parseInt(width), height: parseInt(height) };
		} else if (viewports[preset]) {
			const scale = parseFloat(size);
			viewport = { ...viewports[preset] };
			if (!isNaN(scale) && scale > 0) {
				viewport.width = Math.round(viewport.width * scale);
				viewport.height = Math.round(viewport.height * scale);
			}
		}
		await page.setViewportSize({
			width: viewport.width,
			height: viewport.height
		});
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
