# Development image for the web app (Vite dev server). Production builds are static
# files served by Vercel/Netlify (see docs/deployment.md).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
