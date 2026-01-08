/**
 * License Routes
 */

const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const licenseService = require('../services/license');

/**
 * POST /api/licenses/validate
 * PUBLIC - Validate license from extension (no auth required)
 */
router.post('/validate', (req, res) => {
    const { key, machineId } = req.body;

    if (!key || !machineId) {
        return res.status(400).json({
            valid: false,
            reason: 'Key and machine ID are required'
        });
    }

    const result = licenseService.validateLicense(key, machineId);
    res.json(result);
});

/**
 * GET /api/licenses
 * Get all licenses (admin only)
 */
router.get('/', authMiddleware, (req, res) => {
    const licenses = licenseService.getAllLicenses();
    res.json({ licenses });
});

/**
 * GET /api/licenses/stats
 * Get license statistics
 */
router.get('/stats', authMiddleware, (req, res) => {
    const stats = licenseService.getStats();
    res.json(stats);
});

/**
 * GET /api/licenses/:id
 * Get single license
 */
router.get('/:id', authMiddleware, (req, res) => {
    const license = licenseService.getLicenseById(req.params.id);

    if (!license) {
        return res.status(404).json({ error: 'License not found' });
    }

    res.json({ license });
});

/**
 * GET /api/licenses/:id/logs
 * Get activation logs for a license
 */
router.get('/:id/logs', authMiddleware, (req, res) => {
    const logs = licenseService.getActivationLogs(req.params.id);
    res.json({ logs });
});

/**
 * POST /api/licenses
 * Create new license
 */
router.post('/', authMiddleware, (req, res) => {
    const { email, plan, maxMachines } = req.body;

    if (!plan) {
        return res.status(400).json({ error: 'Plan is required' });
    }

    if (!['monthly', 'annual', 'lifetime'].includes(plan)) {
        return res.status(400).json({ error: 'Invalid plan type' });
    }

    const license = licenseService.createLicense({ email, plan, maxMachines });
    res.status(201).json({ license });
});

/**
 * PUT /api/licenses/:id
 * Update license
 */
router.put('/:id', authMiddleware, (req, res) => {
    const license = licenseService.updateLicense(req.params.id, req.body);

    if (!license) {
        return res.status(404).json({ error: 'License not found' });
    }

    res.json({ license });
});

/**
 * DELETE /api/licenses/:id
 * Revoke license
 */
router.delete('/:id', authMiddleware, (req, res) => {
    const license = licenseService.getLicenseById(req.params.id);

    if (!license) {
        return res.status(404).json({ error: 'License not found' });
    }

    licenseService.revokeLicense(req.params.id);
    res.json({ success: true, message: 'License revoked' });
});

/**
 * POST /api/licenses/:id/reset-machines
 * Reset machine bindings
 */
router.post('/:id/reset-machines', authMiddleware, (req, res) => {
    const license = licenseService.getLicenseById(req.params.id);

    if (!license) {
        return res.status(404).json({ error: 'License not found' });
    }

    licenseService.resetMachines(req.params.id);
    res.json({ success: true, message: 'Machine bindings reset' });
});

module.exports = router;
