import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import type { AlertThreshold, AlertHistory, MetricHistory } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bot.db');

import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_thresholds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT NOT NULL UNIQUE,
      threshold REAL NOT NULL DEFAULT 80,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      threshold REAL NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS metric_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node TEXT NOT NULL,
      metric TEXT NOT NULL,
      value REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bot_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Index for faster metric queries
    CREATE INDEX IF NOT EXISTS idx_metric_history_node_metric ON metric_history(node, metric, created_at);

    -- Insert default thresholds if not exist
    INSERT OR IGNORE INTO alert_thresholds (metric, threshold, enabled) VALUES ('cpu', 80, 1);
    INSERT OR IGNORE INTO alert_thresholds (metric, threshold, enabled) VALUES ('memory', 85, 1);
    INSERT OR IGNORE INTO alert_thresholds (metric, threshold, enabled) VALUES ('disk', 90, 1);
  `);

  console.log('Database initialized');
}

export function getAlertThresholds(): AlertThreshold[] {
  return db.prepare('SELECT * FROM alert_thresholds').all() as AlertThreshold[];
}

export function getAlertThreshold(metric: string): AlertThreshold | undefined {
  return db.prepare('SELECT * FROM alert_thresholds WHERE metric = ?').get(metric) as AlertThreshold | undefined;
}

export function updateAlertThreshold(metric: string, threshold: number, enabled: boolean): void {
  db.prepare('UPDATE alert_thresholds SET threshold = ?, enabled = ? WHERE metric = ?')
    .run(threshold, enabled ? 1 : 0, metric);
}

export function addAlertHistory(metric: string, value: number, threshold: number, message: string): void {
  db.prepare('INSERT INTO alert_history (metric, value, threshold, message) VALUES (?, ?, ?, ?)')
    .run(metric, value, threshold, message);
}

export function getAlertHistory(limit: number = 10): AlertHistory[] {
  return db.prepare('SELECT * FROM alert_history ORDER BY created_at DESC LIMIT ?').all(limit) as AlertHistory[];
}

export function getLastAlert(metric: string): AlertHistory | undefined {
  return db.prepare('SELECT * FROM alert_history WHERE metric = ? ORDER BY created_at DESC LIMIT 1')
    .get(metric) as AlertHistory | undefined;
}

export function addMetricHistory(node: string, metric: string, value: number): void {
  db.prepare('INSERT INTO metric_history (node, metric, value) VALUES (?, ?, ?)')
    .run(node, metric, value);
}

export function getMetricHistory(node: string, metric: string, hours: number = 24): MetricHistory[] {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT * FROM metric_history 
    WHERE node = ? AND metric = ? AND created_at > ?
    ORDER BY created_at ASC
  `).all(node, metric, since) as MetricHistory[];
}

export function getLatestMetrics(node: string): Record<string, number> {
  const rows = db.prepare(`
    SELECT metric, value FROM metric_history 
    WHERE node = ? 
    GROUP BY metric 
    HAVING created_at = MAX(created_at)
  `).all(node) as Array<{ metric: string; value: number }>;
  
  return Object.fromEntries(rows.map(r => [r.metric, r.value]));
}

export function getConfig(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM bot_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO bot_config (key, value) VALUES (?, ?)').run(key, value);
}

export function cleanupOldHistory(): void {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  
  db.prepare('DELETE FROM metric_history WHERE created_at < ?').run(weekAgo);
  
  db.prepare(`
    DELETE FROM alert_history WHERE id NOT IN (
      SELECT id FROM alert_history ORDER BY created_at DESC LIMIT 1000
    )
  `).run();
}

export default db;
