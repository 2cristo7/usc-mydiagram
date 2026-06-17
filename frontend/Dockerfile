# Frontend — React 19 + Vite 8. Multi-stage: build estático → servir con nginx.
#
# IMPORTANTE: las VITE_* se inyectan en BUILD-TIME (Vite las hornea en el bundle),
# no en runtime. Por eso se pasan como build args, no como env del contenedor.
# Si en el futuro quieres una imagen reusable entre entornos, habría que sustituir
# placeholders en el entrypoint en vez de hornearlas aquí.

# --- build ---
FROM node:22-slim AS build
WORKDIR /app

# Args de build → expuestos como env para que `vite build` los recoja.
ARG VITE_API_URL
ARG VITE_WS_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime ---
FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
