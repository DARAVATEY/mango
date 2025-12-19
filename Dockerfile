# Step 1: Build the app
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Step 2: Serve with Nginx
FROM nginx:alpine
# Vite builds to 'dist' by default. Ensure this matches your vite.config.ts
COPY --from=build /app/dist /usr/share/nginx/html

# Create a custom nginx config to listen on $PORT
RUN printf 'server {\n\
    listen %s;\n\
    location / {\n\
        root /usr/share/nginx/html;\n\
        index index.html;\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
}\n' "$PORT" > /etc/nginx/conf.d/default.conf

# Use a shell script to replace $PORT at runtime
CMD sh -c "sed -i 's/listen [0-9]*/listen '$PORT'/g' /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"
