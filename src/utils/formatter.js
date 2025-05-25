// src/utils/formatter.js

/**
 * Утиліти для форматування даних
 */

/**
 * Форматування числа з фіксованою кількістю знаків після коми
 * @param {number} number - Число для форматування
 * @param {number} precision - Кількість знаків після коми
 * @returns {number} Відформатоване число
 */
function formatNumber(number, precision = 8) {
  if (isNaN(number) || number === null || number === undefined) {
    return 0;
  }
  
  // Перетворюємо в число для безпеки
  const num = parseFloat(number);
  
  // Обрізаємо до потрібної точності (без округлення)
  const factor = Math.pow(10, precision);
  const truncated = Math.floor(num * factor) / factor;
  
  return truncated;
}

/**
 * Форматування ціни згідно з правилами біржі
 * @param {number} price - Ціна
 * @param {object} symbolInfo - Інформація про символ
 * @returns {number} Відформатована ціна
 */
function formatPrice(price, symbolInfo) {
  if (!symbolInfo || !symbolInfo.filters) {
    return formatNumber(price, 8);
  }
  
  // Шукаємо фільтр PRICE_FILTER
  const priceFilter = symbolInfo.filters.find(f => f.filterType === 'PRICE_FILTER');
  
  if (priceFilter) {
    const { minPrice, maxPrice, tickSize } = priceFilter;
    
    // Перевіряємо обмеження
    if (price < parseFloat(minPrice)) {
      price = parseFloat(minPrice);
    }
    
    if (price > parseFloat(maxPrice)) {
      price = parseFloat(maxPrice);
    }
    
    // Округляємо до tickSize
    const precision = getPrecisionFromTickSize(tickSize);
    return formatNumber(price, precision);
  }
  
  return formatNumber(price, 8);
}

/**
 * Отримання точності з tickSize
 * @param {string} tickSize - Мінімальний крок ціни
 * @returns {number} Кількість знаків після коми
 */
function getPrecisionFromTickSize(tickSize) {
  const tickSizeStr = tickSize.toString();
  
  // Якщо в науковій нотації (e.g., 1e-8)
  if (tickSizeStr.includes('e-')) {
    return parseInt(tickSizeStr.split('e-')[1]);
  }
  
  // Якщо десяткове число
  if (tickSizeStr.includes('.')) {
    const decimals = tickSizeStr.split('.')[1];
    // Шукаємо перший ненульовий символ
    let precision = 0;
    for (let i = 0; i < decimals.length; i++) {
      if (decimals[i] !== '0') {
        precision = i + 1;
        break;
      }
      precision = i + 1;
    }
    return precision;
  }
  
  return 0;
}

/**
 * Форматування часу в людиночитабельний формат
 * @param {number} timestamp - Часова мітка в мілісекундах
 * @returns {string} Форматований час
 */
function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
  
  const date = new Date(timestamp);
  return date.toLocaleString();
}

/**
 * Форматування часової різниці
 * @param {number} ms - Різниця в мілісекундах
 * @returns {string} Форматована різниця
 */
function formatTimeDiff(ms) {
  if (ms < 1000) {
    return `${ms}мс`;
  }
  
  if (ms < 60000) {
    return `${Math.floor(ms / 1000)}с`;
  }
  
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}хв ${seconds}с`;
  }
  
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}г ${minutes}хв`;
}

/**
 * Форматування відсотка
 * @param {number} percent - Відсоток
 * @param {number} precision - Кількість знаків після коми
 * @returns {string} Відформатований відсоток
 */
function formatPercent(percent, precision = 2) {
  if (isNaN(percent)) return '0.00%';
  
  const formatted = (percent > 0 ? '+' : '') + percent.toFixed(precision) + '%';
  return formatted;
}

/**
 * Форматування грошової суми
 * @param {number} amount - Сума
 * @param {string} currency - Валюта
 * @returns {string} Відформатована сума
 */
function formatMoney(amount, currency = 'USDT') {
  if (isNaN(amount)) return '0.00 ' + currency;
  
  // Різна точність в залежності від розміру суми
  let precision = 2;
  
  if (Math.abs(amount) < 0.1) {
    precision = 6;
  } else if (Math.abs(amount) < 1) {
    precision = 4;
  }
  
  return amount.toFixed(precision) + ' ' + currency;
}

/**
 * Форматування назви валютної пари
 * @param {string} symbol - Символ пари
 * @param {string} separator - Розділювач
 * @returns {string} Відформатована назва
 */
function formatSymbol(symbol, separator = '/') {
  if (!symbol) return '';
  
  // Знаходимо базову та котирувальну валюти
  const quoteAssets = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH', 'BNB'];
  let baseAsset = symbol;
  let quoteAsset = '';
  
  for (const quote of quoteAssets) {
    if (symbol.endsWith(quote)) {
      quoteAsset = quote;
      baseAsset = symbol.substring(0, symbol.length - quote.length);
      break;
    }
  }
  
  return baseAsset + separator + quoteAsset;
}

module.exports = {
  formatNumber,
  formatPrice,
  formatTime,
  formatTimeDiff,
  formatPercent,
  formatMoney,
  formatSymbol
};