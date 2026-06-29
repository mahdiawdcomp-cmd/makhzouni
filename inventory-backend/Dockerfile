FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig.json ./
COPY src ./src

RUN npx prisma generate
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     openssl ca-certificates \
     postgresql-client \
     # Chrome/Puppeteer dependencies for WhatsApp
     libglib2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
     libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
     libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
     libcairo2 libx11-6 libx11-xcb1 libxcb1 libxext6 libxss1 \
     fonts-liberation wget \
     # fontconfig + an Arabic-capable font so SVG->PNG label rendering
     # (sharp/librsvg) can actually draw Arabic text. librsvg does NOT honor
     # @font-face fonts embedded in the SVG, so the font MUST be installed in
     # the OS font path and registered with fontconfig.
     fontconfig fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Install the bundled Cairo font system-wide so labels render Arabic on the
# Linux runtime (no Arabic font ships with the base image).
RUN mkdir -p /usr/share/fonts/truetype/cairo \
  && cp /app/dist/src/assets/Cairo.ttf /usr/share/fonts/truetype/cairo/Cairo.ttf \
  && fc-cache -f \
  && fc-list | grep -i cairo || true

EXPOSE 5000

CMD ["sh", "-c", "npx prisma migrate deploy && node --unhandled-rejections=warn dist/src/server.js"]
