/**
 * YouTube AI Routes
 * Updated to use unified youtube-agent with local AI priority
 */

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authMiddleware } = require('../middleware/auth');
const youtubeAgent = require('../services/youtube-agent');
const externalAgent = require('../services/external-agent');

// ============================================
// AI Status & Configuration
// ============================================

/**
 * GET /api/youtube/ai-status
 * Get full AI status (local + API)
 */
router.get('/ai-status', authMiddleware, async (req, res) => {
    try {
        const status = await youtubeAgent.getAIStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/youtube/voices
 * Get available TTS voices
 */
router.get('/voices', authMiddleware, async (req, res) => {
    try {
        const voices = await youtubeAgent.getVoices();
        res.json({ voices });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Auth & Upload Routes
// ============================================

router.post('/autopilot', authMiddleware, async (req, res) => {
    const { videoId, mode } = req.body; // mode: 'local' or 'api' (default)
    console.log(`[Autopilot] Starting full video production for ID: ${videoId} (Mode: ${mode || 'api'})`);

    try {
        // 1. Get Video & Script
        const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
        if (!video || !video.script) return res.status(400).json({ error: 'Video or script not found' });

        // 2. Generate Audio (if not exists)
        let audioPath = video.audio_path;
        if (!audioPath) {
            console.log('[Autopilot] Generating Audio...');

            if (mode === 'local') {
                // LOCAL MODE: Use Edge TTS
                const ttsRes = await youtubeAgent.localTTS.generateAudio(video.script, 'pt-BR-FranciscaNeural');
                if (ttsRes.success) {
                    audioPath = ttsRes.audioPath;
                    db.prepare('UPDATE videos SET audio_path = ? WHERE id = ?').run(audioPath, videoId);
                } else throw new Error('Local TTS failed: ' + ttsRes.error);

            } else {
                // API MODE: OpenAI (legacy)
                const status = await youtubeAgent.getAIStatus();
                const openaiKey = youtubeAgent.getApiKey('openai');

                if (openaiKey) {
                    const audioRes = await youtubeAgent.generateAudioWithOpenAI(video.script, 'onyx', openaiKey);
                    if (audioRes.success) {
                        audioPath = audioRes.audioPath;
                        db.prepare('UPDATE videos SET audio_path = ? WHERE id = ?').run(audioPath, videoId);
                    } else throw new Error('Audio generation failed: ' + audioRes.error);
                } else {
                    // Fallback to local if no API key
                    console.log('No OpenAI Key, falling back to Local TTS');
                    const ttsRes = await youtubeAgent.localTTS.generateAudio(video.script, 'pt-BR-FranciscaNeural');
                    if (ttsRes.success) {
                        audioPath = ttsRes.audioPath;
                        db.prepare('UPDATE videos SET audio_path = ? WHERE id = ?').run(audioPath, videoId);
                    } else throw new Error('TTS failed (No Key & Local Error): ' + ttsRes.error);
                }
            }
        }

        // 3. Generate Visuals & Render Video
        console.log('[Autopilot] Rendering Video...');
        const outputPath = path.join(__dirname, '..', 'public', 'videos', `video_${videoId}.mp4`);
        const videoOutputDir = path.dirname(outputPath);
        if (!fs.existsSync(videoOutputDir)) fs.mkdirSync(videoOutputDir, { recursive: true });

        if (mode === 'local_visualizer') {
            // 1. VISUALIZER MODE
            console.log('[Autopilot] Rendering Local Visualizer...');
            await youtubeAgent.renderLocalVideoWithVisualizer(audioPath, outputPath, video.title);

        } else if (mode === 'agent_samurai' || mode === 'local_stock') {
            // 2. SAMURAI GPT (Advanced Stock Mode)
            console.log('[Autopilot] Starting SamurAI GPT Agent...');
            const pexelsKey = youtubeAgent.getApiKey('pexels');
            if (!pexelsKey) throw new Error('Chave da API Pexels não configurada para o Agente SamurAI!');

            // Plan & Render
            const scenePlan = await youtubeAgent.localLLM.planVideoScenes(video.script);
            if (!scenePlan.success) throw new Error('SamurAI Agent failed to plan scenes.');

            await youtubeAgent.renderSmartEditedVideo(scenePlan.scenes, pexelsKey, outputPath);

        } else if (mode === 'agent_opensora') {
            // 3. GENERATIVE AGENT (Open-Sora)
            console.log('[Autopilot] Calling Open-Sora Python Agent...');
            await youtubeAgent.runPythonAgent('opensora', video.script.substring(0, 200), outputPath); // Prompt limit

        } else if (mode === 'agent_director') {
            // 4. DIRECTOR AGENT
            console.log('[Autopilot] Calling Director AI Agent...');
            await youtubeAgent.runPythonAgent('director', video.script, outputPath);

        } else if (mode === 'agent_cloud' || mode === 'agent_external' || mode === 'agent_veo') {
            // 5. EXTERNAL CLOUD AGENT (OpenAI / Google Veo)
            console.log(`[Autopilot] Calling External Agent (${mode})...`);

            const provider = (mode === 'agent_veo') ? 'google_veo' : 'openai_editor';
            const apiKey = (mode === 'agent_veo')
                ? youtubeAgent.getApiKey('google_cloud') // Need to ensure this exists or use generic
                : youtubeAgent.getApiKey('openai');

            // Try to find a good image for the video (Thumbnail)
            // If local SD or Pexels has run before, maybe we have an image?
            // For now, let's try to get a stock image if Pexels is active, to make it look nice.
            let imagePath = null;
            const pexelsKey = youtubeAgent.getApiKey('pexels');

            if (pexelsKey) {
                try {
                    // Quick hack: use youtubeAgent's internal logic or just reuse a known function
                    // Since we don't have a direct "get one image" public function exposed easily without rewrite,
                    // let's check if we can reuse 'generateImageWithOpenAI' or similar if desired.
                    // But simpler: just pass null, forcing black screen is safer for reliability unless requested.
                    // User said "sem foto", so let's try to fix that.
                    // Let's fallback to "generateImageWithOpenAI" if OpenAI key exists, as it makes a nice cover.
                    if (youtubeAgent.getApiKey('openai')) {
                        const imgRes = await youtubeAgent.generateImageWithOpenAI(video.title, youtubeAgent.getApiKey('openai'));
                        if (imgRes.success) imagePath = imgRes.imagePath;
                    }
                } catch (e) { console.error('Failed to auto-generate cover image:', e); }
            }

            // Dispatch to external service with assets
            await externalAgent.runAgent(video.script, provider, apiKey, outputPath, {
                audioPath: audioPath,
                imagePath: imagePath
            });

        } else if (mode === 'local_sd') {
            // 5. GEN AI LOCAL MODE (Stable Diffusion) - Legacy
            console.log('[Autopilot] Generating Image with Local SD...');
            const sdUrl = youtubeAgent.getApiKey('sd_url') || 'http://127.0.0.1:7860';
            const imgRes = await youtubeAgent.generateImageWithLocalSD(video.title, sdUrl);

            if (imgRes.success) {
                await youtubeAgent.renderVideo(imgRes.imagePath, audioPath, outputPath);
            } else {
                throw new Error('Local SD Generation failed: ' + imgRes.error);
            }

        } else {
            // 6. DEFAULT API MODE (OpenAI)
            console.log('[Autopilot] Generating Image (API)...');
            const openaiKey = youtubeAgent.getApiKey('openai');

            // Fallback to stock if no key
            if (!openaiKey) {
                console.log('[Autopilot] No OpenAI Key, falling back to Stock Mode...');
                const pexelsKey = youtubeAgent.getApiKey('pexels');
                if (!pexelsKey) throw new Error('Nem OpenAI Key nem Pexels Key configuradas.');

                const scenePlan = await youtubeAgent.localLLM.planVideoScenes(video.script);
                await youtubeAgent.renderSmartEditedVideo(scenePlan.scenes, pexelsKey, outputPath);
            } else {
                const imgRes = await youtubeAgent.generateImageWithOpenAI(video.title, openaiKey);
                if (imgRes.success) {
                    await youtubeAgent.renderVideo(imgRes.imagePath, audioPath, outputPath);
                } else {
                    throw new Error('Image generation failed: ' + imgRes.error);
                }
            }
        }

        // Update DB (Runs for all modes)
        db.prepare('UPDATE videos SET video_path = ?, status = ? WHERE id = ?')
            .run(outputPath, 'video_ready', videoId);

        console.log('[Autopilot] Success!');
        res.json({ success: true, videoPath: outputPath });

    } catch (e) {
        console.error('[Autopilot] Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/auth/url', authMiddleware, (req, res) => {
    const { clientId, clientSecret, redirectUri } = req.body;
    if (!clientId || !clientSecret || !redirectUri) return res.status(400).json({ error: 'Credenciais incompletas' });

    try {
        const url = youtubeAgent.generateAuthUrl({ clientId, clientSecret, redirectUri });
        res.json({ url });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/auth/callback', authMiddleware, async (req, res) => {
    const { code, channelId, credentials } = req.body;
    // credentials = { clientId, clientSecret, redirectUri }

    try {
        const tokens = await youtubeAgent.exchangeCodeForToken(code, credentials);

        // Update channel in DB
        db.prepare(`
            UPDATE youtube_channels 
            SET access_token = ?, refresh_token = ?, expiry_date = ?, credentials = ?
            WHERE id = ?
        `).run(
            tokens.access_token,
            tokens.refresh_token,
            tokens.expiry_date,
            JSON.stringify(credentials),
            channelId
        );

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/generate-audio', authMiddleware, async (req, res) => {
    const { videoId, voiceId } = req.body;

    try {
        const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
        if (!video || !video.script) return res.status(400).json({ error: 'Vídeo sem script' });

        const audioPath = await youtubeAgent.generateAudio(video.script, voiceId);

        db.prepare('UPDATE videos SET audio_path = ?, status = ? WHERE id = ?')
            .run(audioPath, 'audio_ready', videoId);

        res.json({ success: true, audioPath });
    } catch (error) {
        res.status(500).json({ error: 'Erro na geração de áudio', message: error.message });
    }
});

// Configure Multer for Uploads
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ dest: uploadDir });

router.post('/generate-video', authMiddleware, upload.single('image'), async (req, res) => {
    const { videoId } = req.body;
    const imageFile = req.file;

    try {
        const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
        if (!video || !video.audio_path) return res.status(400).json({ error: 'Vídeo sem áudio gerado' });
        if (!imageFile) return res.status(400).json({ error: 'Imagem de fundo obrigatória' });

        // Paths
        // Use absolute paths for ffmpeg
        const audioPath = video.audio_path;
        const imagePath = imageFile.path;
        const outputPath = path.join(__dirname, '..', 'public', 'videos', `video_${videoId}.mp4`);

        // Ensure dir
        const videoOutputDir = path.dirname(outputPath);
        if (!fs.existsSync(videoOutputDir)) fs.mkdirSync(videoOutputDir, { recursive: true });

        // Run FFmpeg
        await youtubeAgent.renderVideo(imagePath, audioPath, outputPath);

        // Update DB
        db.prepare('UPDATE videos SET video_path = ?, status = ? WHERE id = ?')
            .run(outputPath, 'video_ready', videoId);

        res.json({ success: true, videoPath: outputPath });
    } catch (e) {
        console.error('Video Gen Error:', e);
        res.status(500).json({ error: e.message });
    }
});

router.post('/upload-video', authMiddleware, async (req, res) => {
    const { videoId } = req.body;

    try {
        const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(videoId);
        if (!video || !video.video_path) return res.status(400).json({ error: 'Vídeo não renderizado' });

        const channel = db.prepare('SELECT * FROM youtube_channels WHERE id = ?').get(video.channel_id);
        if (!channel || !channel.access_token) return res.status(400).json({ error: 'Canal não conectado ao Google' });

        const credentials = JSON.parse(channel.credentials);
        const tokens = {
            access_token: channel.access_token,
            refresh_token: channel.refresh_token,
            expiry_date: channel.expiry_date
        };

        const result = await youtubeAgent.uploadVideoToYouTube(
            { title: video.title, path: video.video_path, description: video.script },
            tokens,
            credentials
        );

        db.prepare('UPDATE videos SET status = ?, youtube_video_id = ? WHERE id = ?')
            .run('uploaded', result.id, videoId);

        res.json({ success: true, youtubeId: result.id });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// ============================================
// Channel Management
// ============================================

router.get('/channels', authMiddleware, (req, res) => {
    const channels = db.prepare('SELECT * FROM youtube_channels ORDER BY created_at DESC').all();
    res.json({ channels });
});

router.post('/channels', authMiddleware, (req, res) => {
    const { name, niche, youtubeChannelId } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });

    const result = db.prepare(`
        INSERT INTO youtube_channels (name, niche, youtube_channel_id)
        VALUES (?, ?, ?)
    `).run(name, niche || null, youtubeChannelId || null);

    const channel = db.prepare('SELECT * FROM youtube_channels WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ channel });
});

router.put('/channels/:id', authMiddleware, (req, res) => {
    const { name, niche, youtubeChannelId } = req.body;
    db.prepare(`
        UPDATE youtube_channels 
        SET name = COALESCE(?, name), niche = COALESCE(?, niche), youtube_channel_id = COALESCE(?, youtube_channel_id)
        WHERE id = ?
    `).run(name, niche, youtubeChannelId, req.params.id);

    const channel = db.prepare('SELECT * FROM youtube_channels WHERE id = ?').get(req.params.id);
    res.json({ channel });
});

router.delete('/channels/:id', authMiddleware, (req, res) => {
    db.prepare('DELETE FROM videos WHERE channel_id = ?').run(req.params.id);
    db.prepare('DELETE FROM youtube_channels WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ============================================
// Video Management
// ============================================

router.get('/videos', authMiddleware, (req, res) => {
    const { channelId, status } = req.query;
    let query = 'SELECT v.*, c.name as channel_name FROM videos v LEFT JOIN youtube_channels c ON v.channel_id = c.id';
    const params = [];
    const conditions = [];

    if (channelId) { conditions.push('v.channel_id = ?'); params.push(channelId); }
    if (status) { conditions.push('v.status = ?'); params.push(status); }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY v.created_at DESC';

    const videos = db.prepare(query).all(...params);
    res.json({ videos });
});

router.get('/videos/:id', authMiddleware, (req, res) => {
    const video = db.prepare(`
        SELECT v.*, c.name as channel_name 
        FROM videos v LEFT JOIN youtube_channels c ON v.channel_id = c.id WHERE v.id = ?
    `).get(req.params.id);
    if (!video) return res.status(404).json({ error: 'Vídeo não encontrado' });
    res.json({ video });
});

router.post('/videos', authMiddleware, (req, res) => {
    const { channelId, title, platform, script } = req.body;
    if (!title) return res.status(400).json({ error: 'Título é obrigatório' });

    const result = db.prepare(`
        INSERT INTO videos (channel_id, title, platform, status, script)
        VALUES (?, ?, ?, 'draft', ?)
    `).run(channelId || null, title, platform || 'youtube', script || null);

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ video });
});

router.put('/videos/:id', authMiddleware, (req, res) => {
    const { title, script, status, platform } = req.body;
    const updates = [];
    const values = [];

    if (title !== undefined) { updates.push('title = ?'); values.push(title); }
    if (script !== undefined) { updates.push('script = ?'); values.push(script); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (platform !== undefined) { updates.push('platform = ?'); values.push(platform); }

    if (updates.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });

    values.push(req.params.id);
    db.prepare(`UPDATE videos SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
    res.json({ video });
});

router.delete('/videos/:id', authMiddleware, (req, res) => {
    db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

// ============================================
// AI Content Generation
// ============================================

/**
 * POST /api/youtube/research
 * Research niches - uses local AI first, then API, then templates
 */
router.post('/research', authMiddleware, async (req, res) => {
    let { niche, keywords, referenceVideos, count, forceLocal, aiProvider } = req.body;

    try {
        // ... (existing code)

        const result = await youtubeAgent.researchNiche(niche, keywords, {
            forceLocal,
            aiProvider, // Pass the chosen provider
            referenceVideos,
            count: count || 10
        });
        res.json(result);
    } catch (error) {
        console.error('[Research Error]', error);
        res.status(500).json({ error: 'Erro na pesquisa', message: error.message });
    }
});

/**
 * Fetch DETAILED video info from YouTube URLs
 * Uses oEmbed + page scraping for maximum data extraction
 */
async function fetchVideoInfo(urls) {
    const results = [];

    for (const url of urls.slice(0, 3)) { // Limit to 3 videos
        try {
            // Extract video ID
            let videoId = null;
            if (url.includes('youtu.be/')) {
                videoId = url.split('youtu.be/')[1]?.split(/[?&]/)[0];
            } else if (url.includes('watch?v=')) {
                videoId = url.split('watch?v=')[1]?.split(/[?&]/)[0];
            }

            if (!videoId) continue;

            // Step 1: Get basic info via oEmbed
            const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
            const oembedResponse = await fetch(oembedUrl);

            if (!oembedResponse.ok) continue;

            const oembedData = await oembedResponse.json();

            // Step 2: Try to scrape the YouTube page for more details
            let description = '';
            let tags = [];
            let viewCount = '';

            try {
                const pageUrl = `https://www.youtube.com/watch?v=${videoId}`;
                const pageResponse = await fetch(pageUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
                    }
                });

                if (pageResponse.ok) {
                    const html = await pageResponse.text();

                    // Extract description from meta tag or JSON
                    const descMatch = html.match(/"description"\s*:\s*\{"simpleText"\s*:\s*"([^"]+)"/);
                    if (descMatch) {
                        description = descMatch[1].replace(/\\n/g, ' ').substring(0, 500);
                    }

                    // Try meta description as fallback
                    if (!description) {
                        const metaMatch = html.match(/<meta name="description" content="([^"]+)"/);
                        if (metaMatch) {
                            description = metaMatch[1].substring(0, 500);
                        }
                    }

                    // Extract keywords/tags
                    const keywordsMatch = html.match(/<meta name="keywords" content="([^"]+)"/);
                    if (keywordsMatch) {
                        tags = keywordsMatch[1].split(',').map(t => t.trim()).slice(0, 10);
                    }

                    // Extract view count
                    const viewMatch = html.match(/"viewCount"\s*:\s*"(\d+)"/);
                    if (viewMatch) {
                        viewCount = parseInt(viewMatch[1]).toLocaleString('pt-BR');
                    }
                }
            } catch (scrapeError) {
                console.log(`[Research] Scrape warning for ${videoId}:`, scrapeError.message);
            }

            const videoInfo = {
                id: videoId,
                title: oembedData.title,
                author: oembedData.author_name,
                description: description,
                tags: tags,
                viewCount: viewCount,
                url: url
            };

            results.push(videoInfo);

            console.log(`[Research] Analyzed video: "${oembedData.title}" by ${oembedData.author_name}`);
            if (description) console.log(`[Research] Description: ${description.substring(0, 100)}...`);
            if (tags.length > 0) console.log(`[Research] Tags: ${tags.slice(0, 5).join(', ')}`);
            if (viewCount) console.log(`[Research] Views: ${viewCount}`);

        } catch (e) {
            console.log(`[Research] Failed to fetch video info for ${url}:`, e.message);
        }
    }

    return results;
}

/**
 * POST /api/youtube/generate-script
 * Generate video script - uses local AI first
 */
router.post('/generate-script', authMiddleware, async (req, res) => {
    const { videoId, idea, platform, style, forceLocal } = req.body;
    if (!idea) return res.status(400).json({ error: 'Ideia é obrigatória' });

    try {
        const result = await youtubeAgent.generateScript(idea, platform || 'youtube', style || 'informative', { forceLocal });

        // Save to video if ID provided
        if (result.success && videoId) {
            db.prepare('UPDATE videos SET script = ?, status = ? WHERE id = ?')
                .run(result.script, 'script_ready', videoId);
        }

        res.json(result);
    } catch (error) {
        console.error('[Script Error]', error);
        res.status(500).json({ error: 'Erro na geração', message: error.message });
    }
});

/**
 * POST /api/youtube/generate-audio
 * Generate audio from script - uses local TTS first
 */
router.post('/generate-audio', authMiddleware, async (req, res) => {
    let { videoId, script, voice, forceLocal } = req.body;

    // Get script from video if not provided
    if (!script && videoId) {
        const video = db.prepare('SELECT script FROM videos WHERE id = ?').get(videoId);
        if (video?.script) script = video.script;
    }

    if (!script) return res.status(400).json({ error: 'Script é obrigatório' });

    try {
        const result = await youtubeAgent.generateAudio(script, voice, { forceLocal });

        if (result.success && videoId) {
            db.prepare('UPDATE videos SET status = ?, audio_path = ? WHERE id = ?')
                .run('audio_ready', result.audioPath, videoId);
        }

        res.json(result);
    } catch (error) {
        console.error('[Audio Error]', error);
        res.status(500).json({ error: 'Erro na geração de áudio', message: error.message });
    }
});

/**
 * GET /api/youtube/audio-files
 * List generated audio files
 */
router.get('/audio-files', authMiddleware, (req, res) => {
    try {
        const files = youtubeAgent.localTTS.listAudioFiles();
        res.json({ files });
    } catch (error) {
        res.json({ files: [] });
    }
});

/**
 * DELETE /api/youtube/audio-files/:filename
 * Delete an audio file
 */
router.delete('/audio-files/:filename', authMiddleware, (req, res) => {
    const deleted = youtubeAgent.localTTS.deleteAudio(req.params.filename);
    res.json({ success: deleted });
});

// ============================================
// Ollama Management
// ============================================

/**
 * GET /api/youtube/ollama/models
 * Get available Ollama models
 */
router.get('/ollama/models', authMiddleware, async (req, res) => {
    try {
        const models = await youtubeAgent.localLLM.getModels();
        res.json({ models });
    } catch (error) {
        res.json({ models: [], error: error.message });
    }
});

/**
 * POST /api/youtube/ollama/pull
 * Pull/download an Ollama model
 */
router.post('/ollama/pull', authMiddleware, async (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'Nome do modelo é obrigatório' });

    try {
        const result = await youtubeAgent.localLLM.pullModel(model);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/youtube/ollama/generate
 * Direct generation with Ollama
 */
router.post('/ollama/generate', authMiddleware, async (req, res) => {
    const { prompt, model, temperature } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt é obrigatório' });

    try {
        const result = await youtubeAgent.localLLM.generate(prompt, { model, temperature });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/youtube/analyze-audio
 * AI Audio Analysis using Silero VAD (for Premiere Plugin)
 */
router.post('/analyze-audio', authMiddleware, async (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'FilePath é obrigatório' });

    try {
        const result = await youtubeAgent.analyzeAudioWithVAD(filePath);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Legacy API status endpoint (for compatibility)
router.get('/api-status', authMiddleware, async (req, res) => {
    try {
        const status = await youtubeAgent.getAIStatus();
        res.json({ status: status.api });
    } catch (error) {
        res.json({ status: {} });
    }
});

module.exports = router;
