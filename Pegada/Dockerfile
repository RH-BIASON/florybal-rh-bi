FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json requirements.txt ./

RUN npm ci \
  && python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

COPY . .

RUN npm run build \
  && mkdir -p data/uploads data/import-history \
  && chown -R node:node /app

ENV NODE_ENV=production
ENV PYTHON_BIN=/opt/venv/bin/python

USER node

EXPOSE 10000

CMD ["npm", "start"]
