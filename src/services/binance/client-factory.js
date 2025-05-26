// src/services/binance/client-factory.js

const { BinanceClient } = require('./client');
const { TestnetClient } = require('./testnet-client');
const { MainnetClient } = require('./mainnet-client');
const { EnvironmentManager } = require('./environment-manager');
const logger = require('../../utils/logger');
const config = require('../../config');

/**
 * Фабрика для створення відповідного клієнта Binance
 * на основі налаштувань середовища
 */
class BinanceClientFactory {
  constructor() {
    this.clients = new Map();
    this.currentEnvironment = null;
    this.environmentManager = new EnvironmentManager();
  }

  /**
   * Отримання клієнта для поточного середовища
   */
  getCurrentClient() {
    if (!this.currentEnvironment) {
      throw new Error('No active environment');
    }
    return this.clients.get(this.currentEnvironment);
  }

  /**
   * Перемикання середовища
   */
  async switchEnvironment(environment) {
    // Якщо вже в цьому середовищі, просто повертаємо поточного клієнта
    if (this.currentEnvironment === environment) {
      return this.getCurrentClient();
    }

    // Валідуємо нове середовище
    const validation = await this.environmentManager.validateEnvironment(environment);
    if (!validation.isValid) {
      throw new Error(`Invalid environment: ${validation.errors.join(', ')}`);
    }

    // Створюємо клієнт для нового середовища
    const client = new BinanceClient(environment);
    this.clients.set(environment, client);
    
    // Оновлюємо поточне середовище
    this.currentEnvironment = environment;
    
    return client;
  }

  /**
   * Валідація всіх середовищ
   */
  async validateAllEnvironments() {
    const results = {};
    const environments = this.environmentManager.getAvailableEnvironments();
    
    for (const env of environments) {
      try {
        const validation = await this.environmentManager.validateEnvironment(env.name);
        results[env.name] = {
          isValid: validation.isValid,
          checks: validation.checks
        };
      } catch (error) {
        results[env.name] = {
          isValid: false,
          error: error.message
        };
      }
    }
    
    return results;
  }

  /**
   * Очищення кешу клієнтів
   */
  clearClientCache() {
    this.clients.clear();
    this.currentEnvironment = null;
  }

  /**
   * Створення клієнта для конкретного середовища (без перемикання поточного)
   */
  createClientForEnvironment(environmentName) {
    const originalEnv = this.environmentManager.currentEnvironment;
    
    try {
      // Тимчасово перемикаємо середовище
      this.environmentManager.switchEnvironment(environmentName);
      const client = this.getCurrentClient();
      
      // Повертаємо оригінальне середовище
      this.environmentManager.switchEnvironment(originalEnv);
      
      return client;
    } catch (error) {
      // Відновлюємо оригінальне середовище у випадку помилки
      this.environmentManager.switchEnvironment(originalEnv);
      throw error;
    }
  }

  /**
   * Автоматичний вибір найкращого середовища
   */
  async autoSelectEnvironment() {
    const validationResults = await this.validateAllEnvironments();
    
    // Пріоритет: testnet для розробки, mainnet для продакшену
    const preferredOrder = config.isDevelopment 
      ? ['testnet', 'mainnet']
      : ['mainnet', 'testnet'];

    for (const envName of preferredOrder) {
      if (validationResults[envName] && validationResults[envName].isValid) {
        logger.info(`🎯 Автоматично обрано середовище: ${envName}`);
        return this.switchEnvironment(envName);
      }
    }

    throw new Error('Жодне середовище не пройшло валідацію');
  }

  /**
   * Отримання статистики по клієнтах
   */
  getClientStatistics() {
    const stats = {
      currentEnvironment: this.environmentManager.currentEnvironment,
      cachedClients: Array.from(this.clients.keys()),
      hasCurrentClient: !!this.currentEnvironment,
      environmentsAvailable: this.environmentManager.getAvailableEnvironments().map(e => e.name)
    };

    // Додаємо статистику поточного клієнта
    if (this.currentEnvironment) {
      if (this.clients.get(this.currentEnvironment).dailyStats) {
        stats.dailyStats = this.clients.get(this.currentEnvironment).dailyStats;
      }
      if (this.clients.get(this.currentEnvironment).virtualBalance) {
        stats.virtualBalance = Object.fromEntries(this.clients.get(this.currentEnvironment).virtualBalance);
      }
    }

    return stats;
  }

  /**
   * Експорт конфігурації всіх клієнтів
   */
  exportConfiguration() {
    return {
      factory: {
        currentEnvironment: this.environmentManager.currentEnvironment,
        cachedEnvironments: Array.from(this.clients.keys())
      },
      environments: this.environmentManager.getAvailableEnvironments(),
      recommendations: this.environmentManager.getSetupRecommendations(),
      statistics: this.getClientStatistics()
    };
  }

  /**
   * Безпечне завершення роботи всіх клієнтів
   */
  async shutdown() {
    logger.info('🔒 Завершення роботи фабрики клієнтів...');
    
    const shutdownPromises = [];

    // Завершуємо роботу всіх закешованих клієнтів
    for (const [envName, client] of this.clients.entries()) {
      if (client.safeShutdown) {
        shutdownPromises.push(
          client.safeShutdown().catch(error => {
            logger.error(`Помилка завершення клієнта ${envName}:`, error);
          })
        );
      }
    }

    await Promise.allSettled(shutdownPromises);
    
    this.clearClientCache();
    
    logger.info('✅ Фабрика клієнтів завершила роботу');
  }
}

// Синглтон для фабрики
let factoryInstance = null;

function getBinanceClientFactory() {
  if (!factoryInstance) {
    factoryInstance = new BinanceClientFactory();
  }
  return factoryInstance;
}

module.exports = {
  BinanceClientFactory,
  getBinanceClientFactory
};