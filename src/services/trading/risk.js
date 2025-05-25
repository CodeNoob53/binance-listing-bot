// src/services/trading/risk.js

const logger = require('../../utils/logger');
const config = require('../../config');

/**
 * Менеджер ризиків для торгівлі
 */
class RiskManager {
  constructor() {
    this.maxAccountRiskPercent = config.trading.risk.maxAccountRiskPercent;
    this.maxPositionRiskPercent = config.trading.risk.maxPositionRiskPercent;
    this.useOfBalance = config.trading.risk.useOfBalance;
    this.baseOrderSize = config.trading.baseOrderSize;
    this.maxOrderSize = config.trading.maxOrderSize;
  }

  /**
   * Розрахунок розміру ордера з урахуванням ризиків
   */
  calculateOrderSize(balance, activePositionsCount) {
    try {
      // Базовий розмір з конфігурації
      let orderSize = this.baseOrderSize;
      
      // Доступний для торгівлі баланс
      const availableBalance = balance * this.useOfBalance;
      
      // Обмеження за ризиком всього акаунту
      const maxRiskAmount = availableBalance * this.maxAccountRiskPercent;
      
      // Обмеження за розміром однієї позиції
      const maxPositionSize = availableBalance * this.maxPositionRiskPercent;
      
      // Визначаємо розмір з урахуванням обмежень
      orderSize = Math.min(
        orderSize,
        maxPositionSize,
        maxRiskAmount / (activePositionsCount + 1) // Розподіляємо ризик
      );
      
      // Переконуємося, що розмір не перевищує максимальний
      orderSize = Math.min(orderSize, this.maxOrderSize);
      
      // Переконуємося, що розмір не перевищує доступний баланс
      orderSize = Math.min(orderSize, availableBalance);
      
      logger.debug(`💰 Розрахований розмір ордера: ${orderSize}`, {
        balance,
        availableBalance,
        maxRiskAmount,
        maxPositionSize,
        activePositionsCount
      });
      
      return orderSize;
      
    } catch (error) {
      logger.error('❌ Помилка розрахунку розміру ордера:', error);
      return this.baseOrderSize; // Повертаємо базовий розмір у випадку помилки
    }
  }

  /**
   * Перевірка прийнятності ризику для нової позиції
   */
  isRiskAcceptable(balance, activePositionsCount, orderSize) {
    // Перевіряємо максимальну кількість позицій
    if (activePositionsCount >= config.trading.maxPositions) {
      logger.warn(`⚠️ Досягнуто ліміт позицій: ${config.trading.maxPositions}`);
      return false;
    }
    
    // Перевіряємо доступний баланс
    const availableBalance = balance * this.useOfBalance;
    if (orderSize > availableBalance) {
      logger.warn(`⚠️ Недостатньо коштів. Доступно: ${availableBalance}, Потрібно: ${orderSize}`);
      return false;
    }
    
    // Перевіряємо загальний ризик по відкритих позиціях
    const totalRiskAmount = orderSize * (activePositionsCount + 1);
    const maxRiskAmount = balance * this.maxAccountRiskPercent;
    
    if (totalRiskAmount > maxRiskAmount) {
      logger.warn(`⚠️ Перевищено ліміт ризику. Поточний: ${totalRiskAmount}, Максимальний: ${maxRiskAmount}`);
      return false;
    }
    
    return true;
  }

  /**
   * Розрахунок кількості з урахуванням Stop Loss
   */
  calculateQuantityWithStopLoss(balance, entryPrice, stopLossPrice) {
    // Різниця між ціною входу та Stop Loss
    const priceDifference = Math.abs(entryPrice - stopLossPrice);
    
    // Відсоток ризику від балансу
    const riskAmount = balance * this.maxPositionRiskPercent;
    
    // Розрахунок кількості на основі ризику
    const quantity = riskAmount / priceDifference;
    
    return quantity;
  }

  /**
   * Розрахунок диверсифікації ризику
   */
  calculateRiskDiversification(balance, positions) {
    // Групуємо позиції за базовим активом
    const assetGroups = {};
    
    for (const position of positions) {
      const baseAsset = position.symbol.replace(config.trading.quoteAsset, '');
      
      if (!assetGroups[baseAsset]) {
        assetGroups[baseAsset] = {
          totalValue: 0,
          positions: []
        };
      }
      
      const positionValue = position.quantity * position.entryPrice;
      assetGroups[baseAsset].totalValue += positionValue;
      assetGroups[baseAsset].positions.push(position);
    }
    
    // Розраховуємо відсоток кожного активу
    const assetPercentages = {};
    const totalValue = positions.reduce((sum, p) => sum + (p.quantity * p.entryPrice), 0);
    
    for (const asset in assetGroups) {
      assetPercentages[asset] = totalValue > 0 
        ? (assetGroups[asset].totalValue / totalValue) * 100 
        : 0;
    }
    
    return {
      assetGroups,
      assetPercentages,
      totalValue,
      portfolioPercentage: totalValue / balance * 100
    };
  }

  /**
   * Розрахунок trailing stop loss
   */
  calculateTrailingStop(entryPrice, currentPrice, initialStopPercent, trailPercent) {
    // Початковий stop loss
    const initialStop = entryPrice * (1 - initialStopPercent);
    
    // Для довгих позицій
    if (currentPrice > entryPrice) {
      // Новий stop loss на основі поточної ціни
      const trailingStop = currentPrice * (1 - trailPercent);
      
      // Повертаємо максимум з початкового і trailing
      return Math.max(initialStop, trailingStop);
    }
    
    // Якщо ціна не зросла - повертаємо початковий stop loss
    return initialStop;
  }

  /**
   * Розрахунок ризику торгової сесії
   */
  calculateSessionRisk(balance, sessionTrades) {
    // Загальний ризик сесії
    let totalRisk = 0;
    let totalProfit = 0;
    
    // Аналізуємо кожну угоду
    for (const trade of sessionTrades) {
      if (trade.status === 'CLOSED') {
        if (trade.pnl > 0) {
          totalProfit += trade.pnl;
        } else {
          totalRisk += Math.abs(trade.pnl);
        }
      } else {
        // Для відкритих позицій враховуємо потенційний ризик
        const potentialLoss = trade.quantity * (trade.entryPrice - trade.stopLossPrice);
        totalRisk += potentialLoss;
      }
    }
    
    // Розраховуємо відсоток ризику від балансу
    const riskPercent = (totalRisk / balance) * 100;
    const profitPercent = (totalProfit / balance) * 100;
    
    return {
      totalRisk,
      totalProfit,
      netResult: totalProfit - totalRisk,
      riskPercent,
      profitPercent,
      riskToRewardRatio: totalRisk > 0 ? totalProfit / totalRisk : Infinity
    };
  }
}

module.exports = { RiskManager };