// src/config/constants.js

/**
 * Системні константи
 */
module.exports = {
  // Торгові статуси
  TRADE_STATUS: {
    PENDING: 'PENDING',
    EXECUTED: 'EXECUTED',
    PARTIALLY_FILLED: 'PARTIALLY_FILLED',
    CANCELLED: 'CANCELLED',
    FAILED: 'FAILED',
    COMPLETED: 'COMPLETED'
  },

  // Типи ордерів
  ORDER_TYPES: {
    MARKET: 'MARKET',
    LIMIT: 'LIMIT',
    STOP_LOSS: 'STOP_LOSS',
    STOP_LOSS_LIMIT: 'STOP_LOSS_LIMIT',
    TAKE_PROFIT: 'TAKE_PROFIT',
    TAKE_PROFIT_LIMIT: 'TAKE_PROFIT_LIMIT',
    LIMIT_MAKER: 'LIMIT_MAKER'
  },

  // Сторони ордерів
  ORDER_SIDES: {
    BUY: 'BUY',
    SELL: 'SELL'
  },

  // Статуси ордерів Binance
  ORDER_STATUS: {
    NEW: 'NEW',
    PARTIALLY_FILLED: 'PARTIALLY_FILLED',
    FILLED: 'FILLED',
    CANCELED: 'CANCELED',
    PENDING_CANCEL: 'PENDING_CANCEL',
    REJECTED: 'REJECTED',
    EXPIRED: 'EXPIRED'
  },

  // Time in Force
  TIME_IN_FORCE: {
    GTC: 'GTC', // Good Till Cancelled
    IOC: 'IOC', // Immediate Or Cancel
    FOK: 'FOK'  // Fill Or Kill
  },

  // Типи подій
  EVENT_TYPES: {
    // Моніторинг
    NEW_LISTING: 'new_listing',
    DELISTING: 'delisting',
    HIGH_VOLUME: 'high_volume',
    
    // Торгівля
    BUY_ORDER_PLACED: 'buy_order_placed',
    BUY_ORDER_FILLED: 'buy_order_filled',
    SELL_ORDER_PLACED: 'sell_order_placed',
    SELL_ORDER_FILLED: 'sell_order_filled',
    
    // TP/SL
    TAKE_PROFIT_HIT: 'take_profit_hit',
    STOP_LOSS_HIT: 'stop_loss_hit',
    
    // Система
    BOT_STARTED: 'bot_started',
    BOT_STOPPED: 'bot_stopped',
    ERROR: 'error',
    WARNING: 'warning'
  },

  // Типи сповіщень
  NOTIFICATION_TYPES: {
    INFO: 'info',
    SUCCESS: 'success',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'critical'
  },

  // Binance API endpoints
  BINANCE_ENDPOINTS: {
    EXCHANGE_INFO: '/api/v3/exchangeInfo',
    TICKER_24H: '/api/v3/ticker/24hr',
    TICKER_PRICE: '/api/v3/ticker/price',
    ORDER: '/api/v3/order',
    ORDER_OCO: '/api/v3/order/oco',
    ACCOUNT: '/api/v3/account',
    MY_TRADES: '/api/v3/myTrades',
    OPEN_ORDERS: '/api/v3/openOrders',
    ALL_ORDERS: '/api/v3/allOrders'
  },

  // WebSocket потоки
  WS_STREAMS: {
    MINI_TICKER_ALL: '!miniTicker@arr',
    TICKER_ALL: '!ticker@arr',
    TRADE: '@trade',
    KLINE: '@kline_',
    DEPTH: '@depth',
    BOOK_TICKER: '@bookTicker',
    AGGR_TRADE: '@aggTrade'
  },

  // Інтервали для свічок
  KLINE_INTERVALS: {
    '1m': '1m',
    '3m': '3m',
    '5m': '5m',
    '15m': '15m',
    '30m': '30m',
    '1h': '1h',
    '2h': '2h',
    '4h': '4h',
    '6h': '6h',
    '8h': '8h',
    '12h': '12h',
    '1d': '1d',
    '3d': '3d',
    '1w': '1w',
    '1M': '1M'
  },

  // Стейблкоїни
  STABLECOINS: ['USDT', 'USDC', 'BUSD', 'TUSD', 'USDP', 'DAI', 'FRAX', 'GUSD', 'USDJ', 'EUR', 'GBP', 'AUD'],

  // Популярні базові активи
  POPULAR_BASES: ['BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOGE', 'SOL', 'DOT', 'MATIC', 'LTC'],

  // Коди помилок Binance
  BINANCE_ERROR_CODES: {
    UNKNOWN: -1000,
    DISCONNECTED: -1001,
    UNAUTHORIZED: -1002,
    TOO_MANY_REQUESTS: -1003,
    UNEXPECTED_RESPONSE: -1006,
    TIMEOUT: -1007,
    INVALID_MESSAGE: -1013,
    UNKNOWN_ORDER_COMPOSITION: -1014,
    TOO_MANY_ORDERS: -1015,
    SERVICE_SHUTTING_DOWN: -1016,
    UNSUPPORTED_OPERATION: -1020,
    INVALID_TIMESTAMP: -1021,
    INVALID_SIGNATURE: -1022,
    ILLEGAL_CHARS: -1100,
    TOO_MANY_PARAMETERS: -1101,
    MANDATORY_PARAM_EMPTY: -1102,
    UNKNOWN_PARAM: -1103,
    UNREAD_PARAMETERS: -1104,
    PARAM_EMPTY: -1105,
    PARAM_NOT_REQUIRED: -1106,
    NO_DEPTH: -1112,
    TIF_NOT_REQUIRED: -1114,
    INVALID_TIF: -1115,
    INVALID_ORDER_TYPE: -1116,
    INVALID_SIDE: -1117,
    EMPTY_NEW_CL_ORD_ID: -1118,
    EMPTY_ORG_CL_ORD_ID: -1119,
    BAD_INTERVAL: -1120,
    BAD_SYMBOL: -1121,
    INVALID_LISTEN_KEY: -1125,
    MORE_THAN_XX_HOURS: -1127,
    OPTIONAL_PARAMS_BAD_COMBO: -1128,
    INVALID_PARAMETER: -1130,
    BAD_RECV_WINDOW: -1131,
    NEW_ORDER_REJECTED: -2010,
    CANCEL_REJECTED: -2011,
    NO_SUCH_ORDER: -2013,
    BAD_API_KEY_FMT: -2014,
    REJECTED_MBX_KEY: -2015,
    NO_TRADING_WINDOW: -2016
  },

  // Ліміти API
  API_LIMITS: {
    WEIGHT_PER_MINUTE: 1200,
    ORDERS_PER_10_SECONDS: 50,
    ORDERS_PER_DAY: 200000,
    REQUEST_WEIGHT: {
      EXCHANGE_INFO: 10,
      TICKER_24H: 40,
      TICKER_PRICE: 2,
      ORDER_PLACE: 1,
      ORDER_CANCEL: 1,
      ORDER_STATUS: 2,
      ACCOUNT: 10,
      MY_TRADES: 10,
      OPEN_ORDERS: 3,
      ALL_ORDERS: 10
    }
  },

  // Затримки та таймаути
  DELAYS: {
    BETWEEN_REQUESTS: 100, // мс
    AFTER_ERROR: 1000, // мс
    RECONNECT_BASE: 5000, // мс
    HEARTBEAT: 30000, // мс
    ORDER_CHECK: 5000, // мс
    POSITION_UPDATE: 10000 // мс
  },

  // Розміри та точність
  PRECISION: {
    PRICE: 8,
    QUANTITY: 8,
    QUOTE: 8,
    BASE: 8
  },

  // Мінімальні значення
  MINIMUMS: {
    NOTIONAL: 10, // USDT
    QUANTITY: 0.00001,
    PRICE: 0.00000001
  },

  // Статуси позицій
  POSITION_STATUS: {
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
    PARTIALLY_CLOSED: 'PARTIALLY_CLOSED',
    BREAK_EVEN: 'BREAK_EVEN',
    IN_PROFIT: 'IN_PROFIT',
    IN_LOSS: 'IN_LOSS'
  },

  // Причини закриття позицій
  CLOSE_REASONS: {
    TAKE_PROFIT: 'TAKE_PROFIT',
    STOP_LOSS: 'STOP_LOSS',
    MANUAL: 'MANUAL',
    TRAILING_STOP: 'TRAILING_STOP',
    TIMEOUT: 'TIMEOUT',
    ERROR: 'ERROR'
  },

  // Режими роботи
  BOT_MODES: {
    LIVE: 'LIVE',
    PAPER: 'PAPER',
    BACKTEST: 'BACKTEST',
    SIMULATION: 'SIMULATION'
  },

  // Пріоритети черг
  QUEUE_PRIORITY: {
    CRITICAL: 1,
    HIGH: 2,
    NORMAL: 3,
    LOW: 4
  },

  // Типи аналізу
  ANALYSIS_TYPES: {
    VOLUME: 'VOLUME',
    PRICE_ACTION: 'PRICE_ACTION',
    LIQUIDITY: 'LIQUIDITY',
    MOMENTUM: 'MOMENTUM',
    VOLATILITY: 'VOLATILITY'
  },

  // Метрики продуктивності  
  METRICS: {
    TRADES_COUNT: 'trades_count',
    SUCCESS_RATE: 'success_rate',
    PROFIT_FACTOR: 'profit_factor',
    SHARPE_RATIO: 'sharpe_ratio',
    MAX_DRAWDOWN: 'max_drawdown',
    AVERAGE_PROFIT: 'average_profit',
    AVERAGE_LOSS: 'average_loss',
    WIN_RATE: 'win_rate',
    RISK_REWARD_RATIO: 'risk_reward_ratio'
  }
};