// src/services/binance/environment-manager.js

const logger = require('../../utils/logger');
const config = require('../../config');

/**
 * Менеджер середовищ для керування testnet та mainnet конфігураціями
 */
class EnvironmentManager {
  constructor() {
    this.currentEnvironment = config.binance.useTestnet ? 'testnet' : 'mainnet';
    this.environments = new Map();
    
    // Ініціалізуємо середовища
    this.initializeEnvironments();
  }

  /**
   * Ініціалізація всіх середовищ
   */
  initializeEnvironments() {
    // Testnet середовище
    this.environments.set('testnet', {
      name: 'testnet',
      displayName: 'Testnet',
      config: config.binance.testnet,
      features: {
        realTrading: false,
        virtualMoney: true,
        fullAPI: true,
        websocket: true,
        orderLimits: {
          maxOrderValue: 1000000, // Більші ліміти на testnet
          maxPositions: 50
        }
      },
      validation: {
        requiredKeys: ['apiKey', 'apiSecret'],
        minKeyLength: 64
      }
    });

    // Mainnet середовище
    this.environments.set('mainnet', {
      name: 'mainnet',
      displayName: 'Mainnet (Production)',
      config: config.binance.mainnet,
      features: {
        realTrading: true,
        virtualMoney: false,
        fullAPI: true,
        websocket: true,
        orderLimits: {
          maxOrderValue: config.trading.maxOrderSize,
          maxPositions: config.trading.maxPositions
        }
      },
      validation: {
        requiredKeys: ['apiKey', 'apiSecret'],
        minKeyLength: 64,
        additionalChecks: [
          'validateIPRestrictions',
          'validatePermissions'
        ]
      }
    });

    logger.info(`🌍 Ініціалізовано середовища: ${Array.from(this.environments.keys()).join(', ')}`);
    logger.info(`📍 Поточне середовище: ${this.currentEnvironment}`);
  }

  /**
   * Отримання поточного середовища
   */
  getCurrentEnvironment() {
    return this.environments.get(this.currentEnvironment);
  }

  /**
   * Отримання конфігурації поточного середовища
   */
  getCurrentConfig() {
    const environment = this.getCurrentEnvironment();
    if (!environment) {
      throw new Error(`Середовище ${this.currentEnvironment} не знайдено`);
    }
    return environment.config;
  }

  /**
   * Перемикання середовища
   */
  switchEnvironment(environmentName) {
    if (!this.environments.has(environmentName)) {
      throw new Error(`Середовище ${environmentName} не існує`);
    }

    const oldEnvironment = this.currentEnvironment;
    this.currentEnvironment = environmentName;

    logger.warn(`🔄 Перемикання середовища: ${oldEnvironment} → ${environmentName}`);
    
    // Валідуємо нове середовище
    const validationResult = this.validateEnvironment(environmentName);
    if (!validationResult.isValid) {
      // Повертаємо назад при помилці
      this.currentEnvironment = oldEnvironment;
      throw new Error(`Помилка валідації середовища ${environmentName}: ${validationResult.errors.join(', ')}`);
    }

    return this.getCurrentEnvironment();
  }

