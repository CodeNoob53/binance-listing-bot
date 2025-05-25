// src/services/server/index.js

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const WebSocket = require('ws');
const config = require('../../config');
const logger = require('../../utils/logger');
const { ErrorHandler } = require('../../utils/errors');

/**
 * API Сервер для моніторингу та управління ботом
 */
class APIServer {
  constructor(bot) {
    this.app = express();
    this.server = null;
    this.wss = null;
    this.bot = bot;
    this.connectedClients = new Set();
    this.port = config.server.port;
    this.host = config.server.host;
  }

  /**
   * Запуск сервера
   */
  async start() {
    try {
      // Налаштування Express
      this.setupExpress();
      
      // Налаштування маршрутів
      this.setupRoutes();
      
      // Створення HTTP сервера
      this.server = http.createServer(this.app);
      
      // Налаштування WebSocket сервера
      if (config.server.ws.enabled) {
        this.setupWebSocket();
      }
      
      // Запуск сервера
      await this.startServer();
      
      logger.info(`🌐 API сервер запущено на http://${this.host}:${this.port}`);
      
      if (config.server.ws.enabled) {
        logger.info(`🔌 WebSocket сервер запущено на ws://${this.host}:${this.port}${config.server.ws.path}`);
      }
      
    } catch (error) {
      logger.error('❌ Помилка запуску API сервера:', error);
      throw error;
    }
  }

