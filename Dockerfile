# Copiloto + sistema de exemplo (Horizonte) numa imagem só. Uso: docker compose up
FROM node:22-bookworm

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependências primeiro (camada reaproveitada enquanto os package.json não mudam).
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY sample-system/package.json sample-system/
COPY console/package.json console/
COPY widget/package.json widget/
COPY extension/package.json extension/
RUN npm ci
# Chromium e as bibliotecas do sistema para as tarefas pelo navegador.
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run build

ENV HOST=0.0.0.0 \
    DATA_DIR=data
EXPOSE 3000 4000
CMD ["node", "scripts/start.mjs"]
