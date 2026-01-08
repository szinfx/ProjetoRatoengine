/**
 * JWT Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const config = require('../config/default');

/**
 * Verify JWT token from cookie or Authorization header
 */
function authMiddleware(req, res, next) {
    // Get token from cookie or Authorization header
    let token = req.cookies?.token;

    if (!token && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7);
        }
    }

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, config.jwtSecret);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

/**
 * Optional auth - doesn't fail if no token
 */
function optionalAuth(req, res, next) {
    let token = req.cookies?.token;

    if (!token && req.headers.authorization) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
            token = authHeader.slice(7);
        }
    }

    if (token) {
        try {
            const decoded = jwt.verify(token, config.jwtSecret);
            req.user = decoded;
        } catch (error) {
            // Token invalid, but continue without user
        }
    }

    next();
}

module.exports = { authMiddleware, optionalAuth };
