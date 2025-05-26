#!/usr/bin/env node
// scripts/environment-manager.js

const { Command } = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const Table = require('cli-table3');
const fs = require('fs').promises;
const path = require('path');

// Імпортуємо наші сервіси
const { getBinanceClientFactory } = require('../src/services/binance/client-factory');
const config = require('../src/config');
const logger = require('../src/utils/logger');

/**
 * CLI утиліта для керування середовищами Binance
 */
class EnvironmentCLI {
  constructor() {
    this.program = new Command();
    this.clientFactory = null;
    this.setupCommands();
  }

  /**
   * Налаштування команд CLI
   */
  setupCommands() {
    this.program
      .name('environment-manager')
      .description('Утиліта для керування середовищами Binance (testnet/mainnet)')
      .version('1.0.0');

    // Команда для показу поточного статусу
    this.program
      .command('status')
      .description('Показати статус всіх середовищ')
      .option('-v, --verbose', 'Детальний вивід')
      .action((options) => this.showStatus(options));

    // Команда для валідації середовищ
    this.program
      .command('validate')
      .description('Валідувати всі налаштовані середовища')
      .option('-e, --environment <env>', 'Валідувати конкретне середовище')
      .action((options) => this.validateEnvironments(options));

    // Команда для перемикання середовища
    this.program
      .command('switch <environment>')
      .description('Перемкнути на інше середовище (testnet/mainnet)')
      .action((environment) => this.switchEnvironment(environment));

    // Команда для тестування з'єднання
    this.program
      .command('test <environment>')
      .description('Протестувати з\'єднання з конкретним середовищем')
      .option('--orders', 'Тестувати розміщення тестових ордерів')
      .option('--balance', 'Перевірити баланс')
      .action((environment, options) => this.testEnvironment(environment, options));

    // Команда для налаштування
    this.program
      .command('setup')
      .description('Інтерактивне налаштування середовищ')
      .action(() => this.interactiveSetup());

    // Команда для експорту конфігурації
    this.program
      .command('export')
      .description('Експортувати конфігурацію середовищ')
      .option('-o, --output <file>', 'Файл для збереження', 'environment-config.json')
      .option('--include-secrets', 'Включити секретні ключі (небезпечно!)')
      .action((options) => this.exportConfiguration(options));

    // Команда для показу рекомендацій
    this.program
      .command('recommendations')
      .description('Показати рекомендації з налаштування')
      .action(() => this.showRecommendations());

    // Команда для очищення кешу
    this.program
      .command('clear-cache')
      .description('Очистити кеш клієнтів')
      .action(() => this.clearCache());
  }

  /**
   * Ініціалізація фабрики клієнтів
   */
  async initializeFactory() {
    if (!this.clientFactory) {
      this.clientFactory = getBinanceClientFactory();
    }
    return this.clientFactory;
  }

