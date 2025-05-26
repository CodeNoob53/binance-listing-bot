// src/services/trading/index.js (оновлений)

const EventEmitter = require('events');
const config = require('../../config');
const logger = require('../../utils/logger');
const { getBinanceClientFactory } = require('../binance/client-factory');
const { OrderManager } = require('../binance/orders');
const { PositionCalculator } = require('./calculator');
const { RiskManager } = require('./risk');
const constants = require('../../config/constants');

/**
 * Оновлений торговий сервіс з підтримкою різних середовищ
 */
class TradingService extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    
    // Ініціалізуємо фабрику клієнтів
    this.clientFactory = getBinanceClientFactory();
    this.binanceClient = null;
    this.orderManager = null;
    
    this.calculator = new PositionCalculator();
    this.riskManager = new RiskManager();
    
    this.isActive = false;
    this.activePositions = new Map();
    this.accountInfo = null;
    this.lastBalanceUpdate = 0;
    
    // Налаштування специфічні для середовища
    this.environmentSettings = {
      testnet: {
        maxSimultaneousPositions: 10,
        allowRiskyOperations: true,
        detailedLogging: true
      },
      mainnet: {
        maxSimultaneousPositions: config.trading.maxPositions,
        allowRiskyOperations: false,
        detailedLogging: false
      }
    };
  }

  /**
   * Ініціалізація сервісу
   */
  async initialize() {
    try {
      logger.info('💹 Ініціалізація торгового сервісу...');
      
      // Ініціалізуємо клієнт для поточного середовища
      await this.initializeBinanceClient();
      
      // Отримуємо інформацію про акаунт
      await this.updateAccountInfo();
      
      // Завантажуємо активні позиції з БД
      await this.loadActivePositions();
      
      // Запускаємо моніторинг позицій
      this.startPositionMonitoring();
      
      this.isActive = true;
      
      // Логуємо інформацію про середовище
      const envInfo = this.clientFactory.environmentManager.getEnvironmentInfo();
      logger.info('✅ Торговий сервіс ініціалізовано', {
        environment: envInfo.name,
        features: envInfo.features,
        hasApiKeys: envInfo.hasApiKeys
      });
      
    } catch (error) {
      logger.error('❌ Помилка ініціалізації торгового сервісу:', error);
      throw error;
    }
  }

  /**
   * Ініціалізація Binance клієнта
   */
  async initializeBinanceClient() {
    try {
      // Створюємо клієнт для поточного середовища
      this.binanceClient = this.clientFactory.getCurrentClient();
      this.orderManager = new OrderManager(this.binanceClient);
      
      // Валідуємо клієнт
      if (this.binanceClient.isTestnet && this.binanceClient.validateTestEnvironment) {
        const validation = await this.binanceClient.validateTestEnvironment();
        if (!validation.isValid) {
          throw new Error(`Testnet валідація провалена: ${validation.checks.filter(c => c.status === 'failed').map(c => c.details).join(', ')}`);
        }
      } else if (this.binanceClient.isMainnet && this.binanceClient.healthCheck) {
        const health = await this.binanceClient.healthCheck();
        if (health.overall === 'critical') {
          throw new Error(`Mainnet health check провалений: ${health.checks.filter(c => c.status === 'critical').map(c => c.details).join(', ')}`);
        }
      }
      
      logger.info(`🔗 Binance клієнт підключено: ${this.binanceClient.environment}`);
      
    } catch (error) {
      logger.error('❌ Помилка ініціалізації Binance клієнта:', error);
      throw error;
    }
  }

  /**
   * Перемикання середовища
   */
  async switchEnvironment(environmentName) {
    try {
      logger.info(`🔄 Перемикання торгового сервісу на ${environmentName}...`);
      
      // Зупиняємо поточні операції
      const wasActive = this.isActive;
      if (this.isActive) {
        await this.pause();
      }
      
      // Перемикаємо клієнт
      this.binanceClient = await this.clientFactory.switchEnvironment(environmentName);
      this.orderManager = new OrderManager(this.binanceClient);
      
      // Оновлюємо налаштування для нового середовища
      this.updateEnvironmentSettings();
      
      // Оновлюємо інформацію про акаунт
      await this.updateAccountInfo();
      
      // Відновлюємо роботу якщо було активно
      if (wasActive) {
        await this.resume();
      }
      
      logger.info(`✅ Торговий сервіс перемкнуто на ${environmentName}`);
      
      this.emit('environmentChanged', {
        environment: environmentName,
        client: this.binanceClient
      });
      
    } catch (error) {
      logger.error(`❌ Помилка перемикання на ${environmentName}:`, error);
      throw error;
    }
  }

  /**
   * Оновлення налаштувань для поточного середовища
   */
  updateEnvironmentSettings() {
    const currentEnv = this.binanceClient.environment;
    const settings = this.environmentSettings[currentEnv] || this.environmentSettings.mainnet;
    
    // Застосовуємо налаштування
    this.maxPositions = settings.maxSimultaneousPositions;
    this.allowRiskyOperations = settings.allowRiskyOperations;
    this.detailedLogging = settings.detailedLogging;
    
    logger.debug(`⚙️ Застосовано налаштування для ${currentEnv}:`, settings);
  }

  /**
   * Оновлення інформації про акаунт з урахуванням середовища
   */
  async updateAccountInfo() {
    try {
      this.accountInfo = await this.binanceClient.getAccountInfo();
      this.lastBalanceUpdate = Date.now();
      
      // Логування з урахуванням середовища
      if (this.detailedLogging || this.binanceClient.isTestnet) {
        const balances = this.accountInfo.balances
          .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
          .map(b => `${b.asset}: ${b.free} (locked: ${b.locked})`);
        
        logger.info('💰 Баланси:', balances);
      }
      
      // Для testnet показуємо віртуальний баланс якщо доступний
      if (this.binanceClient.isTestnet && this.binanceClient.virtualBalance) {
        logger.info('🧪 Віртуальний баланс:', Object.fromEntries(this.binanceClient.virtualBalance));
      }
      
      // Для mainnet перевіряємо безпеку
      if (this.binanceClient.isMainnet && this.binanceClient.validateAccountSafety) {
        this.binanceClient.validateAccountSafety(this.accountInfo);
      }
      
    } catch (error) {
      logger.error('❌ Помилка оновлення інформації акаунта:', error);
      throw error;
    }
  }

  /**
   * Виконання покупки з урахуванням середовища
   */
  async executeBuy(listingData) {
    const timer = logger.startTimer();
    const { symbol } = listingData;
    
    try {
      logger.trade(`🛒 Початок покупки ${symbol} в ${this.binanceClient.environment}`, { 
        listingData,
        environment: this.binanceClient.environment
      });
      
      // Перевіряємо чи вже маємо позицію
      if (this.activePositions.has(symbol)) {
        logger.warn(`⚠️ Позиція для ${symbol} вже існує`);
        return { success: false, error: 'Position already exists' };
      }
      
      // Перевіряємо ліміт позицій з урахуванням середовища
      if (this.activePositions.size >= this.maxPositions) {
        logger.warn(`⚠️ Досягнуто ліміт позицій: ${this.maxPositions} для ${this.binanceClient.environment}`);
        return { success: false, error: 'Max positions limit reached' };
      }
      
      // Додаткові перевірки для mainnet
      if (this.binanceClient.isMainnet && !this.allowRiskyOperations) {
        const riskAssessment = await this.assessTradeRisk(listingData);
        if (riskAssessment.risk === 'high') {
          logger.warn(`⚠️ Високий ризик торгівлі ${symbol} на mainnet:`, riskAssessment.reasons);
          return { success: false, error: 'High risk trade blocked on mainnet' };
        }
      }
      
      // Оновлюємо баланс якщо потрібно
      if (Date.now() - this.lastBalanceUpdate > 60000) {
        await this.updateAccountInfo();
      }
      
      // Отримуємо інформацію про символ
      const symbolInfo = await this.binanceClient.getSymbolInfo(symbol);
      if (!symbolInfo) {
        throw new Error(`Symbol info not found for ${symbol}`);
      }
      
      // Розраховуємо розмір ордера з урахуванням середовища
      const availableBalance = this.getAvailableBalance();
      const orderSize = this.calculateOrderSizeForEnvironment(availableBalance);
      
      if (orderSize < config.trading.baseOrderSize) {
        logger.warn(`⚠️ Недостатньо коштів. Доступно: ${availableBalance}, Потрібно: ${config.trading.baseOrderSize}`);
        return { success: false, error: 'Insufficient balance' };
      }
      
      // Отримуємо поточну ціну
      const currentPrice = listingData.price || await this.binanceClient.getCurrentPrice(symbol);
      
      // Розраховуємо кількість для покупки
      const quantity = this.calculator.calculateQuantity(
        orderSize,
        currentPrice,
        symbolInfo
      );
      
      if (!quantity || quantity <= 0) {
        throw new Error('Invalid quantity calculated');
      }
      
      // Виконуємо ринковий ордер
      logger.trade(`📈 Виконання ринкового ордера: ${quantity} ${symbol} @ ~${currentPrice}`);
      
      const orderResult = await this.orderManager.placeMarketBuyOrder(symbol, quantity);
      
      if (!orderResult.success) {
        throw new Error(orderResult.error || 'Order placement failed');
      }
      
      // Зберігаємо позицію
      const position = {
        symbol,
        orderId: orderResult.orderId,
        quantity: orderResult.executedQty,
        entryPrice: orderResult.avgPrice,
        entryTime: new Date(),
        status: constants.POSITION_STATUS.OPEN,
        side: constants.ORDER_SIDES.BUY,
        environment: this.binanceClient.environment,
        ...listingData
      };
      
      await this.database.savePosition(position);
      this.activePositions.set(symbol, position);
      
      timer.done(`✅ Покупка ${symbol} виконана успішно в ${this.binanceClient.environment}`, {
        symbol,
        quantity: orderResult.executedQty,
        avgPrice: orderResult.avgPrice,
        cost: orderResult.executedQty * orderResult.avgPrice,
        environment: this.binanceClient.environment,
        isSimulated: orderResult.isSimulated
      });
      
      this.emit('buyExecuted', {
        ...position,
        environment: this.binanceClient.environment
      });
      
      return {
        success: true,
        position,
        order: orderResult
      };
      
    } catch (error) {
      logger.error(`❌ Помилка покупки ${symbol} в ${this.binanceClient.environment}:`, error);
      
      await this.database.saveError({
        type: 'BUY_ORDER_ERROR',
        symbol,
        environment: this.binanceClient.environment,
        error: error.message,
        data: listingData
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Розрахунок розміру ордера з урахуванням середовища
   */
  calculateOrderSizeForEnvironment(availableBalance) {
    let baseSize = this.riskManager.calculateOrderSize(
      availableBalance,
      this.activePositions.size
    );
    
    // Коригуємо розмір для різних середовищ
    if (this.binanceClient.isTestnet) {
      // На testnet можемо дозволити більші ордери для тестування
      baseSize = Math.min(baseSize * 2, availableBalance * 0.5);
    } else if (this.binanceClient.isMainnet) {
      // На mainnet більш консервативний підхід
      baseSize = Math.min(baseSize, config.trading.maxOrderSize * 0.8);
    }
    
    return baseSize;
  }

  /**
   * Оцінка ризику торгівлі
   */
  async assessTradeRisk(listingData) {
    const risks = [];
    let riskLevel = 'low';
    
    // Перевірка обсягу
    if (listingData.quoteVolume < config.trading.filters.minVolume24h * 2) {
      risks.push('Низький обсяг торгів');
      riskLevel = 'medium';
    }
    
    // Перевірка волатильності
    if (Math.abs(listingData.priceChangePercent) > 50) {
      risks.push('Висока волатільність');
      riskLevel = 'high';
    }
    
    // Перевірка часу лістингу
    const listingAge = Date.now() - listingData.timestamp;
    if (listingAge > 300000) { // 5 хвилин
      risks.push('Старий лістинг');
      riskLevel = 'medium';
    }
    
    return {
      risk: riskLevel,
      reasons: risks,
      score: risks.length
    };
  }

  /**
   * Пауза торгового сервісу
   */
  async pause() {
    logger.info('⏸️ Пауза торгового сервісу...');
    this.isActive = false;
    
    if (this.positionMonitorInterval) {
      clearInterval(this.positionMonitorInterval);
      this.positionMonitorInterval = null;
    }
  }

  /**
   * Відновлення торгового сервісу
   */
  async resume() {
    logger.info('▶️ Відновлення торгового сервісу...');
    this.isActive = true;
    this.startPositionMonitoring();
  }

  /**
   * Отримання статусу з урахуванням середовища
   */
  getStatus() {
    const baseStatus = {
      isActive: this.isActive,
      activePositions: this.activePositions.size,
      balance: this.getAvailableBalance(),
      lastUpdate: this.lastBalanceUpdate,
      environment: this.binanceClient?.environment || 'unknown',
      maxPositions: this.maxPositions,
      positions: Array.from(this.activePositions.values()).map(p => ({
        symbol: p.symbol,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        status: p.status,
        environment: p.environment
      }))
    };

    // Додаємо специфічну інформацію для середовища
    if (this.binanceClient?.isTestnet) {
      baseStatus.testnetFeatures = this.binanceClient.testFeatures;
      if (this.binanceClient.virtualBalance) {
        baseStatus.virtualBalance = Object.fromEntries(this.binanceClient.virtualBalance);
      }
    }

    if (this.binanceClient?.isMainnet) {
      baseStatus.safetyFeatures = this.binanceClient.safetyFeatures;
      baseStatus.dailyStats = this.binanceClient.dailyStats;
    }

    return baseStatus;
  }

  /**
   * Генерація звіту середовища
   */
  generateEnvironmentReport() {
    const clientStats = this.clientFactory.getClientStatistics();
    const envInfo = this.clientFactory.environmentManager.getEnvironmentInfo();
    
    const report = {
      timestamp: new Date().toISOString(),
      currentEnvironment: envInfo,
      clientStatistics: clientStats,
      tradingService: this.getStatus(),
      recommendations: this.clientFactory.environmentManager.getSetupRecommendations()
    };

    // Додаємо специфічну інформацію
    if (this.binanceClient?.isMainnet && this.binanceClient.generateSecurityReport) {
      report.securityReport = this.binanceClient.generateSecurityReport();
    }

    if (this.binanceClient?.isTestnet && this.binanceClient.exportTestData) {
      report.testData = this.binanceClient.exportTestData();
    }

    return report;
  }

  /**
   * Зупинка сервісу з урахуванням середовища
   */
  async stop() {
    logger.info('⏹️ Зупинка торгового сервісу...');
    
    this.isActive = false;
    
    if (this.positionMonitorInterval) {
      clearInterval(this.positionMonitorInterval);
    }
    
    // Безпечне завершення клієнта
    if (this.binanceClient?.safeShutdown) {
      await this.binanceClient.safeShutdown();
    }
    
    // Генеруємо фінальний звіт
    const finalReport = this.generateEnvironmentReport();
    logger.info('📊 Фінальний звіт торгового сервісу:', finalReport);
    
    logger.info('✅ Торговий сервіс зупинено');
  }

  // Решта методів залишаються без змін, тільки додаємо логування середовища де потрібно
  
  /**
   * Завантаження активних позицій
   */
  async loadActivePositions() {
    try {
      const positions = await this.database.getActivePositions();
      
      for (const position of positions) {
        this.activePositions.set(position.symbol, position);
      }
      
      logger.info(`📊 Завантажено ${this.activePositions.size} активних позицій для ${this.binanceClient.environment}`);
      
    } catch (error) {
      logger.error('❌ Помилка завантаження позицій:', error);
    }
  }

  /**
   * Отримання доступного балансу
   */
  getAvailableBalance(asset = config.trading.quoteAsset) {
    if (!this.accountInfo) return 0;
    
    const balance = this.accountInfo.balances.find(b => b.asset === asset);
    return balance ? parseFloat(balance.free) : 0;
  }

  /**
   * Встановлення Take Profit та Stop Loss
   */
  async setTakeProfitStopLoss(buyResult) {
    const { position } = buyResult;
    const { symbol, quantity, entryPrice } = position;
    
    try {
      logger.trade(`⚙️ Встановлення TP/SL для ${symbol} в ${this.binanceClient.environment}`);
      
      // Розраховуємо ціни TP та SL
      const prices = this.calculator.calculateTPSL(
        entryPrice,
        config.trading.defaultTP,
        config.trading.defaultSL
      );
      
      let result;
      
      // Спробуємо створити OCO ордер
      if (config.trading.useOCO) {
        result = await this.orderManager.placeOCOOrder(
          symbol,
          quantity,
          prices.takeProfit,
          prices.stopLoss
        );
      }
      
      // Якщо OCO не вдалося або не підтримується - створюємо окремі ордери
      if (!result || !result.success) {
        logger.warn('⚠️ OCO ордер не вдався, створюємо окремі ордери');
        
        const [tpResult, slResult] = await Promise.all([
          this.orderManager.placeLimitSellOrder(symbol, quantity, prices.takeProfit),
          this.orderManager.placeStopLossOrder(symbol, quantity, prices.stopLoss)
        ]);
        
        result = {
          success: tpResult.success && slResult.success,
          tpOrder: tpResult,
          slOrder: slResult
        };
      }
      
      // Оновлюємо позицію з інформацією про TP/SL
      position.takeProfitPrice = prices.takeProfit;
      position.stopLossPrice = prices.stopLoss;
      position.tpOrderId = result.tpOrder?.orderId || result.orders?.[0]?.orderId;
      position.slOrderId = result.slOrder?.orderId || result.orders?.[1]?.orderId;
      
      await this.database.updatePosition(position);
      
      logger.trade(`✅ TP/SL встановлено для ${symbol} в ${this.binanceClient.environment}`, {
        takeProfit: prices.takeProfit,
        stopLoss: prices.stopLoss
      });
      
      this.emit('tpSlSet', position);
      
      return {
        success: true,
        position,
        tpSlResult: result
      };
      
    } catch (error) {
      logger.error(`❌ Помилка встановлення TP/SL для ${symbol}:`, error);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Моніторинг активних позицій
   */
  startPositionMonitoring() {
    this.positionMonitorInterval = setInterval(async () => {
      if (!this.isActive || this.activePositions.size === 0) return;
      
      try {
        await this.checkPositions();
      } catch (error) {
        logger.error('❌ Помилка моніторингу позицій:', error);
      }
    }, constants.DELAYS.POSITION_UPDATE);
  }

  /**
   * Перевірка статусу позицій
   */
  async checkPositions() {
    const positions = Array.from(this.activePositions.values());
    
    for (const position of positions) {
      try {
        // Отримуємо поточну ціну
        const currentPrice = await this.binanceClient.getCurrentPrice(position.symbol);
        position.currentPrice = currentPrice;
        
        // Розраховуємо P&L
        const pnl = this.calculator.calculatePnL(
          position.entryPrice,
          currentPrice,
          position.quantity
        );
        
        position.pnl = pnl.amount;
        position.pnlPercent = pnl.percentage;
        
        // Оновлюємо статус позиції
        const newStatus = this.determinePositionStatus(pnl.percentage);
        if (newStatus !== position.status) {
          position.status = newStatus;
          await this.database.updatePosition(position);
        }
        
        // Перевіряємо статус ордерів
        if (position.tpOrderId || position.slOrderId) {
          await this.checkOrderStatus(position);
        }
        
        // Логуємо поточний стан
        logger.position(`${position.symbol}: ${currentPrice} (${pnl.percentage >= 0 ? '+' : ''}${pnl.percentage.toFixed(2)}%) [${this.binanceClient.environment}]`, {
          symbol: position.symbol,
          entryPrice: position.entryPrice,
          currentPrice,
          pnl: pnl.amount,
          pnlPercent: pnl.percentage,
          environment: position.environment
        });
        
      } catch (error) {
        logger.error(`❌ Помилка перевірки позиції ${position.symbol}:`, error);
      }
    }

    // Виводимо статус після перевірки всіх позицій
    this.logTradingStatus();
  }

  /**
   * Перевірка статусу ордерів
   */
  async checkOrderStatus(position) {
    try {
      const orders = await this.binanceClient.getOpenOrders(position.symbol);
      
      const tpOrder = orders.find(o => o.orderId === position.tpOrderId);
      const slOrder = orders.find(o => o.orderId === position.slOrderId);
      
      // Якщо один з ордерів виконано - закриваємо позицію
      if ((!tpOrder && position.tpOrderId) || (!slOrder && position.slOrderId)) {
        const filledOrder = await this.binanceClient.getOrder(
          position.symbol,
          position.tpOrderId || position.slOrderId
        );
        
        if (filledOrder && filledOrder.status === constants.ORDER_STATUS.FILLED) {
          await this.closePosition(position, filledOrder);
        }
      }
      
    } catch (error) {
      logger.error(`❌ Помилка перевірки ордерів для ${position.symbol}:`, error);
    }
  }

  /**
   * Закриття позиції
   */
  async closePosition(position, filledOrder) {
    try {
      logger.trade(`📊 Закриття позиції ${position.symbol} в ${this.binanceClient.environment}`);
      
      // Визначаємо причину закриття
      const closeReason = filledOrder.orderId === position.tpOrderId
        ? constants.CLOSE_REASONS.TAKE_PROFIT
        : constants.CLOSE_REASONS.STOP_LOSS;
      
      // Скасовуємо протилежний ордер
      const orderToCancel = closeReason === constants.CLOSE_REASONS.TAKE_PROFIT
        ? position.slOrderId
        : position.tpOrderId;
      
      if (orderToCancel) {
        await this.orderManager.cancelOrder(position.symbol, orderToCancel);
      }
      
      // Розраховуємо фінальний P&L
      const exitPrice = parseFloat(filledOrder.price);
      const pnl = this.calculator.calculatePnL(
        position.entryPrice,
        exitPrice,
        position.quantity
      );
      
      // Оновлюємо позицію
      position.status = constants.POSITION_STATUS.CLOSED;
      position.exitPrice = exitPrice;
      position.exitTime = new Date();
      position.closeReason = closeReason;
      position.pnl = pnl.amount;
      position.pnlPercent = pnl.percentage;
      
      await this.database.updatePosition(position);
      
      // Видаляємо з активних
      this.activePositions.delete(position.symbol);
      
      // Оновлюємо статистику клієнта
      if (this.binanceClient.updateDailyStats) {
        this.binanceClient.updateDailyStats('trade', {}, { pnl: pnl.amount });
      }
      
      logger.trade(`✅ Позиція ${position.symbol} закрита в ${this.binanceClient.environment}`, {
        reason: closeReason,
        entryPrice: position.entryPrice,
        exitPrice,
        pnl: pnl.amount,
        pnlPercent: pnl.percentage,
        environment: this.binanceClient.environment
      });
      
      this.emit('positionClosed', {
        ...position,
        environment: this.binanceClient.environment
      });
      
      // Оновлюємо баланс
      await this.updateAccountInfo();
      
    } catch (error) {
      logger.error(`❌ Помилка закриття позиції ${position.symbol}:`, error);
    }
  }

  /**
   * Визначення статусу позиції
   */
  determinePositionStatus(pnlPercent) {
    if (pnlPercent > 0) {
      return constants.POSITION_STATUS.IN_PROFIT;
    } else if (pnlPercent < 0) {
      return constants.POSITION_STATUS.IN_LOSS;
    } else {
      return constants.POSITION_STATUS.BREAK_EVEN;
    }
  }

  /**
   * Виведення статусу торгового сервісу
   */
  logTradingStatus() {
    const positions = Array.from(this.activePositions.values());
    const status = {
      environment: this.binanceClient.environment,
      isActive: this.isActive,
      activePositions: positions.length,
      positions: positions.map(p => ({
        symbol: p.symbol,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        pnl: p.pnl,
        pnlPercent: p.pnlPercent,
        status: p.status
      })),
      maxPositions: this.maxPositions,
      lastBalanceUpdate: this.lastBalanceUpdate ? new Date(this.lastBalanceUpdate).toLocaleTimeString() : 'N/A',
      simulationMode: config.debug.simulationMode ? 'Enabled' : 'Disabled'
    };

    logger.info('💹 Статус торгового сервісу:', status);
  }

  /**
   * Запуск торгового сервісу
   */
  async start() {
    try {
      logger.info('▶️ Запуск торгового сервісу...');
      
      // Ініціалізуємо сервіс якщо ще не ініціалізовано
      if (!this.isActive) {
        await this.initialize();
      }
      
      // Запускаємо моніторинг позицій
      this.startPositionMonitoring();
      
      this.isActive = true;
      
      logger.info('✅ Торговий сервіс запущено');
      
    } catch (error) {
      logger.error('❌ Помилка запуску торгового сервісу:', error);
      throw error;
    }
  }
}

module.exports = { TradingService };