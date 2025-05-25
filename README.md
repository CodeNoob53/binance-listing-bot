# 🤖 Binance Listing Bot

Професійний торговий бот для автоматичної торгівлі новими лістингами на Binance з використанням WebSocket моніторингу.

## 🚀 Основні можливості

- **WebSocket моніторинг** - миттєва реакція на нові лістинги
- **Автоматична торгівля** - купівля та встановлення TP/SL
- **Модульна архітектура** - легке розширення функціоналу
- **Різні типи сповіщень** - Telegram, Email, Discord
- **API для моніторингу** - веб-інтерфейс для контролю
- **Docker підтримка** - легке розгортання
- **Детальне логування** - повний контроль над роботою бота

## 📋 Вимоги

- Node.js >= 16.0.0
- npm >= 8.0.0
- Binance API ключі
- (Опціонально) PostgreSQL або MySQL для розширеного зберігання даних
- (Опціонально) Redis для кешування та черг

## 🛠️ Швидкий старт

### 1. Клонування репозиторію

```bash
git clone https://github.com/yourusername/binance-listing-bot.git
cd binance-listing-bot
```

### 2. Встановлення залежностей

```bash
npm install
```

### 3. Налаштування

```bash
# Копіюємо приклад конфігурації
cp .env.example .env

# Редагуємо .env файл
nano .env
```

Обов'язкові налаштування:
- `BINANCE_API_KEY` - ваш API ключ
- `BINANCE_API_SECRET` - ваш Secret ключ
- `BINANCE_TESTNET` - `true` для тестування

### 4. Запуск бота

```bash
# Звичайний запуск
npm start

# Режим розробки (з автоперезапуском)
npm run dev

# Запуск через PM2
npm run pm2:start
```

## 🐳 Docker

### Запуск через Docker Compose

```bash
# Збірка та запуск
docker-compose up -d

# Перегляд логів
docker-compose logs -f bot

# Зупинка
docker-compose down
```

### Окремий Docker контейнер

```bash
# Збірка образу
docker build -t binance-listing-bot .

# Запуск контейнера
docker run -d \
  --name binance-bot \
  --env-file .env \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  binance-listing-bot
```

## 📁 Структура проекту

```
├── src/
│   ├── config/           # Конфігурація
│   ├── services/         # Бізнес-логіка
│   │   ├── binance/      # Binance API
│   │   ├── monitoring/   # Моніторинг лістингів
│   │   ├── trading/      # Торгові операції
│   │   ├── storage/      # Зберігання даних
│   │   └── notification/ # Сповіщення
│   ├── utils/            # Допоміжні функції
│   ├── models/           # Моделі даних
│   └── app.js            # Головний файл
├── data/                 # Дані додатку
├── logs/                 # Логи
├── tests/                # Тести
└── scripts/              # Допоміжні скрипти
```

## ⚙️ Конфігурація

### Основні параметри

| Параметр | Опис | За замовчуванням |
|----------|------|------------------|
| `BASE_ORDER_SIZE` | Розмір ордера в USDT | 10 |
| `DEFAULT_TP_PERCENT` | Take Profit у % | 5% |
| `DEFAULT_SL_PERCENT` | Stop Loss у % | 3% |
| `MAX_POSITIONS` | Макс. кількість позицій | 5 |

### Моніторинг

| Параметр | Опис | За замовчуванням |
|----------|------|------------------|
| `USE_WEBSOCKET` | Використовувати WebSocket | true |
| `POLLING_INTERVAL` | Інтервал polling (мс) | 5000 |
| `WS_RECONNECT_ATTEMPTS` | Спроби перепідключення | 5 |

### Фільтри лістингів

| Параметр | Опис | За замовчуванням |
|----------|------|------------------|
| `MIN_VOLUME_24H` | Мін. обсяг за 24г | $1,000,000 |
| `EXCLUDE_STABLECOINS` | Виключити стейблкоїни | true |
| `EXCLUDE_TOKENS` | Виключити токени | SHIB,DOGE,PEPE |

## 📊 API Endpoints

Якщо `API_ENABLED=true`:

- `GET /api/status` - Статус бота
- `GET /api/positions` - Активні позиції
- `GET /api/trades` - Історія угод
- `GET /api/performance` - Статистика
- `POST /api/stop` - Зупинити бота
- `POST /api/start` - Запустити бота

## 🔔 Сповіщення

### Telegram

1. Створіть бота через @BotFather
2. Отримайте токен бота
3. Отримайте ваш chat_id
4. Налаштуйте в .env:
   ```
   TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=your_token
   TELEGRAM_CHAT_ID=your_chat_id
   ```

### Email

Налаштуйте SMTP:
```
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email
SMTP_PASS=your_app_password
```

## 🧪 Тестування

```bash
# Запуск всіх тестів
npm test

# Тести з coverage
npm run test:coverage

# Watch режим
npm run test:watch
```

## 🚨 Безпека

1. **НІКОЛИ** не діліться API ключами
2. Використовуйте **лише** дозволи на торгівлю (без виведення)
3. Рекомендовано обмежити доступ за IP
4. Спочатку тестуйте на Testnet
5. Починайте з мінімальних сум

## 📈 Моніторинг

### Grafana Dashboard

Якщо використовуєте Docker Compose з Grafana:
- URL: http://localhost:3001
- Login: admin
- Password: (встановлений в .env)

### Логи

```bash
# Перегляд логів
tail -f logs/app.log

# Логи помилок
tail -f logs/error.log

# PM2 логи
pm2 logs
```

## 🛠️ Розробка

### Додавання нового моніторингу

1. Створіть файл в `src/services/monitoring/`
2. Наслідуйте від `EventEmitter`
3. Реалізуйте методи `start()`, `stop()`
4. Емітуйте подію `newListing` при знаходженні

### Додавання нової стратегії

1. Створіть файл в `src/services/trading/strategies/`
2. Реалізуйте інтерфейс стратегії
3. Зареєструйте в `TradingService`

## 🤝 Підтримка

- Telegram: @your_support_bot
- Email: support@example.com
- Issues: GitHub Issues

## ⚠️ Відмова від відповідальності

Цей бот призначений для освітніх цілей. Торгівля криптовалютою пов'язана з високим ризиком. Автори не несуть відповідальності за можливі фінансові втрати.

## 📄 Ліцензія

MIT License - див. файл [LICENSE](LICENSE)

---

**Завжди тестуйте на Testnet перед використанням реальних коштів!**