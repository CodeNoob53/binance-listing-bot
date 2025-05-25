# Вказуємо базовий образ
FROM node:20-alpine

# Встановлюємо робочу директорію
WORKDIR /usr/src/app

# Копіюємо package.json та package-lock.json (або yarn.lock)
COPY package*.json ./

# Встановлюємо залежності
RUN npm install --production

# Копіюємо решту файлів проєкту
COPY . .

# Відкриваємо порт (змінити, якщо у вас інший)
EXPOSE 3000

# Команда запуску
CMD ["node", "src/app.js"]