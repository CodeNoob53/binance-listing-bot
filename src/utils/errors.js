// src/utils/errors.js

const logger = require('./logger');
const config = require('../config');

/**
 * Клас для користувацьких помилок додатку
 */
class AppError extends Error {
  constructor(message, code, data = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || 'UNKNOWN_ERROR';
    this.data = data;
    this.timestamp = new Date();
    
    // Зберігаємо трасування стека
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Помилка API
 */
class ApiError extends AppError {
  constructor(message, code = 'API_ERROR', data = {}) {
    super(message, code, data);
    this.status = data.status || 500;
  }
}

/**
 * Помилка з'єднання з біржею
 */
class BinanceError extends AppError {
  constructor(message, code = 'BINANCE_ERROR', data = {}) {
    super(message, code, data);
    
    // Додаткова інформація для специфічних помилок Binance
    if (data.response && data.response.data) {
      this.binanceCode = data.response.data.code;
      this.binanceMsg = data.response.data.msg;
    }
  }
}

/**
 * Помилка торгової операції
 */
class TradeError extends AppError {
  constructor(message, code = 'TRADE_ERROR', data = {}) {
    super(message, code, data);
    this.symbol = data.symbol;
    this.orderId = data.orderId;
  }
}

/**
 * Помилка налаштувань
 */
class ConfigError extends AppError {
  constructor(message, code = 'CONFIG_ERROR', data = {}) {
    super(message, code, data);
  }
}

/**
 * Глобальний обробник помилок
 */
class ErrorHandler {
  /**
   * Обробка помилки
   */
  static handle(error) {
    try {
      // Визначаємо тип помилки
      const isAppError = error instanceof AppError;
      
      // Логуємо помилку
      if (isAppError) {
        logger.error(`[${error.code}] ${error.message}`, {
          code: error.code,
          data: error.data,
          stack: error.stack
        });
      } else {
        logger.error(`Необроблена помилка: ${error.message}`, {
          name: error.name,
          stack: error.stack
        });
      }
      
      // Зберігаємо в БД якщо потрібно
      if (config.logging.database.enabled) {
        this.saveToDatabase(error);
      }
      
      // Відправляємо сповіщення про критичні помилки
      if (this.isCriticalError(error)) {
        this.sendNotification(error);
      }
      
    } catch (handlerError) {
      console.error('Помилка в обробнику помилок:', handlerError);
    }
  }
  
  /**
   * Перевірка чи помилка критична
   */
  static isCriticalError(error) {
    // Помилки, які потребують негайної уваги
    const criticalErrors = [
      'BINANCE_API_KEY_INVALID',
      'DATABASE_CONNECTION_ERROR',
      'OUT_OF_MEMORY',
      'IP_BANNED'
    ];
    
    // Перевіряємо код помилки
    if (error instanceof AppError && criticalErrors.includes(error.code)) {
      return true;
    }
    
    // Перевіряємо специфічні помилки Binance
    if (error instanceof BinanceError && error.binanceCode) {
      const criticalBinanceErrors = [-2015, -2014, -1022, -1021];
      return criticalBinanceErrors.includes(error.binanceCode);
    }
    
    return false;
  }
  
  /**
   * Збереження помилки в базу даних
   */
  static async saveToDatabase(error) {
    try {
      // Імпортуємо модуль бази даних (якщо вже ініціалізовано)
      let dbService;
      
      try {
        const { DatabaseService } = require('../services/storage/database');
        dbService = DatabaseService.getInstance();
      } catch (e) {
        // БД ще не ініціалізована
        return;
      }
      
      if (dbService && dbService.saveError) {
        await dbService.saveError({
          type: error instanceof AppError ? error.code : 'UNCAUGHT_ERROR',
          error: error.message,
          data: error instanceof AppError ? error.data : { stack: error.stack }
        });
      }
    } catch (dbError) {
      logger.error('Помилка збереження помилки в БД:', dbError);
    }
  }
  
  /**
   * Відправка сповіщення про помилку
   */
  static async sendNotification(error) {
    try {
      // Імпортуємо модуль сповіщень (якщо вже ініціалізовано)
      let notificationService;
      
      try {
        const { NotificationService } = require('../services/notification');
        notificationService = NotificationService.getInstance();
      } catch (e) {
        // Сервіс сповіщень ще не ініціалізований
        return;
      }
      
      if (notificationService && notificationService.send) {
        await notificationService.send('error', {
          type: error instanceof AppError ? error.code : 'UNCAUGHT_ERROR',
          error: error.message,
          data: error instanceof AppError ? error.data : { stack: error.stack }
        });
      }
    } catch (notificationError) {
      logger.error('Помилка відправки сповіщення про помилку:', notificationError);
    }
  }
  
  /**
   * Форматування помилки для відповіді API
   */
  static formatErrorResponse(error) {
    // Базова відповідь
    const response = {
      success: false,
      error: error.message || 'Невідома помилка',
      code: error instanceof AppError ? error.code : 'INTERNAL_ERROR'
    };
    
    // Додаємо статус для API помилок
    if (error instanceof ApiError) {
      response.status = error.status;
    }
    
    // Додаємо додаткові дані в режимі розробки
    if (config.debug.enabled) {
      response.stack = error.stack;
      
      if (error instanceof AppError) {
        response.data = error.data;
      }
      
      if (error instanceof BinanceError) {
        response.binanceCode = error.binanceCode;
        response.binanceMsg = error.binanceMsg;
      }
    }
    
    return response;
  }
}

module.exports = {
  AppError,
  ApiError,
  BinanceError,
  TradeError,
  ConfigError,
  ErrorHandler
};