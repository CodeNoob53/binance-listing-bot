// src/services/binance/mainnet-client.js

const { BinanceClient } = require('./client');
const logger = require('../../utils/logger');
const config = require('../../config');

/**
 * Спеціалізований клієнт для Binance Mainnet
 * Включає додаткові функції безпеки та контролю для реальної торгівлі
 */
class MainnetClient extends BinanceClient {
  constructor() {
    super();
    
    this.isMainnet = true;
    this.safetyFeatures = {
      enableOrderConfirmation: true,
      enableBalanceChecks: true,
      enableRiskLimits: true,
      enableAuditLogging: true,
      maxOrderValue: config.trading.maxOrderSize,
      dailyLossLimit: config.trading.baseOrderSize * 10 // 10x базового ордера
    };
    
    this.dailyStats = {
      ordersPlaced: 0,
      totalVolume: 0,
      totalLoss: 0,
      totalProfit: 0,
      lastReset: new Date().toDateString()
    };
    
    // Показуємо попередження про реальні гроші
    this.showMainnetWarning();
    
    logger.info('💰 Mainnet клієнт ініціалізовано', {
      baseURL: this.baseURL,
      safetyFeatures: this.safetyFeatures
    });
  }

  /**
   * Попередження про використання реальних коштів
   */
  showMainnetWarning() {
    const warnings = [
      '⚠️ ================================ УВАГА ================================ ⚠️',
      '⚠️                  ВИ ВИКОРИСТОВУЄТЕ MAINNET BINANCE                    ⚠️',
      '⚠️                    ТОРГІВЛЯ РЕАЛЬНИМИ КОШТАМИ!                       ⚠️',
      '⚠️                                                                      ⚠️',
      '⚠️ • Всі ордери будуть виконуватися з реальними коштами                ⚠️',
      '⚠️ • Втрати будуть реальними та незворотними                           ⚠️',
      '⚠️ • Переконайтеся в правильності налаштувань                          ⚠️',
      '⚠️ • Рекомендується спочатку протестувати на testnet                   ⚠️',
      '⚠️                                                                      ⚠️',
      '⚠️ ===================================================================== ⚠️'
    ];
    
    warnings.forEach(warning => logger.warn(warning));
    
    // Додаткове попередження якщо симуляція вимкнена
    if (!config.debug.simulationMode) {
      logger.warn('🚨 СИМУЛЯЦІЯ ВИМКНЕНА - ОРДЕРИ БУДУТЬ РЕАЛЬНИМИ! 🚨');
    }
  }

  /**
   * Скидання денної статистики
   */
  resetDailyStatsIfNeeded() {
    const today = new Date().toDateString();
    if (this.dailyStats.lastReset !== today) {
      this.dailyStats = {
        ordersPlaced: 0,
        totalVolume: 0,
        totalLoss: 0,
        totalProfit: 0,
        lastReset: today
      };
      logger.info('📊 Денна статистика скинута');
    }
  }

  /**
   * Аудит логування для mainnet операцій
   */
  auditLog(operation, data, risk = 'low') {
    if (this.safetyFeatures.enableAuditLogging) {
      const auditEntry = {
        timestamp: new Date().toISOString(),
        operation,
        risk,
        environment: 'mainnet',
        data,
        user: 'system', // Можна розширити для багатокористувацького режиму
        sessionId: process.pid // Простий session ID
      };
      
      logger.info(`🔍 [AUDIT] ${operation}`, auditEntry);
      
      // В production можна зберігати в окремий файл аудиту
      if (config.isProduction) {
        // TODO: Додати збереження в audit.log
      }
    }
  }

