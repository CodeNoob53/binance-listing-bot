// src/app.js

const config = require('./config');
const logger = require('./utils/logger');
const { WebSocketMonitor } = require('./services/monitoring/websocket');
const { PollingMonitor } = require('./services/monitoring/polling');
const { TradingService } = require('./services/trading');
const { NotificationService } = require('./services/notification');
const { DatabaseService } = require('./services/storage/database');
const { APIServer } = require('./services/server');
const { ErrorHandler } = require('./utils/errors');

/**
 * Головний клас додатку
 */
class BinanceListingBot {
  constructor() {
    this.isRunning = false;
    this.services = {};
    this.monitors = {};
  }

  /**
   * Ініціалізація всіх сервісів
   */
  async initialize() {
    try {
      logger.info('🚀 Ініціалізація Binance Listing Bot...');
      logger.info(`📍 Середовище: ${config.env}`);
      logger.info(`💵 Quote Asset: ${config.trading.quoteAsset}`);
      logger.info(`💰 Розмір ордера: ${config.trading.baseOrderSize} ${config.trading.quoteAsset}`);

      // Ініціалізація бази даних
      logger.info('🗄️ Підключення до бази даних...');
      this.services.database = new DatabaseService();
      await this.services.database.connect();

      // Ініціалізація сервісу торгівлі
      logger.info('💹 Ініціалізація торгового сервісу...');
      this.services.trading = new TradingService(this.services.database);
      await this.services.trading.initialize();

      // Ініціалізація сповіщень
      logger.info('📢 Ініціалізація сервісу сповіщень...');
      this.services.notification = new NotificationService();
      await this.services.notification.initialize();

      // Ініціалізація моніторингу
      await this.initializeMonitoring();

      // Ініціалізація API сервера (якщо увімкнено)
      if (config.server.api.enabled) {
        logger.info('🌐 Запуск API сервера...');
        this.services.apiServer = new APIServer(this);
        await this.services.apiServer.start();
      }

      // Налаштування обробників подій
      this.setupEventHandlers();

      logger.info('✅ Ініціалізація завершена успішно!');
      
      // Відправляємо сповіщення про запуск
      await this.services.notification.send('bot_started', {
        environment: config.env,
        testnet: config.binance.testnet,
        simulationMode: config.debug.simulationMode
      });

    } catch (error) {
      logger.error('❌ Помилка ініціалізації:', error);
      throw error;
    }
  }

  /**
   * Ініціалізація моніторингу (WebSocket + Polling)
   */
  async initializeMonitoring() {
    // WebSocket моніторинг (основний)
    if (config.monitoring.useWebSocket) {
      logger.info('📡 Ініціалізація WebSocket моніторингу...');
      this.monitors.websocket = new WebSocketMonitor();
      
      // Обробка подій WebSocket
      this.monitors.websocket.on('newListing', this.handleNewListing.bind(this));
      this.monitors.websocket.on('error', this.handleMonitorError.bind(this));
      this.monitors.websocket.on('reconnectFailed', this.handleWebSocketFailure.bind(this));
    }

    // Polling моніторинг (резервний)
    if (config.monitoring.pollingEnabled) {
      logger.info('🔄 Ініціалізація Polling моніторингу...');
      this.monitors.polling = new PollingMonitor();
      
      // Обробка подій Polling
      this.monitors.polling.on('newListing', this.handleNewListing.bind(this));
      this.monitors.polling.on('error', this.handleMonitorError.bind(this));
    }
  }

