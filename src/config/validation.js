// src/config/validation.js

const Joi = require('joi');

/**
 * Валідація конфігурації
 * @param {object} config - Об'єкт конфігурації
 * @returns {object} Результат валідації
 */
function validateConfig(config) {
  try {
    // Схема для Binance API
    const binanceSchema = Joi.object({
      apiKey: Joi.string().required().messages({
        'string.empty': 'BINANCE_API_KEY не може бути порожнім',
        'any.required': 'BINANCE_API_KEY є обов\'язковим'
      }),
      apiSecret: Joi.string().required().messages({
        'string.empty': 'BINANCE_API_SECRET не може бути порожнім',
        'any.required': 'BINANCE_API_SECRET є обов\'язковим'
      }),
      testnet: Joi.boolean(),
      baseURL: Joi.string().uri(),
      wsBaseURL: Joi.string(),
      recvWindow: Joi.number().integer().min(1000).max(60000),
      timeout: Joi.object({
        rest: Joi.number().integer().min(1000),
        ws: Joi.number().integer().min(1000)
      }),
      retry: Joi.object({
        maxAttempts: Joi.number().integer().min(1),
        delay: Joi.number().integer().min(100),
        backoff: Joi.number().min(1)
      })
    });

    // Схема для торгових налаштувань
    const tradingSchema = Joi.object({
      quoteAsset: Joi.string().required(),
      baseOrderSize: Joi.number().min(0).required(),
      maxOrderSize: Joi.number().min(0).greater(Joi.ref('baseOrderSize')),
      maxPositions: Joi.number().integer().min(1),
      risk: Joi.object({
        maxAccountRiskPercent: Joi.number().min(0).max(1),
        maxPositionRiskPercent: Joi.number().min(0).max(1),
        useOfBalance: Joi.number().min(0).max(1)
      }),
      defaultTP: Joi.number().min(0),
      defaultSL: Joi.number().min(0),
      useOCO: Joi.boolean(),
      filters: Joi.object({
        minVolume24h: Joi.number().min(0),
        minLiquidity: Joi.number().min(0),
        excludeStablecoins: Joi.boolean(),
        excludeTokens: Joi.array().items(Joi.string())
      })
    });

    // Схема для налаштувань моніторингу
    const monitoringSchema = Joi.object({
      useWebSocket: Joi.boolean(),
      pollingInterval: Joi.number().integer().min(1000),
      pollingEnabled: Joi.boolean(),
      reconnect: Joi.object({
        maxAttempts: Joi.number().integer().min(1),
        delay: Joi.number().integer().min(1000)
      }),
      heartbeat: Joi.object({
        interval: Joi.number().integer().min(1000),
        timeout: Joi.number().integer().min(1000)
      })
    });

    // Схема для налаштувань бази даних
    const databaseSchema = Joi.object({
      type: Joi.string().valid('sqlite', 'postgresql', 'mysql'),
      sqlite: Joi.object({
        filename: Joi.string().when('..type', {
          is: 'sqlite',
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      }),
      postgresql: Joi.object({
        host: Joi.string(),
        port: Joi.number().port(),
        username: Joi.string(),
        password: Joi.string().allow(''),
        database: Joi.string()
      }).when('..type', {
        is: 'postgresql',
        then: Joi.required(),
        otherwise: Joi.optional()
      }),
      pool: Joi.object({
        min: Joi.number().integer().min(1),
        max: Joi.number().integer().min(Joi.ref('min'))
      }),
      logging: Joi.boolean()
    });

    // Схема для налаштувань логування
    const loggingSchema = Joi.object({
      level: Joi.string().valid('error', 'warn', 'info', 'debug', 'trade', 'position'),
      format: Joi.string().valid('json', 'simple'),
      file: Joi.object({
        enabled: Joi.boolean(),
        filename: Joi.string(),
        maxSize: Joi.string(),
        maxFiles: Joi.number().integer().min(1)
      }),
      console: Joi.object({
        enabled: Joi.boolean(),
        colorize: Joi.boolean()
      }),
      database: Joi.object({
        enabled: Joi.boolean(),
        level: Joi.string().valid('error', 'warn', 'info', 'debug')
      })
    });

    // Схема для налаштувань сповіщень
    const notificationsSchema = Joi.object({
      telegram: Joi.object({
        enabled: Joi.boolean(),
        botToken: Joi.string().when('enabled', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        chatId: Joi.string().when('enabled', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        notifyOnNewListing: Joi.boolean(),
        notifyOnBuy: Joi.boolean(),
        notifyOnSell: Joi.boolean(),
        notifyOnError: Joi.boolean()
      }),
      email: Joi.object({
        enabled: Joi.boolean(),
        smtp: Joi.object({
          host: Joi.string(),
          port: Joi.number().port(),
          secure: Joi.boolean(),
          auth: Joi.object({
            user: Joi.string(),
            pass: Joi.string()
          })
        }).when('enabled', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        }),
        from: Joi.string().email(),
        to: Joi.string().email()
      }),
      discord: Joi.object({
        enabled: Joi.boolean(),
        webhookUrl: Joi.string().uri().when('enabled', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      })
    });

    // Схема для налаштувань сервера
    const serverSchema = Joi.object({
      port: Joi.number().port(),
      host: Joi.string(),
      api: Joi.object({
        enabled: Joi.boolean(),
        prefix: Joi.string(),
        auth: Joi.object({
          enabled: Joi.boolean(),
          token: Joi.string().when('enabled', {
            is: true,
            then: Joi.required(),
            otherwise: Joi.optional()
          })
        })
      }),
      ws: Joi.object({
        enabled: Joi.boolean(),
        path: Joi.string()
      })
    });

    // Схема для налаштувань безпеки
    const securitySchema = Joi.object({
      encryption: Joi.object({
        enabled: Joi.boolean(),
        algorithm: Joi.string(),
        key: Joi.string().when('enabled', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.optional()
        })
      }),
      ipWhitelist: Joi.object({
        enabled: Joi.boolean(),
        ips: Joi.array().items(Joi.string())
      }),
      rateLimit: Joi.object({
        enabled: Joi.boolean(),
        windowMs: Joi.number().integer().min(1000),
        max: Joi.number().integer().min(1)
      })
    });

    // Схема для налаштувань відладки
    const debugSchema = Joi.object({
      enabled: Joi.boolean(),
      simulationMode: Joi.boolean(),
      verboseLogging: Joi.boolean(),
      profiling: Joi.boolean()
    });

    // Повна схема конфігурації
    const configSchema = Joi.object({
      env: Joi.string().valid('development', 'production', 'test'),
      isDevelopment: Joi.boolean(),
      isProduction: Joi.boolean(),
      isTest: Joi.boolean(),
      binance: binanceSchema.required(),
      trading: tradingSchema.required(),
      monitoring: monitoringSchema.required(),
      database: databaseSchema.required(),
      logging: loggingSchema.required(),
      notifications: notificationsSchema.required(),
      server: serverSchema.required(),
      security: securitySchema.required(),
      debug: debugSchema.required(),
      constants: Joi.object().required()
    });

    // Виконуємо валідацію
    const result = configSchema.validate(config, { abortEarly: false });

    if (result.error) {
      // Логуємо помилки валідації
      const errors = result.error.details.map(error => `${error.path.join('.')}: ${error.message}`);
      
      return {
        isValid: false,
        errors
      };
    }

    return {
      isValid: true
    };
    
  } catch (error) {
    // Якщо логер недоступний, виводимо помилку в консоль
    console.error('❌ Помилка валідації конфігурації:', error);
    return {
      isValid: false,
      errors: [error.message]
    };
  }
}

module.exports = { validateConfig };