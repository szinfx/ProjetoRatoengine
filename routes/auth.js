/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const config = require('../config/default');
const { authMiddleware } = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Login with username and password
 */
router.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

    if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT token
    const token = jwt.sign(
        { id: user.id, username: user.username },
        config.jwtSecret,
        { expiresIn: config.jwtExpiration }
    );

    // Set cookie
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    res.json({
        success: true,
        user: { id: user.id, username: user.username },
        token
    });
});

/**
 * POST /api/auth/logout
 * Logout (clear cookie)
 */
router.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true });
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authMiddleware, (req, res) => {
    res.json({
        user: { id: req.user.id, username: req.user.username }
    });
});

/**
 * PUT /api/auth/password
 * Change password
 */
router.put('/password', authMiddleware, (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);

    res.json({ success: true, message: 'Password updated successfully' });
});

/**
 * PUT /api/auth/username
 * Change username
 */
router.put('/username', authMiddleware, (req, res) => {
    const { newUsername, password } = req.body;

    if (!newUsername || !password) {
        return res.status(400).json({ error: 'New username and password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

    if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Password is incorrect' });
    }

    // Check if username is taken
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(newUsername, req.user.id);
    if (existing) {
        return res.status(400).json({ error: 'Username already taken' });
    }

    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(newUsername, req.user.id);

    // Create new token with updated username
    const token = jwt.sign(
        { id: user.id, username: newUsername },
        config.jwtSecret,
        { expiresIn: config.jwtExpiration }
    );

    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    });

    res.json({ success: true, message: 'Username updated successfully', token });
});

module.exports = router;
