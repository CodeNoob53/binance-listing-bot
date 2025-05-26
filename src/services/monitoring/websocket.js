// src/services/monitoring/websocket.js

const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('../../config');
const logger = require('../../utils/logger');
const { BinanceClient } = require('../binance/client');

/**
 * WebSocket моніторинг для відстеження нових лістингів
 * Використовує Binance WebSocket Streams
 */
class WebSocketMonitor extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.heartbeatInterval = null;
    this.lastHeartbeat = null;
    this.knownSymbols = new Set();
    this.subscriptions = new Set();
    
    // Binance REST клієнт для отримання початкових даних
    this.binanceClient = new BinanceClient();
  }

  /**
   * Ініціалізація та запуск моніторингу
   */
  async start() {
    try {
      logger.info('🚀 Запуск WebSocket моніторингу...');
      
      // Отримуємо початковий список символів
      await this.loadInitialSymbols();
      
      // Підключаємось до WebSocket
      await this.connect();
      
      // Запускаємо heartbeat
      this.startHeartbeat();
      
      logger.info('✅ WebSocket моніторинг запущено успішно');
    } catch (error) {
      logger.error('❌ Помилка запуску WebSocket моніторингу:', error);
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
   * Підключення до WebSocket
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        // Створюємо комбінований стрім
        const streams = [
          '!miniTicker@arr', // Всі міні тікери для відстеження нових символів
          '!ticker@arr', // Повні тікери для додаткової інформації
        ];

        // Вибір endpoint залежно від типу стріму та середовища
        let wsUrl;
        if (config.binance.useTestnet) {
          // Для testnet використовуємо базовий WebSocket URL
          wsUrl = 'wss://testnet.binance.vision/ws';
        } else {
          // Для mainnet використовуємо комбінований стрім
          wsUrl = `${config.binance.activeConfig.wsBaseURL}/stream?streams=${streams.join('/')}`;
        }

        logger.debug(`🔌 Підключення до WebSocket: ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);
        
        // Обробники подій
        this.ws.on('open', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          logger.info('✅ WebSocket підключено');

          // Для testnet потрібно підписатися на потоки після підключення
          if (config.binance.useTestnet) {
            // Підписуємося на кожен потік окремо
            streams.forEach(stream => {
              const subscribeMessage = {
                method: 'SUBSCRIBE',
                params: [stream],
                id: Date.now()
              };
              logger.debug(`📡 Відправляємо підписку на ${stream}`);
              this.ws.send(JSON.stringify(subscribeMessage));
            });
          }

          this.emit('connected');
          resolve();
        });
        
        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });
        
        this.ws.on('error', (error) => {
          logger.error('❌ WebSocket помилка:', error);
          this.emit('error', error);
        });
        
        this.ws.on('close', (code, reason) => {
          this.isConnected = false;
          logger.warn(`⚠️ WebSocket закрито. Код: ${code}, Причина: ${reason}`);
          this.emit('disconnected', { code, reason });
          
          // Спроба перепідключення
          this.handleReconnect();
        });
        
        this.ws.on('ping', () => {
          this.ws.pong();
          this.lastHeartbeat = Date.now();
        });
        
        // Таймаут підключення
        setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('WebSocket connection timeout'));
          }
        }, config.binance.timeout.ws);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Обробка вхідних повідомлень
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      
      // Перевіряємо тип потоку
      if (message.stream === '!miniTicker@arr') {
        this.handleMiniTickerArray(message.data);
      } else if (message.stream === '!ticker@arr') {
        this.handleTickerArray(message.data);
      } else if (message.data) {
        // Обробка інших типів повідомлень
        this.handleStreamData(message);
      }
      
    } catch (error) {
      logger.error('❌ Помилка обробки повідомлення:', error);
    }
  }

  /**
   * Обробка масиву міні тікерів
   */
  handleMiniTickerArray(tickers) {
    const currentSymbols = new Set();
    
    for (const ticker of tickers) {
      const symbol = ticker.s;
      
      // Фільтруємо за нашими критеріями
      if (!symbol.endsWith(config.trading.quoteAsset)) continue;
      
      currentSymbols.add(symbol);
      
      // Перевіряємо чи це новий символ
      if (!this.knownSymbols.has(symbol)) {
        logger.info(`🎉 Знайдено новий лістинг: ${symbol}`);
        
        // Емітуємо подію нового лістингу з додатковими даними
        this.emit('newListing', {
          symbol: symbol,
          price: parseFloat(ticker.c), // Поточна ціна
          volume: parseFloat(ticker.v), // Обсяг за 24 години
          quoteVolume: parseFloat(ticker.q), // Обсяг в quote валюті
          priceChange: parseFloat(ticker.p), // Зміна ціни
          priceChangePercent: parseFloat(ticker.P), // Зміна ціни у відсотках
          timestamp: Date.now()
        });
        
        // Додаємо до відомих символів
        this.knownSymbols.add(symbol);
      }
    }
    
    // Перевіряємо чи були делістинги (необов'язково, але корисно для логування)
    const delisted = [...this.knownSymbols].filter(s => !currentSymbols.has(s));
    if (delisted.length > 0) {
      logger.warn(`⚠️ Делістинг символів: ${delisted.join(', ')}`);
      delisted.forEach(s => this.knownSymbols.delete(s));
      this.emit('delisting', { symbols: delisted });
    }
  }

  /**
   * Обробка масиву повних тікерів
   */
  handleTickerArray(tickers) {
    // Можна використовувати для додаткової інформації про нові лістинги
    for (const ticker of tickers) {
      if (!ticker.s.endsWith(config.trading.quoteAsset)) continue;
      
      // Перевіряємо обсяги для фільтрації
      const volume24h = parseFloat(ticker.q); // Quote volume
      
      if (volume24h >= config.trading.filters.minVolume24h) {
        this.emit('highVolumeTicker', {
          symbol: ticker.s,
          volume24h: volume24h,
          price: parseFloat(ticker.c),
          high24h: parseFloat(ticker.h),
          low24h: parseFloat(ticker.l),
          trades24h: parseInt(ticker.n)
        });
      }
    }
  }

  /**
   * Обробка інших stream даних
   */
  handleStreamData(message) {
    // Можна розширити для обробки інших типів потоків
    this.emit('streamData', message);
  }

  /**
   * Heartbeat для перевірки з'єднання
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected) return;
      
      // Перевіряємо час останнього heartbeat
      if (this.lastHeartbeat && 
          Date.now() - this.lastHeartbeat > config.monitoring.heartbeat.timeout) {
        logger.warn('⚠️ WebSocket heartbeat timeout');
        this.ws.terminate();
        this.handleReconnect();
        return;
      }
      
      // Відправляємо ping
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
      
    }, config.monitoring.heartbeat.interval);
  }

  /**
   * Обробка перепідключення
   */
  async handleReconnect() {
    if (this.reconnectAttempts >= config.monitoring.reconnect.maxAttempts) {
      logger.error('❌ Вичерпано спроби перепідключення');
      this.emit('reconnectFailed');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = config.monitoring.reconnect.delay * this.reconnectAttempts;
    
    logger.info(`🔄 Спроба перепідключення ${this.reconnectAttempts}/${config.monitoring.reconnect.maxAttempts} через ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error('❌ Помилка перепідключення:', error);
        this.handleReconnect();
      }
    }, delay);
  }

  /**
   * Підписка на конкретний символ (для детального моніторингу)
   */
  async subscribeToSymbol(symbol) {
    if (this.subscriptions.has(symbol)) return;
    
    try {
      const streams = [
        `${symbol.toLowerCase()}@trade`, // Угоди
        `${symbol.toLowerCase()}@depth20`, // Стакан
        `${symbol.toLowerCase()}@kline_1m` // Свічки
      ];
      
      // Додаємо нові потоки до існуючого з'єднання
      const subscribeMessage = {
        method: 'SUBSCRIBE',
        params: streams,
        id: Date.now()
      };
      
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(subscribeMessage));
        this.subscriptions.add(symbol);
        logger.debug(`📡 Підписано на ${symbol}`);
      }
      
    } catch (error) {
      logger.error(`❌ Помилка підписки на ${symbol}:`, error);
    }
  }

  /**
   * Відписка від символу
   */
  async unsubscribeFromSymbol(symbol) {
    if (!this.subscriptions.has(symbol)) return;
    
    try {
      const streams = [
        `${symbol.toLowerCase()}@trade`,
        `${symbol.toLowerCase()}@depth20`,
        `${symbol.toLowerCase()}@kline_1m`
      ];
      
      const unsubscribeMessage = {
        method: 'UNSUBSCRIBE',
        params: streams,
        id: Date.now()
      };
      
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(unsubscribeMessage));
        this.subscriptions.delete(symbol);
        logger.debug(`📡 Відписано від ${symbol}`);
      }
      
    } catch (error) {
      logger.error(`❌ Помилка відписки від ${symbol}:`, error);
    }
  }

  /**
   * Зупинка моніторингу
   */
  async stop() {
    logger.info('⏹️ Зупинка WebSocket моніторингу...');
    
    // Зупиняємо heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    // Закриваємо WebSocket
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, 'Normal closure');
      }
      this.ws = null;
    }
    
    this.isConnected = false;
    this.knownSymbols.clear();
    this.subscriptions.clear();
    
    logger.info('✅ WebSocket моніторинг зупинено');
  }

  /**
   * Отримання статусу підключення
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      knownSymbols: this.knownSymbols.size,
      subscriptions: this.subscriptions.size,
      lastHeartbeat: this.lastHeartbeat,
      uptime: this.lastHeartbeat ? Date.now() - this.lastHeartbeat : 0
    };
  }
}

module.exports = { WebSocketMonitor };