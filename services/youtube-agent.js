/**
 * YouTube AI Agent Service - Unified
 * Prioritizes local AI (Ollama, edge-tts) over paid APIs
 * Falls back to templates when nothing is available
 */

const db = require('../database/db');
const localLLM = require('./local-llm');
const localTTS = require('./local-tts');
const templates = require('./templates');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
// Set absolute path to bundled ffmpeg
const ffmpegPath = "E:\\Projeto AUDIOCUTPRO\\versão Nova\\ratoenginedemo1.3Fix\\com.ratoengine.panel\\RatoEngine_Plugin\\com.ratoengine.panel\\bin\\ffmpeg.exe";
ffmpeg.setFfmpegPath(ffmpegPath);

// Helper to get API key
function getApiKey(service) {
    try {
        const row = db.prepare('SELECT api_key FROM api_keys WHERE service = ? AND is_active = 1').get(service);
        return row?.api_key || null;
    } catch {
        return null;
    }
}

/**
 * Get AI status - what's available
 */
async function getAIStatus() {
    const ollamaAvailable = await localLLM.isAvailable();
    const ttsAvailable = await localTTS.isAvailable();
    const ollamaModels = ollamaAvailable ? await localLLM.getModels() : [];

    return {
        local: {
            ollama: ollamaAvailable,
            ollamaModels: ollamaModels.map(m => m.name),
            tts: ttsAvailable,
            ttsVoices: localTTS.getVoices('pt-BR')
        },
        api: {
            openai: !!getApiKey('openai'),
            google: !!getApiKey('google'),
            elevenlabs: !!getApiKey('elevenlabs'),
            veo3: !!getApiKey('veo3')
        },
        templates: {
            categories: templates.getCategories(),
            platforms: templates.getPlatforms()
        }
    };
}

/**
 * Research niches and find video ideas
 * Priority: Ollama Local → OpenAI/Gemini API → Templates
 */
async function researchNiche(niche, keywords = '', options = {}) {
    const forceLocal = options.forceLocal || false;
    const referenceVideos = options.referenceVideos || [];
    const count = options.count || 10;

    console.log(`[YouTubeAgent] Starting research for niche: "${niche}" keywords: "${keywords}" count: ${count} refs: ${referenceVideos.length}`);

    // Determine provider priority
    const provider = options.aiProvider || 'auto'; // 'ollama', 'google', 'openai', 'auto'

    console.log(`[YouTubeAgent] Researching with provider: ${provider}`);

    // 1. OLLAMA Strategy
    if (provider === 'ollama' || (provider === 'auto' && !options.skipLocal)) {
        try {
            const ollamaAvailable = await localLLM.isAvailable();
            if (ollamaAvailable) {
                console.log('[YouTubeAgent] Using Ollama...');
                const result = await localLLM.researchNiche(niche, keywords, { referenceVideos, count });
                if (result.success && result.ideas?.length > 0) return result;
            }
        } catch (e) {
            console.error('[YouTubeAgent] Ollama error:', e.message);
        }
    }

    // 2. GOOGLE Strategy
    if (provider === 'google' || provider === 'auto') {
        const googleKey = getApiKey('google');
        if (googleKey) {
            console.log('[YouTubeAgent] Using Gemini (Google)...');
            return await researchWithGemini(niche, keywords, googleKey);
        } else if (provider === 'google') {
            return { success: false, error: 'Chave do Google (Gemini) não configurada.' };
        }
    }

    // 3. OPENAI Strategy
    if (provider === 'openai' || provider === 'auto') {
        const openaiKey = getApiKey('openai');
        if (openaiKey) {
            console.log('[YouTubeAgent] Using OpenAI...');
            return await researchWithOpenAI(niche, keywords, openaiKey);
        } else if (provider === 'openai') {
            return { success: false, error: 'Chave da OpenAI não configurada.' };
        }
    }

    // 3. Fallback to templates - generate NICHE-SPECIFIC content
    console.log('[YouTubeAgent] FALLBACK: Using templates for research');
    const ideas = generateNicheSpecificIdeas(niche, keywords);
    return {
        success: true,
        source: 'templates-dynamic',
        ideas: ideas,
        note: 'Gerado via templates. Para resultados melhores, verifique se o Ollama está rodando.'
    };
}

/**
 * Generate dynamic niche-specific ideas (fallback)
 */