  /**
   * Показ статусу середовищ
   */
  async showStatus(options) {
    try {
      console.log(chalk.blue.bold('\n🌍 Статус середовищ Binance\n'));

      await this.initializeFactory();
      const environments = this.clientFactory.environmentManager.getAvailableEnvironments();
      const currentEnv = this.clientFactory.environmentManager.currentEnvironment;

      const table = new Table({
        head: ['Середовище', 'Статус', 'API ключі', 'Реальні гроші', 'WebSocket', 'REST API'].map(h => chalk.white.bold(h)),
        colWidths: [12, 10, 12, 15, 25, 35]
      });

      for (const env of environments) {
        const isCurrent = env.name === currentEnv;
        const statusIcon = isCurrent ? chalk.green('✅ Активне') : chalk.gray('⚪ Доступне');
        const realMoneyIcon = env.features.realTrading ? chalk.red('💰 ТАК') : chalk.green('🧪 НІ');
        const apiKeysIcon = env.hasApiKeys ? chalk.green('✅ Так') : chalk.red('❌ Ні');

        table.push([
          isCurrent ? chalk.green.bold(env.displayName) : env.displayName,
          statusIcon,
          apiKeysIcon,
          realMoneyIcon,
          env.endpoints.websocket,
          env.endpoints.rest
        ]);
      }

      console.log(table.toString());

      if (options.verbose) {
        console.log(chalk.blue('\n📊 Детальна інформація:\n'));
        
        const stats = this.clientFactory.getClientStatistics();
        console.log(`Поточне середовище: ${chalk.yellow(stats.currentEnvironment)}`);
        console.log(`Кешовані клієнти: ${chalk.cyan(stats.cachedClients.join(', ') || 'немає')}`);
        console.log(`Доступні середовища: ${chalk.cyan(stats.environmentsAvailable.join(', '))}`);

        if (stats.dailyStats) {
          console.log('\n📈 Денна статистика:');
          console.log(`  Ордерів розміщено: ${stats.dailyStats.ordersPlaced}`);
          console.log(`  Загальний обсяг: $${stats.dailyStats.totalVolume.toFixed(2)}`);
          console.log(`  Прибуток: $${stats.dailyStats.totalProfit.toFixed(2)}`);
          console.log(`  Збитки: $${stats.dailyStats.totalLoss.toFixed(2)}`);
        }

        if (stats.virtualBalance) {
          console.log('\n🧪 Віртуальний баланс:');
          Object.entries(stats.virtualBalance).forEach(([asset, amount]) => {
            console.log(`  ${asset}: ${amount}`);
          });
        }
      }

    } catch (error) {
      console.error(chalk.red('❌ Помилка валідації:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Перемикання середовища
   */
  async switchEnvironment(environment) {
    try {
      console.log(chalk.blue(`\n🔄 Перемикання на середовище: ${chalk.yellow(environment)}\n`));

      await this.initializeFactory();
      
      // Перевіряємо чи існує середовище
      const availableEnvs = this.clientFactory.environmentManager.getAvailableEnvironments();
      const targetEnv = availableEnvs.find(env => env.name === environment);
      
      if (!targetEnv) {
        console.error(chalk.red(`❌ Середовище "${environment}" не існує`));
        console.log(chalk.gray(`Доступні середовища: ${availableEnvs.map(e => e.name).join(', ')}`));
        process.exit(1);
      }

      // Показуємо попередження для mainnet
      if (environment === 'mainnet') {
        console.log(chalk.red.bold('⚠️ УВАГА: Ви перемикаєтесь на MAINNET з РЕАЛЬНИМИ ГРОШИМА!'));
        
        const confirm = await inquirer.prompt([{
          type: 'confirm',
          name: 'proceed',
          message: 'Ви впевнені що хочете перемкнутися на mainnet?',
          default: false
        }]);

        if (!confirm.proceed) {
          console.log(chalk.gray('Перемикання скасовано'));
          return;
        }
      }

      // Виконуємо перемикання
      const newClient = await this.clientFactory.switchEnvironment(environment);
      
      console.log(chalk.green(`✅ Успішно перемкнуто на ${targetEnv.displayName}`));
      
      // Показуємо інформацію про нове середовище
      const envInfo = this.clientFactory.environmentManager.getEnvironmentInfo();
      console.log(chalk.blue('\n📋 Інформація про середовище:'));
      console.log(`  Назва: ${envInfo.displayName}`);
      console.log(`  Реальні гроші: ${envInfo.features.realTrading ? chalk.red('ТАК') : chalk.green('НІ')}`);
      console.log(`  API ключі: ${envInfo.hasApiKeys ? chalk.green('Налаштовані') : chalk.red('Відсутні')}`);
      console.log(`  REST API: ${envInfo.endpoints.rest}`);
      console.log(`  WebSocket: ${envInfo.endpoints.websocket}`);

    } catch (error) {
      console.error(chalk.red('❌ Помилка перемикання середовища:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Тестування конкретного середовища
   */
  async testEnvironment(environment, options) {
    try {
      console.log(chalk.blue(`\n🧪 Тестування середовища: ${chalk.yellow(environment)}\n`));

      await this.initializeFactory();
      
      // Створюємо клієнт для тестування
      const client = this.clientFactory.createClientForEnvironment(environment);
      
      console.log(chalk.gray('Виконання базових тестів...'));

      const tests = [];

      // Тест підключення до API
      try {
        const start = Date.now();
        const exchangeInfo = await client.getExchangeInfo();
        const latency = Date.now() - start;
        
        tests.push({
          name: 'API Підключення',
          status: 'passed',
          details: `Латентність: ${latency}ms, Символів: ${exchangeInfo.symbols.length}`,
          latency
        });
      } catch (error) {
        tests.push({
          name: 'API Підключення',
          status: 'failed',
          details: error.message
        });
      }

      // Тест автентифікації
      if (options.balance) {
        try {
          const accountInfo = await client.getAccountInfo();
          const balanceCount = accountInfo.balances.filter(b => parseFloat(b.free) > 0).length;
          
          tests.push({
            name: 'Автентифікація',
            status: 'passed',
            details: `Доступ до балансу, активних активів: ${balanceCount}`
          });

          // Показуємо баланс
          if (environment === 'testnet' && client.virtualBalance) {
            console.log(chalk.cyan('\n🧪 Віртуальний баланс (testnet):'));
            Object.entries(Object.fromEntries(client.virtualBalance)).forEach(([asset, amount]) => {
              console.log(`  ${asset}: ${amount}`);
            });
          } else {
            console.log(chalk.cyan('\n💰 Основні баланси:'));
            accountInfo.balances
              .filter(b => parseFloat(b.free) > 0)
              .slice(0, 5) // Показуємо тільки перші 5
              .forEach(balance => {
                console.log(`  ${balance.asset}: ${balance.free}`);
              });
          }

        } catch (error) {
          tests.push({
            name: 'Автентифікація',
            status: 'failed',
            details: error.message
          });
        }
      }

      // Тест торгових дозволів
      try {
        const openOrders = await client.getOpenOrders();
        tests.push({
          name: 'Торгові дозволи',
          status: 'passed',
          details: `Доступ до ордерів, відкритих: ${openOrders.length}`
        });
      } catch (error) {
        tests.push({
          name: 'Торгові дозволи',
          status: 'failed',
          details: error.message
        });
      }

      // Спеціальні тести для testnet
      if (environment === 'testnet' && client.validateTestEnvironment) {
        console.log(chalk.gray('Виконання спеціальних testnet тестів...'));
        const testnetValidation = await client.validateTestEnvironment();
        
        testnetValidation.checks.forEach(check => {
          tests.push({
            name: `Testnet: ${check.test}`,
            status: check.status,
            details: check.details
          });
        });
      }

      // Спеціальні тести для mainnet
      if (environment === 'mainnet' && client.healthCheck) {
        console.log(chalk.gray('Виконання перевірки здоров\'я mainnet...'));
        const healthCheck = await client.healthCheck();
        
        healthCheck.checks.forEach(check => {
          tests.push({
            name: `Mainnet: ${check.test}`,
            status: check.status,
            details: check.details
          });
        });
      }

      // Показуємо результати тестів
      const table = new Table({
        head: ['Тест', 'Статус', 'Деталі'].map(h => chalk.white.bold(h)),
        colWidths: [20, 12, 50]
      });

      tests.forEach(test => {
        const statusIcon = test.status === 'passed' ? 
          chalk.green('✅ Пройшов') : 
          test.status === 'warning' ? 
            chalk.yellow('⚠️ Попередження') : 
            chalk.red('❌ Провалено');

        table.push([
          test.name,
          statusIcon,
          test.details
        ]);
      });

      console.log(table.toString());

      // Статистика
      const passed = tests.filter(t => t.status === 'passed').length;
      const failed = tests.filter(t => t.status === 'failed').length;
      const warnings = tests.filter(t => t.status === 'warning').length;

      console.log(chalk.blue(`\n📊 Результати тестування:`));
      console.log(`  Пройшло: ${chalk.green(passed)}`);
      if (warnings > 0) console.log(`  Попереджень: ${chalk.yellow(warnings)}`);
      if (failed > 0) console.log(`  Провалено: ${chalk.red(failed)}`);

      if (failed === 0) {
        console.log(chalk.green(`\n✅ Середовище ${environment} готове до використання!`));
      } else {
        console.log(chalk.red(`\n❌ Середовище ${environment} має проблеми з конфігурацією`));
      }

    } catch (error) {
      console.error(chalk.red('❌ Помилка тестування:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Інтерактивне налаштування
   */
  async interactiveSetup() {
    try {
      console.log(chalk.blue.bold('\n🔧 Інтерактивне налаштування середовищ Binance\n'));

      // Вибір середовища для налаштування
      const { environment } = await inquirer.prompt([{
        type: 'list',
        name: 'environment',
        message: 'Оберіть середовище для налаштування:',
        choices: [
          { name: '🧪 Testnet (рекомендовано для початку)', value: 'testnet' },
          { name: '💰 Mainnet (реальні гроші!)', value: 'mainnet' },
          { name: '📋 Показати поточну конфігурацію', value: 'show' }
        ]
      }]);

      if (environment === 'show') {
        await this.showStatus({ verbose: true });
        return;
      }

      console.log(chalk.yellow(`\n📝 Налаштування ${environment === 'testnet' ? 'Testnet' : 'Mainnet'}`));

      if (environment === 'mainnet') {
        console.log(chalk.red.bold('\n⚠️ УВАГА: Ви налаштовуєте MAINNET з РЕАЛЬНИМИ ГРОШИМА!'));
        console.log(chalk.red('• Всі ордери будуть виконуватися з реальними коштами'));
        console.log(chalk.red('• Переконайтеся в правильності всіх налаштувань'));
        console.log(chalk.red('• Рекомендується спочатку протестувати на testnet\n'));
      }

      // Отримуємо API ключі
      const apiConfig = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: `${environment} API ключ:`,
          validate: (input) => input.length >= 64 || 'API ключ має бути довжиною мінімум 64 символи'
        },
        {
          type: 'password',
          name: 'apiSecret',
          message: `${environment} API секрет:`,
          validate: (input) => input.length >= 64 || 'API секрет має бути довжиною мінімум 64 символи'
        }
      ]);

      // Генеруємо оновлений .env файл
      await this.updateEnvFile(environment, apiConfig);

      console.log(chalk.green('\n✅ Конфігурація збережена!'));
      console.log(chalk.blue('🔄 Перезапустіть додаток для застосування змін\n'));

      // Пропонуємо протестувати
      const { testNow } = await inquirer.prompt([{
        type: 'confirm',
        name: 'testNow',
        message: 'Протестувати налаштоване середовище зараз?',
        default: true
      }]);

      if (testNow) {
        await this.testEnvironment(environment, { balance: true });
      }

    } catch (error) {
      console.error(chalk.red('❌ Помилка налаштування:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Оновлення .env файлу
   */
  async updateEnvFile(environment, apiConfig) {
    const envPath = path.join(process.cwd(), '.env');
    
    try {
      // Читаємо поточний .env файл
      let envContent = '';
      try {
        envContent = await fs.readFile(envPath, 'utf8');
      } catch (error) {
        // Файл не існує, створюємо новий
        envContent = '';
      }

      // Оновлюємо відповідні змінні
      const envVars = environment === 'testnet' ? {
        'BINANCE_TESTNET_API_KEY': apiConfig.apiKey,
        'BINANCE_TESTNET_API_SECRET': apiConfig.apiSecret,
        'BINANCE_TESTNET': 'true'
      } : {
        'BINANCE_API_KEY': apiConfig.apiKey,
        'BINANCE_API_SECRET': apiConfig.apiSecret,
        'BINANCE_TESTNET': 'false'
      };

      // Парсимо існуючий .env
      const envLines = envContent.split('\n');
      const updatedLines = [];
      const updatedVars = new Set();

      // Оновлюємо існуючі змінні
      for (const line of envLines) {
        if (line.trim() === '' || line.startsWith('#')) {
          updatedLines.push(line);
          continue;
        }

        const [key] = line.split('=');
        if (envVars[key]) {
          updatedLines.push(`${key}=${envVars[key]}`);
          updatedVars.add(key);
        } else {
          updatedLines.push(line);
        }
      }

      // Додаємо нові змінні
      for (const [key, value] of Object.entries(envVars)) {
        if (!updatedVars.has(key)) {
          updatedLines.push(`${key}=${value}`);
        }
      }

      // Зберігаємо оновлений файл
      await fs.writeFile(envPath, updatedLines.join('\n'));

    } catch (error) {
      throw new Error(`Помилка оновлення .env файлу: ${error.message}`);
    }
  }

  /**
   * Експорт конфігурації
   */
  async exportConfiguration(options) {
    try {
      console.log(chalk.blue.bold('\n📦 Експорт конфігурації середовищ\n'));

      await this.initializeFactory();
      const configuration = this.clientFactory.exportConfiguration();

      // Видаляємо секрети якщо не запитано
      if (!options.includeSecrets) {
        // Маскуємо чутливі дані
        configuration.environments.forEach(env => {
          if (env.endpoints) {
            // Залишаємо тільки публічну інформацію
            delete env.config;
          }
        });
      }

      const exportData = {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        includesSecrets: options.includeSecrets,
        ...configuration
      };

      await fs.writeFile(options.output, JSON.stringify(exportData, null, 2));

      console.log(chalk.green(`✅ Конфігурацію експортовано в ${options.output}`));
      
      if (options.includeSecrets) {
        console.log(chalk.red('⚠️ УВАГА: Файл містить секретні ключі! Зберігайте його в безпеці.'));
      }

    } catch (error) {
      console.error(chalk.red('❌ Помилка експорту:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Показ рекомендацій
   */
  async showRecommendations() {
    try {
      console.log(chalk.blue.bold('\n💡 Рекомендації з налаштування\n'));

      await this.initializeFactory();
      const recommendations = this.clientFactory.environmentManager.getSetupRecommendations();

      if (recommendations.length === 0) {
        console.log(chalk.green('✅ Всі налаштування оптимальні!'));
        return;
      }

      recommendations.forEach((rec, index) => {
        const icon = rec.type === 'warning' ? '⚠️' : 
                    rec.type === 'security' ? '🔒' : 
                    rec.type === 'info' ? 'ℹ️' : '💡';
        
        console.log(`${index + 1}. ${icon} ${chalk.yellow(rec.message)}`);
        if (rec.action) {
          console.log(`   ${chalk.gray('→')} ${rec.action}\n`);
        }
      });

    } catch (error) {
      console.error(chalk.red('❌ Помилка отримання рекомендацій:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Очищення кешу
   */
  async clearCache() {
    try {
      console.log(chalk.blue.bold('\n🧹 Очищення кешу клієнтів\n'));

      await this.initializeFactory();
      this.clientFactory.clearClientCache();

      console.log(chalk.green('✅ Кеш клієнтів очищено'));

    } catch (error) {
      console.error(chalk.red('❌ Помилка очищення кешу:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Валідація середовищ
   */
  async validateEnvironments(options) {
    try {
      console.log(chalk.blue.bold('\n🔍 Валідація середовищ\n'));

      await this.initializeFactory();

      if (options.environment) {
        // Валідуємо конкретне середовище
        console.log(`Валідація середовища: ${chalk.yellow(options.environment)}`);
        const validation = this.clientFactory.environmentManager.validateEnvironment(options.environment);
        
        if (validation.isValid) {
          console.log(chalk.green('✅ Валідація пройшла успішно'));
        } else {
          console.log(chalk.red('❌ Валідація провалена:'));
          validation.errors.forEach(error => {
            console.log(chalk.red(`  • ${error}`));
          });
        }
      } else {
        // Валідуємо всі середовища
        const results = await this.clientFactory.validateAllEnvironments();
        
        const table = new Table({
          head: ['Середовище', 'Статус', 'Перевірки', 'Деталі'].map(h => chalk.white.bold(h)),
          colWidths: [12, 10, 12, 50]
        });

        for (const [envName, result] of Object.entries(results)) {
          const statusIcon = result.isValid ? chalk.green('✅ Пройшла') : chalk.red('❌ Провалена');
          const checksInfo = result.checks ? 
            `${result.checks.filter(c => c.status === 'passed').length}/${result.checks.length}` : 
            'N/A';
          
          const details = result.isValid ? 
            'Всі перевірки пройшли' : 
            (result.error || result.checks?.filter(c => c.status === 'failed').map(c => c.details).join(', ') || 'Невідома помилка');

          table.push([
            envName,
            statusIcon,
            checksInfo,
            details.length > 45 ? details.substring(0, 42) + '...' : details
          ]);
        }

        console.log(table.toString());

        // Статистика
        const totalEnvs = Object.keys(results).length;
        const validEnvs = Object.values(results).filter(r => r.isValid).length;
        
        console.log(chalk.blue(`\n📊 Результат: ${validEnvs}/${totalEnvs} середовищ пройшли валідацію`));
        
        if (validEnvs === 0) {
          console.log(chalk.red('\n⚠️ Жодне середовище не пройшло валідацію! Перевірте налаштування API ключів.'));
        }
      }

    } catch (error) {
      console.error(chalk.red('❌ Помилка валідації:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Запуск CLI
   */
  run() {
    this.program.parse();
  }
}

// Запуск CLI якщо це головний файл
if (require.main === module) {
  const cli = new EnvironmentCLI();
  cli.run();
}

module.exports = { EnvironmentCLI };