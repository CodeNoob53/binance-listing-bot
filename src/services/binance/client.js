// src/services/binance/client.js

const axios = require('axios');
const crypto = require('crypto');
const WebSocket = require('ws');
const pRetry = require('p-retry');
const config = require('../../config');
const logger = require('../../utils/logger');
const constants = require('../../config/constants');

/**
 * Клієнт для роботи з Binance API
 */
class BinanceClient {
  constructor() {
    this.apiKey = config.binance.apiKey;
    this.apiSecret = config.binance.apiSecret;
    this.baseURL = config.binance.baseURL;
    this.recvWindow = config.binance.recvWindow;
    
    // Налаштування axios
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: config.binance.timeout.rest,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
        'Content-Type': 'application/json'
      }
    });
    
    // Відстеження використання ваги API
    this.weightUsage = {
      lastReset: Date.now(),
      current: 0,
      limit: constants.API_LIMITS.WEIGHT_PER_MINUTE
    };
    
    // Обробники помилок
    this.setupErrorHandlers();
  }

  /**
   * Налаштування обробників помилок
   */
  setupErrorHandlers() {
    // Interceptor для відповідей
    this.client.interceptors.response.use(
      response => response,
      async error => {
        if (error.response) {
          const status = error.response.status;
          const data = error.response.data;
          
          // Логуємо помилку
          logger.error('❌ Binance API помилка:', {
            status,
            code: data.code,
            msg: data.msg,
            url: error.config.url,
            method: error.config.method
          });
          
          // Обробка специфічних помилок
          if (status === 429) {
            // Rate limit - чекаємо та пробуємо знову
            const retryAfter = parseInt(error.response.headers['retry-after'] || '60') * 1000;
            logger.warn(`⚠️ Rate limit перевищено. Очікування ${retryAfter}ms`);
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            return this.client(error.config);
          }
          
          if (status === 418) {
            // IP заблоковано
            logger.error('⛔ IP заблоковано Binance. Необхідно змінити IP');
            throw new Error('IP banned by Binance');
          }
        }
        
        return Promise.reject(error);
      }
    );
  }

  /**
   * Створення підпису для запитів
   */
  createSignature(queryString) {
    return crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');
  }

  /**
   * Додавання автентифікаційних параметрів
   */
  addAuthParams(params = {}) {
    const timestamp = Date.now();
    const recvWindow = this.recvWindow;
    
    return {
      ...params,
      timestamp,
      recvWindow
    };
  }

  /**
   * Перетворення об'єкту параметрів в querystring
   */
  buildQueryString(params) {
    return Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
  }

  /**
   * Виконання публічного запиту
   */
  async publicRequest(endpoint, params = {}) {
    try {
      // Додаємо затримку якщо потрібно
      await this.checkRateLimit(
        constants.API_LIMITS.REQUEST_WEIGHT[endpoint.split('/').pop()] || 1
      );
      
      const url = `${endpoint}${params ? '?' + this.buildQueryString(params) : ''}`;
      
      return await pRetry(
        async () => {
          const response = await this.client.get(url);
          return response.data;
        },
        {
          retries: config.binance.retry.maxAttempts,
          factor: config.binance.retry.backoff,
          minTimeout: config.binance.retry.delay
        }
      );
      
    } catch (error) {
      logger.error(`❌ Помилка публічного запиту до ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Виконання приватного запиту з підписом
   */
  async privateRequest(endpoint, params = {}, method = 'GET') {
    try {
      // Додаємо автентифікаційні параметри
      const authParams = this.addAuthParams(params);
      const queryString = this.buildQueryString(authParams);
      const signature = this.createSignature(queryString);
      
      // Додаємо затримку якщо потрібно
      await this.checkRateLimit(
        constants.API_LIMITS.REQUEST_WEIGHT[endpoint.split('/').pop()] || 10
      );
      
      return await pRetry(
        async () => {
          let response;
          
          if (method === 'GET') {
            response = await this.client.get(
              `${endpoint}?${queryString}&signature=${signature}`
            );
          } else if (method === 'POST') {
            response = await this.client.post(
              `${endpoint}?signature=${signature}`,
              null,
              { params: authParams }
            );
          } else if (method === 'DELETE') {
            response = await this.client.delete(
              `${endpoint}?${queryString}&signature=${signature}`
            );
          }
          
          return response.data;
        },
        {
          retries: config.binance.retry.maxAttempts,
          factor: config.binance.retry.backoff,
          minTimeout: config.binance.retry.delay
        }
      );
      
    } catch (error) {
      logger.error(`❌ Помилка приватного запиту до ${endpoint}:`, error);
      throw error;
    }
  }

  /**
   * Перевірка та контроль рейт-ліміту
   */
  async checkRateLimit(weight) {
    // Перевіряємо чи потрібно скинути лічильник
    const now = Date.now();
    if (now - this.weightUsage.lastReset > 60000) {
      this.weightUsage.current = 0;
      this.weightUsage.lastReset = now;
    }
    
    // Перевіряємо чи не перевищимо ліміт
    if (this.weightUsage.current + weight >= this.weightUsage.limit) {
      const delay = 60000 - (now - this.weightUsage.lastReset);
      logger.warn(`⚠️ API вага наближається до ліміту. Очікування ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      this.weightUsage.current = 0;
      this.weightUsage.lastReset = Date.now();
    }
    
    // Збільшуємо лічильник
    this.weightUsage.current += weight;
  }

  /**
   * Отримання інформації про біржу
   */
  async getExchangeInfo() {
    return this.publicRequest(constants.BINANCE_ENDPOINTS.EXCHANGE_INFO);
  }

  /**
   * Отримання інформації про конкретний символ
   */
  async getSymbolInfo(symbol) {
    const exchangeInfo = await this.getExchangeInfo();
    return exchangeInfo.symbols.find(s => s.symbol === symbol);
  }

  /**
   * Отримання поточної ціни
   */
  async getCurrentPrice(symbol) {
    const params = symbol ? { symbol } : {};
    const response = await this.publicRequest(constants.BINANCE_ENDPOINTS.TICKER_PRICE, params);
    
    if (symbol) {
      return parseFloat(response.price);
    }
    
    // Якщо symbol не вказано - повертаємо всі ціни
    return response;
  }

  /**
   * Отримання інформації за 24 години
   */
  async get24hrStats(symbol) {
    const params = symbol ? { symbol } : {};
    return this.publicRequest(constants.BINANCE_ENDPOINTS.TICKER_24H, params);
  }

  /**
   * Отримання інформації про акаунт
   */
  async getAccountInfo() {
    return this.privateRequest(constants.BINANCE_ENDPOINTS.ACCOUNT);
  }

  /**
   * Створення ордера
   */
  async createOrder(params) {
    return this.privateRequest(constants.BINANCE_ENDPOINTS.ORDER, params, 'POST');
  }

  /**
   * Отримання статусу ордера
   */
  async getOrder(symbol, orderId) {
    return this.privateRequest(constants.BINANCE_ENDPOINTS.ORDER, { symbol, orderId });
  }

  /**
   * Отримання відкритих ордерів
   */
  async getOpenOrders(symbol) {
    const params = symbol ? { symbol } : {};
    return this.privateRequest(constants.BINANCE_ENDPOINTS.OPEN_ORDERS, params);
  }

  /**
   * Скасування ордера
   */
  async cancelOrder(symbol, orderId) {
    return this.privateRequest(constants.BINANCE_ENDPOINTS.ORDER, { symbol, orderId }, 'DELETE');
  }

  /**
   * Отримання всіх ордерів за символом
   */
  async getAllOrders(symbol, params = {}) {
    return this.privateRequest(constants.BINANCE_ENDPOINTS.ALL_ORDERS, { symbol, ...params });
  }

  /**
   * Отримання історії торгівлі
   */
  async getMyTrades(symbol, params = {}) {
    return this.privateRequest(constants.BINANCE_ENDPOINTS.MY_TRADES, { symbol, ...params });
  }

  /**
   * Розрахунок комісії за угоду
   */
  calculateFee(price, quantity, feeRate = 0.001) {
    return price * quantity * feeRate;
  }
}

module.exports = { BinanceClient };