function generateNicheSpecificIdeas(niche, keywords = '') {
    const formats = ['Tutorial', 'Listicle', 'Reação', 'Comparação', 'Storytelling', 'Análise', 'Review'];
    const potentials = ['high', 'high', 'high', 'medium', 'medium'];
    const durations = ['8-12 min', '10-15 min', '5-8 min', '15-20 min', '12-18 min'];

    const templates = [
        `Os 7 ERROS que TODO INICIANTE comete em ${niche}`,
        `Como eu fiz R$10.000 com ${niche} (passo a passo)`,
        `${niche} em 2024: O Guia DEFINITIVO para Iniciantes`,
        `Testei ${niche} por 30 dias e OLHA O QUE ACONTECEU`,
        `A VERDADE sobre ${niche} que ninguém te conta`,
        `${niche}: 5 DICAS que vão MUDAR sua vida`,
        `Por que ${niche} está EXPLODINDO em 2024`,
        `Como ${niche} pode te fazer ganhar dinheiro`,
        `Reagi aos PIORES erros em ${niche}`,
        `${niche} vs ${niche}: Qual é MELHOR?`
    ];

    // Shuffle and pick 5
    const shuffled = templates.sort(() => Math.random() - 0.5);

    return shuffled.slice(0, 5).map((title, i) => ({
        title: keywords ? title.replace(niche, `${niche} (${keywords})`) : title,
        hook: `Você sabia que 90% das pessoas erram em ${niche}?`,
        potential: potentials[i % potentials.length],
        format: formats[Math.floor(Math.random() * formats.length)],
        duration: durations[i % durations.length],
        target_audience: `Pessoas interessadas em ${niche}`,
        why_viral: `Título com gatilhos emocionais + tema em alta`,
        tags: [niche.toLowerCase(), keywords?.toLowerCase() || 'dicas', '2024', 'tutorial'].filter(Boolean),
        thumbnail_idea: `Rosto surpreso + texto grande com número`
    }));
}

/**
 * Generate video script
 * Priority: Ollama Local → OpenAI/Gemini API → Templates
 */
async function generateScript(idea, platform = 'youtube', style = 'informative', options = {}) {
    const forceLocal = options.forceLocal || false;

    // 1. Try Ollama first
    if (!options.skipLocal) {
        const ollamaAvailable = await localLLM.isAvailable();
        if (ollamaAvailable) {
            console.log('[YouTubeAgent] Using Ollama for script');
            const result = await localLLM.generateScript(idea, platform, style);
            if (result.success) {
                return result;
            }
        }
    }

    // 2. Try paid APIs
    if (!forceLocal) {
        const openaiKey = getApiKey('openai');
        const googleKey = getApiKey('google');

        if (openaiKey) {
            console.log('[YouTubeAgent] Using OpenAI for script');
            return await generateScriptWithOpenAI(idea, platform, style, openaiKey);
        }

        if (googleKey) {
            console.log('[YouTubeAgent] Using Gemini for script');
            return await generateScriptWithGemini(idea, platform, style, googleKey);
        }
    }

    // 3. Fallback to templates
    console.log('[YouTubeAgent] Using templates for script');
    return templates.generateScript(idea, platform, { niche: idea });
}

/**
 * Generate audio from script
 * Priority: edge-tts Local → OpenAI TTS → ElevenLabs
 */
async function generateAudio(script, voice = null, options = {}) {
    const forceLocal = options.forceLocal || false;

    // 1. Try edge-tts first (local, free)
    if (!options.skipLocal) {
        const ttsAvailable = await localTTS.isAvailable();
        if (ttsAvailable) {
            console.log('[YouTubeAgent] Using edge-tts for audio');
            const localVoice = voice || 'pt-BR-FranciscaNeural';
            const result = await localTTS.generateAudio(script, localVoice, options);
            if (result.success) {
                return result;
            }
        }
    }

    // 2. Try paid APIs
    if (!forceLocal) {
        const openaiKey = getApiKey('openai');
        const elevenlabsKey = getApiKey('elevenlabs');

        if (openaiKey) {
            console.log('[YouTubeAgent] Using OpenAI TTS for audio');
            return await generateAudioWithOpenAI(script, voice || 'alloy', openaiKey);
        }

        if (elevenlabsKey) {
            console.log('[YouTubeAgent] Using ElevenLabs for audio');
            return await generateAudioWithElevenLabs(script, voice, elevenlabsKey);
        }
    }

    // 3. No audio generation available
    return {
        success: false,
        error: 'Nenhum serviço de TTS disponível. Instale edge-tts: pip install edge-tts',
        requiresTTS: true
    };
}

/**
 * Get available voices
 */