  /**
   * Валідація середовища
   */
  validateEnvironment(environmentName = this.currentEnvironment) {
    const environment = this.environments.get(environmentName);
    if (!environment) {
      return {
        isValid: false,
        errors: [`Середовище ${environmentName} не знайдено`]
      };
    }

    const errors = [];
    const { config, validation } = environment;

    // Перевіряємо обов'язкові ключі
    for (const key of validation.requiredKeys) {
      if (!config[key] || config[key].trim() === '') {
        errors.push(`Відсутній обов'язковий параметр: ${key}`);
      } else if (config[key].length < validation.minKeyLength) {
        errors.push(`${key} має бути довжиною мінімум ${validation.minKeyLength} символів`);
      }
    }

    // Перевіряємо URL
    if (!this.isValidUrl(config.baseURL)) {
      errors.push('Некоректний baseURL');
    }

    if (!this.isValidWebSocketUrl(config.wsBaseURL)) {
      errors.push('Некоректний wsBaseURL');
    }

    // Додаткові перевірки для mainnet
    if (environmentName === 'mainnet' && validation.additionalChecks) {
      // Попередження про реальні гроші
      if (environment.features.realTrading) {
        logger.warn('⚠️ УВАГА: Увімкнено торгівлю реальними коштами на MAINNET!');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Перевірка валідності URL
   */
  isValidUrl(url) {
    try {
      new URL(url);
      return url.startsWith('https://');
    } catch {
      return false;
    }
  }

  /**
   * Перевірка валідності WebSocket URL
   */
  isValidWebSocketUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.protocol === 'wss:';
    } catch {
      return false;
    }
  }

  /**
   * Отримання функцій середовища
   */
  getEnvironmentFeatures(environmentName = this.currentEnvironment) {
    const environment = this.environments.get(environmentName);
    return environment ? environment.features : null;
  }

  /**
   * Перевірка чи дозволена операція в поточному середовищі
   */
  isOperationAllowed(operation, value = null) {
    const features = this.getEnvironmentFeatures();
    if (!features) return false;

    switch (operation) {
      case 'realTrading':
        return features.realTrading;
      
      case 'orderValue':
        return value <= features.orderLimits.maxOrderValue;
      
      case 'positions':
        return value <= features.orderLimits.maxPositions;
      
      case 'websocket':
        return features.websocket;
      
      default:
        return true;
    }
  }

  /**
   * Отримання безпечної інформації про середовище (без секретів)
   */
  getEnvironmentInfo(environmentName = this.currentEnvironment) {
    const environment = this.environments.get(environmentName);
    if (!environment) return null;

    return {
      name: environment.name,
      displayName: environment.displayName,
      features: environment.features,
      endpoints: {
        rest: environment.config.baseURL,
        websocket: environment.config.wsBaseURL,
        wsApi: environment.config.wsApiBaseURL
      },
      hasApiKeys: !!(environment.config.apiKey && environment.config.apiSecret)
    };
  }

  /**
   * Отримання списку всіх доступних середовищ
   */
  getAvailableEnvironments() {
    return Array.from(this.environments.keys()).map(name => this.getEnvironmentInfo(name));
  }

  /**
   * Генерація рекомендацій для налаштування
   */
  getSetupRecommendations() {
    const recommendations = [];

    if (this.currentEnvironment === 'mainnet') {
      recommendations.push({
        type: 'warning',
        message: 'Рекомендовано спочатку протестувати на testnet',
        action: 'Встановіть BINANCE_TESTNET=true в .env файлі'
      });
    }

    if (this.currentEnvironment === 'testnet') {
      recommendations.push({
        type: 'info',
        message: 'Використовуються тестові кошти',
        action: 'Переключіться на mainnet коли будете готові'
      });
    }

    // Перевіряємо налаштування безпеки
    if (!config.security.ipWhitelist.enabled && this.currentEnvironment === 'mainnet') {
      recommendations.push({
        type: 'security',
        message: 'Рекомендовано увімкнути IP whitelist для mainnet',
        action: 'Встановіть IP_WHITELIST_ENABLED=true'
      });
    }

    return recommendations;
  }

  /**
   * Експорт конфігурації середовища
   */
  exportEnvironmentConfig(includeSecrets = false) {
    const environment = this.getCurrentEnvironment();
    const config = { ...environment.config };

    if (!includeSecrets) {
      // Маскуємо секретні дані
      if (config.apiKey) {
        config.apiKey = config.apiKey.substring(0, 8) + '...';
      }
      delete config.apiSecret;
    }

    return {
      environment: environment.name,
      config,
      features: environment.features
    };
  }
}

module.exports = { EnvironmentManager };