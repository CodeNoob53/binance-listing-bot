// src/utils/logger.js

const winston = require('winston');
const { format } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Створюємо дефолтні налаштування, якщо конфіг ще не доступний
const defaultConfig = {
  logging: {
    level: 'info',
    format: 'json',
    file: {
      enabled: true,
      filename: 'app.log',
      maxSize: '10m',
      maxFiles: 5
    },
    console: {
      enabled: true,
      colorize: true
    },
    database: {
      enabled: false,
      level: 'error'
    }
  }
};

// Функція для відкладеного завантаження конфігу (уникаємо циклічної залежності)
function getConfig() {
  try {
    return require('../config/index') || defaultConfig;
  } catch (e) {
    console.warn('Не вдалося завантажити конфігурацію, використовуємо дефолтні налаштування логера');
    return defaultConfig;
  }
}

// Перевіряємо наявність директорії для логів
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Функція для безпечного серіалізування об'єктів
function safeStringify(obj) {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  }, 2);
}

// Функція для форматування помилок
function formatError(error) {
  if (!error) return 'Unknown error';
  
  // Базова інформація про помилку
  const errorInfo = {
    message: error.message || 'No error message',
    code: error.code,
    status: error.status || error.statusCode,
    name: error.name
  };

  // Додаємо додаткову інформацію для Axios помилок
  if (error.config) {
    errorInfo.request = {
      method: error.config.method,
      url: error.config.url,
      baseURL: error.config.baseURL
    };
  }

  // Додаємо відповідь сервера, якщо вона є
  if (error.response) {
    errorInfo.response = {
      status: error.response.status,
      statusText: error.response.statusText,
      data: error.response.data
    };
  }

  return errorInfo;
}

// Налаштування формату
const logFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.printf(({ level, message, timestamp, ...meta }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    if (Object.keys(meta).length > 0) {
      // Форматуємо помилки спеціальним чином
      if (meta.error) {
        logMessage += `\n${safeStringify(formatError(meta.error))}`;
      } else {
        logMessage += `\n${safeStringify(meta)}`;
      }
    }
    
    return logMessage;
  })
);

// Додаткові рівні логування
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    trade: 2, // Спеціальний рівень для торгових операцій
    info: 3,
    position: 4, // Спеціальний рівень для позицій
    http: 5,
    verbose: 6,
    debug: 7,
    silly: 8
  },
  colors: {
    error: 'red',
    warn: 'yellow',
    trade: 'green',
    info: 'blue',
    position: 'cyan',
    http: 'magenta',
    verbose: 'grey',
    debug: 'grey',
    silly: 'grey'
  }
};

// Створюємо транспорти з відкладеним завантаженням конфігу
function createTransports() {
  const config = getConfig();
  const transports = [];

  // Консольний транспорт
  if (config?.logging?.console?.enabled) {
    transports.push(
      new winston.transports.Console({
        level: config.logging.level || 'info',
        format: format.combine(
          config.logging.console.colorize ? format.colorize() : format.uncolorize(),
          logFormat
        )
      })
    );
  }

  // Файловий транспорт
  if (config?.logging?.file?.enabled) {
    transports.push(
      new DailyRotateFile({
        filename: path.join(logDir, '%DATE%_' + (config.logging.file.filename || 'app.log')),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.logging.file.maxSize || '10m',
        maxFiles: config.logging.file.maxFiles || 5,
        level: config.logging.level || 'info',
        format: logFormat
      })
    );
  }

  return transports;
}

// Створюємо логер
const logger = winston.createLogger({
  levels: customLevels.levels,
  level: 'info', // Початковий рівень, буде оновлено після завантаження конфігу
  format: logFormat,
  transports: createTransports(),
  exitOnError: false
});

// Додаємо кольори
winston.addColors(customLevels.colors);

// Оновлення рівня логування після повного завантаження конфігу
setTimeout(() => {
  const config = getConfig();
  logger.level = config.logging.level;
}, 0);

// Таймер для вимірювання часу виконання
logger.startTimer = function() {
  const start = Date.now();
  return {
    done: function(message, data = {}) {
      const ms = Date.now() - start;
      logger.info(`${message} [${ms}ms]`, data);
      return ms;
    }
  };
};

// Додаємо метод для збереження логу в БД
logger.saveToDb = async function(level, message, context = {}) {
  const config = getConfig();
  // Цей метод буде викликатись з DatabaseService, коли буде доступний
  if (config.logging.database.enabled && level === config.logging.database.level) {
    try {
      const dbService = require('../services/storage/database');
      if (dbService.saveLog) {
        await dbService.saveLog({
          level,
          message,
          context
        });
      }
    } catch (error) {
      console.error('Помилка збереження логу в БД:', error);
    }
  }
};

// Додаємо методи для різних типів логування
logger.trade = function(message, meta = {}) {
  this.info(`[TRADE] ${message}`, meta);
};

logger.position = function(message, meta = {}) {
  this.info(`[POSITION] ${message}`, meta);
};

logger.error = function(message, error = null, meta = {}) {
  if (error) {
    meta.error = error;
  }
  this.log('error', message, meta);
};

// Експортуємо логер
module.exports = logger;