async function getVoices() {
    const voices = [];

    // Local voices (edge-tts)
    const ttsAvailable = await localTTS.isAvailable();
    if (ttsAvailable) {
        localTTS.getVoices('pt-BR').forEach(v => {
            voices.push({ ...v, provider: 'edge-tts', local: true });
        });
    }

    // OpenAI voices
    if (getApiKey('openai')) {
        voices.push(
            { id: 'alloy', name: 'Alloy', provider: 'openai', local: false },
            { id: 'echo', name: 'Echo', provider: 'openai', local: false },
            { id: 'fable', name: 'Fable', provider: 'openai', local: false },
            { id: 'onyx', name: 'Onyx', provider: 'openai', local: false },
            { id: 'nova', name: 'Nova', provider: 'openai', local: false },
            { id: 'shimmer', name: 'Shimmer', provider: 'openai', local: false }
        );
    }

    // ElevenLabs voices
    if (getApiKey('elevenlabs')) {
        voices.push(
            { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', provider: 'elevenlabs', local: false },
            { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', provider: 'elevenlabs', local: false }
        );
    }

    return voices;
}

// ============================================
// PAID API IMPLEMENTATIONS (fallback)
// ============================================

async function researchWithOpenAI(niche, keywords, apiKey) {
    try {
        const prompt = `Você é um especialista em YouTube. Analise o nicho "${niche}"${keywords ? ` com foco em: ${keywords}` : ''}.
Forneça 5 ideias de vídeos em JSON: { "ideas": [{ "title": "...", "potential": "high/medium/low", "format": "...", "duration": "...", "reason": "..." }] }`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                response_format: { type: 'json_object' }
            })
        });

        const data = await response.json();
        const content = JSON.parse(data.choices[0].message.content);
        return { success: true, source: 'openai', ideas: content.ideas };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

const https = require('https');

// Helper to call Gemini with fallback (using native https for max reliability)
async function callGemini(apiKey, prompt) {
    // UPDATED: Use models confirmed by simple listModels() check
    // Prioritize 1.5/flash-latest as 2.0 is hitting quota limits (Limit 0)
    const models = ['gemini-flash-latest', 'gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-pro-latest'];
    let lastError = null;

    for (const model of models) {
        try {
            console.log(`[Gemini] Attempting with model: ${model}`);

            const responseData = await new Promise((resolve, reject) => {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });

                const req = https.request(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body) // Correct byte length calculation
                    }
                }, (res) => {
                    let data = '';
                    res.on('data', (chunk) => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            try {
                                resolve(JSON.parse(data));
                            } catch (e) {
                                reject(new Error('Invalid JSON response: ' + data.substring(0, 100)));
                            }
                        } else {
                            reject(new Error(`API Error ${res.statusCode}: ${data}`));
                        }
                    });
                });

                req.on('error', (e) => reject(new Error('Network Error: ' + e.message)));
                req.write(body);
                req.end();
            });

            return responseData;

        } catch (e) {
            console.warn(`[Gemini] Model ${model} failed:`, e.message);
            lastError = e;

            // If it's a 4xx error (client side), we might want to try other models unless it's auth (403).
            if (e.message.includes('403')) break;
        }
    }
    throw lastError || new Error('All Gemini models failed');
}

async function researchWithGemini(niche, keywords, apiKey) {
    if (!apiKey) {
        return { success: false, error: 'Chave de API do Gemini não configurada. Vá em Configurações > Google.' };
    }

    try {
        const prompt = `Analise o nicho "${niche}" e forneça 5 ideias de vídeos virais em JSON. Formato: { "ideas": [{ "title": "...", "potential": "high", "format": "...", "duration": "...", "reason": "..." }] }`;

        let data;
        try {
            data = await callGemini(apiKey, prompt);
        } catch (e) {
            return { success: false, error: e.message };
        }

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            console.error('[Gemini API Error] Unexpected response format:', JSON.stringify(data));
            return { success: false, error: 'Resposta inválida do Gemini (sem candidatos)' };
        }

        const text = data.candidates[0].content.parts[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
            try {
                const content = JSON.parse(jsonMatch[0]);
                return { success: true, source: 'gemini', ideas: content.ideas || [] };
            } catch (e) {
                console.error('[Gemini Parse Error]', e);
                return { success: false, error: 'Erro ao processar JSON do Gemini' };
            }
        }
        return { success: false, error: 'JSON não encontrado na resposta do Gemini' };
    } catch (error) {
        console.error('[Gemini Request Error]', error);
        return { success: false, error: error.message };
    }
}