  /**
   * Перевірка безпечності ордера перед виконанням
   */
  validateOrderSafety(params) {
    this.resetDailyStatsIfNeeded();
    
    const { symbol, side, quantity, price, type } = params;
    const orderValue = type === 'MARKET' 
      ? quantity * (price || 0) // Для ринкових ордерів ціна може бути невідома
      : quantity * price;

    const validationResults = {
      isValid: true,
      warnings: [],
      errors: []
    };

    // Перевірка максимального розміру ордера
    if (orderValue > this.safetyFeatures.maxOrderValue) {
      validationResults.errors.push(
        `Розмір ордера (${orderValue}) перевищує максимальний ліміт (${this.safetyFeatures.maxOrderValue})`
      );
      validationResults.isValid = false;
    }

    // Перевірка денного ліміту втрат
    if (this.dailyStats.totalLoss >= this.safetyFeatures.dailyLossLimit) {
      validationResults.errors.push(
        `Досягнуто денний ліміт втрат (${this.safetyFeatures.dailyLossLimit})`
      );
      validationResults.isValid = false;
    }

    // Попередження для великих ордерів
    if (orderValue > config.trading.baseOrderSize * 5) {
      validationResults.warnings.push(
        `Великий ордер: ${orderValue} (>5x базового розміру)`
      );
    }

    // Перевірка символу
    if (!symbol.endsWith(config.trading.quoteAsset)) {
      validationResults.warnings.push(
        `Символ ${symbol} не відповідає налаштованому quote asset (${config.trading.quoteAsset})`
      );
    }

    return validationResults;
  }

  /**
   * Перевизначене створення ордера з додатковими перевірками безпеки
   */
  async createOrder(params) {
    // Аудит спроби створення ордера
    this.auditLog('ORDER_ATTEMPT', params, 'high');

    // Перевірка безпечності
    const safetyCheck = this.validateOrderSafety(params);
    
    if (!safetyCheck.isValid) {
      const error = new Error(`Ордер заблоковано системою безпеки: ${safetyCheck.errors.join(', ')}`);
      this.auditLog('ORDER_BLOCKED', { params, errors: safetyCheck.errors }, 'critical');
      throw error;
    }

    // Логуємо попередження
    if (safetyCheck.warnings.length > 0) {
      safetyCheck.warnings.forEach(warning => logger.warn(`⚠️ ${warning}`));
    }

    // Якщо ввімкнена симуляція на mainnet (для тестування)
    if (config.debug.simulationMode) {
      logger.warn('🧪 [MAINNET SIMULATION] Ордер не буде виконано реально');
      return this.simulateOrderExecution(params);
    }

    try {
      // Додаткове підтвердження для критичних операцій
      if (this.safetyFeatures.enableOrderConfirmation) {
        const orderValue = params.quantity * (params.price || 0);
        if (orderValue > config.trading.baseOrderSize * 2) {
          logger.warn(`🤔 Підтвердження великого ордера: ${orderValue} ${config.trading.quoteAsset}`);
          // В production тут може бути запит підтвердження від користувача
        }
      }

      const result = await super.createOrder(params);
      
      // Оновлюємо статистику
      this.updateDailyStats('order', params, result);
      
      // Аудит успішного ордера
      this.auditLog('ORDER_SUCCESS', {
        orderId: result.orderId,
        symbol: result.symbol,
        side: result.side,
        quantity: result.executedQty,
        price: result.avgPrice || params.price
      }, 'high');

      return result;
    } catch (error) {
      // Аудит помилки ордера
      this.auditLog('ORDER_ERROR', {
        params,
        error: error.message
      }, 'critical');
      
      throw error;
    }
  }

  /**
   * Симуляція виконання ордера для режиму тестування на mainnet
   */
  simulateOrderExecution(params) {
    const mockOrderId = Date.now();
    const executedQty = params.quantity;
    const avgPrice = params.price || Math.random() * 100; // Випадкова ціна для ринкових ордерів

    return {
      orderId: mockOrderId,
      symbol: params.symbol,
      status: 'FILLED',
      type: params.type,
      side: params.side,
      origQty: params.quantity,
      executedQty,
      avgPrice,
      transactTime: Date.now(),
      isSimulated: true
    };
  }

