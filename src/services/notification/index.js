// src/services/notification/index.js

const TelegramBot = require('node-telegram-bot-api');
const nodemailer = require('nodemailer');
const axios = require('axios');
const config = require('../../config');
const logger = require('../../utils/logger');
const constants = require('../../config/constants');

/**
 * Сервіс для відправки сповіщень (Telegram, Email, Discord)
 */
class NotificationService {
  constructor() {
    this.telegramBot = null;
    this.emailTransporter = null;
    this.isInitialized = false;
  }

  /**
   * Ініціалізація сервісу сповіщень
   */
  async initialize() {
    try {
      logger.info('🔔 Ініціалізація сервісу сповіщень...');
      
      // Ініціалізація Telegram бота
      if (config.notifications.telegram.enabled) {
        await this.initializeTelegram();
      }
      
      // Ініціалізація Email
      if (config.notifications.email.enabled) {
        await this.initializeEmail();
      }
      
      this.isInitialized = true;
      logger.info('✅ Сервіс сповіщень ініціалізовано');
      
    } catch (error) {
      logger.error('❌ Помилка ініціалізації сервісу сповіщень:', error);
      // Продовжуємо роботу навіть без сповіщень
    }
  }

  /**
   * Ініціалізація Telegram бота
   */
  async initializeTelegram() {
    try {
      const token = config.notifications.telegram.botToken;
      
      if (!token) {
        throw new Error('Не вказано токен Telegram бота');
      }
      
      this.telegramBot = new TelegramBot(token, { polling: false });
      logger.info('✅ Telegram бот ініціалізовано');
      
      // Відправляємо тестове повідомлення
      await this.sendTelegramMessage('🤖 Бінанс лістинг бот запущено!');
      
    } catch (error) {
      logger.error('❌ Помилка ініціалізації Telegram бота:', error);
      this.telegramBot = null;
    }
  }

