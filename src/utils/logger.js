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
    return require('../config');
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

// Створюємо формати для логера з використанням відкладеного завантаження конфігу
const customFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.errors({ stack: true }),
  format.printf(info => {
    const config = getConfig();
    const { timestamp, level, message, ...rest } = info;
    
    // Додаємо emoji для рівнів логування
    const levelEmoji = {
      error: '❌',
      warn: '⚠️',
      info: 'ℹ️',
      http: '🌐',
      verbose: '📝',
      debug: '🔍',
      silly: '🤪',
      trade: '💹',
      position: '📊'
    };
    
    const emoji = levelEmoji[level] || '';
    
    // Основне повідомлення
    let log = `${timestamp} ${emoji} [${level.toUpperCase()}]: ${message}`;
    
    // Додаємо контекст, якщо є
    if (Object.keys(rest).length > 0) {
      log += ` ${JSON.stringify(rest)}`;
    }
    
    return log;
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
  if (config.logging.console.enabled) {
    transports.push(
      new winston.transports.Console({
        level: config.logging.level,
        format: format.combine(
          config.logging.console.colorize ? format.colorize() : format.uncolorize(),
          customFormat
        )
      })
    );
  }

  // Файловий транспорт
  if (config.logging.file.enabled) {
    transports.push(
      new DailyRotateFile({
        filename: path.join(logDir, '%DATE%_' + config.logging.file.filename),
        datePattern: 'YYYY-MM-DD',
        maxSize: config.logging.file.maxSize,
        maxFiles: config.logging.file.maxFiles,
        level: config.logging.level,
        format: customFormat
      })
    );
  }

  return transports;
}

// Створюємо логер
const logger = winston.createLogger({
  levels: customLevels.levels,
  level: 'info', // Початковий рівень, буде оновлено після завантаження конфігу
  format: customFormat,
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

// Експортуємо логер
module.exports = logger;