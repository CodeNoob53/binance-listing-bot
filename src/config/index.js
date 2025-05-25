// src/config/index.js

const dotenv = require('dotenv');
const path = require('path');
const { validateConfig } = require('./validation');
const constants = require('./constants');

// Завантажуємо змінні оточення
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Визначаємо середовище
const ENV = process.env.NODE_ENV || 'development';

// Основна конфігурація
const config = {
  // Середовище
  env: ENV,
  isDevelopment: ENV === 'development',
  isProduction: ENV === 'production',
  isTest: ENV === 'test',

  // Binance API
  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    testnet: process.env.BINANCE_TESTNET === 'true',
    baseURL: process.env.BINANCE_TESTNET === 'true' 
      ? 'https://testnet.binance.vision/api'
      : 'https://api.binance.com/api',
    wsBaseURL: process.env.BINANCE_TESTNET === 'true'
      ? 'wss://testnet.binance.vision/ws'
      : 'wss://stream.binance.com:9443/ws',
    recvWindow: parseInt(process.env.BINANCE_RECV_WINDOW) || 60000,
    // Таймаути
    timeout: {
      rest: parseInt(process.env.REST_TIMEOUT) || 15000,
      ws: parseInt(process.env.WS_TIMEOUT) || 30000,
    },
    // Retry налаштування
    retry: {
      maxAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS) || 3,
      delay: parseInt(process.env.RETRY_DELAY) || 1000,
      backoff: 2, // Експоненційний backoff
    }
  },

  // Торгові налаштування
  trading: {
    // Основні параметри
    quoteAsset: process.env.QUOTE_ASSET || 'USDT',
    baseOrderSize: parseFloat(process.env.BASE_ORDER_SIZE) || 10, // в USDT
    maxOrderSize: parseFloat(process.env.MAX_ORDER_SIZE) || 100,
    maxPositions: parseInt(process.env.MAX_POSITIONS) || 5,
    
    // Ризик менеджмент
    risk: {
      maxAccountRiskPercent: parseFloat(process.env.MAX_ACCOUNT_RISK_PERCENT) || 0.02, // 2%
      maxPositionRiskPercent: parseFloat(process.env.MAX_POSITION_RISK_PERCENT) || 0.01, // 1%
      useOfBalance: parseFloat(process.env.USE_OF_BALANCE) || 0.95, // 95% балансу
    },
    
    // Take Profit / Stop Loss
    defaultTP: parseFloat(process.env.DEFAULT_TP_PERCENT) || 0.05, // 5%
    defaultSL: parseFloat(process.env.DEFAULT_SL_PERCENT) || 0.03, // 3%
    useOCO: process.env.USE_OCO !== 'false', // OCO ордери за замовчуванням
    
    // Фільтри для нових лістингів
    filters: {
      minVolume24h: parseFloat(process.env.MIN_VOLUME_24H) || 1000000, // $1M
      minLiquidity: parseFloat(process.env.MIN_LIQUIDITY) || 100000, // $100k
      excludeStablecoins: process.env.EXCLUDE_STABLECOINS !== 'false',
      excludeTokens: process.env.EXCLUDE_TOKENS ? process.env.EXCLUDE_TOKENS.split(',') : [],
    }
  },

  // Моніторинг
  monitoring: {
    // WebSocket як основний метод
    useWebSocket: process.env.USE_WEBSOCKET !== 'false',
    // Polling як резервний метод
    pollingInterval: parseInt(process.env.POLLING_INTERVAL) || 5000, // 5 секунд
    pollingEnabled: process.env.POLLING_ENABLED !== 'false',
    // Reconnect налаштування для WebSocket
    reconnect: {
      maxAttempts: parseInt(process.env.WS_RECONNECT_ATTEMPTS) || 5,
      delay: parseInt(process.env.WS_RECONNECT_DELAY) || 5000,
    },
    // Heartbeat для WebSocket
    heartbeat: {
      interval: parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000, // 30 секунд
      timeout: parseInt(process.env.WS_HEARTBEAT_TIMEOUT) || 60000, // 60 секунд
    }
  },

  // База даних
  database: {
    type: process.env.DB_TYPE || 'sqlite', // sqlite, postgresql, mysql
    sqlite: {
      filename: process.env.SQLITE_FILENAME || path.join(__dirname, '../../data/db/bot.db'),
    },
    postgresql: {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_DATABASE || 'binance_bot',
    },
    // Налаштування підключення
    pool: {
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      max: parseInt(process.env.DB_POOL_MAX) || 10,
    },
    logging: process.env.DB_LOGGING === 'true',
  },

  // Логування
  logging: {
    level: process.env.LOG_LEVEL || (ENV === 'production' ? 'info' : 'debug'),
    format: process.env.LOG_FORMAT || 'json',
    // Файлове логування
    file: {
      enabled: process.env.LOG_FILE_ENABLED !== 'false',
      filename: process.env.LOG_FILENAME || 'app.log',
      maxSize: process.env.LOG_MAX_SIZE || '10m',
      maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
    },
    // Консольне логування
    console: {
      enabled: process.env.LOG_CONSOLE_ENABLED !== 'false',
      colorize: process.env.LOG_CONSOLE_COLORIZE !== 'false',
    },
    // Логування в БД
    database: {
      enabled: process.env.LOG_DB_ENABLED === 'true',
      level: process.env.LOG_DB_LEVEL || 'error',
    }
  },

  // Сповіщення
  notifications: {
    // Telegram
    telegram: {
      enabled: process.env.TELEGRAM_ENABLED === 'true',
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
      // Типи сповіщень
      notifyOnNewListing: process.env.TELEGRAM_NOTIFY_NEW_LISTING !== 'false',
      notifyOnBuy: process.env.TELEGRAM_NOTIFY_BUY !== 'false',
      notifyOnSell: process.env.TELEGRAM_NOTIFY_SELL !== 'false',
      notifyOnError: process.env.TELEGRAM_NOTIFY_ERROR !== 'false',
    },
    // Email
    email: {
      enabled: process.env.EMAIL_ENABLED === 'true',
      smtp: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        }
      },
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
    },
    // Discord
    discord: {
      enabled: process.env.DISCORD_ENABLED === 'true',
      webhookUrl: process.env.DISCORD_WEBHOOK_URL,
    }
  },

  // Сервер та API
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
    // API для моніторингу
    api: {
      enabled: process.env.API_ENABLED === 'true',
      prefix: process.env.API_PREFIX || '/api',
      // Автентифікація
      auth: {
        enabled: process.env.API_AUTH_ENABLED === 'true',
        token: process.env.API_AUTH_TOKEN,
      }
    },
    // WebSocket для real-time даних
    ws: {
      enabled: process.env.WS_SERVER_ENABLED === 'true',
      path: process.env.WS_SERVER_PATH || '/ws',
    }
  },

  // Безпека
  security: {
    // Шифрування чутливих даних
    encryption: {
      enabled: process.env.ENCRYPTION_ENABLED === 'true',
      algorithm: process.env.ENCRYPTION_ALGORITHM || 'aes-256-gcm',
      key: process.env.ENCRYPTION_KEY, // 32 байти для aes-256
    },
    // IP whitelist
    ipWhitelist: {
      enabled: process.env.IP_WHITELIST_ENABLED === 'true',
      ips: process.env.IP_WHITELIST ? process.env.IP_WHITELIST.split(',') : [],
    },
    // Rate limiting
    rateLimit: {
      enabled: process.env.RATE_LIMIT_ENABLED === 'true',
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000, // 1 хвилина
      max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    }
  },

  // Розробка та дебаг
  debug: {
    enabled: process.env.DEBUG === 'true' || ENV === 'development',
    // Симуляція торгів без реальних ордерів
    simulationMode: process.env.SIMULATION_MODE === 'true',
    // Детальне логування
    verboseLogging: process.env.VERBOSE_LOGGING === 'true',
    // Профайлінг продуктивності
    profiling: process.env.PROFILING_ENABLED === 'true',
  },

  // Імпорт констант
  constants: constants,
};

// Валідуємо конфігурацію
const validationResult = validateConfig(config);
if (!validationResult.isValid) {
  console.error('❌ Помилка конфігурації:', validationResult.errors);
  process.exit(1);
}

// Експортуємо заморожену конфігурацію
module.exports = Object.freeze(config);