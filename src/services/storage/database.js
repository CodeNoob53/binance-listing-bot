// src/services/storage/database.js

const { Sequelize, DataTypes, Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Сервіс для роботи з базою даних
 */
class DatabaseService {
  constructor() {
    this.sequelize = null;
    this.models = {};
    this.isConnected = false;
  }

  /**
   * Підключення до бази даних
   */
  async connect() {
    try {
      logger.info('🔌 Підключення до бази даних...');
      
      // Створюємо підключення в залежності від типу БД
      if (config.database.type === 'sqlite') {
        // Перевіряємо наявність директорії
        const dbDir = path.dirname(config.database.sqlite.filename);
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }
        
        this.sequelize = new Sequelize({
          dialect: 'sqlite',
          storage: config.database.sqlite.filename,
          logging: config.database.logging ? console.log : false,
          define: {
            timestamps: true,
            underscored: true
          }
        });
        
      } else if (config.database.type === 'postgresql') {
        this.sequelize = new Sequelize(
          config.database.postgresql.database,
          config.database.postgresql.username,
          config.database.postgresql.password,
          {
            host: config.database.postgresql.host,
            port: config.database.postgresql.port,
            dialect: 'postgres',
            logging: config.database.logging ? console.log : false,
            pool: {
              min: config.database.pool.min,
              max: config.database.pool.max
            },
            define: {
              timestamps: true,
              underscored: true
            }
          }
        );
      } else {
        throw new Error(`Непідтримуваний тип бази даних: ${config.database.type}`);
      }
      
      // Перевіряємо підключення
      await this.sequelize.authenticate();
      logger.info('✅ Підключення до бази даних успішне');
      
      // Ініціалізуємо моделі
      this.defineModels();
      
      // Синхронізуємо модель з БД
      await this.sequelize.sync();
      
      this.isConnected = true;
      
    } catch (error) {
      logger.error('❌ Помилка підключення до бази даних:', error);
      throw error;
    }
  }

  /**
   * Визначення моделей
   */
  defineModels() {
    // Модель позиції
    this.models.Position = this.sequelize.define('Position', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      symbol: {
        type: DataTypes.STRING,
        allowNull: false
      },
      orderId: {
        type: DataTypes.BIGINT,
        allowNull: false
      },
      side: {
        type: DataTypes.STRING,
        allowNull: false
      },
      quantity: {
        type: DataTypes.FLOAT,
        allowNull: false
      },
      entryPrice: {
        type: DataTypes.FLOAT,
        allowNull: false
      },
      entryTime: {
        type: DataTypes.DATE,
        allowNull: false
      },
      exitPrice: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      exitTime: {
        type: DataTypes.DATE,
        allowNull: true
      },
      takeProfitPrice: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      stopLossPrice: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      tpOrderId: {
        type: DataTypes.BIGINT,
        allowNull: true
      },
      slOrderId: {
        type: DataTypes.BIGINT,
        allowNull: true
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false
      },
      closeReason: {
        type: DataTypes.STRING,
        allowNull: true
      },
      pnl: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      pnlPercent: {
        type: DataTypes.FLOAT,
        allowNull: true
      }
    }, {
      tableName: 'positions',
      indexes: [
        {
          unique: false,
          fields: ['symbol']
        },
        {
          unique: false,
          fields: ['status']
        }
      ]
    });
    
    // Модель лістингу
    this.models.Listing = this.sequelize.define('Listing', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      symbol: {
        type: DataTypes.STRING,
        allowNull: false
      },
      price: {
        type: DataTypes.FLOAT,
        allowNull: false
      },
      volume: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      quoteVolume: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      priceChange: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      priceChangePercent: {
        type: DataTypes.FLOAT,
        allowNull: true
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false
      },
      processed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
      }
    }, {
      tableName: 'listings',
      indexes: [
        {
          unique: true,
          fields: ['symbol']
        }
      ]
    });
    
    // Модель помилок
    this.models.Error = this.sequelize.define('Error', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false
      },
      symbol: {
        type: DataTypes.STRING,
        allowNull: true
      },
      error: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      data: {
        type: DataTypes.JSON,
        allowNull: true
      },
      timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'errors'
    });
    
    // Модель логів
    this.models.Log = this.sequelize.define('Log', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      level: {
        type: DataTypes.STRING,
        allowNull: false
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false
      },
      context: {
        type: DataTypes.JSON,
        allowNull: true
      },
      timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
      }
    }, {
      tableName: 'logs'
    });
    
    // Модель для статистики
    this.models.Statistic = this.sequelize.define('Statistic', {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
      },
      date: {
        type: DataTypes.DATEONLY,
        allowNull: false
      },
      tradesCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      winCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      lossCount: {
        type: DataTypes.INTEGER,
        defaultValue: 0
      },
      totalProfit: {
        type: DataTypes.FLOAT,
        defaultValue: 0
      },
      totalLoss: {
        type: DataTypes.FLOAT,
        defaultValue: 0
      },
      startBalance: {
        type: DataTypes.FLOAT,
        allowNull: false
      },
      endBalance: {
        type: DataTypes.FLOAT,
        allowNull: false
      }
    }, {
      tableName: 'statistics',
      indexes: [
        {
          unique: true,
          fields: ['date']
        }
      ]
    });
  }

  /**
   * Збереження позиції
   */
  async savePosition(position) {
    try {
      return await this.models.Position.create(position);
    } catch (error) {
      logger.error('❌ Помилка збереження позиції:', error);
      throw error;
    }
  }

  /**
   * Оновлення позиції
   */
  async updatePosition(position) {
    try {
      const { symbol, orderId } = position;
      
      const [updatedRows] = await this.models.Position.update(
        position,
        {
          where: {
            symbol,
            orderId
          }
        }
      );
      
      return updatedRows > 0;
    } catch (error) {
      logger.error('❌ Помилка оновлення позиції:', error);
      throw error;
    }
  }

  /**
   * Отримання активних позицій
   */
  async getActivePositions() {
    try {
      return await this.models.Position.findAll({
        where: {
          status: {
            [Op.notIn]: [config.constants.POSITION_STATUS.CLOSED]
          }
        },
        order: [['entryTime', 'DESC']]
      });
    } catch (error) {
      logger.error('❌ Помилка отримання активних позицій:', error);
      throw error;
    }
  }

  /**
   * Отримання позиції за символом
   */
  async getPositionBySymbol(symbol) {
    try {
      return await this.models.Position.findOne({
        where: {
          symbol,
          status: {
            [Op.notIn]: [config.constants.POSITION_STATUS.CLOSED]
          }
        }
      });
    } catch (error) {
      logger.error(`❌ Помилка отримання позиції для ${symbol}:`, error);
      throw error;
    }
  }

  /**
   * Збереження лістингу
   */
  async saveListing(listing) {
    try {
      return await this.models.Listing.create({
        ...listing,
        timestamp: new Date(listing.timestamp)
      });
    } catch (error) {
      // Обробка помилки унікальності
      if (error.name === 'SequelizeUniqueConstraintError') {
        logger.warn(`⚠️ Лістинг ${listing.symbol} вже існує`);
        return null;
      }
      
      logger.error('❌ Помилка збереження лістингу:', error);
      throw error;
    }
  }

  /**
   * Збереження помилки
   */
  async saveError(error) {
    try {
      return await this.models.Error.create({
        ...error,
        timestamp: new Date()
      });
    } catch (err) {
      logger.error('❌ Помилка збереження помилки в БД:', err);
      return null;
    }
  }

  /**
   * Збереження логу в БД
   */
  async saveLog(log) {
    try {
      return await this.models.Log.create({
        ...log,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Помилка збереження логу в БД:', error);
      return null;
    }
  }

  /**
   * Оновлення статистики за день
   */
  async updateDailyStatistics(stats) {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      const [statistic, created] = await this.models.Statistic.findOrCreate({
        where: { date: today },
        defaults: {
          date: today,
          ...stats
        }
      });
      
      if (!created) {
        await statistic.update(stats);
      }
      
      return statistic;
    } catch (error) {
      logger.error('❌ Помилка оновлення статистики:', error);
      throw error;
    }
  }

  /**
   * Отримання статистики за період
   */
  async getStatistics(startDate, endDate) {
    try {
      return await this.models.Statistic.findAll({
        where: {
          date: {
            [Op.between]: [startDate, endDate]
          }
        },
        order: [['date', 'ASC']]
      });
    } catch (error) {
      logger.error('❌ Помилка отримання статистики:', error);
      throw error;
    }
  }

  /**
   * Отримання закритих позицій за період
   */
  async getClosedPositions(startDate, endDate) {
    try {
      return await this.models.Position.findAll({
        where: {
          status: config.constants.POSITION_STATUS.CLOSED,
          exitTime: {
            [Op.between]: [startDate, endDate]
          }
        },
        order: [['exitTime', 'DESC']]
      });
    } catch (error) {
      logger.error('❌ Помилка отримання закритих позицій:', error);
      throw error;
    }
  }

  /**
   * Отримання всіх позицій з фільтрацією
   */
  async getPositions(filters = {}, limit = 100, offset = 0) {
    try {
      const where = {};
      
      // Застосовуємо фільтри
      if (filters.symbol) {
        where.symbol = filters.symbol;
      }
      
      if (filters.status) {
        where.status = filters.status;
      }
      
      if (filters.startDate && filters.endDate) {
        where.entryTime = {
          [Op.between]: [filters.startDate, filters.endDate]
        };
      }
      
      return await this.models.Position.findAndCountAll({
        where,
        limit,
        offset,
        order: [['entryTime', 'DESC']]
      });
    } catch (error) {
      logger.error('❌ Помилка отримання позицій:', error);
      throw error;
    }
  }

  /**
   * Видалення старих логів
   */
  async cleanupLogs(daysToKeep = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      const deletedCount = await this.models.Log.destroy({
        where: {
          timestamp: {
            [Op.lt]: cutoffDate
          }
        }
      });
      
      logger.info(`🧹 Видалено ${deletedCount} старих логів`);
      return deletedCount;
    } catch (error) {
      logger.error('❌ Помилка видалення старих логів:', error);
      throw error;
    }
  }

  /**
   * Отримання статусу БД
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      type: config.database.type,
      positionsCount: this.models.Position ? this.getPositionsCount() : 0
    };
  }

  /**
   * Отримання кількості позицій
   */
  async getPositionsCount() {
    try {
      return await this.models.Position.count();
    } catch (error) {
      logger.error('❌ Помилка отримання кількості позицій:', error);
      return 0;
    }
  }

  /**
   * Відключення від бази даних
   */
  async disconnect() {
    if (this.sequelize) {
      try {
        await this.sequelize.close();
        logger.info('🔌 Відключення від бази даних');
        this.isConnected = false;
      } catch (error) {
        logger.error('❌ Помилка відключення від бази даних:', error);
      }
    }
  }
}

module.exports = { DatabaseService };