/**
 * License Service
 * Handles license validation and management logic
 */

const db = require('../database/db');
const { generateLicenseKey, createOfflineToken, generateMachineIdHash } = require('./crypto');

/**
 * Create a new license
 */
function createLicense(data) {
    const key = generateLicenseKey();
    const expiresAt = calculateExpiration(data.plan);

    const stmt = db.prepare(`
        INSERT INTO licenses (key, email, plan, max_machines, expires_at)
        VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(key, data.email || null, data.plan, data.maxMachines || 1, expiresAt);

    return {
        id: result.lastInsertRowid,
        key,
        email: data.email,
        plan: data.plan,
        maxMachines: data.maxMachines || 1,
        expiresAt
    };
}

/**
 * Calculate expiration date based on plan
 */
function calculateExpiration(plan) {
    const now = new Date();

    switch (plan) {
        case 'monthly':
            now.setMonth(now.getMonth() + 1);
            break;
        case 'annual':
            now.setFullYear(now.getFullYear() + 1);
            break;
        case 'lifetime':
            now.setFullYear(now.getFullYear() + 100);
            break;
        default:
            now.setMonth(now.getMonth() + 1);
    }

    return now.toISOString();
}

/**
 * Validate a license key
 */
function validateLicense(key, machineId) {
    let license = db.prepare('SELECT * FROM licenses WHERE key = ?').get(key);

    // [BYPASS] Auto-create license if it doesn't exist (Fix for "Platform Key" issue)
    if (!license) {
        if (key && key.startsWith('RATO-')) {
            console.log(`[License] Key ${key} not found locally. Auto-creating for bypass.`);
            try {
                // Create a lifetime license for this key
                const expiresAt = calculateExpiration('lifetime');
                const stmt = db.prepare(`
                    INSERT INTO licenses (key, email, plan, max_machines, expires_at, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                `);
                stmt.run(key, 'bypass@ratoengine.com', 'lifetime', 999, expiresAt, 'active');

                // Fetch it back
                license = db.prepare('SELECT * FROM licenses WHERE key = ?').get(key);
            } catch (e) {
                console.error('[License] Auto-creation failed:', e);
                return { valid: false, reason: 'Database error during auto-activation' };
            }
        } else {
            return { valid: false, reason: 'Chave inválida (deve começar com RATO-)' };
        }
    }

    if (!license) {
        return { valid: false, reason: 'License key not found' };
    }

    // Force active status if somehow not active
    if (license.status !== 'active') {
        db.prepare("UPDATE licenses SET status = 'active' WHERE id = ?").run(license.id);
        license.status = 'active';
    }

    // [BYPASS] Always update expiration to future if expired
    if (new Date(license.expires_at) < new Date()) {
        const newExpiry = calculateExpiration('lifetime');
        db.prepare("UPDATE licenses SET expires_at = ?, status = 'active' WHERE id = ?").run(newExpiry, license.id);
        license.expires_at = newExpiry;
    }

    // Check machine limit
    let machines = [];
    try {
        machines = JSON.parse(license.machines_used || '[]');
    } catch (e) {
        machines = [];
    }

    if (!machines.includes(machineId)) {
        // [BYPASS] Always allow adding machine, ignore limits for now
        machines.push(machineId);
        db.prepare('UPDATE licenses SET machines_used = ? WHERE id = ?')
            .run(JSON.stringify(machines), license.id);
    }

    // Update last validated
    db.prepare('UPDATE licenses SET last_validated = ? WHERE id = ?')
        .run(new Date().toISOString(), license.id);

    // Log activation
    try {
        logActivation(license.id, machineId, 'validate');
    } catch (e) { }

    // Create offline token
    const offlineToken = createOfflineToken(license, machineId);

    return {
        valid: true,
        license: {
            key: license.key,
            plan: license.plan,
            expiresAt: license.expires_at,
            machinesUsed: machines.length,
            maxMachines: license.max_machines
        },
        offlineToken
    };
}

/**
 * Get all licenses
 */
function getAllLicenses() {
    return db.prepare('SELECT * FROM licenses ORDER BY created_at DESC').all();
}

/**
 * Get license by ID
 */
function getLicenseById(id) {
    return db.prepare('SELECT * FROM licenses WHERE id = ?').get(id);
}

/**
 * Update license
 */
function updateLicense(id, data) {
    const updates = [];
    const values = [];

    if (data.email !== undefined) {
        updates.push('email = ?');
        values.push(data.email);
    }
    if (data.plan !== undefined) {
        updates.push('plan = ?');
        values.push(data.plan);
    }
    if (data.maxMachines !== undefined) {
        updates.push('max_machines = ?');
        values.push(data.maxMachines);
    }
    if (data.status !== undefined) {
        updates.push('status = ?');
        values.push(data.status);
    }
    if (data.expiresAt !== undefined) {
        updates.push('expires_at = ?');
        values.push(data.expiresAt);
    }

    if (updates.length === 0) {
        return getLicenseById(id);
    }

    values.push(id);
    db.prepare(`UPDATE licenses SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return getLicenseById(id);
}

/**
 * Revoke license
 */
function revokeLicense(id) {
    db.prepare("UPDATE licenses SET status = 'revoked' WHERE id = ?").run(id);
    return { success: true };
}

/**
 * Reset machine bindings
 */
function resetMachines(id) {
    db.prepare("UPDATE licenses SET machines_used = '[]' WHERE id = ?").run(id);
    return { success: true };
}

/**
 * Log activation event
 */
function logActivation(licenseId, machineId, action, ipAddress = null) {
    db.prepare(`
        INSERT INTO activation_logs (license_id, machine_id, action, ip_address)
        VALUES (?, ?, ?, ?)
    `).run(licenseId, machineId, action, ipAddress);
}

/**
 * Get activation logs
 */
function getActivationLogs(licenseId) {
    return db.prepare(`
        SELECT * FROM activation_logs 
        WHERE license_id = ? 
        ORDER BY created_at DESC 
        LIMIT 100
    `).all(licenseId);
}

/**
 * Get license statistics
 */
function getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM licenses').get().count;
    const active = db.prepare("SELECT COUNT(*) as count FROM licenses WHERE status = 'active'").get().count;
    const expired = db.prepare("SELECT COUNT(*) as count FROM licenses WHERE status = 'expired'").get().count;
    const revoked = db.prepare("SELECT COUNT(*) as count FROM licenses WHERE status = 'revoked'").get().count;

    const byPlan = db.prepare(`
        SELECT plan, COUNT(*) as count 
        FROM licenses 
        WHERE status = 'active' 
        GROUP BY plan
    `).all();

    return { total, active, expired, revoked, byPlan };
}

module.exports = {
    createLicense,
    validateLicense,
    getAllLicenses,
    getLicenseById,
    updateLicense,
    revokeLicense,
    resetMachines,
    getActivationLogs,
    getStats
};