  /**
   * Запуск бота
   */
  async start() {
    if (this.isRunning) {
      logger.warn('⚠️ Бот вже запущено');
      return;
    }

    try {
      logger.info('▶️ Запуск бота...');
      this.isRunning = true;

      // Запускаємо WebSocket моніторинг
      if (this.monitors.websocket) {
        await this.monitors.websocket.start();
      }

      // Якщо WebSocket не доступний або як резерв - запускаємо polling
      if (this.monitors.polling && 
          (!this.monitors.websocket || !config.monitoring.useWebSocket)) {
        await this.monitors.polling.start();
      }

      logger.info('✅ Бот запущено успішно!');
      logger.info('👀 Очікування нових лістингів...\n');

    } catch (error) {
      logger.error('❌ Помилка запуску бота:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Обробка нового лістингу
   */
  async handleNewListing(listingData) {
    try {
      logger.info('🎉 Обробка нового лістингу:', listingData);

      // Зберігаємо інформацію про лістинг
      await this.services.database.saveListing(listingData);

      // Перевіряємо чи відповідає фільтрам
      if (!this.checkListingFilters(listingData)) {
        logger.info(`⏭️ Лістинг ${listingData.symbol} не відповідає фільтрам`);
        return;
      }

      // Відправляємо сповіщення про новий лістинг
      await this.services.notification.send('new_listing', listingData);

      // Якщо ввімкнено режим симуляції - лише логуємо
      if (config.debug.simulationMode) {
        logger.info(`📝 [СИМУЛЯЦІЯ] Купівля ${listingData.symbol}`);
        return;
      }

      // Виконуємо торгову операцію
      const result = await this.services.trading.executeBuy(listingData);

      if (result.success) {
        logger.info(`✅ Успішна покупка ${listingData.symbol}`);
        
        // Відправляємо сповіщення про покупку
        await this.services.notification.send('buy_executed', result);

        // Встановлюємо TP/SL
        const tpSlResult = await this.services.trading.setTakeProfitStopLoss(result);
        
        if (tpSlResult.success) {
          logger.info(`✅ TP/SL встановлено для ${listingData.symbol}`);
        }
      } else {
        logger.error(`❌ Помилка покупки ${listingData.symbol}:`, result.error);
      }

    } catch (error) {
      logger.error('❌ Помилка обробки нового лістингу:', error);
      await this.services.notification.send('error', {
        type: 'new_listing_processing',
        error: error.message,
        listing: listingData
      });
    }
  }

  /**
   * Перевірка відповідності лістингу фільтрам
   */
  checkListingFilters(listingData) {
    const filters = config.trading.filters;

    // Перевірка мінімального обсягу
    if (listingData.quoteVolume && listingData.quoteVolume < filters.minVolume24h) {
      logger.debug(`Фільтр: обсяг ${listingData.quoteVolume} < ${filters.minVolume24h}`);
      return false;
    }

    // Інші перевірки можна додати тут

    return true;
  }

  /**
   * Обробка помилки моніторингу
   */
  async handleMonitorError(error) {
    logger.error('❌ Помилка моніторингу:', error);
    
    await this.services.notification.send('error', {
      type: 'monitoring_error',
      error: error.message
    });
  }

  /**
   * Обробка відмови WebSocket
   */
  async handleWebSocketFailure() {
    logger.warn('⚠️ WebSocket моніторинг недоступний');

    // Автоматично переключаємось на polling якщо доступний
    if (this.monitors.polling && !this.monitors.polling.isRunning) {
      logger.info('🔄 Переключення на Polling моніторинг...');
      await this.monitors.polling.start();
    }

    await this.services.notification.send('warning', {
      type: 'websocket_failure',
      message: 'Переключено на резервний метод моніторингу'
    });
  }

  /**
   * Налаштування обробників системних подій
   */
  setupEventHandlers() {
    // Graceful shutdown
    const shutdownHandler = async (signal) => {
      logger.info(`\n📍 Отримано сигнал ${signal}, завершення роботи...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);

    // Обробка необроблених помилок
    process.on('unhandledRejection', (error) => {
      logger.error('❌ Необроблена помилка:', error);
      ErrorHandler.handle(error);
    });

    process.on('uncaughtException', (error) => {
      logger.error('❌ Критична помилка:', error);
      ErrorHandler.handle(error);
      process.exit(1);
    });
  }

  /**
   * Зупинка бота
   */
  async stop() {
    if (!this.isRunning) return;

    try {
      logger.info('⏹️ Зупинка бота...');

      // Зупиняємо моніторинг
      if (this.monitors.websocket) {
        await this.monitors.websocket.stop();
      }
      if (this.monitors.polling) {
        await this.monitors.polling.stop();
      }

      // Зупиняємо торговий сервіс
      if (this.services.trading) {
        await this.services.trading.stop();
      }

      // Зупиняємо API сервер
      if (this.services.apiServer) {
        await this.services.apiServer.stop();
      }

      // Закриваємо з'єднання з БД
      if (this.services.database) {
        await this.services.database.disconnect();
      }

      // Відправляємо сповіщення про зупинку
      if (this.services.notification) {
        await this.services.notification.send('bot_stopped', {
          uptime: process.uptime()
        });
      }

      this.isRunning = false;
      logger.info('✅ Бот зупинено');

    } catch (error) {
      logger.error('❌ Помилка при зупинці бота:', error);
      throw error;
    }
  }

  /**
   * Отримання статусу бота
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      uptime: process.uptime(),
      monitors: {
        websocket: this.monitors.websocket?.getStatus() || null,
        polling: this.monitors.polling?.getStatus() || null
      },
      services: {
        trading: this.services.trading?.getStatus() || null,
        database: this.services.database?.getStatus() || null,
        notification: this.services.notification?.getStatus() || null
      },
      config: {
        environment: config.env,
        testnet: config.binance.testnet,
        simulationMode: config.debug.simulationMode
      }
    };
  }
}

// Головна функція запуску
async function main() {
  const bot = new BinanceListingBot();

  try {
    await bot.initialize();
    await bot.start();
  } catch (error) {
    logger.error('❌ Критична помилка:', error);
    process.exit(1);
  }
}

// Експорт для тестування
module.exports = { BinanceListingBot };

// Запуск якщо це головний файл
if (require.main === module) {
  main();
}