  /**
   * Ініціалізація Email транспорту
   */
  async initializeEmail() {
    try {
      const { smtp } = config.notifications.email;
      
      if (!smtp.host || !smtp.user || !smtp.pass) {
        throw new Error('Не вказані SMTP налаштування');
      }
      
      this.emailTransporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass
        }
      });
      
      // Перевіряємо підключення
      await this.emailTransporter.verify();
      logger.info('✅ Email транспорт ініціалізовано');
      
    } catch (error) {
      logger.error('❌ Помилка ініціалізації Email транспорту:', error);
      this.emailTransporter = null;
    }
  }

  /**
   * Відправка сповіщення
   */
  async send(type, data) {
    if (!this.isInitialized) {
      logger.warn('⚠️ Сервіс сповіщень не ініціалізовано');
      return false;
    }
    
    try {
      let notificationType = constants.NOTIFICATION_TYPES.INFO;
      let title = '';
      let message = '';
      
      // Формуємо сповіщення в залежності від типу
      switch (type) {
        case 'new_listing':
          if (!config.notifications.telegram.notifyOnNewListing) return;
          
          title = '🎉 Новий лістинг';
          message = this.formatNewListingMessage(data);
          break;
          
        case 'buy_executed':
          if (!config.notifications.telegram.notifyOnBuy) return;
          
          title = '🛒 Виконано покупку';
          message = this.formatBuyMessage(data);
          break;
          
        case 'take_profit_hit':
        case 'stop_loss_hit':
        case 'position_closed':
          if (!config.notifications.telegram.notifyOnSell) return;
          
          title = type === 'take_profit_hit' ? '💰 Take Profit' : '🛑 Stop Loss';
          message = this.formatSellMessage(data);
          break;
          
        case 'error':
          if (!config.notifications.telegram.notifyOnError) return;
          
          notificationType = constants.NOTIFICATION_TYPES.ERROR;
          title = '❌ Помилка';
          message = this.formatErrorMessage(data);
          break;
          
        case 'warning':
          notificationType = constants.NOTIFICATION_TYPES.WARNING;
          title = '⚠️ Попередження';
          message = this.formatWarningMessage(data);
          break;
          
        case 'bot_started':
          title = '🚀 Бот запущено';
          message = this.formatBotStartedMessage(data);
          break;
          
        case 'bot_stopped':
          title = '⏹️ Бот зупинено';
          message = this.formatBotStoppedMessage(data);
          break;
          
        default:
          title = 'ℹ️ Інформація';
          message = JSON.stringify(data, null, 2);
      }
      
      // Відправляємо сповіщення через різні канали
      const results = await Promise.all([
        this.sendTelegramMessage(`${title}\n\n${message}`),
        this.sendEmailNotification(title, message, notificationType),
        this.sendDiscordNotification(title, message, notificationType)
      ]);
      
      return results.some(r => r === true);
      
    } catch (error) {
      logger.error(`❌ Помилка відправки сповіщення типу ${type}:`, error);
      return false;
    }
  }

  /**
   * Відправка повідомлення в Telegram
   */
  async sendTelegramMessage(message) {
    if (!this.telegramBot) return false;
    
    try {
      const chatId = config.notifications.telegram.chatId;
      
      if (!chatId) {
        logger.warn('⚠️ Не вказано ID чату Telegram');
        return false;
      }
      
      await this.telegramBot.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
      });
      
      return true;
    } catch (error) {
      logger.error('❌ Помилка відправки повідомлення Telegram:', error);
      return false;
    }
  }

  /**
   * Відправка Email сповіщення
   */
  async sendEmailNotification(subject, message, type) {
    if (!this.emailTransporter) return false;
    
    try {
      const { from, to } = config.notifications.email;
      
      if (!from || !to) {
        logger.warn('⚠️ Не вказані Email адреси');
        return false;
      }
      
      // Форматуємо HTML для Email
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: ${this.getColorForType(type)};">${subject}</h2>
          <pre style="background-color: #f5f5f5; padding: 15px; border-radius: 5px;">${message}</pre>
          <p style="color: #888; font-size: 12px;">Binance Listing Bot - ${new Date().toISOString()}</p>
        </div>
      `;
      
      const mailOptions = {
        from,
        to,
        subject: `[Binance Bot] ${subject}`,
        text: message,
        html
      };
      
      await this.emailTransporter.sendMail(mailOptions);
      
      return true;
    } catch (error) {
      logger.error('❌ Помилка відправки Email:', error);
      return false;
    }
  }

  /**
   * Відправка Discord сповіщення
   */
  async sendDiscordNotification(title, message, type) {
    if (!config.notifications.discord.enabled) return false;
    
    try {
      const webhookUrl = config.notifications.discord.webhookUrl;
      
      if (!webhookUrl) {
        logger.warn('⚠️ Не вказано URL Discord webhook');
        return false;
      }
      
      const embed = {
        title,
        description: '```' + message + '```',
        color: this.getDiscordColorForType(type),
        timestamp: new Date().toISOString()
      };
      
      await axios.post(webhookUrl, {
        username: 'Binance Listing Bot',
        embeds: [embed]
      });
      
      return true;
    } catch (error) {
      logger.error('❌ Помилка відправки Discord сповіщення:', error);
      return false;
    }
  }

  /**
   * Форматування повідомлення про новий лістинг
   */
  formatNewListingMessage(data) {
    return `Символ: *${data.symbol}*
Ціна: ${data.price}
Обсяг: ${data.quoteVolume ? data.quoteVolume.toLocaleString() : 'Н/Д'} USDT
Час: ${new Date(data.timestamp).toLocaleString()}`;
  }

  /**
   * Форматування повідомлення про покупку
   */
  formatBuyMessage(data) {
    const { position, order } = data;
    
    return `Символ: *${position.symbol}*
Ціна: ${position.entryPrice}
Кількість: ${position.quantity}
Сума: ${(position.entryPrice * position.quantity).toFixed(2)} USDT
Статус: ${position.status}
Час: ${new Date(position.entryTime).toLocaleString()}`;
  }

  /**
   * Форматування повідомлення про продаж
   */
  formatSellMessage(data) {
    const { position } = data;
    
    return `Символ: *${position.symbol}*
Ціна входу: ${position.entryPrice}
Ціна виходу: ${position.exitPrice}
Кількість: ${position.quantity}
P&L: ${position.pnl ? position.pnl.toFixed(2) : 'Н/Д'} USDT (${position.pnlPercent ? position.pnlPercent.toFixed(2) : 'Н/Д'}%)
Причина: ${position.closeReason}
Час: ${new Date(position.exitTime).toLocaleString()}`;
  }

  /**
   * Форматування повідомлення про помилку
   */
  formatErrorMessage(data) {
    let message = `Тип: ${data.type}\n`;
    
    if (data.symbol) {
      message += `Символ: ${data.symbol}\n`;
    }
    
    message += `Помилка: ${data.error}\n`;
    
    if (data.data) {
      message += `Дані: ${JSON.stringify(data.data, null, 2)}`;
    }
    
    return message;
  }

  /**
   * Форматування повідомлення про попередження
   */
  formatWarningMessage(data) {
    return `Тип: ${data.type}\nПовідомлення: ${data.message}`;
  }

  /**
   * Форматування повідомлення про запуск бота
   */
  formatBotStartedMessage(data) {
    let message = `Середовище: ${data.environment}\n`;
    
    if (data.testnet) {
      message += `Режим: Testnet\n`;
    }
    
    if (data.simulationMode) {
      message += `Симуляція: Увімкнена\n`;
    }
    
    return message;
  }

  /**
   * Форматування повідомлення про зупинку бота
   */
  formatBotStoppedMessage(data) {
    const uptime = this.formatUptime(data.uptime);
    return `Час роботи: ${uptime}`;
  }

  /**
   * Форматування uptime
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let result = '';
    
    if (days > 0) {
      result += `${days}д `;
    }
    
    if (hours > 0 || days > 0) {
      result += `${hours}г `;
    }
    
    if (minutes > 0 || hours > 0 || days > 0) {
      result += `${minutes}хв `;
    }
    
    result += `${secs}с`;
    
    return result;
  }

  /**
   * Отримання кольору для типу сповіщення
   */
  getColorForType(type) {
    switch (type) {
      case constants.NOTIFICATION_TYPES.SUCCESS:
        return '#28a745';
      case constants.NOTIFICATION_TYPES.WARNING:
        return '#ffc107';
      case constants.NOTIFICATION_TYPES.ERROR:
        return '#dc3545';
      case constants.NOTIFICATION_TYPES.CRITICAL:
        return '#6610f2';
      default:
        return '#17a2b8';
    }
  }

  /**
   * Отримання коду кольору для Discord
   */
  getDiscordColorForType(type) {
    switch (type) {
      case constants.NOTIFICATION_TYPES.SUCCESS:
        return 3066993; // зелений
      case constants.NOTIFICATION_TYPES.WARNING:
        return 16776960; // жовтий
      case constants.NOTIFICATION_TYPES.ERROR:
        return 15158332; // червоний
      case constants.NOTIFICATION_TYPES.CRITICAL:
        return 10181046; // фіолетовий
      default:
        return 3447003; // синій
    }
  }

  /**
   * Отримання статусу сервісу
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      telegramEnabled: !!this.telegramBot,
      emailEnabled: !!this.emailTransporter,
      discordEnabled: config.notifications.discord.enabled
    };
  }
}

module.exports = { NotificationService };