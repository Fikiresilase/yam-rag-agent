import mysql from "mysql2/promise";
import dbConfig from "./dbConfig.js";
import logger from "../utils/logger.js";
import createHttpError from "http-errors";

let pool = null;

export const initDB = async () => {
  try {
    pool = mysql.createPool({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    const connection = await pool.getConnection();
    connection.release();
  } catch (err) {
    logger.error("Database connection failed: " + err.message);
    throw err;
  }
};

export const getDB = () => {
  if (!pool) {
    throw createHttpError(500, "Database not initialized. Call initDB()");
  }
  return pool;
};
