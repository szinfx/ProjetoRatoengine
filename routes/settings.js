/**
 * Settings Routes
 */

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authMiddleware } = require('../middleware/auth');

/**
 * GET /api/settings
 * Get all settings
 */
router.get('/', authMiddleware, (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};

    rows.forEach(row => {
        try {
            settings[row.key] = JSON.parse(row.value);
        } catch (e) {
            settings[row.key] = row.value;
        }
    });

    res.json({ settings });
});

/**
 * PUT /api/settings
 * Update settings
 */
router.put('/', authMiddleware, (req, res) => {
    const settings = req.body;

    const upsert = db.prepare(`
        INSERT INTO settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    Object.entries(settings).forEach(([key, value]) => {
        upsert.run(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    });

    res.json({ success: true });
});

/**
 * GET /api/settings/api-keys
 * Get configured API keys (masked)
 */
router.get('/api-keys', authMiddleware, (req, res) => {
    const keys = db.prepare('SELECT id, service, is_active FROM api_keys').all();
    res.json({ apiKeys: keys });
});

/**
 * POST /api/settings/api-keys
 * Add or update an API key
 */
router.post('/api-keys', authMiddleware, (req, res) => {
    const { service, apiKey } = req.body;

    if (!service || !apiKey) {
        return res.status(400).json({ error: 'Service and API key are required' });
    }

    // Check if service already exists
    const existing = db.prepare('SELECT id FROM api_keys WHERE service = ?').get(service);

    if (existing) {
        db.prepare('UPDATE api_keys SET api_key = ?, is_active = 1 WHERE id = ?')
            .run(apiKey, existing.id);
    } else {
        db.prepare('INSERT INTO api_keys (service, api_key) VALUES (?, ?)')
            .run(service, apiKey);
    }

    res.json({ success: true });
});

/**
 * DELETE /api/settings/api-keys/:service
 * Remove an API key
 */
router.delete('/api-keys/:service', authMiddleware, (req, res) => {
    const { service } = req.params;
    db.prepare('DELETE FROM api_keys WHERE service = ?').run(service);
    res.json({ success: true });
});

/**
 * GET /api/settings/api-keys/:service/status
 * Check if an API key is configured
 */
router.get('/api-keys/:service/status', authMiddleware, (req, res) => {
    const { service } = req.params;
    const key = db.prepare('SELECT is_active FROM api_keys WHERE service = ?').get(service);
    res.json({
        configured: !!key,
        active: key?.is_active === 1
    });
});

/**
 * Internal function to get API key for a service
 */
function getApiKey(service) {
    const row = db.prepare('SELECT api_key FROM api_keys WHERE service = ? AND is_active = 1').get(service);
    return row?.api_key || null;
}

// Export for use in other modules
router.getApiKey = getApiKey;

module.exports = router;
