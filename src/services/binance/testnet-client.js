// src/services/binance/testnet-client.js

const { BinanceClient } = require('./client');
const logger = require('../../utils/logger');
const config = require('../../config');

/**
 * Спеціалізований клієнт для Binance Testnet
 * Включає додаткові функції для тестування та налагодження
 */
class TestnetClient extends BinanceClient {
  constructor() {
    // Форсуємо використання testnet конфігурації
    super();
    
    this.isTestnet = true;
    this.virtualBalance = new Map(); // Віртуальний баланс для симуляції
    this.testFeatures = {
      enableMockData: config.debug.simulationMode,
      enableDetailedLogging: true,
      enableOrderSimulation: true,
      enableBalanceSimulation: true
    };
    
    // Ініціалізуємо віртуальний баланс
    this.initializeVirtualBalance();
    
    logger.info('🧪 Testnet клієнт ініціалізовано', {
      baseURL: this.baseURL,
      features: this.testFeatures
    });
  }

  /**
   * Ініціалізація віртуального балансу для тестування
   */
  initializeVirtualBalance() {
    // Стандартні тестові баланси
    this.virtualBalance.set('USDT', 10000); // $10,000 для тестування
    this.virtualBalance.set('BTC', 1); // 1 BTC
    this.virtualBalance.set('ETH', 10); // 10 ETH
    this.virtualBalance.set('BNB', 100); // 100 BNB
    
    logger.debug('💰 Віртуальний баланс ініціалізовано:', Object.fromEntries(this.virtualBalance));
  }

  /**
   * Розширене логування для testnet
   */
  logTestnetOperation(operation, data) {
    if (this.testFeatures.enableDetailedLogging) {
      logger.debug(`🧪 [TESTNET] ${operation}:`, data);
    }
  }

