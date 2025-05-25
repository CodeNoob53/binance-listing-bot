// src/utils/logger.js

const winston = require('winston');
const { format } = winston;
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Перевіряємо наявність директорії для логів
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Створюємо формати для логера
const customFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  format.errors({ stack: true }),
  config.logging.format === 'json'
    ? format.json()
    : format.printf(info => {
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

// Створюємо транспорти
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

// Створюємо логер
const logger = winston.createLogger({
  levels: customLevels.levels,
  level: config.logging.level,
  format: customFormat,
  transports,
  exitOnError: false
});

// Додаємо кольори
winston.addColors(customLevels.colors);

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