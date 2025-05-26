// src/app.js (оновлений)

const config = require('./config');
const logger = require('./utils/logger');
const { WebSocketMonitor } = require('./services/monitoring/websocket');
const { PollingMonitor } = require('./services/monitoring/polling');
const { TradingService } = require('./services/trading');
const { NotificationService } = require('./services/notification');
const { DatabaseService } = require('./services/storage/database');
const { APIServer } = require('./services/server');
const { ErrorHandler } = require('./utils/errors');
const { getBinanceClientFactory } = require('./services/binance/client-factory');

/**
 * Головний клас додатку з підтримкою множинних середовищ
 */
class BinanceListingBot {
  constructor() {
    this.isRunning = false;
    this.services = {};
    this.monitors = {};
    this.clientFactory = null;
    this.currentEnvironment = null;
    this.processedListings = new Set(); // Кеш для оброблених лістингів
  }

  /**
   * Ініціалізація всіх сервісів
   */
  async initialize() {
    try {
      logger.info('🚀 Ініціалізація Binance Listing Bot...');
      
      // Ініціалізуємо фабрику клієнтів
      this.clientFactory = getBinanceClientFactory();
      
      // Встановлюємо початкове середовище (testnet або mainnet)
      const initialEnvironment = config.binance.useTestnet ? 'testnet' : 'mainnet';
      await this.clientFactory.switchEnvironment(initialEnvironment);
      
      // Оновлюємо поточне середовище
      this.currentEnvironment = this.clientFactory.environmentManager.getCurrentEnvironment();
      
      // Ініціалізуємо базу даних
      await this.initializeDatabase();
      
      // Ініціалізуємо торговий сервіс
      await this.initializeTradingService();
      
      // Ініціалізуємо сервіс сповіщень
      await this.initializeNotificationService();
      
      // Ініціалізуємо моніторинг
      await this.initializeMonitoring();
      
      logger.info('✅ Ініціалізація завершена успішно!');
      
    } catch (error) {
      logger.error('❌ Помилка ініціалізації:', error);
      throw error;
    }
  }

  /**
   * Ініціалізація бази даних
   */
  async initializeDatabase() {
    logger.info('🗄️ Підключення до бази даних...');
    this.services.database = new DatabaseService();
    await this.services.database.connect();
  }

  /**
   * Ініціалізація торгового сервісу
   */
  async initializeTradingService() {
    logger.info('💹 Ініціалізація торгового сервісу...');
    this.services.trading = new TradingService(this.services.database);
    await this.services.trading.initialize();
  }

  /**
   * Ініціалізація сервісу сповіщень
   */
  async initializeNotificationService() {
    logger.info('📢 Ініціалізація сервісу сповіщень...');
    this.services.notification = new NotificationService();
    await this.services.notification.initialize();
  }

  /**
   * Ініціалізація моніторингу (WebSocket або Polling)
   */
  async initializeMonitoring() {
    // Використовуємо WebSocket якщо він увімкнений
    if (config.monitoring.useWebSocket && process.env.USE_WEBSOCKET === 'true') {
      logger.info('📡 Ініціалізація WebSocket моніторингу...');
      this.monitors.websocket = new WebSocketMonitor();
      
      // Обробка подій WebSocket
      this.monitors.websocket.on('newListing', this.handleNewListing.bind(this));
      this.monitors.websocket.on('error', this.handleMonitorError.bind(this));
      this.monitors.websocket.on('reconnectFailed', this.handleWebSocketFailure.bind(this));
    } 
    // Інакше використовуємо Polling
    else if (config.monitoring.pollingEnabled && process.env.USE_POLLING === 'true') {
      logger.info('🔄 Ініціалізація Polling моніторингу...');
      this.monitors.polling = new PollingMonitor();
      
      // Обробка подій Polling
      this.monitors.polling.on('newListing', this.handleNewListing.bind(this));
      this.monitors.polling.on('error', this.handleMonitorError.bind(this));
    } else {
      logger.warn('⚠️ Жоден метод моніторингу не увімкнено. Перевірте налаштування USE_WEBSOCKET та USE_POLLING');
    }
  }

