// src/services/binance/orders.js

const logger = require('../../utils/logger');
const config = require('../../config');
const constants = require('../../config/constants');
const { formatNumber } = require('../../utils/formatter');

/**
 * Менеджер ордерів для Binance
 */
class OrderManager {
  constructor(binanceClient) {
    this.binanceClient = binanceClient;
  }

  /**
   * Розміщення ринкового ордера на покупку
   */
  async placeMarketBuyOrder(symbol, quantity) {
    try {
      logger.trade(`📈 Розміщення ринкового ордера BUY ${symbol}, кількість: ${quantity}`);
      
      // Якщо ввімкнено симуляцію - повертаємо моковані дані
      if (config.debug.simulationMode) {
        const currentPrice = await this.binanceClient.getCurrentPrice(symbol);
        return this.mockOrderResult(symbol, quantity, currentPrice, 'BUY', true);
      }
      
      const orderParams = {
        symbol,
        side: constants.ORDER_SIDES.BUY,
        type: constants.ORDER_TYPES.MARKET,
        quantity: formatNumber(quantity, 8)
      };
      
      const result = await this.binanceClient.createOrder(orderParams);
      
      return {
        success: true,
        orderId: result.orderId,
        symbol: result.symbol,
        orderType: result.type,
        side: result.side,
        quantity: parseFloat(result.origQty),
        executedQty: parseFloat(result.executedQty),
        avgPrice: this.getOrderAveragePrice(result),
        status: result.status,
        time: result.transactTime
      };
      
    } catch (error) {
      logger.error(`❌ Помилка розміщення ринкового ордера BUY ${symbol}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Розміщення лімітного ордера на продаж
   */
  async placeLimitSellOrder(symbol, quantity, price) {
    try {
      logger.trade(`📉 Розміщення лімітного ордера SELL ${symbol}, кількість: ${quantity}, ціна: ${price}`);
      
      // Якщо ввімкнено симуляцію - повертаємо моковані дані
      if (config.debug.simulationMode) {
        return this.mockOrderResult(symbol, quantity, price, 'SELL', false);
      }
      
      const orderParams = {
        symbol,
        side: constants.ORDER_SIDES.SELL,
        type: constants.ORDER_TYPES.LIMIT,
        timeInForce: constants.TIME_IN_FORCE.GTC,
        quantity: formatNumber(quantity, 8),
        price: formatNumber(price, 8)
      };
      
      const result = await this.binanceClient.createOrder(orderParams);
      
      return {
        success: true,
        orderId: result.orderId,
        symbol: result.symbol,
        orderType: result.type,
        side: result.side,
        quantity: parseFloat(result.origQty),
        executedQty: parseFloat(result.executedQty),
        price: parseFloat(result.price),
        status: result.status,
        time: result.transactTime
      };
      
    } catch (error) {
      logger.error(`❌ Помилка розміщення лімітного ордера SELL ${symbol}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Розміщення Stop Loss ордера
   */
  async placeStopLossOrder(symbol, quantity, stopPrice) {
    try {
      logger.trade(`🛑 Розміщення Stop Loss ордера ${symbol}, кількість: ${quantity}, ціна: ${stopPrice}`);
      
      // Якщо ввімкнено симуляцію - повертаємо моковані дані
      if (config.debug.simulationMode) {
        return this.mockOrderResult(symbol, quantity, stopPrice, 'SELL', false);
      }
      
      const orderParams = {
        symbol,
        side: constants.ORDER_SIDES.SELL,
        type: constants.ORDER_TYPES.STOP_LOSS,
        timeInForce: constants.TIME_IN_FORCE.GTC,
        quantity: formatNumber(quantity, 8),
        stopPrice: formatNumber(stopPrice, 8),
        price: formatNumber(stopPrice * 0.99, 8) // Ціна трохи нижче stopPrice для гарантованого виконання
      };
      
      const result = await this.binanceClient.createOrder(orderParams);
      
      return {
        success: true,
        orderId: result.orderId,
        symbol: result.symbol,
        orderType: result.type,
        side: result.side,
        quantity: parseFloat(result.origQty),
        executedQty: parseFloat(result.executedQty),
        stopPrice: parseFloat(result.stopPrice),
        price: parseFloat(result.price),
        status: result.status,
        time: result.transactTime
      };
      
    } catch (error) {
      logger.error(`❌ Помилка розміщення Stop Loss ордера ${symbol}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Розміщення OCO ордера (One-Cancels-Other)
   */
  async placeOCOOrder(symbol, quantity, takeProfitPrice, stopLossPrice) {
    try {
      logger.trade(`🔄 Розміщення OCO ордера ${symbol}, TP: ${takeProfitPrice}, SL: ${stopLossPrice}`);
      
      // Якщо ввімкнено симуляцію - повертаємо моковані дані
      if (config.debug.simulationMode) {
        return {
          success: true,
          orders: [
            this.mockOrderResult(symbol, quantity, takeProfitPrice, 'SELL', false, false),
            this.mockOrderResult(symbol, quantity, stopLossPrice, 'SELL', false, false)
          ]
        };
      }
      
      const orderParams = {
        symbol,
        side: constants.ORDER_SIDES.SELL,
        quantity: formatNumber(quantity, 8),
        price: formatNumber(takeProfitPrice, 8), // Ліміт ордер для Take Profit
        stopPrice: formatNumber(stopLossPrice, 8), // Тригер для Stop Loss
        stopLimitPrice: formatNumber(stopLossPrice * 0.99, 8), // Ліміт ціна для Stop Loss
        stopLimitTimeInForce: constants.TIME_IN_FORCE.GTC
      };
      
      const result = await this.binanceClient.privateRequest(
        constants.BINANCE_ENDPOINTS.ORDER_OCO,
        orderParams,
        'POST'
      );
      
      return {
        success: true,
        orderListId: result.orderListId,
        orders: result.orders.map(order => ({
          orderId: order.orderId,
          symbol: order.symbol,
          type: order.type,
          side: order.side,
          price: parseFloat(order.price),
          quantity: parseFloat(order.origQty),
          status: order.status
        }))
      };
      
    } catch (error) {
      logger.error(`❌ Помилка розміщення OCO ордера ${symbol}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Скасування ордера
   */
  async cancelOrder(symbol, orderId) {
    try {
      logger.trade(`❌ Скасування ордера ${symbol}, orderId: ${orderId}`);
      
      // Якщо ввімкнено симуляцію - повертаємо моковані дані
      if (config.debug.simulationMode) {
        return {
          success: true,
          symbol,
          orderId,
          status: 'CANCELED'
        };
      }
      
      const result = await this.binanceClient.cancelOrder(symbol, orderId);
      
      return {
        success: true,
        orderId: result.orderId,
        symbol: result.symbol,
        status: result.status
      };
      
    } catch (error) {
      // Перевіряємо чи помилка пов'язана з тим, що ордер вже виконано
      if (error.response && error.response.data &&
          (error.response.data.code === -2011 || error.response.data.msg.includes('Unknown order'))) {
        logger.warn(`⚠️ Ордер ${orderId} вже виконано або скасовано`);
        return {
          success: true,
          orderId,
          symbol,
          status: 'UNKNOWN',
          message: 'Order already executed or canceled'
        };
      }
      
      logger.error(`❌ Помилка скасування ордера ${symbol}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Отримання середньої ціни виконання ордера
   */
  getOrderAveragePrice(orderResult) {
    // Для ринкових ордерів Binance не повертає середню ціну виконання
    // Тому ми отримуємо її з історії торгів
    return new Promise(async (resolve) => {
      try {
        // Якщо ордер не виконано - повертаємо 0
        if (orderResult.status !== constants.ORDER_STATUS.FILLED) {
          return resolve(0);
        }
        
        // Отримуємо торги для ордера
        const trades = await this.binanceClient.getMyTrades(
          orderResult.symbol,
          { orderId: orderResult.orderId }
        );
        
        if (!trades || trades.length === 0) {
          return resolve(0);
        }
        
        // Розраховуємо середню ціну
        let totalQty = 0;
        let totalValue = 0;
        
        for (const trade of trades) {
          const qty = parseFloat(trade.qty);
          const price = parseFloat(trade.price);
          
          totalQty += qty;
          totalValue += qty * price;
        }
        
        const avgPrice = totalValue / totalQty;
        resolve(avgPrice);
        
      } catch (error) {
        logger.error('❌ Помилка отримання середньої ціни:', error);
        resolve(0);
      }
    });
  }

  /**
   * Створення мокованого результату ордера для симуляції
   */
  mockOrderResult(symbol, quantity, price, side, isFilled = false, isMarket = true) {
    const orderId = Math.floor(Math.random() * 1000000000);
    
    return {
      success: true,
      orderId,
      symbol,
      orderType: isMarket ? constants.ORDER_TYPES.MARKET : constants.ORDER_TYPES.LIMIT,
      side,
      quantity,
      executedQty: isFilled ? quantity : 0,
      avgPrice: price,
      price,
      status: isFilled ? constants.ORDER_STATUS.FILLED : constants.ORDER_STATUS.NEW,
      time: Date.now(),
      isSimulated: true
    };
  }
}

module.exports = { OrderManager };