  /**
   * Налаштування Express
   */
  setupExpress() {
    // Базова конфігурація
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(cors());
    this.app.use(helmet());
    this.app.use(compression());
    
    // Rate limiting
    if (config.security.rateLimit.enabled) {
      const limiter = rateLimit({
        windowMs: config.security.rateLimit.windowMs,
        max: config.security.rateLimit.max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Перевищено ліміт запитів. Спробуйте пізніше.' }
      });
      
      this.app.use(limiter);
    }
    
    // IP whitelist
    if (config.security.ipWhitelist.enabled && config.security.ipWhitelist.ips.length > 0) {
      this.app.use((req, res, next) => {
        const clientIp = req.ip || req.connection.remoteAddress;
        
        if (!config.security.ipWhitelist.ips.includes(clientIp)) {
          logger.warn(`⚠️ Доступ заборонено для IP: ${clientIp}`);
          return res.status(403).json({ error: 'Доступ заборонено' });
        }
        
        next();
      });
    }
    
    // API Auth middleware
    if (config.server.api.auth.enabled) {
      this.app.use(this.authMiddleware.bind(this));
    }
    
    // Логування запитів
    this.app.use((req, res, next) => {
      const start = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        const logLevel = res.statusCode >= 400 ? 'warn' : 'debug';
        
        logger[logLevel](`${req.method} ${req.originalUrl} ${res.statusCode} [${duration}ms]`);
      });
      
      next();
    });
  }

  /**
   * Middleware для автентифікації
   */
  authMiddleware(req, res, next) {
    // Пропускаємо OPTIONS запити
    if (req.method === 'OPTIONS') {
      return next();
    }
    
    // Перевіряємо токен
    const token = req.headers['x-api-key'] || req.query.apiKey;
    
    if (!token || token !== config.server.api.auth.token) {
      logger.warn('⚠️ Спроба неавторизованого доступу до API');
      return res.status(401).json({ error: 'Необхідна автентифікація' });
    }
    
    next();
  }

  /**
   * Налаштування маршрутів
   */
  setupRoutes() {
    const apiPrefix = config.server.api.prefix;
    
    // Базовий маршрут
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Binance Listing Bot API',
        version: '1.0.0',
        status: 'running'
      });
    });
    
    // API маршрути
    const apiRouter = express.Router();
    
    // Статус бота
    apiRouter.get('/status', (req, res) => {
      const status = this.bot.getStatus();
      res.json(status);
    });
    
    // Запуск/зупинка бота
    apiRouter.post('/control', async (req, res) => {
      try {
        const { action } = req.body;
        
        if (action === 'start') {
          if (this.bot.isRunning) {
            return res.json({ success: true, message: 'Бот вже запущено' });
          }
          
          await this.bot.start();
          return res.json({ success: true, message: 'Бот успішно запущено' });
        }
        
        if (action === 'stop') {
          if (!this.bot.isRunning) {
            return res.json({ success: true, message: 'Бот вже зупинено' });
          }
          
          await this.bot.stop();
          return res.json({ success: true, message: 'Бот успішно зупинено' });
        }
        
        return res.status(400).json({ success: false, error: 'Невідома дія' });
        
      } catch (error) {
        logger.error('❌ Помилка контролю бота:', error);
        return res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Отримання активних позицій
    apiRouter.get('/positions', async (req, res) => {
      try {
        const positions = await this.bot.services.database.getActivePositions();
        res.json({ success: true, positions });
      } catch (error) {
        logger.error('❌ Помилка отримання позицій:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Отримання історії позицій
    apiRouter.get('/positions/history', async (req, res) => {
      try {
        const { limit = 50, offset = 0, status } = req.query;
        
        const filters = {};
        if (status) {
          filters.status = status;
        }
        
        const result = await this.bot.services.database.getPositions(
          filters,
          parseInt(limit),
          parseInt(offset)
        );
        
        res.json({
          success: true,
          positions: result.rows,
          total: result.count,
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
      } catch (error) {
        logger.error('❌ Помилка отримання історії позицій:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Закриття позиції
    apiRouter.post('/positions/:symbol/close', async (req, res) => {
      try {
        const { symbol } = req.params;
        
        // Отримуємо позицію
        const position = await this.bot.services.database.getPositionBySymbol(symbol);
        
        if (!position) {
          return res.status(404).json({ success: false, error: 'Позицію не знайдено' });
        }
        
        // Отримуємо поточну ціну
        const currentPrice = await this.bot.services.trading.binanceClient.getCurrentPrice(symbol);
        
        // Створюємо фіктивний ордер для закриття позиції
        const filledOrder = {
          orderId: Date.now(),
          symbol,
          status: config.constants.ORDER_STATUS.FILLED,
          price: currentPrice
        };
        
        // Закриваємо позицію
        await this.bot.services.trading.closePosition(position, filledOrder);
        
        res.json({
          success: true,
          message: `Позицію ${symbol} успішно закрито`,
          price: currentPrice
        });
        
      } catch (error) {
        logger.error(`❌ Помилка закриття позиції ${req.params.symbol}:`, error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Отримання конфігурації
    apiRouter.get('/config', (req, res) => {
      // Повертаємо конфігурацію без чутливих даних
      const safeConfig = { ...config };
      
      // Видаляємо чутливі дані
      delete safeConfig.binance.apiKey;
      delete safeConfig.binance.apiSecret;
      delete safeConfig.server.api.auth.token;
      
      if (safeConfig.notifications.telegram) {
        delete safeConfig.notifications.telegram.botToken;
        delete safeConfig.notifications.telegram.chatId;
      }
      
      if (safeConfig.notifications.email && safeConfig.notifications.email.smtp) {
        delete safeConfig.notifications.email.smtp.auth;
      }
      
      if (safeConfig.security.encryption) {
        delete safeConfig.security.encryption.key;
      }
      
      res.json({ success: true, config: safeConfig });
    });
    
    // Ручний запуск тестової покупки
    apiRouter.post('/test/buy', async (req, res) => {
      try {
        const { symbol } = req.body;
        
        if (!symbol) {
          return res.status(400).json({ success: false, error: 'Необхідно вказати символ' });
        }
        
        // Отримуємо інформацію про символ
        const currentPrice = await this.bot.services.trading.binanceClient.getCurrentPrice(symbol);
        
        if (!currentPrice) {
          return res.status(404).json({ success: false, error: 'Символ не знайдено' });
        }
        
        // Створюємо тестові дані
        const listingData = {
          symbol,
          price: currentPrice,
          volume: 1000000,
          quoteVolume: 1000000,
          timestamp: Date.now()
        };
        
        // Виконуємо покупку
        const result = await this.bot.services.trading.executeBuy(listingData);
        
        if (result.success) {
          // Встановлюємо TP/SL
          await this.bot.services.trading.setTakeProfitStopLoss(result);
          
          res.json({
            success: true,
            message: `Тестова покупка ${symbol} виконана успішно`,
            result
          });
        } else {
          res.status(400).json({
            success: false,
            error: result.error,
            message: `Помилка тестової покупки ${symbol}`
          });
        }
        
      } catch (error) {
        logger.error('❌ Помилка тестової покупки:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Помилки
    apiRouter.get('/errors', async (req, res) => {
      try {
        const { limit = 50, offset = 0 } = req.query;
        
        const errors = await this.bot.services.database.models.Error.findAndCountAll({
          limit: parseInt(limit),
          offset: parseInt(offset),
          order: [['timestamp', 'DESC']]
        });
        
        res.json({
          success: true,
          errors: errors.rows,
          total: errors.count,
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
      } catch (error) {
        logger.error('❌ Помилка отримання помилок:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Логи
    apiRouter.get('/logs', async (req, res) => {
      try {
        const { limit = 50, offset = 0, level } = req.query;
        
        const where = {};
        if (level) {
          where.level = level;
        }
        
        const logs = await this.bot.services.database.models.Log.findAndCountAll({
          where,
          limit: parseInt(limit),
          offset: parseInt(offset),
          order: [['timestamp', 'DESC']]
        });
        
        res.json({
          success: true,
          logs: logs.rows,
          total: logs.count,
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
        
      } catch (error) {
        logger.error('❌ Помилка отримання логів:', error);
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Створюємо маршрут для API
    this.app.use(apiPrefix, apiRouter);
    
    // Обробка 404
    this.app.use((req, res) => {
      res.status(404).json({ error: 'Маршрут не знайдено' });
    });
    
    // Обробка помилок
    this.app.use((err, req, res, next) => {
      logger.error('❌ Помилка API:', err);
      
      const errorResponse = ErrorHandler.formatErrorResponse(err);
      res.status(errorResponse.status || 500).json(errorResponse);
    });
  }

  /**
   * Налаштування WebSocket сервера
   */
  setupWebSocket() {
    this.wss = new WebSocket.Server({
      server: this.server,
      path: config.server.ws.path
    });
    
    // Обробка нових з'єднань
    this.wss.on('connection', (ws, req) => {
      // Перевірка автентифікації
      if (config.server.api.auth.enabled) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        if (!token || token !== config.server.api.auth.token) {
          logger.warn('⚠️ Спроба неавторизованого WebSocket з\'єднання');
          ws.close(4001, 'Необхідна автентифікація');
          return;
        }
      }
      
      // Додаємо клієнта до списку підключених
      this.connectedClients.add(ws);
      
      logger.info(`🔌 Новий WebSocket клієнт підключено (всього: ${this.connectedClients.size})`);
      
      // Відправляємо початковий статус
      this.sendToClient(ws, {
        type: 'status',
        data: this.bot.getStatus()
      });
      
      // Обробка повідомлень від клієнта
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          logger.warn('⚠️ Некоректне WebSocket повідомлення:', error);
        }
      });
      
      // Обробка закриття з'єднання
      ws.on('close', () => {
        this.connectedClients.delete(ws);
        logger.info(`🔌 WebSocket клієнт відключено (залишилось: ${this.connectedClients.size})`);
      });
      
      // Обробка помилок
      ws.on('error', (error) => {
        logger.error('❌ WebSocket помилка:', error);
        this.connectedClients.delete(ws);
      });
    });
    
    // Підписуємось на події бота
    this.subscribeToEvents();
  }

  /**
   * Обробка WebSocket повідомлень
   */
  handleWebSocketMessage(ws, message) {
    const { type, data } = message;
    
    switch (type) {
      case 'ping':
        this.sendToClient(ws, { type: 'pong', timestamp: Date.now() });
        break;
        
      case 'getStatus':
        this.sendToClient(ws, {
          type: 'status',
          data: this.bot.getStatus()
        });
        break;
        
      case 'control':
        if (data.action === 'start') {
          this.bot.start()
            .then(() => {
              this.sendToClient(ws, {
                type: 'controlResponse',
                success: true,
                message: 'Бот успішно запущено'
              });
            })
            .catch(error => {
              this.sendToClient(ws, {
                type: 'controlResponse',
                success: false,
                message: `Помилка запуску бота: ${error.message}`
              });
            });
        } else if (data.action === 'stop') {
          this.bot.stop()
            .then(() => {
              this.sendToClient(ws, {
                type: 'controlResponse',
                success: true,
                message: 'Бот успішно зупинено'
              });
            })
            .catch(error => {
              this.sendToClient(ws, {
                type: 'controlResponse',
                success: false,
                message: `Помилка зупинки бота: ${error.message}`
              });
            });
        }
        break;
        
      default:
        logger.warn(`⚠️ Невідомий тип WebSocket повідомлення: ${type}`);
    }
  }

  /**
   * Підписка на події бота
   */
  subscribeToEvents() {
    // Нові лістинги
    this.bot.on('newListing', (data) => {
      this.broadcastToClients({
        type: 'newListing',
        data
      });
    });
    
    // Покупка
    this.bot.on('buyExecuted', (data) => {
      this.broadcastToClients({
        type: 'buyExecuted',
        data
      });
    });
    
    // Закриття позиції
    this.bot.on('positionClosed', (data) => {
      this.broadcastToClients({
        type: 'positionClosed',
        data
      });
    });
    
    // Помилки
    this.bot.on('error', (data) => {
      this.broadcastToClients({
        type: 'error',
        data
      });
    });
  }

  /**
   * Відправка повідомлення одному клієнту
   */
  sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Відправка повідомлення всім клієнтам
   */
  broadcastToClients(data) {
    this.connectedClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  /**
   * Запуск HTTP сервера
   */
  async startServer() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.port, this.host, (err) => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  /**
   * Зупинка сервера
   */
  async stop() {
    logger.info('⏹️ Зупинка API сервера...');
    
    // Закриваємо всі WebSocket з'єднання
    if (this.wss) {
      this.connectedClients.forEach(client => {
        client.close(1000, 'Сервер зупинено');
      });
      
      this.connectedClients.clear();
      
      this.wss.close();
      this.wss = null;
    }
    
    // Закриваємо HTTP сервер
    if (this.server) {
      return new Promise((resolve, reject) => {
        this.server.close((err) => {
          if (err) {
            logger.error('❌ Помилка зупинки сервера:', err);
            return reject(err);
          }
          
          this.server = null;
          logger.info('✅ API сервер зупинено');
          resolve();
        });
      });
    }
  }
}

module.exports = { APIServer };