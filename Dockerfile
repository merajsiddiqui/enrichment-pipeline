# syntax=docker/dockerfile:1

# Matches the Node version this project is developed against (see README).
FROM node:24-alpine AS base
RUN npm install -g pnpm@10.33.0
WORKDIR /app

# Install once with dev dependencies, reused by the build stage.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Compile TypeScript -> dist (both main.ts and cli.ts entry points).
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm run build

# Slim runtime image: only prod dependencies + compiled output.
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main.js"]
