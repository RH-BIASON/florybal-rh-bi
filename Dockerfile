FROM node:24-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY Florybal/package*.json ./Florybal/
COPY Pegada/package*.json ./Pegada/
COPY Florybal/requirements.txt ./Florybal/requirements.txt
COPY Pegada/requirements.txt ./Pegada/requirements.txt

RUN npm ci \
  && npm ci --prefix Florybal \
  && npm ci --prefix Pegada \
  && python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r Florybal/requirements.txt \
  && /opt/venv/bin/pip install --no-cache-dir -r Pegada/requirements.txt

COPY . .

RUN npm run build \
  && mkdir -p Florybal/data/uploads Florybal/data/import-history \
  && mkdir -p Pegada/data/uploads Pegada/data/import-history \
  && chown -R node:node /app

ENV NODE_ENV=production
ENV PYTHON_BIN=/opt/venv/bin/python

USER node

EXPOSE 10000

CMD ["npm", "start"]