async function generateScriptWithOpenAI(idea, platform, style, apiKey) {
    try {
        const prompt = `Crie um roteiro profissional de ${platform} sobre: ${idea}. Estilo: ${style}. Inclua timestamps, indicações visuais e CTAs.`;
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.7,
                max_tokens: 4000
            })
        });
        const data = await response.json();
        return { success: true, source: 'openai', script: data.choices[0].message.content, platform, style };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function generateScriptWithGemini(idea, platform, style, apiKey) {
    try {
        const prompt = `Crie um roteiro de ${platform} sobre: ${idea}. Estilo: ${style}.`;

        let data;
        try {
            data = await callGemini(apiKey, prompt);
        } catch (e) {
            return { success: false, error: e.message };
        }

        if (!data.candidates || !data.candidates[0]) {
            return { success: false, error: 'Sem resposta do Gemini' };
        }

        return { success: true, source: 'gemini', script: data.candidates[0].content.parts[0].text, platform, style };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function generateAudioWithOpenAI(script, voice, apiKey) {
    try {
        const cleanScript = script.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim().substring(0, 4096);
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ model: 'tts-1', input: cleanScript, voice: voice })
        });
        const audioBuffer = await response.arrayBuffer();
        const fs = require('fs');
        const path = require('path');
        const audioDir = path.join(__dirname, '..', 'audio');
        if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
        const filename = `audio_${Date.now()}.mp3`;
        const filepath = path.join(audioDir, filename);
        fs.writeFileSync(filepath, Buffer.from(audioBuffer));
        return { success: true, source: 'openai', audioPath: filepath, filename };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

async function generateAudioWithElevenLabs(script, voice, apiKey) {
    try {
        const cleanScript = script.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim().substring(0, 5000);
        const voiceId = voice || 'EXAVITQu4vr4xnSDxMaL';
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
            body: JSON.stringify({ text: cleanScript, model_id: 'eleven_multilingual_v2' })
        });
        const audioBuffer = await response.arrayBuffer();
        const fs = require('fs');
        const path = require('path');
        const audioDir = path.join(__dirname, '..', 'audio');
        if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
        const filename = `audio_${Date.now()}.mp3`;
        const filepath = path.join(audioDir, filename);
        fs.writeFileSync(filepath, Buffer.from(audioBuffer));
        return { success: true, source: 'elevenlabs', audioPath: filepath, filename };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// OAUTH2 & YOUTUBE API
// ============================================

function createOAuth2Client(credentials) {
    const { clientId, clientSecret, redirectUri } = credentials;
    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function generateAuthUrl(credentials) {
    const oauth2Client = createOAuth2Client(credentials);
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/youtube.upload',
            'https://www.googleapis.com/auth/youtube.readonly'
        ]
    });
}

async function exchangeCodeForToken(code, credentials) {
    const oauth2Client = createOAuth2Client(credentials);
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
}

async function uploadVideoToYouTube(videoData, authTokens, credentials) {
    const oauth2Client = createOAuth2Client(credentials);
    oauth2Client.setCredentials(authTokens);

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Upload
    const res = await youtube.videos.insert({
        part: 'snippet,status',
        requestBody: {
            snippet: {
                title: videoData.title,
                description: videoData.description || 'Uploaded by RatoEngine',
                tags: videoData.tags || [],
                categoryId: '22'
            },
            status: {
                privacyStatus: 'private' // Safety default
            }
        },
        media: {
            body: fs.createReadStream(videoData.path)
        }
    });

    return res.data;
}

// VIDEO GENERATION (FFMPEG - MULTI-CLIP SUPPORT)
async function renderVideo(mediaPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        // Check if mediaPath is array (multiple clips) or string (single image/video)

        if (Array.isArray(mediaPath)) {
            // MULTI-CLIP STITCHING FOR STOCK FOOTAGE WITH SMART SCALING
            const command = ffmpeg();

            // Add all video inputs
            mediaPath.forEach(p => command.input(p));

            // Add audio input (last input)
            command.input(audioPath);

            // Generate Complex Filter
            // We need to scale ALL videos to 1920x1080 to prevent concatenation errors
            // filter: [0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]; ...

            let filterGraph = [];
            let concatInputs = [];

            mediaPath.forEach((_, index) => {
                // Scale & Pad filter
                filterGraph.push({
                    filter: 'scale',
                    options: '1920:1080:force_original_aspect_ratio=decrease',
                    inputs: `${index}:v`,
                    outputs: `scaled${index}`
                });
                filterGraph.push({
                    filter: 'pad',
                    options: '1920:1080:(ow-iw)/2:(oh-ih)/2',
                    inputs: `scaled${index}`,
                    outputs: `padded${index}`
                });
                filterGraph.push({
                    filter: 'setsar',
                    options: '1',
                    inputs: `padded${index}`,
                    outputs: `v${index}`
                });
                concatInputs.push(`v${index}`);
            });

            // Concat filter
            filterGraph.push({
                filter: 'concat',
                options: { n: mediaPath.length, v: 1, a: 0 }, // Video only, audio comes from separate file
                inputs: concatInputs,
                outputs: 'v'
            });

            command
                .complexFilter(filterGraph)
                .map('v') // Mapped concatenated video
                .map(`${mediaPath.length}:a`) // Map the Audio file (last input)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-pix_fmt yuv420p',
                    '-shortest', // Stop when shortest stream ends
                    '-r 30'      // Force 30fps
                ])
                .save(outputPath)
                .on('end', () => resolve(outputPath))
                .on('error', (err) => {
                    console.error('FFmpeg Stitch Error:', err);
                    reject(err);
                });

        } else {
            // SINGLE IMAGE / VIDEO LOOP (Original)
            ffmpeg()
                .input(mediaPath)
                .loop()
                .input(audioPath)
                .videoCodec('libx264')
                .audioCodec('aac')
                .outputOptions([
                    '-pix_fmt yuv420p',
                    '-shortest',
                    '-tune stillimage'
                ])
                .save(outputPath)
                .on('end', () => resolve(outputPath))
                .on('error', (err) => reject(err));
        }
    });
}