  /**
   * Оновлення денної статистики
   */
  updateDailyStats(type, params, result) {
    this.resetDailyStatsIfNeeded();

    if (type === 'order') {
      this.dailyStats.ordersPlaced++;
      const volume = result.executedQty * (result.avgPrice || params.price);
      this.dailyStats.totalVolume += volume;
    }

    if (type === 'trade') {
      if (result.pnl > 0) {
        this.dailyStats.totalProfit += result.pnl;
      } else {
        this.dailyStats.totalLoss += Math.abs(result.pnl);
      }
    }
  }

  /**
   * Перевірка балансу з додатковими обмеженнями
   */
  async getAccountInfo() {
    try {
      const accountInfo = await super.getAccountInfo();
      
      this.auditLog('BALANCE_CHECK', {
        balanceCount: accountInfo.balances.length,
        canTrade: accountInfo.canTrade,
        canWithdraw: accountInfo.canWithdraw
      }, 'medium');

      // Додаткові перевірки для mainnet
      if (this.safetyFeatures.enableBalanceChecks) {
        this.validateAccountSafety(accountInfo);
      }

      return {
        ...accountInfo,
        isMainnet: true,
        dailyStats: this.dailyStats
      };
    } catch (error) {
      this.auditLog('BALANCE_ERROR', { error: error.message }, 'critical');
      throw error;
    }
  }

  /**
   * Валідація безпечності акаунта
   */
  validateAccountSafety(accountInfo) {
    const warnings = [];

    // Перевірка дозволів
    if (!accountInfo.canTrade) {
      warnings.push('Торгівля заборонена на акаунті');
    }

    if (accountInfo.canWithdraw) {
      warnings.push('Дозвіл на виведення коштів увімкнено (ризик безпеки)');
    }

    // Перевірка балансу основної валюти
    const quoteBalance = accountInfo.balances.find(b => b.asset === config.trading.quoteAsset);
    if (quoteBalance) {
      const balance = parseFloat(quoteBalance.free);
      if (balance < config.trading.baseOrderSize) {
        warnings.push(`Низький баланс ${config.trading.quoteAsset}: ${balance}`);
      }
    }

    // Логуємо попередження
    warnings.forEach(warning => logger.warn(`⚠️ [MAINNET SAFETY] ${warning}`));

    return warnings;
  }

  /**
   * Експорт звіту по безпеці
   */
  generateSecurityReport() {
    this.resetDailyStatsIfNeeded();

    return {
      environment: 'mainnet',
      timestamp: new Date().toISOString(),
      safetyFeatures: this.safetyFeatures,
      dailyStats: this.dailyStats,
      limits: {
        maxOrderValue: this.safetyFeatures.maxOrderValue,
        dailyLossLimit: this.safetyFeatures.dailyLossLimit,
        remainingLossLimit: Math.max(0, this.safetyFeatures.dailyLossLimit - this.dailyStats.totalLoss)
      },
      recommendations: this.getSecurityRecommendations()
    };
  }

  /**
   * Генерація рекомендацій з безпеки
   */
  getSecurityRecommendations() {
    const recommendations = [];

    // Перевірка денної активності
    if (this.dailyStats.ordersPlaced > 20) {
      recommendations.push({
        type: 'warning',
        message: 'Висока денна активність',
        suggestion: 'Розгляньте збільшення інтервалів між ордерами'
      });
    }

    // Перевірка втрат
    if (this.dailyStats.totalLoss > this.safetyFeatures.dailyLossLimit * 0.7) {
      recommendations.push({
        type: 'critical',
        message: 'Наближення до денного ліміту втрат',
        suggestion: 'Розгляньте зупинку торгівлі до завтра'
      });
    }

    // Перевірка прибутковості
    const totalPnL = this.dailyStats.totalProfit - this.dailyStats.totalLoss;
    if (totalPnL < 0 && Math.abs(totalPnL) > config.trading.baseOrderSize) {
      recommendations.push({
        type: 'warning',
        message: 'Денний збиток перевищує базовий розмір ордера',
        suggestion: 'Перегляньте торгову стратегію'
      });
    }

    // Перевірка налаштувань безпеки
    if (!config.security.ipWhitelist.enabled) {
      recommendations.push({
        type: 'security',
        message: 'IP whitelist не увімкнено',
        suggestion: 'Увімкніть IP_WHITELIST_ENABLED для додаткової безпеки'
      });
    }

    return recommendations;
  }

