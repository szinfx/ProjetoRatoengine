/**
 * Crypto utilities for license keys
 */

const crypto = require('crypto');
const config = require('../config/default');

// Algorithm for encryption
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Generate a license key
 * Format: RATO-XXXX-XXXX-XXXX-XXXX
 */
function generateLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = 'RATO';

    for (let i = 0; i < 4; i++) {
        key += '-';
        for (let j = 0; j < 4; j++) {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }

    return key;
}

/**
 * Create encryption key from secret
 */
function getEncryptionKey() {
    return crypto.scryptSync(config.licenseSecret, 'salt', 32);
}

/**
 * Encrypt data for offline validation
 */
function encryptLicenseData(data) {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Combine IV + AuthTag + Encrypted data
    return iv.toString('hex') + authTag.toString('hex') + encrypted;
}

/**
 * Decrypt license data
 */
function decryptLicenseData(encryptedData) {
    try {
        const key = getEncryptionKey();

        // Extract IV, AuthTag, and encrypted content
        const iv = Buffer.from(encryptedData.slice(0, IV_LENGTH * 2), 'hex');
        const authTag = Buffer.from(encryptedData.slice(IV_LENGTH * 2, IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2), 'hex');
        const encrypted = encryptedData.slice(IV_LENGTH * 2 + AUTH_TAG_LENGTH * 2);

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
}

/**
 * Generate machine ID hash
 */
function generateMachineIdHash(machineInfo) {
    return crypto.createHash('sha256').update(JSON.stringify(machineInfo)).digest('hex');
}

/**
 * Create offline validation token
 * Contains encrypted license data for offline verification
 */
function createOfflineToken(license, machineId) {
    const data = {
        key: license.key,
        machineId: machineId,
        expiresAt: license.expires_at,
        plan: license.plan,
        createdAt: new Date().toISOString(),
        validationSignature: crypto.createHmac('sha256', config.licenseSecret)
            .update(license.key + machineId + license.expires_at)
            .digest('hex')
    };

    return encryptLicenseData(data);
}

/**
 * Verify offline token
 */
function verifyOfflineToken(token) {
    const data = decryptLicenseData(token);

    if (!data) return { valid: false, reason: 'Invalid token' };

    // Check expiration
    if (new Date(data.expiresAt) < new Date()) {
        return { valid: false, reason: 'License expired' };
    }

    // Verify signature
    const expectedSignature = crypto.createHmac('sha256', config.licenseSecret)
        .update(data.key + data.machineId + data.expiresAt)
        .digest('hex');

    if (data.validationSignature !== expectedSignature) {
        return { valid: false, reason: 'Invalid signature' };
    }

    return { valid: true, data };
}

module.exports = {
    generateLicenseKey,
    encryptLicenseData,
    decryptLicenseData,
    generateMachineIdHash,
    createOfflineToken,
    verifyOfflineToken
};
