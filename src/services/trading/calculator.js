// src/services/trading/calculator.js

const logger = require('../../utils/logger');
const { formatNumber } = require('../../utils/formatter');

/**
 * Калькулятор позицій для торгівлі
 */
class PositionCalculator {
  constructor() {}

  /**
   * Розрахунок кількості для покупки з урахуванням обмежень символа
   */
  calculateQuantity(orderSize, price, symbolInfo) {
    try {
      // Базовий розрахунок кількості
      let quantity = orderSize / price;
      
      // Валідація на основі фільтрів символа
      if (symbolInfo && symbolInfo.filters) {
        // LOT_SIZE фільтр - кратність кількості
        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        if (lotSizeFilter) {
          const { minQty, maxQty, stepSize } = lotSizeFilter;
          
          // Перевіряємо мінімальну кількість
          if (quantity < parseFloat(minQty)) {
            logger.warn(`⚠️ Розрахована кількість ${quantity} менша за мінімальну ${minQty}`);
            quantity = parseFloat(minQty);
          }
          
          // Перевіряємо максимальну кількість
          if (quantity > parseFloat(maxQty)) {
            logger.warn(`⚠️ Розрахована кількість ${quantity} більша за максимальну ${maxQty}`);
            quantity = parseFloat(maxQty);
          }
          
          // Округлюємо до кратного stepSize
          quantity = this.roundToStepSize(quantity, parseFloat(stepSize));
        }
        
        // MIN_NOTIONAL фільтр - мінімальна вартість ордера
        const notionalFilter = symbolInfo.filters.find(f => f.filterType === 'MIN_NOTIONAL');
        if (notionalFilter) {
          const minNotional = parseFloat(notionalFilter.minNotional);
          const notional = quantity * price;
          
          if (notional < minNotional) {
            logger.warn(`⚠️ Вартість ордера ${notional} менша за мінімальну ${minNotional}`);
            quantity = minNotional / price;
            
            // Перераховуємо з урахуванням LOT_SIZE
            if (lotSizeFilter) {
              quantity = this.roundToStepSize(quantity, parseFloat(lotSizeFilter.stepSize));
            }
          }
        }
      }
      
      return quantity;
    } catch (error) {
      logger.error('❌ Помилка розрахунку кількості:', error);
      return 0;
    }
  }

  /**
   * Округлення до stepSize
   */
  roundToStepSize(quantity, stepSize) {
    if (stepSize === 0) return quantity;
    
    // Визначаємо точність на основі stepSize
    const precision = this.getPrecisionFromStepSize(stepSize);
    
    // Ділимо на stepSize, округлюємо до цілого, множимо на stepSize
    return Math.floor(quantity / stepSize) * stepSize;
  }

  /**
   * Отримання точності на основі stepSize
   */
  getPrecisionFromStepSize(stepSize) {
    const stepSizeStr = stepSize.toString();
    
    // Якщо в науковій нотації (e.g., 1e-8)
    if (stepSizeStr.includes('e-')) {
      return parseInt(stepSizeStr.split('e-')[1]);
    }
    
    // Якщо десяткове число
    if (stepSizeStr.includes('.')) {
      return stepSizeStr.split('.')[1].length;
    }
    
    return 0;
  }

  /**
   * Розрахунок цін Take Profit та Stop Loss
   */
  calculateTPSL(entryPrice, tpPercent, slPercent) {
    const takeProfit = entryPrice * (1 + tpPercent);
    const stopLoss = entryPrice * (1 - slPercent);
    
    return {
      takeProfit: formatNumber(takeProfit, 8),
      stopLoss: formatNumber(stopLoss, 8)
    };
  }

  /**
   * Розрахунок P&L (Profit and Loss)
   */
  calculatePnL(entryPrice, currentPrice, quantity) {
    const pnlAmount = (currentPrice - entryPrice) * quantity;
    const pnlPercentage = ((currentPrice / entryPrice) - 1) * 100;
    
    return {
      amount: pnlAmount,
      percentage: pnlPercentage
    };
  }

  /**
   * Розрахунок комісії
   */
  calculateFee(price, quantity, feeRate = 0.001) {
    return price * quantity * feeRate;
  }

  /**
   * Розрахунок trailing stop loss
   */
  calculateTrailingStopLoss(entryPrice, highestPrice, trailPercent) {
    // Розраховуємо на основі найвищої досягнутої ціни
    const stopPrice = highestPrice * (1 - trailPercent);
    
    // Переконуємося, що trailing stop loss вище за початковий stop loss
    const initialStopLoss = entryPrice * (1 - trailPercent);
    
    return Math.max(stopPrice, initialStopLoss);
  }

  /**
   * Оцінка прибутковості стратегії
   */
  evaluateStrategyPerformance(trades) {
    // Загальна статистика
    let totalTrades = trades.length;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalProfit = 0;
    let totalLoss = 0;
    let largestWin = 0;
    let largestLoss = 0;
    
    for (const trade of trades) {
      const pnl = trade.pnl || 0;
      
      if (pnl >= 0) {
        winningTrades++;
        totalProfit += pnl;
        largestWin = Math.max(largestWin, pnl);
      } else {
        losingTrades++;
        totalLoss += Math.abs(pnl);
        largestLoss = Math.max(largestLoss, Math.abs(pnl));
      }
    }
    
    // Розрахунок метрик
    const winRate = winningTrades / totalTrades;
    const averageWin = winningTrades > 0 ? totalProfit / winningTrades : 0;
    const averageLoss = losingTrades > 0 ? totalLoss / losingTrades : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : totalProfit;
    const expectancy = (winRate * averageWin) - ((1 - winRate) * averageLoss);
    
    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      profitFactor,
      expectancy,
      totalProfit,
      totalLoss,
      netProfit: totalProfit - totalLoss,
      averageWin,
      averageLoss,
      largestWin,
      largestLoss,
      riskRewardRatio: averageLoss > 0 ? averageWin / averageLoss : Infinity
    };
  }
}

module.exports = { PositionCalculator };