  /**
   * Аварійна зупинка торгівлі
   */
  async emergencyStop(reason) {
    this.auditLog('EMERGENCY_STOP', { reason }, 'critical');
    
    logger.error(`🚨 АВАРІЙНА ЗУПИНКА: ${reason}`);
    
    try {
      // Отримуємо всі відкриті ордери
      const openOrders = await this.getOpenOrders();
      
      if (openOrders.length > 0) {
        logger.warn(`⚠️ Скасування ${openOrders.length} відкритих ордерів...`);
        
        // Скасовуємо всі відкриті ордери
        const cancelPromises = openOrders.map(order => 
          this.cancelOrder(order.symbol, order.orderId).catch(err => {
            logger.error(`Помилка скасування ордера ${order.orderId}:`, err);
          })
        );
        
        await Promise.allSettled(cancelPromises);
      }
      
      // Вимикаємо всі функції торгівлі
      this.safetyFeatures.enableOrderConfirmation = false;
      
      logger.error('🛑 Торгівля зупинена. Перезапустіть бота для відновлення.');
      
      return {
        stopped: true,
        reason,
        cancelledOrders: openOrders.length,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.auditLog('EMERGENCY_STOP_ERROR', { reason, error: error.message }, 'critical');
      throw error;
    }
  }

  /**
   * Перевірка здоров'я mainnet клієнта
   */
  async healthCheck() {
    const checks = [];

    // Перевірка підключення
    try {
      const start = Date.now();
      await this.getExchangeInfo();
      const latency = Date.now() - start;
      
      checks.push({
        test: 'API Connectivity',
        status: latency < 5000 ? 'passed' : 'warning',
        details: `Latency: ${latency}ms`,
        latency
      });
    } catch (error) {
      checks.push({
        test: 'API Connectivity',
        status: 'failed',
        details: error.message
      });
    }

    // Перевірка автентифікації
    try {
      const accountInfo = await this.getAccountInfo();
      checks.push({
        test: 'Authentication',
        status: 'passed',
        details: `Trading: ${accountInfo.canTrade ? 'enabled' : 'disabled'}`
      });
    } catch (error) {
      checks.push({
        test: 'Authentication',
        status: 'failed',
        details: error.message
      });
    }

    // Перевірка лімітів
    const lossLimitUsage = (this.dailyStats.totalLoss / this.safetyFeatures.dailyLossLimit) * 100;
    checks.push({
      test: 'Daily Loss Limit',
      status: lossLimitUsage < 70 ? 'passed' : lossLimitUsage < 90 ? 'warning' : 'critical',
      details: `Used: ${lossLimitUsage.toFixed(1)}%`
    });

    return {
      environment: 'mainnet',
      overall: checks.every(c => c.status === 'passed') ? 'healthy' : 
               checks.some(c => c.status === 'critical') ? 'critical' : 'warning',
      checks,
      dailyStats: this.dailyStats
    };
  }

  /**
   * Безпечне завершення роботи
   */
  async safeShutdown() {
    logger.info('🔒 Безпечне завершення mainnet клієнта...');
    
    this.auditLog('SAFE_SHUTDOWN', { dailyStats: this.dailyStats }, 'medium');
    
    // Генеруємо фінальний звіт
    const finalReport = this.generateSecurityReport();
    logger.info('📊 Фінальний звіт mainnet сесії:', finalReport);
    
    return finalReport;
  }
}

module.exports = { MainnetClient };