  /**
   * Виведення статусу бота
   */
  logBotStatus() {
    const status = {
      environment: this.currentEnvironment.displayName,
      isRunning: this.isRunning,
      activePositions: this.services.trading?.activePositions?.size || 0,
      processedListings: this.processedListings.size,
      lastCheckTime: this.monitors.polling?.lastCheckTime ? new Date(this.monitors.polling.lastCheckTime).toLocaleTimeString() : 'N/A',
      monitoringMode: this.monitors.websocket ? 'WebSocket' : 'Polling',
      simulationMode: config.debug.simulationMode ? 'Enabled' : 'Disabled'
    };

    logger.info('🤖 Статус бота:', status);
  }

  /**
   * Запуск періодичного виведення статусу
   */
  startStatusUpdates() {
    setInterval(() => {
      if (this.isRunning) {
        this.logBotStatus();
      }
    }, 30000); // Кожні 30 секунд
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

      // Запускаємо періодичне оновлення статусу
      this.startStatusUpdates();

      // Запускаємо моніторинг
      if (this.monitors.websocket) {
        logger.info('🔌 Запуск WebSocket моніторингу...');
        await this.monitors.websocket.start();
      } else if (this.monitors.polling) {
        logger.info('🔄 Запуск Polling моніторингу...');
        await this.monitors.polling.start();
      }

      // Запускаємо торговий сервіс
      if (this.services.trading) {
        await this.services.trading.start();
      }

      logger.info('✅ Бот запущено успішно!');
      this.logBotStatus();

    } catch (error) {
      logger.error('❌ Помилка запуску бота:', error);
      this.isRunning = false;
      throw error;
    }
  }

  /**
   * Перемикання середовища під час роботи
   */
  async switchEnvironment(environmentName) {
    try {
      logger.info(`🔄 Перемикання бота на середовище ${environmentName}...`);
      
      const wasRunning = this.isRunning;
      
      // Тимчасово зупиняємо бота
      if (this.isRunning) {
        await this.pause();
      }
      
      // Перемикаємо торговий сервіс
      await this.services.trading.switchEnvironment(environmentName);
      
      // Оновлюємо поточне середовище
      this.currentEnvironment = this.clientFactory.environmentManager.getCurrentEnvironment();
      
      // Логуємо нову інформацію про середовище
      this.logEnvironmentInfo();
      
      // Відновлюємо роботу якщо було запущено
      if (wasRunning) {
        await this.resume();
      }
      
      // Відправляємо сповіщення
      await this.services.notification.send('environment_switched', {
        newEnvironment: this.currentEnvironment.name,
        displayName: this.currentEnvironment.displayName,
        features: this.currentEnvironment.features
      });
      
      logger.info(`✅ Бот успішно перемкнуто на ${this.currentEnvironment.displayName}`);
      
    } catch (error) {
      logger.error(`❌ Помилка перемикання на ${environmentName}:`, error);
      throw error;
    }
  }

  /**
   * Пауза бота
   */
  async pause() {
    logger.info('⏸️ Пауза бота...');
    this.isRunning = false;
    
    // Зупиняємо моніторинг
    if (this.monitors.websocket) {
      await this.monitors.websocket.stop();
    }
    if (this.monitors.polling) {
      await this.monitors.polling.stop();
    }
    
    // Призупиняємо торговий сервіс
    if (this.services.trading) {
      await this.services.trading.pause();
    }
  }

  /**
   * Відновлення роботи бота
   */
  async resume() {
    logger.info('▶️ Відновлення роботи бота...');
    this.isRunning = true;
    
    // Відновлюємо торговий сервіс
    if (this.services.trading) {
      await this.services.trading.resume();
    }
    
    // Запускаємо WebSocket моніторинг якщо він увімкнено
    if (config.monitoring.useWebSocket && process.env.USE_WEBSOCKET === 'true' && this.monitors.websocket) {
      await this.monitors.websocket.start();
    } 
    // Інакше запускаємо polling як резервний варіант
    else if (config.monitoring.pollingEnabled && this.monitors.polling) {
      await this.monitors.polling.start();
    }
  }

  /**
   * Обробка нового лістингу з урахуванням середовища
   */
  async handleNewListing(listingData) {
    try {
      // Перевіряємо чи вже обробляли цей лістинг
      const listingKey = `${listingData.symbol}_${listingData.detectedAt || new Date().toISOString()}`;
      if (this.processedListings.has(listingKey)) {
        logger.debug(`⏭️ Пропускаємо повторний лістинг ${listingData.symbol} (вже оброблено)`);
        return;
      }

      // Додаємо в кеш оброблених
      this.processedListings.add(listingKey);
      
      // Очищаємо старий кеш кожні 1000 записів
      if (this.processedListings.size > 1000) {
        logger.debug(`🧹 Очищення кешу оброблених лістингів (розмір: ${this.processedListings.size})`);
        this.processedListings.clear();
      }

      // Перевіряємо чи вже є активна позиція для цього символу
      const existingPosition = await this.services.database.getPositionBySymbol(listingData.symbol);
      if (existingPosition) {
        logger.info(`ℹ️ Символ ${listingData.symbol} вже має активну позицію (статус: ${existingPosition.status})`);
        return;
      }

      logger.info(`🎉 Обробка нового лістингу в ${this.currentEnvironment.displayName}:`, listingData);

      // Додаємо інформацію про середовище до даних лістингу
      const enrichedListingData = {
        ...listingData,
        environment: this.currentEnvironment.name,
        detectedAt: new Date().toISOString(),
        timestamp: new Date().toISOString()
      };

      // Зберігаємо інформацію про лістинг
      const savedListing = await this.services.database.saveListing(enrichedListingData);
      
      // Якщо лістинг вже існує, пропускаємо обробку
      if (!savedListing) {
        logger.debug(`⏭️ Пропускаємо лістинг ${listingData.symbol} (вже існує в базі даних)`);
        return;
      }

      // Перевіряємо чи відповідає фільтрам
      if (!this.checkListingFilters(enrichedListingData)) {
        logger.info(`⏭️ Лістинг ${listingData.symbol} не відповідає фільтрам`);
        return;
      }

      // Відправляємо сповіщення про новий лістинг
      await this.services.notification.send('new_listing', {
        ...enrichedListingData,
        environment: this.currentEnvironment.displayName
      });

      // Спеціальна логіка для різних середовищ
      if (this.currentEnvironment.name === 'testnet') {
        await this.handleTestnetListing(enrichedListingData);
      } else if (this.currentEnvironment.name === 'mainnet') {
        await this.handleMainnetListing(enrichedListingData);
      }

      // Оновлюємо статус після обробки лістингу
      this.logBotStatus();

    } catch (error) {
      logger.error('❌ Помилка обробки нового лістингу:', error);
      await this.services.notification.send('error', {
        type: 'new_listing_processing',
        environment: this.currentEnvironment?.name || 'unknown',
        error: error.message,
        listing: listingData
      });
    }
  }

  /**
   * Обробка лістингу в testnet середовищі
   */
  async handleTestnetListing(listingData) {
    logger.info(`🧪 Обробка testnet лістингу ${listingData.symbol}`);
    
    // На testnet можемо бути більш агресивними в тестуванні
    if (config.debug.simulationMode) {
      logger.info(`📝 [TESTNET SIMULATION] Купівля ${listingData.symbol}`);
      return;
    }

    // Виконуємо торгову операцію
    const result = await this.services.trading.executeBuy(listingData);

    if (result.success) {
      logger.info(`✅ Testnet покупка ${listingData.symbol} успішна`);
      
      // Відправляємо сповіщення про покупку
      await this.services.notification.send('buy_executed', {
        ...result,
        environment: 'Testnet'
      });

      // Встановлюємо TP/SL
      const tpSlResult = await this.services.trading.setTakeProfitStopLoss(result);
      
      if (tpSlResult.success) {
        logger.info(`✅ TP/SL встановлено для ${listingData.symbol} в testnet`);
      }
    } else {
      logger.error(`❌ Помилка testnet покупки ${listingData.symbol}:`, result.error);
    }
  }

  /**
   * Обробка лістингу в mainnet середовищі
   */
  async handleMainnetListing(listingData) {
    logger.warn(`💰 Обробка MAINNET лістингу ${listingData.symbol} - РЕАЛЬНІ ГРОШІ!`);
    
    // Додаткові перевірки безпеки для mainnet
    const safetyChecks = await this.performMainnetSafetyChecks(listingData);
    
    if (!safetyChecks.passed) {
      logger.warn(`⚠️ Mainnet лістинг ${listingData.symbol} заблоковано системою безпеки:`, safetyChecks.reasons);
      return;
    }

    // Якщо ввімкнено режим симуляції навіть на mainnet
    if (config.debug.simulationMode) {
      logger.warn(`📝 [MAINNET SIMULATION] Купівля ${listingData.symbol} - симуляція на mainnet`);
      return;
    }

    // Виконуємо торгову операцію з підвищеним рівнем обережності
    const result = await this.services.trading.executeBuy(listingData);

    if (result.success) {
      logger.info(`✅ MAINNET покупка ${listingData.symbol} успішна - РЕАЛЬНІ КОШТИ ВИКОРИСТАНО!`);
      
      // Відправляємо сповіщення про покупку
      await this.services.notification.send('buy_executed', {
        ...result,
        environment: 'Mainnet (PRODUCTION)',
        warning: 'Реальні кошти використано!'
      });

      // Встановлюємо TP/SL
      const tpSlResult = await this.services.trading.setTakeProfitStopLoss(result);
      
      if (tpSlResult.success) {
        logger.info(`✅ TP/SL встановлено для ${listingData.symbol} в mainnet`);
      }
    } else {
      logger.error(`❌ Помилка MAINNET покупки ${listingData.symbol}:`, result.error);
    }
  }

  /**
   * Перевірки безпеки для mainnet
   */
  async performMainnetSafetyChecks(listingData) {
    const checks = {
      passed: true,
      reasons: []
    };

    // Перевірка часу (наприклад, не торгуємо вночі)
    const hour = new Date().getHours();
    if (config.isProduction && (hour < 6 || hour > 22)) {
      checks.passed = false;
      checks.reasons.push('Торгівля поза робочими годинами');
    }

    // Перевірка обсягу
    if (listingData.quoteVolume < config.trading.filters.minVolume24h * 3) {
      checks.passed = false;
      checks.reasons.push('Недостатній обсяг для mainnet');
    }

    // Перевірка на вихідні (опціонально)
    const isWeekend = [0, 6].includes(new Date().getDay());
    if (config.isProduction && isWeekend) {
      checks.passed = false;
      checks.reasons.push('Торгівля у вихідні дні заборонена');
    }

    return checks;
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

    // Додаткові фільтри для mainnet
    if (this.currentEnvironment.name === 'mainnet') {
      // Більш строгі фільтри для реальних грошей
      if (listingData.quoteVolume && listingData.quoteVolume < filters.minVolume24h * 2) {
        logger.debug(`Mainnet фільтр: обсяг ${listingData.quoteVolume} < ${filters.minVolume24h * 2} (подвійний мінімум)`);
        return false;
      }
    }

    return true;
  }

  /**
   * Обробка помилки моніторингу
   */
  async handleMonitorError(error) {
    logger.error('❌ Помилка моніторингу:', error);
    
    // Безпечна обробка помилки, якщо середовище не встановлено
    const environmentName = this.currentEnvironment?.name || 'unknown';
    
    await this.services.notification.send('error', {
      type: 'monitoring_error',
      environment: environmentName,
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
      environment: this.currentEnvironment.name,
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

    // Обробник зміни середовища
    if (this.services.trading) {
      this.services.trading.on('environmentChanged', (data) => {
        logger.info(`🔄 Торговий сервіс перемкнуто на ${data.environment}`);
        this.currentEnvironment = this.clientFactory.environmentManager.getCurrentEnvironment();
      });
    }
  }

  /**
   * Генерація повного звіту про стан бота
   */
  generateBotReport() {
    const tradingReport = this.services.trading?.generateEnvironmentReport();
    const clientStats = this.clientFactory?.getClientStatistics();
    
    return {
      timestamp: new Date().toISOString(),
      version: '3.0.0',
      environment: {
        current: this.currentEnvironment,
        factory: this.clientFactory?.exportConfiguration()
      },
      status: {
        isRunning: this.isRunning,
        uptime: process.uptime(),
        monitors: {
          websocket: this.monitors.websocket?.getStatus() || null,
          polling: this.monitors.polling?.getStatus() || null
        }
      },
      services: {
        trading: tradingReport,
        database: this.services.database?.getStatus() || null,
        notification: this.services.notification?.getStatus() || null
      },
      configuration: {
        simulationMode: config.debug.simulationMode,
        maxPositions: config.trading.maxPositions,
        baseOrderSize: config.trading.baseOrderSize,
        filters: config.trading.filters
      },
      clientStatistics: clientStats
    };
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

      // Безпечне завершення фабрики клієнтів
      if (this.clientFactory) {
        await this.clientFactory.shutdown();
      }

      // Закриваємо з'єднання з БД
      if (this.services.database) {
        await this.services.database.disconnect();
      }

      // Генеруємо фінальний звіт
      const finalReport = this.generateBotReport();
      logger.info('📊 Фінальний звіт бота:', finalReport);

      // Відправляємо сповіщення про зупинку
      if (this.services.notification) {
        await this.services.notification.send('bot_stopped', {
          uptime: process.uptime(),
          environment: this.currentEnvironment?.name || 'unknown',
          finalReport
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
    return this.generateBotReport();
  }

  /**
   * Логування інформації про середовище
   */
  logEnvironmentInfo() {
    const envInfo = [
      '🌍 ======================== ІНФОРМАЦІЯ ПРО СЕРЕДОВИЩЕ ======================== 🌍',
      `🏷️  Назва: ${this.currentEnvironment.displayName}`,
      `🔧 Внутрішня назва: ${this.currentEnvironment.name}`,
      `🌐 REST API: ${this.currentEnvironment.config.baseURL}`,
      `📡 WebSocket: ${this.currentEnvironment.config.wsBaseURL}`,
      `💰 Реальні гроші: ${this.currentEnvironment.features.realTrading ? 'ТАК' : 'НІ'}`,
      `🧪 Тестові дані: ${this.currentEnvironment.features.virtualMoney ? 'ТАК' : 'НІ'}`,
      `📊 API ключі: ${this.currentEnvironment.hasApiKeys ? 'Налаштовані' : 'Відсутні'}`,
      `🎚️  Максимальна вартість ордера: $${this.currentEnvironment.features.orderLimits.maxOrderValue.toLocaleString()}`,
      `📈 Максимальна кількість позицій: ${this.currentEnvironment.features.orderLimits.maxPositions}`,
      `💵 Quote Asset: ${config.trading.quoteAsset}`,
      `💰 Розмір ордера: ${config.trading.baseOrderSize} ${config.trading.quoteAsset}`,
      `🎯 Take Profit: ${(config.trading.defaultTP * 100).toFixed(1)}%`,
      `🛑 Stop Loss: ${(config.trading.defaultSL * 100).toFixed(1)}%`,
      '🌍 ========================================================================== 🌍'
    ];
    
    envInfo.forEach(line => logger.info(line));
    
    // Додаткові попередження
    if (this.currentEnvironment.features.realTrading && !config.debug.simulationMode) {
      logger.warn('⚠️ УВАГА: Торгівля реальними коштами увімкнена!');
    }
    
    if (config.debug.simulationMode) {
      logger.info('🧪 Режим симуляції увімкнено - ордери не будуть реальними');
    }
    
    // Показуємо рекомендації
    const recommendations = this.clientFactory.environmentManager.getSetupRecommendations();
    if (recommendations.length > 0) {
      logger.info('💡 Рекомендації:');
      recommendations.forEach(rec => {
        const icon = rec.type === 'warning' ? '⚠️' : rec.type === 'security' ? '🔒' : 'ℹ️';
        logger.info(`  ${icon} ${rec.message}`);
        if (rec.action) {
          logger.info(`    → ${rec.action}`);
        }
      });
    }
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