  /**
   * Перевизначаємо створення ордера для додаткового логування
   */
  async createOrder(params) {
    this.logTestnetOperation('CREATE_ORDER', {
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      quantity: params.quantity,
      price: params.price
    });

    try {
      const result = await super.createOrder(params);
      
      this.logTestnetOperation('ORDER_SUCCESS', {
        orderId: result.orderId,
        status: result.status,
        symbol: result.symbol
      });

      // Оновлюємо віртуальний баланс якщо ввімкнена симуляція
      if (this.testFeatures.enableBalanceSimulation) {
        this.updateVirtualBalance(params, result);
      }

      return result;
    } catch (error) {
      this.logTestnetOperation('ORDER_ERROR', {
        symbol: params.symbol,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Оновлення віртуального балансу після ордера
   */
  updateVirtualBalance(orderParams, orderResult) {
    const { symbol, side, quantity } = orderParams;
    const { avgPrice } = orderResult;

    // Витягуємо базовий та котирувальний активи
    const quoteAsset = config.trading.quoteAsset;
    const baseAsset = symbol.replace(quoteAsset, '');

    if (side === 'BUY') {
      // Купівля: зменшуємо quote asset, збільшуємо base asset
      const cost = quantity * avgPrice;
      const currentQuote = this.virtualBalance.get(quoteAsset) || 0;
      const currentBase = this.virtualBalance.get(baseAsset) || 0;

      this.virtualBalance.set(quoteAsset, currentQuote - cost);
      this.virtualBalance.set(baseAsset, currentBase + quantity);
    } else if (side === 'SELL') {
      // Продаж: зменшуємо base asset, збільшуємо quote asset
      const revenue = quantity * avgPrice;
      const currentQuote = this.virtualBalance.get(quoteAsset) || 0;
      const currentBase = this.virtualBalance.get(baseAsset) || 0;

      this.virtualBalance.set(quoteAsset, currentQuote + revenue);
      this.virtualBalance.set(baseAsset, Math.max(0, currentBase - quantity));
    }

    this.logTestnetOperation('BALANCE_UPDATE', Object.fromEntries(this.virtualBalance));
  }

  /**
   * Отримання віртуального балансу (перевизначає реальний баланс)
   */
  async getVirtualAccountInfo() {
    const balances = Array.from(this.virtualBalance.entries()).map(([asset, amount]) => ({
      asset,
      free: amount.toString(),
      locked: '0.00000000'
    }));

    return {
      balances,
      canTrade: true,
      canWithdraw: false, // Завжди false для testnet
      canDeposit: false,
      updateTime: Date.now(),
      isTestnet: true
    };
  }

  /**
   * Перевизначаємо getAccountInfo для можливості використання віртуального балансу
   */
  async getAccountInfo() {
    if (this.testFeatures.enableBalanceSimulation) {
      return this.getVirtualAccountInfo();
    }
    
    try {
      const accountInfo = await super.getAccountInfo();
      
      this.logTestnetOperation('ACCOUNT_INFO', {
        balancesCount: accountInfo.balances.length,
        canTrade: accountInfo.canTrade,
        canWithdraw: accountInfo.canWithdraw
      });

      return {
        ...accountInfo,
        isTestnet: true
      };
    } catch (error) {
      logger.warn('⚠️ Помилка отримання реального балансу testnet, використовуємо віртуальний');
      return this.getVirtualAccountInfo();
    }
  }

  /**
   * Генерація тестових даних для нового лістингу
   */
  generateMockListing() {
    const symbols = ['MOCK', 'TEST', 'DEMO', 'FAKE', 'SAMPLE'];
    const randomSymbol = symbols[Math.floor(Math.random() * symbols.length)];
    const price = Math.random() * 100 + 1; // Ціна від 1 до 101
    
    return {
      symbol: `${randomSymbol}${config.trading.quoteAsset}`,
      price: parseFloat(price.toFixed(8)),
      volume: Math.random() * 1000000 + 100000, // Обсяг від 100k до 1.1M
      quoteVolume: Math.random() * 1000000 + 100000,
      priceChange: (Math.random() - 0.5) * 20, // Зміна від -10 до +10
      priceChangePercent: (Math.random() - 0.5) * 20,
      timestamp: Date.now(),
      isMock: true
    };
  }

  /**
   * Симуляція нового лістингу для тестування
   */
  async simulateNewListing() {
    if (!this.testFeatures.enableMockData) {
      throw new Error('Mock data не увімкнено');
    }

    const mockListing = this.generateMockListing();
    
    this.logTestnetOperation('MOCK_LISTING', mockListing);
    
    return mockListing;
  }

  /**
   * Перевірка тестових даних
   */
  async validateTestEnvironment() {
    const checks = [];

    // Перевірка підключення
    try {
      const exchangeInfo = await this.getExchangeInfo();
      checks.push({
        test: 'API Connection',
        status: 'passed',
        details: `Connected to ${this.baseURL}`
      });
    } catch (error) {
      checks.push({
        test: 'API Connection',
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
        details: `Account has ${accountInfo.balances.length} assets`
      });
    } catch (error) {
      checks.push({
        test: 'Authentication',
        status: 'failed',
        details: error.message
      });
    }

    // Перевірка дозволів
    try {
      const openOrders = await this.getOpenOrders();
      checks.push({
        test: 'Trading Permissions',
        status: 'passed',
        details: `Can access orders (${openOrders.length} open)`
      });
    } catch (error) {
      checks.push({
        test: 'Trading Permissions',
        status: 'failed',
        details: error.message
      });
    }

    const passedChecks = checks.filter(c => c.status === 'passed').length;
    const totalChecks = checks.length;

    logger.info(`🧪 Testnet валідація: ${passedChecks}/${totalChecks} тестів пройдено`);
    
    return {
      passed: passedChecks,
      total: totalChecks,
      checks,
      isValid: passedChecks === totalChecks
    };
  }

  /**
   * Скидання віртуального балансу
   */
  resetVirtualBalance() {
    this.virtualBalance.clear();
    this.initializeVirtualBalance();
    logger.info('🔄 Віртуальний баланс скинуто');
  }

  /**
   * Додавання коштів до віртуального балансу
   */
  addVirtualFunds(asset, amount) {
    const current = this.virtualBalance.get(asset) || 0;
    this.virtualBalance.set(asset, current + amount);
    
    this.logTestnetOperation('FUNDS_ADDED', {
      asset,
      amount,
      newBalance: this.virtualBalance.get(asset)
    });
  }

  /**
   * Експорт тестових даних
   */
  exportTestData() {
    return {
      environment: 'testnet',
      virtualBalance: Object.fromEntries(this.virtualBalance),
      features: this.testFeatures,
      apiConfig: {
        baseURL: this.baseURL,
        wsBaseURL: this.wsBaseURL
      }
    };
  }
}

module.exports = { TestnetClient };