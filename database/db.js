/**
 * SQLite Database Connection and Initialization
 */

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../config/default');

// Database file path
const dbPath = path.join(__dirname, 'ratoengine.db');

// Create database connection
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize database schema
function initializeDatabase() {
    // Create users table
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create licenses table
    db.exec(`
        CREATE TABLE IF NOT EXISTS licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            email TEXT,
            plan TEXT NOT NULL,
            max_machines INTEGER DEFAULT 1,
            machines_used TEXT DEFAULT '[]',
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            last_validated DATETIME
        )
    `);

    // Create activation logs table
    db.exec(`
        CREATE TABLE IF NOT EXISTS activation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            license_id INTEGER,
            machine_id TEXT,
            action TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (license_id) REFERENCES licenses(id)
        )
    `);

    // Create settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    `);

    // Create youtube_channels table
    db.exec(`
        CREATE TABLE IF NOT EXISTS youtube_channels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            niche TEXT,
            youtube_channel_id TEXT,
            credentials TEXT,
            niche TEXT,
            youtube_channel_id TEXT,
            credentials TEXT,
            access_token TEXT,
            refresh_token TEXT,
            expiry_date INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create videos table
    db.exec(`
        CREATE TABLE IF NOT EXISTS videos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            channel_id INTEGER,
            title TEXT,
            script TEXT,
            status TEXT DEFAULT 'draft',
            platform TEXT,
            platform TEXT,
            video_path TEXT,
            audio_path TEXT,
            youtube_video_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (channel_id) REFERENCES youtube_channels(id)
        )
    `);

    // Create api_keys table
    db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service TEXT NOT NULL,
            api_key TEXT NOT NULL,
            is_active INTEGER DEFAULT 1
        )
    `);

    // Create default admin user if not exists
    const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get(config.defaultAdmin.username);

    if (!adminExists) {
        const passwordHash = bcrypt.hashSync(config.defaultAdmin.password, 10);
        db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
            config.defaultAdmin.username,
            passwordHash
        );
        console.log('✅ Default admin user created');
    }

    console.log('✅ Database initialized successfully');
}

// Initialize on module load
try {
    initializeDatabase();
} catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
}

module.exports = db;
