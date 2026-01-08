/**
 * Default configuration
 */

module.exports = {
    // JWT Secret - in production, use environment variable
    jwtSecret: process.env.JWT_SECRET || 'ratoengine-super-secret-key-2024',

    // Token expiration (24 hours)
    jwtExpiration: '24h',

    // Default admin credentials
    defaultAdmin: {
        username: 'admin',
        password: 'ratoengine2024'
    },

    // License key encryption secret
    licenseSecret: 'ratoengine-license-encryption-key-v1',

    // Server settings
    server: {
        port: 3000
    },

    // Database path
    dbPath: './database/ratoengine.db'
};
