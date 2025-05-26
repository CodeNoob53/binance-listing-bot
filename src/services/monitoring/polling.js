// src/services/monitoring/polling.js

const EventEmitter = require('events');
const config = require('../../config');
const logger = require('../../utils/logger');
const { BinanceClient } = require('../binance/client');

/**
 * Polling моніторинг для резервного відстеження нових лістингів
 * Використовується як резервний метод, якщо WebSocket недоступний
 */
class PollingMonitor extends EventEmitter {
  constructor(binanceClient) {
    super();
    this.binanceClient = binanceClient;
    this.knownSymbols = new Set();
    this.pollingInterval = null;
    this.isRunning = false;
    this.lastCheckTime = 0;
  }

  /**
   * Запуск моніторингу
   */
  async start() {
    try {
      logger.info('🔄 Запуск Polling моніторингу...');
      
      // Отримуємо початковий список символів
      await this.loadInitialSymbols();
      
      // Запускаємо періодичну перевірку
      this.startPolling();
      
      this.isRunning = true;
      logger.info('✅ Polling моніторинг запущено успішно');
      
    } catch (error) {
      logger.error('❌ Помилка запуску Polling моніторингу:', error);
      throw error;
    }
  }

  /**
   * Завантаження початкового списку символів
   */
  async loadInitialSymbols() {
    try {
      const exchangeInfo = await this.binanceClient.getExchangeInfo();
      
      // Фільтруємо символи згідно з конфігурацією
      const symbols = exchangeInfo.symbols
        .filter(s => {
          // Фільтруємо за quote asset
          if (!s.symbol.endsWith(config.trading.quoteAsset)) return false;
          
          // Фільтруємо активні пари
          if (s.status !== 'TRADING') return false;
          
          // Виключаємо стейблкоїни якщо потрібно
          if (config.trading.filters.excludeStablecoins) {
            const stablecoins = ['USDC', 'BUSD', 'TUSD', 'USDP', 'DAI'];
            const baseAsset = s.baseAsset;
            if (stablecoins.includes(baseAsset)) return false;
          }
          
          // Виключаємо певні токени
          if (config.trading.filters.excludeTokens.includes(s.baseAsset)) {
            return false;
          }
          
          return true;
        })
        .map(s => s.symbol);
      
      this.knownSymbols = new Set(symbols);
      logger.info(`📊 Завантажено ${this.knownSymbols.size} торгових пар`);
      
    } catch (error) {
      logger.error('❌ Помилка завантаження символів:', error);
      throw error;
    }
  }

  /**
   * Запуск періодичної перевірки
   */
  startPolling() {
    const pollingInterval = config.monitoring.pollingInterval;
    
    this.pollingInterval = setInterval(async () => {
      try {
        await this.checkForNewListings();
      } catch (error) {
        logger.error('❌ Помилка перевірки нових лістингів:', error);
        this.emit('error', error);
      }
    }, pollingInterval);
    
    logger.info(`⏱️ Polling запущено з інтервалом ${pollingInterval}ms`);
  }

  /**
   * Перевірка нових лістингів
   */
  async checkForNewListings() {
    try {
      this.lastCheckTime = Date.now();
      
      // Отримуємо поточні ціни всіх символів
      const tickers = await this.binanceClient.get24hrStats();
      
      // Список для нових символів
      const newSymbols = [];
      
      // Перевіряємо кожен тікер
      for (const ticker of tickers) {
        const symbol = ticker.symbol;
        
        // Фільтруємо за нашими критеріями
        if (!symbol.endsWith(config.trading.quoteAsset)) continue;
        
        // Перевіряємо чи це новий символ
        if (!this.knownSymbols.has(symbol)) {
          logger.info(`🎉 Знайдено новий лістинг через polling: ${symbol}`);
          
          // Додаємо до списку нових
          newSymbols.push(symbol);
          
          // Додаємо до відомих
          this.knownSymbols.add(symbol);
          
          // Створюємо об'єкт лістингу
          const listingData = {
            symbol: symbol,
            price: parseFloat(ticker.lastPrice),
            volume: parseFloat(ticker.volume),
            quoteVolume: parseFloat(ticker.quoteVolume),
            priceChange: parseFloat(ticker.priceChange),
            priceChangePercent: parseFloat(ticker.priceChangePercent),
            timestamp: Date.now()
          };
          
          // Емітуємо подію
          this.emit('newListing', listingData);
        }
      }
      
      // Якщо знайдено нові символи - логуємо
      if (newSymbols.length > 0) {
        logger.info(`📊 Знайдено ${newSymbols.length} нових символів: ${newSymbols.join(', ')}`);
      }
      
    } catch (error) {
      logger.error('❌ Помилка при перевірці нових лістингів:', error);
      throw error;
    }
  }

  /**
   * Перевірка делістингу
   */
  async checkDelisting() {
    try {
      // Отримуємо всі символи
      const exchangeInfo = await this.binanceClient.getExchangeInfo();
      
      // Перетворюємо в множину для швидкого пошуку
      const currentSymbols = new Set(
        exchangeInfo.symbols
          .filter(s => s.status === 'TRADING' && s.symbol.endsWith(config.trading.quoteAsset))
          .map(s => s.symbol)
      );
      
      // Перевіряємо відомі символи
      const delisted = [...this.knownSymbols].filter(s => !currentSymbols.has(s));
      
      // Якщо знайдено делістинги - логуємо та емітуємо подію
      if (delisted.length > 0) {
        logger.warn(`⚠️ Делістинг символів: ${delisted.join(', ')}`);
        
        // Видаляємо з відомих
        delisted.forEach(s => this.knownSymbols.delete(s));
        
        // Емітуємо подію
        this.emit('delisting', { symbols: delisted });
      }
      
    } catch (error) {
      logger.error('❌ Помилка при перевірці делістингу:', error);
    }
  }

  /**
   * Оновлення списку символів
   */
  async refreshSymbolsList() {
    try {
      await this.loadInitialSymbols();
    } catch (error) {
      logger.error('❌ Помилка оновлення списку символів:', error);
      this.emit('error', error);
    }
  }

  /**
   * Зупинка моніторингу
   */
  async stop() {
    logger.info('⏹️ Зупинка Polling моніторингу...');
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    this.isRunning = false;
    this.knownSymbols.clear();
    
    logger.info('✅ Polling моніторинг зупинено');
  }

  /**
   * Отримання статусу
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      knownSymbols: this.knownSymbols.size,
      lastCheckTime: this.lastCheckTime,
      pollingInterval: config.monitoring.pollingInterval,
      uptime: this.lastCheckTime ? Date.now() - this.lastCheckTime : 0
    };
  }
}

module.exports = { PollingMonitor };