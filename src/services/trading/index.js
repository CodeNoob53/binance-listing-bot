// src/services/trading/index.js

const EventEmitter = require('events');
const config = require('../../config');
const logger = require('../../utils/logger');
const { BinanceClient } = require('../binance/client');
const { OrderManager } = require('../binance/orders');
const { PositionCalculator } = require('./calculator');
const { RiskManager } = require('./risk');
const constants = require('../../config/constants');

/**
 * Головний торговий сервіс
 */
class TradingService extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
    this.binanceClient = new BinanceClient();
    this.orderManager = new OrderManager(this.binanceClient);
    this.calculator = new PositionCalculator();
    this.riskManager = new RiskManager();
    
    this.isActive = false;
    this.activePositions = new Map();
    this.accountInfo = null;
    this.lastBalanceUpdate = 0;
  }

  /**
   * Ініціалізація сервісу
   */
  async initialize() {
    try {
      logger.info('💹 Ініціалізація торгового сервісу...');
      
      // Отримуємо інформацію про акаунт
      await this.updateAccountInfo();
      
      // Завантажуємо активні позиції з БД
      await this.loadActivePositions();
      
      // Запускаємо моніторинг позицій
      this.startPositionMonitoring();
      
      this.isActive = true;
      logger.info('✅ Торговий сервіс ініціалізовано');
      
    } catch (error) {
      logger.error('❌ Помилка ініціалізації торгового сервісу:', error);
      throw error;
    }
  }

  /**
   * Оновлення інформації про акаунт
   */
  async updateAccountInfo() {
    try {
      this.accountInfo = await this.binanceClient.getAccountInfo();
      this.lastBalanceUpdate = Date.now();
      
      // Логуємо баланс
      const balances = this.accountInfo.balances
        .filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0)
        .map(b => `${b.asset}: ${b.free} (locked: ${b.locked})`);
      
      logger.info('💰 Баланси:', balances);
      
    } catch (error) {
      logger.error('❌ Помилка оновлення інформації акаунта:', error);
      throw error;
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
   * Завантаження активних позицій
   */
  async loadActivePositions() {
    try {
      const positions = await this.database.getActivePositions();
      
      for (const position of positions) {
        this.activePositions.set(position.symbol, position);
      }
      
      logger.info(`📊 Завантажено ${this.activePositions.size} активних позицій`);
      
    } catch (error) {
      logger.error('❌ Помилка завантаження позицій:', error);
    }
  }

  /**
   * Виконання покупки для нового лістингу
   */
  async executeBuy(listingData) {
    const timer = logger.startTimer();
    const { symbol } = listingData;
    
    try {
      logger.trade(`🛒 Початок покупки ${symbol}`, { listingData });
      
      // Перевіряємо чи вже маємо позицію
      if (this.activePositions.has(symbol)) {
        logger.warn(`⚠️ Позиція для ${symbol} вже існує`);
        return { success: false, error: 'Position already exists' };
      }
      
      // Перевіряємо ліміт позицій
      if (this.activePositions.size >= config.trading.maxPositions) {
        logger.warn(`⚠️ Досягнуто ліміт позицій: ${config.trading.maxPositions}`);
        return { success: false, error: 'Max positions limit reached' };
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
      
      // Перевіряємо доступний баланс
      const availableBalance = this.getAvailableBalance();
      const orderSize = this.riskManager.calculateOrderSize(
        availableBalance,
        this.activePositions.size
      );
      
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
        ...listingData
      };
      
      await this.database.savePosition(position);
      this.activePositions.set(symbol, position);
      
      timer.done(`✅ Покупка ${symbol} виконана успішно`, {
        symbol,
        quantity: orderResult.executedQty,
        avgPrice: orderResult.avgPrice,
        cost: orderResult.executedQty * orderResult.avgPrice
      });
      
      this.emit('buyExecuted', position);
      
      return {
        success: true,
        position,
        order: orderResult
      };
      
    } catch (error) {
      logger.error(`❌ Помилка покупки ${symbol}:`, error);
      
      await this.database.saveError({
        type: 'BUY_ORDER_ERROR',
        symbol,
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
   * Встановлення Take Profit та Stop Loss
   */
  async setTakeProfitStopLoss(buyResult) {
    const { position } = buyResult;
    const { symbol, quantity, entryPrice } = position;
    
    try {
      logger.trade(`⚙️ Встановлення TP/SL для ${symbol}`);
      
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
      
      logger.trade(`✅ TP/SL встановлено для ${symbol}`, {
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
        
        // Розраховуємо P&L
        const pnl = this.calculator.calculatePnL(
          position.entryPrice,
          currentPrice,
          position.quantity
        );
        
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
        logger.position(`${position.symbol}: ${currentPrice} (${pnl.percentage >= 0 ? '+' : ''}${pnl.percentage.toFixed(2)}%)`, {
          symbol: position.symbol,
          entryPrice: position.entryPrice,
          currentPrice,
          pnl: pnl.amount,
          pnlPercent: pnl.percentage
        });
        
      } catch (error) {
        logger.error(`❌ Помилка перевірки позиції ${position.symbol}:`, error);
      }
    }
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
      logger.trade(`📊 Закриття позиції ${position.symbol}`);
      
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
      
      logger.trade(`✅ Позиція ${position.symbol} закрита`, {
        reason: closeReason,
        entryPrice: position.entryPrice,
        exitPrice,
        pnl: pnl.amount,
        pnlPercent: pnl.percentage
      });
      
      this.emit('positionClosed', position);
      
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
   * Отримання статусу сервісу
   */
  getStatus() {
    return {
      isActive: this.isActive,
      activePositions: this.activePositions.size,
      balance: this.getAvailableBalance(),
      lastUpdate: this.lastBalanceUpdate,
      positions: Array.from(this.activePositions.values()).map(p => ({
        symbol: p.symbol,
        entryPrice: p.entryPrice,
        quantity: p.quantity,
        status: p.status
      }))
    };
  }

  /**
   * Зупинка сервісу
   */
  async stop() {
    logger.info('⏹️ Зупинка торгового сервісу...');
    
    this.isActive = false;
    
    if (this.positionMonitorInterval) {
      clearInterval(this.positionMonitorInterval);
    }
    
    logger.info('✅ Торговий сервіс зупинено');
  }
}

module.exports = { TradingService };