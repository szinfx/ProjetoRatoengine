const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth'); // Check path relative to routes folder
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// POST /api/system/install-dependencies
router.post('/install-dependencies', authMiddleware, (req, res) => {
    // Detect OS
    const isWin = process.platform === "win32";
    const scriptName = isWin ? 'setup-ollama.bat' : 'setup-ollama.sh';
    const scriptPath = path.join(__dirname, '..', scriptName);

    console.log(`[System] Request to run dependency setup: ${scriptPath}`);

    // Adjust permissions for Linux/Mac
    if (!isWin) {
        try {
            fs.chmodSync(scriptPath, '755');
        } catch (e) {
            console.error('Error chmoding script:', e);
        }
    }

    // Spawn process (detached so it doesn't block express too much, though we want output)
    const shell = isWin ? 'cmd.exe' : '/bin/bash';
    const args = isWin ? ['/c', scriptPath] : [scriptPath];

    const child = exec(`"${scriptPath}"`, { cwd: path.join(__dirname, '..') }, (error, stdout, stderr) => {
        if (error) {
            console.error(`[Setup] Error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`[Setup] Stderr: ${stderr}`);
        }
        console.log(`[Setup] Stdout: ${stdout}`);
    });

    // We respond immediately to not timeout the UI, assuming the user will check status separately or logs
    res.json({
        success: true,
        message: 'Instalação de dependências iniciada em segundo plano. Verifique o console do servidor.'
    });
});

// POST /api/system/start-services
router.post('/start-services', authMiddleware, (req, res) => {
    const isWin = process.platform === "win32";
    const ollamaPath = path.join(__dirname, '..', 'bin', 'ollama', 'ollama.exe');

    console.log(`[System] Request to START services (Ollama)`);

    if (isWin) {
        // Check if embedded ollama exists
        if (fs.existsSync(ollamaPath)) {
            // Start Ollama in background
            const cmd = `start /B "" "${ollamaPath}" serve`;
            exec(cmd, { cwd: path.join(__dirname, '..') }, (error) => {
                if (error) console.error('[Start] Error starting Ollama:', error);
            });
            return res.json({ success: true, message: 'Iniciando Ollama em segundo plano...' });
        } else {
            // Try global ollama
            exec('ollama serve', (error) => {
                if (error) console.log('[Start] Global ollama start attempt finished (might be running)');
            });
            return res.json({ success: true, message: 'Tentando iniciar Ollama global...' });
        }
    } else {
        // Unix
        exec('ollama serve', (error) => {
            if (error) console.log('[Start] Unix ollama start attempt finished');
        });
        return res.json({ success: true, message: 'Tentando iniciar Ollama (Unix)...' });
    }
});



// POST /api/system/stop-services
router.post('/stop-services', authMiddleware, (req, res) => {
    const isWin = process.platform === "win32";
    console.log(`[System] Request to STOP services`);

    // Commands to kill process
    // Windows: taskkill /F /IM "process.exe"
    // Linux/Mac: pkill -f "process"

    // We target "ollama.exe" and "ollama app.exe" on Windows
    // "ollama" on Linux

    if (isWin) {
        exec('taskkill /F /IM "ollama.exe" /T', (err) => {
            if (err) console.log('[Stop] Ollama kill 1:', err.message);
        });
        exec('taskkill /F /IM "ollama app.exe" /T', (err) => {
            if (err) console.log('[Stop] Ollama kill 2:', err.message);
        });

        // Also kill "ffmpeg.exe" if stuck? Maybe too aggressive. User asked for services.
        // Let's stick to AI services.

        res.json({ success: true, message: 'Comando de parada enviado para o Ollama.' });
    } else {
        exec('pkill -f ollama', (err) => {
            if (err) console.log('[Stop] Unix kill:', err.message);
        });
        res.json({ success: true, message: 'Comando de parada enviado (Unix).' });
    }
});

module.exports = router;
