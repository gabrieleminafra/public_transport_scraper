import sqlite3 from "sqlite3";
import fs from "fs";
import { logger } from "./app.js";

export class Database {
  constructor(target) {
    this.db = null;
    this.target = target;
  }

  init() {
    this.db = new sqlite3.Database("./mount/database.db", (err) => {
      if (err) {
        console.error("Errore nell'apertura del database:" + err.message);
      } else {
        logger("Database connected successfully.");
      }
    });

    try {
      this.db.run(
        "CREATE TABLE IF NOT EXISTS buses (uid TEXT PRIMARY KEY NOT NULL, bus_id TEXT NOT NULL, origin TEXT, destination TEXT, via TEXT, departure TEXT, arrival TEXT, intermediate_1 TEXT, intermediate_2 TEXT, intermediate_3 TEXT, suppressed BOOLEAN NOT NULL DEFAULT 0, unreliable BOOLEAN NOT NULL DEFAULT 0, route TEXT NOT NULL);"
      );
    } catch (error) {
      console.log(error);
    }
  }

  getOne(query, params) {
    return new Promise((resolve, reject) => {
      this.db.get(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  getAll(query, params) {
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }
}
