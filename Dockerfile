FROM mcr.microsoft.com/playwright:focal

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npx playwright install --with-deps

ENV PORT=7860

EXPOSE 7860

CMD ["node", "app.js"]