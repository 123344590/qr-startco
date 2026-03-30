FROM node:20-alpine
WORKDIR /app

# Dependencias
COPY backend/package*.json ./
RUN npm ci --only=production

# Código del backend
COPY backend/ .

# Carpetas públicas (admin y formulario están en la raíz del repo)
COPY admin/      /app/admin/
COPY formulario/ /app/formulario/

EXPOSE 3001
CMD ["node", "server.js"]
