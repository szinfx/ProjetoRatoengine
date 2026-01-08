/**
 * RatoEngine License & AI Management Server
 * Main entry point
 */

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Import database and init
const db = require('./database/db');

// Import routes
const authRoutes = require('./routes/auth');
const licensesRoutes = require('./routes/licenses');
const settingsRoutes = require('./routes/settings');
const youtubeRoutes = require('./routes/youtube-ai');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/licenses', licensesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/system', require('./routes/system'));

// === NEW: Audio Analysis Endpoint (delegated from plugin) ===
app.post('/api/analyze-audio', async (req, res) => {
    console.log('[API] analyze-audio request received');
    const { filePath, settings } = req.body;

    if (!filePath) {
        return res.status(400).json({ error: 'filePath is required' });
    }

    try {
        const fs = require('fs');
        const path = require('path');
        const { spawn } = require('child_process');

        // Find FFmpeg path
        let ffmpegPath = 'ffmpeg'; // Default to PATH

        // Try to find local ffmpeg in the plugin bin folder
        // We go up from RatoEngine_Server/ to find RatoEngine_Plugin/
        const localFFmpeg = path.join(__dirname, '..', 'RatoEngine_Plugin', 'com.ratoengine.panel', 'bin', 'ffmpeg.exe');

        if (fs.existsSync(localFFmpeg)) {
            ffmpegPath = localFFmpeg;
            console.log('[API] Found local FFmpeg:', ffmpegPath);
        } else {
            console.log('[API] Local FFmpeg not found, using PATH default');
        }

        console.log('[API] Using FFmpeg binary:', ffmpegPath);
        console.log('[API] Analyzing file:', filePath);

        // Parameters
        const threshold = (settings && settings.silenceThreshold) || -40;
        const minDuration = ((settings && settings.minSilence) || 300) / 1000;

        console.log(`[API] Parameters: threshold=${threshold}dB, minDuration=${minDuration}s`);

        const args = [
            '-hide_banner',
            '-i', filePath,
            '-vn',
            '-af', `silencedetect=noise=${threshold}dB:d=${minDuration}`,
            '-f', 'null',
            '-'
        ];

        const proc = spawn(ffmpegPath, args);
        let stderr = '';

        proc.stderr.on('data', (data) => stderr += data.toString());

        proc.on('close', (code) => {
            if (code !== 0) {
                console.error('[API] FFmpeg failed with code', code);
                console.error('[API] stderr:', stderr);
                return res.status(500).json({ error: 'FFmpeg analysis failed. Check server logs.' });
            }

            // Parse silences from stderr
            const silences = [];
            const regex = /silence_start: ([\d.]+)[\s\S]+?silence_end: ([\d.]+)/g;
            let match;
            while ((match = regex.exec(stderr)) !== null) {
                silences.push({
                    start: parseFloat(match[1]),
                    end: parseFloat(match[2]),
                    duration: parseFloat(match[2]) - parseFloat(match[1])
                });
            }

            // Get duration
            const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/);
            let duration = 0;
            if (durationMatch) {
                const h = parseInt(durationMatch[1]);
                const m = parseInt(durationMatch[2]);
                const s = parseFloat(durationMatch[3]);
                duration = h * 3600 + m * 60 + s;
            }

            console.log(`[API] Analysis complete. Found ${silences.length} silences. Duration: ${duration}s`);

            // Return compatible format for the plugin
            res.json({
                silences,
                duration,
                waveform: [] // Waveform is harder to stream, skipping for now
            });
        });

    } catch (error) {
        console.error('[API] Unexpected error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Default route - serve login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404 for API routes
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Catch-all for SPA routes (only for paths without file extensions)
app.get('*', (req, res, next) => {
    // If the request has a file extension, let it 404 naturally
    if (path.extname(req.path)) {
        return res.status(404).send('Not Found');
    }
    // Otherwise redirect to index (SPA behavior)
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🐀 RatoEngine License Server                            ║
║                                                           ║
║   Server running at: http://localhost:${PORT}               ║
║                                                           ║
║   Default admin credentials:                              ║
║   Username: admin                                         ║
║   Password: ratoengine2024                                ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