// Helper for HTTPS requests
function httpsRequest(url, options = {}, body = null) {
    const https = require('https');
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        // If not JSON, return raw buffer? No, usually JSON APIs.
                        // But for images we need buffer.
                        resolve(data);
                    }
                } else {
                    reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', (e) => reject(e));
        if (body) {
            req.write(typeof body === 'object' ? JSON.stringify(body) : body);
        }
        req.end();
    });
}

// Helper to download file
function downloadFile(url, destPath) {
    const https = require('https');
    const fs = require('fs');
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(destPath);
        https.get(url, (response) => {
            if (response.statusCode === 200) {
                response.pipe(file);
                file.on('finish', () => {
                    file.close(resolve);
                });
            } else {
                fs.unlink(destPath, () => reject(new Error(`Download failed: ${response.statusCode}`)));
            }
        }).on('error', (err) => {
            fs.unlink(destPath, () => reject(err));
        });
    });
}

// STOCK FOOTAGE (PEXELS)
async function searchPexelsVideos(query, apiKey, count = 3) {
    try {
        const data = await httpsRequest(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`, {
            method: 'GET',
            headers: { 'Authorization': apiKey }
        });

        if (!data.videos || data.videos.length === 0) return [];

        const path = require('path');
        const fs = require('fs');
        const vidDir = path.join(__dirname, '..', 'public', 'uploads', 'stock');
        if (!fs.existsSync(vidDir)) fs.mkdirSync(vidDir, { recursive: true });

        const videoPaths = [];

        for (const vid of data.videos) {
            // Get best quality mp4
            const videoFile = vid.video_files.find(f => f.quality === 'hd') || vid.video_files[0];
            if (!videoFile) continue;

            const localPath = path.join(vidDir, `pexels_${vid.id}.mp4`);
            await downloadFile(videoFile.link, localPath);
            videoPaths.push(localPath);
        }

        return videoPaths;
    } catch (e) {
        console.error('Pexels Error:', e);
        return [];
    }
}

// LOCAL STABLE DIFFUSION
async function generateImageWithLocalSD(prompt, sdUrl = 'http://127.0.0.1:7860') {
    try {
        // Handle http vs https for local
        const lib = sdUrl.startsWith('https') ? require('https') : require('http');

        // Custom request logic for local http
        const data = await new Promise((resolve, reject) => {
            const req = lib.request(`${sdUrl}/sdapi/v1/txt2img`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, (res) => {
                let chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
            });
            req.on('error', reject);
            req.write(JSON.stringify({
                prompt: `cinematic shot, ${prompt}, highly detailed, 8k, photorealistic`,
                negative_prompt: "text, watermark, low quality, ugly, deformed",
                steps: 20,
                width: 1024,
                height: 1024,
                cfg_scale: 7
            }));
            req.end();
        });

        if (!data.images || data.images.length === 0) throw new Error('No images returned');

        // Decode Base64
        const buffer = Buffer.from(data.images[0], 'base64');
        const fs = require('fs');
        const path = require('path');
        const imgDir = path.join(__dirname, '..', 'public', 'uploads');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

        const filename = `sd_${Date.now()}.png`;
        const filepath = path.join(imgDir, filename);
        fs.writeFileSync(filepath, buffer);

        return { success: true, imagePath: filepath };

    } catch (e) {
        console.error('Local SD Error:', e);
        return { success: false, error: e.message };
    }
}

async function generateImageWithOpenAI(prompt, apiKey) {
    try {
        const data = await httpsRequest('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        }, {
            model: "dall-e-3",
            prompt: `Cinematic YouTube Thumbnail for a video about: ${prompt}. High quality, 4k, professional lighting, no text.`,
            n: 1,
            size: "1024x1024"
        });

        if (data.error) throw new Error(data.error.message);

        const imageUrl = data.data[0].url;

        // Download Image
        const fs = require('fs');
        const path = require('path');
        const imgDir = path.join(__dirname, '..', 'public', 'uploads');
        if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

        const filename = `img_${Date.now()}.png`;
        const filepath = path.join(imgDir, filename);

        await downloadFile(imageUrl, filepath);

        return { success: true, imagePath: filepath };
    } catch (e) {
        console.error('Image Gen Error:', e);
        return { success: false, error: e.message };
    }
}

// Generate simple background video/image locally using FFmpeg
// Generate complex visualizer video locally using FFmpeg
async function renderLocalVideoWithVisualizer(audioPath, outputPath, title, backgroundType = 'gradient') {
    return new Promise((resolve, reject) => {
        // Simple sanitization
        const safeTitle = title.replace(/:/g, '\\:').replace(/'/g, '').substring(0, 40);

        // Complex Filter Chain explanation:
        // 1. [0:a] showwaves=s=1280x200:mode=line:colors=cyan [wave] -> Generate Waveform
        // 2. color=c=black:s=1920x1080 [bg] -> Black generic background or Gradient if possible
        // 3. [bg][wave] overlay=x=(W-w)/2:y=H-300 [comp1] -> waveform at bottom
        // 4. [comp1] drawtext... -> Title centered

        // Using 'testsrc' for dynamic background or 'mandelbrot' (fractal)
        const bgInput = backgroundType === 'fractal' ? 'mandelbrot=s=1920x1080' : 'testsrc=size=1920x1080:rate=30';
        // Actually a nice dark gradient is better: color=c=#1a1a2e:s=1920x1080

        ffmpeg()
            .input(audioPath)
            .complexFilter([
                // 1. Generate Waveform from Audio
                {
                    filter: 'showwaves',
                    options: { s: '1280x250', mode: 'line', colors: '0x00ffcc|0x0099ff' },
                    inputs: '0:a',
                    outputs: 'wave'
                },
                // 2. Generate Background (Dark Gradient Style)
                // Since we can't easily generate gradient without extra input, lets use a solid dark color
                {
                    filter: 'color',
                    options: { c: '#121212', s: '1920x1080' },
                    outputs: 'bg'
                },
                // 3. Overlay Waveform
                {
                    filter: 'overlay',
                    options: { x: '(W-w)/2', y: 'H-350' },
                    inputs: ['bg', 'wave'],
                    outputs: 'comp1'
                },
                // 4. Draw Title 
                {
                    filter: 'drawtext',
                    options: {
                        text: safeTitle,
                        fontcolor: 'white',
                        fontsize: 80,
                        x: '(w-text_w)/2',
                        y: '(h-text_h)/3', // Upper third
                        box: 1,
                        boxcolor: 'black@0.5',
                        boxborderw: 20
                    },
                    inputs: 'comp1',
                    outputs: 'v'
                }
            ])
            .map('v') // Map video from filter
            .map('0:a') // Map original audio
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-pix_fmt yuv420p',
                '-shortest' // Stop when audio ends
            ])
            .save(outputPath)
            .on('end', () => resolve({ success: true, videoPath: outputPath }))
            .on('error', (err) => reject({ success: false, error: err.message }));
    });
}

// Export everything
async function renderSmartEditedVideo(scenes, apiKey, outputPath) {
    return new Promise(async (resolve, reject) => {
        try {
            const path = require('path');
            const fs = require('fs');

            // Temp dir for this render
            const tempDir = path.join(__dirname, '..', 'public', 'uploads', `temp_${Date.now()}`);
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

            const segments = [];

            // 1. Process Each Scene
            for (let i = 0; i < scenes.length; i++) {
                const scene = scenes[i];
                const index = i;
                console.log(`[SmartEdit] Processing Scene ${index + 1}/${scenes.length}: "${scene.visual_query}"`);

                // A. Generate Audio Segment
                const audioRes = await localTTS.generateAudio(scene.text, 'pt-BR-FranciscaNeural');
                if (!audioRes.success) throw new Error('TTS Failed for scene ' + index);

                // Move/Copy audio to temp
                const segmentAudioPath = path.join(tempDir, `audio_${index}.mp3`);
                fs.copyFileSync(audioRes.audioPath, segmentAudioPath);

                // Get Audio Duration (using ffprobe preferably, or estimate)
                // We will use ffprobe to be exact.
                const getDuration = (p) => {
                    return new Promise((res, rej) => {
                        ffmpeg.ffprobe(p, (err, meta) => {
                            if (err) rej(err);
                            else res(meta.format.duration);
                        });
                    });
                };

                const duration = await getDuration(segmentAudioPath);
                console.log(`[SmartEdit] Scene ${index + 1} Duration: ${duration}s`);

                // B. Search & Download Visual
                const videos = await searchPexelsVideos(scene.visual_query, apiKey, 1);
                let videoPath = null;

                if (videos.length > 0) {
                    videoPath = videos[0]; // Use the first match
                } else {
                    // Fallback: Generate a simple color bg video of that duration
                    // Or use a generic fallback video if we had one.
                    // Let's create a solid color bg with FFmpeg
                    videoPath = path.join(tempDir, `fallback_${index}.mp4`);
                    await new Promise((res, rej) => {
                        ffmpeg()
                            .input('color=c=black:s=1920x1080')
                            .inputFormat('lavfi')
                            .outputOptions([`-t ${duration}`, '-pix_fmt yuv420p'])
                            .save(videoPath)
                            .on('end', res)
                            .on('error', rej);
                    });
                }

                // C. Trim Video to Audio Duration
                const trimmedVideoPath = path.join(tempDir, `video_trim_${index}.mp4`);
                await new Promise((res, rej) => {
                    // We trim the video (loop if shorter) to exactly the audio duration
                    ffmpeg()
                        .input(videoPath)
                        .inputOptions(['-stream_loop -1']) // Loop input if needed
                        .outputOptions([
                            `-t ${duration}`,
                            '-vf scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1', // Ensure 1080p
                            '-c:v libx264',
                            '-pix_fmt yuv420p'
                        ])
                        .save(trimmedVideoPath)
                        .on('end', res)
                        .on('error', rej);
                });

                segments.push({
                    video: trimmedVideoPath,
                    audio: segmentAudioPath
                });
            }

            // 2. Concat All Segments
            // We need a complex filter or file list. 
            // Simpler method: Create a concat text file used by ffmpeg demuxer, 
            // BUT since we have separate audio/video files, we need to merge them first per segment?
            // No, we can render partial mp4s (video+audio) then concat those.

            const finalSegments = [];
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const segPath = path.join(tempDir, `segment_${i}.mp4`);

                await new Promise((res, rej) => {
                    ffmpeg()
                        .input(seg.video)
                        .input(seg.audio)
                        .outputOptions([
                            '-c:v copy', // Video is already encoded correctly above
                            '-c:a aac',
                            '-shortest'
                        ])
                        .save(segPath)
                        .on('end', res)
                        .on('error', rej);
                });
                finalSegments.push(segPath);
            }

            // Final Concat
            const fileListPath = path.join(tempDir, 'concat_list.txt');
            const fileContent = finalSegments.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
            fs.writeFileSync(fileListPath, fileContent);

            ffmpeg()
                .input(fileListPath)
                .inputOptions(['-f concat', '-safe 0'])
                .outputOptions(['-c copy'])
                .save(outputPath)
                .on('end', () => {
                    // Cleanup temp? Maybe later
                    resolve({ success: true, videoPath: outputPath });
                })
                .on('error', (err) => reject(err));

        } catch (e) {
            console.error('[SmartEdit] Error:', e);
            reject({ success: false, error: e.message });
        }
    });
}

/**
 * Analyze audio using Silero VAD (Python)
 */
async function analyzeAudioWithVAD(filePath) {
    const { exec } = require('child_process');
    const path = require('path');

    return new Promise((resolve, reject) => {
        const fs = require('fs');
        const scriptPath = path.join(__dirname, '..', 'ai_agents', 'audio_analysis', 'vad_service.py');

        // Check for portable python
        const portablePython = path.join(__dirname, '..', 'python_portable', 'python.exe');
        const pythonCmd = fs.existsSync(portablePython) ? `"${portablePython}"` : 'python';

        const cmd = `${pythonCmd} "${scriptPath}" --file "${filePath}"`;

        console.log(`[VAD] Analyzing: ${filePath}`);

        exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error('[VAD] Error:', stderr);
                // Don't reject, resolve with error so frontend handles it gracefully
                return resolve({ success: false, error: 'VAD Analysis failed. Check dependencies.' });
            }
            try {
                const lines = stdout.trim().split('\n');
                const lastLine = lines[lines.length - 1];
                const result = JSON.parse(lastLine);
                resolve(result);
            } catch (e) {
                resolve({ success: false, error: 'Invalid JSON from VAD service', raw: stdout });
            }
        });
    });
}

/**
* Run a local Python Agent
* @param {string} agentName - 'opensora', 'director', 'samurai'
* @param {string} prompt - The prompt or script
* @param {string} outputPath - Where to save the video
*/
async function runPythonAgent(agentName, prompt, outputPath) {
    const { spawn, exec } = require('child_process');
    const path = require('path');
    const fs = require('fs');

    // Timeout configuration (default 15 minutes for Video Gen, resettable by heartbeat)
    const TIMEOUT_MS = 1000 * 60 * 15;

    // Helper to find python
    const getPythonCmd = () => {
        const portablePython = path.join(__dirname, '..', 'python_portable', 'python.exe');
        return fs.existsSync(portablePython) ? `"${portablePython}"` : 'python';
    };

    const pythonCmd = getPythonCmd();

    // 1. PRE-FLIGHT CHECK (Only for OpenSora for now)
    if (agentName === 'opensora') {
        const checkScript = path.join(__dirname, '..', 'ai_agents', agentName, 'check_env.py');
        console.log(`[Agent ${agentName}] Running Pre-flight check...`);

        try {
            const checkResult = await new Promise((resolve, reject) => {
                exec(`${pythonCmd} "${checkScript}"`, (err, stdout, stderr) => {
                    if (err) return reject(new Error(`Check failed: ${stderr || err.message}`));
                    try {
                        resolve(JSON.parse(stdout.trim()));
                    } catch (e) {
                        // Fallback for messy output - try to find JSON block
                        const match = stdout.match(/\{[\s\S]*\}/);
                        if (match) resolve(JSON.parse(match[0]));
                        else reject(new Error(`Invalid JSON from check_env: ${stdout}`));
                    }
                });
            });

            if (!checkResult.success) {
                console.error(`[Agent ${agentName}] Pre-flight Failed:`, checkResult);
                let errorMsg = 'Falha na verificação do ambiente.';
                if (!checkResult.weights_found) errorMsg += ' Arquivo de Pesos (weights) não encontrado.';
                if (checkResult.missing_deps && checkResult.missing_deps.length > 0) {
                    errorMsg += ` Dependências faltando: ${checkResult.missing_deps.join(', ')}.`;
                }
                throw new Error(errorMsg);
            }
            console.log(`[Agent ${agentName}] Pre-flight Success!`);

        } catch (e) {
            console.error(`[Agent ${agentName}] Environment Error:`, e.message);
            throw e; // Propagate error up
        }
    }

    // 2. MAIN EXECUTION
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', 'ai_agents', agentName, `run_${agentName}.py`);

        // Use bare python command for spawn (arguments separate)
        const spawnCmd = fs.existsSync(path.join(__dirname, '..', 'python_portable', 'python.exe'))
            ? path.join(__dirname, '..', 'python_portable', 'python.exe')
            : 'python';

        const args = [
            '-u', // Unbuffered stdout is CRITICAL to prevent Node.js buffering freezes
            scriptPath,
            '--prompt', prompt,
            '--output', outputPath
        ];

        console.log(`[Agent] Spawning: ${spawnCmd} ${args.join(' ')}`);

        const child = spawn(spawnCmd, args);

        let stdout = '';
        let stderr = '';
        let lastHeartbeat = Date.now();

        // Heartbeat Monitor
        const checkInterval = setInterval(() => {
            const now = Date.now();
            if (now - lastHeartbeat > TIMEOUT_MS) {
                clearInterval(checkInterval);
                console.error(`[Agent ${agentName}] TIMEOUT (No heartbeat for ${TIMEOUT_MS / 1000}s) - Killing process...`);
                child.kill();
                reject(new Error(`Agent ${agentName} timed out (frozen).`));
            }
        }, 5000);

        child.stdout.on('data', (data) => {
            const msg = data.toString();
            // Reset heartbeat on ANY output, but specifically look for HEARTBEAT tag
            lastHeartbeat = Date.now();

            if (msg.includes('HEARTBEAT')) {
                // Determine if we want to log heartbeats. Maybe verbose only.
                // console.log('.'); 
            } else {
                stdout += msg;
                console.log(`[Agent ${agentName}]`, msg.trim());
            }
        });

        child.stderr.on('data', (data) => {
            const msg = data.toString();
            // stderr also counts as activity
            lastHeartbeat = Date.now();
            stderr += msg;
            // console.error(`[Agent ${agentName} STDERR]`, msg.trim());
        });

        child.on('close', (code) => {
            clearInterval(checkInterval);

            if (code !== 0 && code !== null) {
                console.error(`[Agent ${agentName}] Error (Exit ${code}):`, stderr);
                let userMsg = `Falha ao executar agente ${agentName}.`;
                if (stderr.includes('not found')) userMsg = 'Erro de dependência (Module not found).';
                return reject(new Error(userMsg + ` (Exit ${code})\n${stderr.substring(0, 200)}`));
            }

            console.log(`[Agent ${agentName}] Finished successfully.`);
            resolve({ success: true, videoPath: outputPath });
        });

        child.on('error', (err) => {
            clearInterval(checkInterval);
            reject(new Error(`Failed to start subprocess: ${err.message}`));
        });
    });
}

module.exports = {
    getAIStatus,
    getApiKey,
    researchNiche,
    generateScript,
    generateAudio,
    generateImageWithOpenAI,
    generateImageWithLocalSD,
    renderVideo,
    renderLocalVideoWithVisualizer,
    renderSmartEditedVideo,
    generateAudioWithOpenAI,
    generateAudioWithElevenLabs,
    uploadVideoToYouTube,
    getVoices,
    localLLM,
    localTTS,
    templates,
    runPythonAgent,
    analyzeAudioWithVAD
};
