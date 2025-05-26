const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('../../config');
const logger = require('../../utils/logger');
const { BinanceClient } = require('../binance/client');
const constants = require('../../config/constants');

// Мапінг станів WebSocket
const READY_STATES = {
  0: 'CONNECTING',
  1: 'OPEN',
  2: 'CLOSING',
  3: 'CLOSED'
};

/**
 * WebSocket моніторинг для відстеження нових лістингів
 * Використовує Binance WebSocket Streams з окремою логікою для mainnet і testnet
 */
class WebSocketMonitor extends EventEmitter {
  constructor(binanceClient) {
    super();
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.heartbeatInterval = null;
    this.lastHeartbeat = null;
    this.knownSymbols = new Set();
    this.subscriptions = new Set();
    this.binanceClient = binanceClient;
  }

  /**
   * Ініціалізація та запуск моніторингу
   */
  async start() {
    try {
      logger.info('🚀 Запуск WebSocket моніторингу...');
      await this.loadInitialSymbols();
      await this.connect();
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
      const symbols = exchangeInfo.symbols
        .filter(s => {
          if (!s.symbol.endsWith(config.trading.quoteAsset)) return false;
          if (s.status !== 'TRADING') return false;
          if (config.trading.filters.excludeStablecoins) {
            if (constants.STABLECOINS.includes(s.baseAsset)) return false;
          }
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
   * Налаштування потоків залежно від середовища
   */
  getStreams() {
    if (config.binance.useTestnet) {
      // Testnet: потоки для окремих символів
      return Array.from(this.knownSymbols)
        .map(symbol => `${symbol.toLowerCase()}@miniTicker`);
    } else {
      // Mainnet: глобальні потоки
      return [
        constants.WS_STREAMS.MINI_TICKER_ALL,
        constants.WS_STREAMS.TICKER_ALL
      ];
    }
  }

  /**
   * Підключення до WebSocket
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        const streams = this.getStreams();
        const { wsBaseURL } = config.binance.activeConfig;
        let wsUrl;
        
        if (config.binance.useTestnet) {
          // wsBaseURL вже містить '/ws'
          wsUrl = `${wsBaseURL}?streams=${streams.join('/')}`;
        } else {
          // на mainnet додаємо '/stream'
          wsUrl = `${wsBaseURL}/stream?streams=${streams.join('/')}`;
        }

        logger.debug(`🔌 Підключення до WebSocket: ${wsUrl}`);
        
        this.ws = new WebSocket(wsUrl);
        
        this.ws.on('open', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          logger.info('✅ WebSocket підключено');

          // Підписка для testnet
          if (config.binance.useTestnet) {
            streams.forEach(stream => {
              const subscribeMessage = {
                method: 'SUBSCRIBE',
                params: [stream],
                id: Date.now()
              };
              logger.debug(`📡 Підписка на ${stream}`);
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
          logger.error('WebSocket URL:', wsUrl);
          const rs = this.ws ? this.ws.readyState : 'not initialized';
          logger.error('WebSocket статус:', READY_STATES[rs] || rs);
          this.emit('error', error);
        });
        
        this.ws.on('close', (code, reason) => {
          this.isConnected = false;
          logger.warn(`⚠️ WebSocket закрито. Код: ${code}, Причина: ${reason}`);
          logger.warn('WebSocket URL:', wsUrl);
          const rs = this.ws ? this.ws.readyState : 'not initialized';
          logger.warn('WebSocket статус:', READY_STATES[rs] || rs);
          this.emit('disconnected', { code, reason });
          this.handleReconnect();
        });
        
        this.ws.on('ping', () => {
          this.ws.pong();
          this.lastHeartbeat = Date.now();
        });
        
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
      logger.debug('📨 Отримано повідомлення:', message);

      // Обробка відповідей на SUBSCRIBE
      if (message.id && message.result === null) {
        logger.info(`✅ Успішна підписка, ID: ${message.id}`);
        return;
      } else if (message.error) {
        logger.error(`❌ Помилка підписки: ${message.error.msg}`, message.error);
        return;
      }

      // Обробка даних залежно від середовища
      if (config.binance.useTestnet) {
        // Testnet: індивідуальні тікеры
        if (message.stream && message.data) {
          this.handleTestnetTicker(message.data);
        }
      } else {
        // Mainnet: масиви тікерів
        if (message.stream === constants.WS_STREAMS.MINI_TICKER_ALL) {
          this.handleMiniTickerArray(message.data);
        } else if (message.stream === constants.WS_STREAMS.TICKER_ALL) {
          this.handleTickerArray(message.data);
        }
      }
    } catch (error) {
      logger.error('❌ Помилка обробки повідомлення:', error);
    }
  }

  /**
   * Обробка індивідуального тікера (testnet)
   */
  handleTestnetTicker(data) {
    const symbol = data.s;
    if (!symbol.endsWith(config.trading.quoteAsset)) return;

    if (!this.knownSymbols.has(symbol)) {
      logger.info(`🎉 Знайдено новий лістинг: ${symbol}`);
      this.emit('newListing', {
        symbol: symbol,
        price: parseFloat(data.c),
        volume: parseFloat(data.v),
        quoteVolume: parseFloat(data.q),
        priceChange: parseFloat(data.p),
        priceChangePercent: parseFloat(data.P),
        timestamp: Date.now()
      });
      this.knownSymbols.add(symbol);
    }
  }

  /**
   * Обробка масиву міні тікерів (mainnet)
   */
  handleMiniTickerArray(tickers) {
    const currentSymbols = new Set();
    
    for (const ticker of tickers) {
      const symbol = ticker.s;
      if (!symbol.endsWith(config.trading.quoteAsset)) continue;
      
      currentSymbols.add(symbol);
      
      if (!this.knownSymbols.has(symbol)) {
        logger.info(`🎉 Знайдено новий лістинг: ${symbol}`);
        this.emit('newListing', {
          symbol: symbol,
          price: parseFloat(ticker.c),
          volume: parseFloat(ticker.v),
          quoteVolume: parseFloat(ticker.q),
          priceChange: parseFloat(ticker.p),
          priceChangePercent: parseFloat(ticker.P),
          timestamp: Date.now()
        });
        this.knownSymbols.add(symbol);
      }
    }
    
    const delisted = [...this.knownSymbols].filter(s => !currentSymbols.has(s));
    if (delisted.length > 0) {
      logger.warn(`⚠️ Делістинг символів: ${delisted.join(', ')}`);
      delisted.forEach(s => this.knownSymbols.delete(s));
      this.emit('delisting', { symbols: delisted });
    }
  }

  /**
   * Обробка масиву повних тікерів (mainnet)
   */
  handleTickerArray(tickers) {
    for (const ticker of tickers) {
      if (!ticker.s.endsWith(config.trading.quoteAsset)) continue;
      
      const volume24h = parseFloat(ticker.q);
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
   * Heartbeat для перевірки з'єднання
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (!this.isConnected) return;
      
      if (this.lastHeartbeat && 
          Date.now() - this.lastHeartbeat > config.monitoring.heartbeat.timeout) {
        logger.warn('⚠️ WebSocket heartbeat timeout');
        this.ws.terminate();
        this.handleReconnect();
        return;
      }
      
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
   * Підписка на конкретний символ
   */
  async subscribeToSymbol(symbol) {
    if (this.subscriptions.has(symbol)) return;
    
    try {
      const streams = [
        `${symbol.toLowerCase()}@trade`,
        `${symbol.toLowerCase()}@depth20`,
        `${symbol.toLowerCase()}@kline_1m`
      ];
      
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
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
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
      uptime: this.lastHeartbeat ? Date.now() - this.lastHeartbeat : 0,
      environment: config.binance.useTestnet ? 'testnet' : 'mainnet'
    };
  }
}

module.exports = { WebSocketMonitor };