# 🌐 Open Mirror

**Open Mirror** is a simple API proxy built with Node.js and Playwright. It can fetch website content through a headless Chromium browser, take screenshots, capture HTTP headers, render pages to PDF, and act as a universal proxy — capable of bypassing basic Cloudflare and bot protections.

---

## 🚀 Features

- 🔁 **Proxy** any URL through a real browser (supports images, HTML, files, etc.)
- 🖼️ **Screenshot** websites (full page or viewport)
- 📄 **PDF** rendering of webpages
- 📑 **Headers** retrieval from HTTP responses
- 💡 **System info** at root (`/`) – uptime, CPU, memory, IP, and more

---

## 📦 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Returns system info & API usage guide |
| `/proxy?url=` | Proxies content from the target URL |
| `/screenshot?url=&fullpage=true` | Captures a screenshot of the webpage |
| `/pdf?url=` | Renders the webpage as a PDF |
| `/headers?url=` | Retrieves HTTP response headers from the target URL |

---

## ⚙️ Installation

### 1. Clone the repository
```bash
git clone https://github.com/nazedev/open-mirror.git
cd open-mirror
```

### 2. Install
```bash
npm install
npx playwright install --with-deps
```

### 3. Run
```bash
node app.js
```

#### Support Me
- [Saweria](https://saweria.co/naze)
