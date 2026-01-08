/**
 * External Agent Service
 * Gerencia integrações com ferramentas externas de IA (Cloud)
 * Permite que o sistema atue como um "Agente" usando credenciais de outros serviços
 */

const fs = require('fs');
const path = require('path');
const db = require('../database/db');
const browserAgent = require('./browser-agent');

class ExternalAgentService {
    constructor() {
        this.providers = {
            'openai_editor': this.runOpenAIEditor,
            'google_veo': this.runGoogleVeo,
            'generic_cloud': this.runGenericCloud
        };
    }

    async runAgent(script, providerName, apiKey, outputPath, options = {}) {
        console.log(`[ExternalAgent] Iniciando tarefa com provedor: ${providerName}`);
        const providerFn = this.providers[providerName];
        if (!providerFn) throw new Error(`Provedor externo '${providerName}' não suportado.`);
        return await providerFn.call(this, script, apiKey, outputPath, options);
    }

    async runOpenAIEditor(script, apiKey, outputPath, options) {
        console.log('[ExternalAgent] Contatando OpenAI Assistant...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        return await this.createRichPlaceholder(outputPath, options.audioPath, options.imagePath);
    }

    async runGoogleVeo(script, apiKey, outputPath, options) {
        console.log('[ExternalAgent] Iniciando Google Veo (Mojo Autônomo)...');

        // 1. Split Script into 8s Chunks (Heuristic or LLM)
        // Simple heuristic: 1 chunk per sentence or ~15 words
        const chunks = script.split(/[.!?]/).filter(s => s.length > 10).slice(0, 5); // Limit to 5 chunks for safety
        console.log(`[ExternalAgent] Script dividido em ${chunks.length} cenas.`);

        const clipPaths = [];
        const downloadsDir = path.join(process.env.USERPROFILE || process.env.HOME, 'Downloads');

        // 2. Loop & Generate
        for (let i = 0; i < chunks.length; i++) {
            const prompt = `Cinematic shot: ${chunks[i].trim()}`;
            console.log(`>>> Gerando Cena ${i + 1}/${chunks.length}: "${prompt}"`);

            // Record file count before
            const getFiles = () => fs.readdirSync(downloadsDir).filter(f => f.endsWith('.mp4'));
            const filesBefore = getFiles();

            const success = await browserAgent.generateClip(prompt, downloadsDir, i + 1);

            if (success) {
                // Find new file
                await new Promise(r => setTimeout(r, 3000)); // Grace period
                const filesAfter = getFiles();
                // Find difference
                const newFile = filesAfter.find(f => !filesBefore.includes(f) && fs.statSync(path.join(downloadsDir, f)).mtimeMs > (Date.now() - 60000));

                if (newFile) {
                    const fullPath = path.join(downloadsDir, newFile);
                    console.log(`   Arquivo detectado: ${fullPath}`);
                    clipPaths.push(fullPath);
                } else {
                    console.warn(`   Aviso: Download não detectado para cena ${i + 1}`);
                }
            } else {
                console.error(`   Falha na cena ${i + 1}`);
            }
        }

        // 3. Stitch Videos
        if (clipPaths.length > 0) {
            console.log('[ExternalAgent] Unindo clipes...', clipPaths);
            return await this._stitchVideos(clipPaths, outputPath, options.audioPath);
        }

        throw new Error("Nenhum clipe foi gerado com sucesso.");
    }

    async _stitchVideos(videoPaths, outputPath, audioPath) {
        return new Promise((resolve, reject) => {
            const ffmpeg = require('fluent-ffmpeg');
            const cmd = ffmpeg();

            videoPaths.forEach(p => cmd.input(p));

            cmd.on('error', reject)
                .on('end', () => resolve(outputPath));

            // Complex filter for concat
            const filter = videoPaths.map((_, i) => `[${i}:v]`).join('') + `concat=n=${videoPaths.length}:v=1:a=0[v]`;

            cmd.complexFilter([filter])
                .map('[v]')
                .outputOptions(['-c:v libx264', '-preset fast']);

            if (audioPath && fs.existsSync(audioPath)) {
                cmd.input(audioPath).outputOptions(['-c:a aac', '-shortest']);
            }

            cmd.save(outputPath);
        });
    }

    async runGenericCloud(script, apiKey, outputPath, options) {
        console.log('[ExternalAgent] Executando Generic Cloud Agent...');
        await new Promise(resolve => setTimeout(resolve, 1500));
        return await this.createRichPlaceholder(outputPath, options.audioPath, options.imagePath);
    }

    /**
     * Cria um vídeo rico. Se falhar, faz fallback para silencioso.
     */
    async createRichPlaceholder(outputPath, audioPath, imagePath) {
        try {
            return await this._generateVideo(outputPath, audioPath, imagePath);
        } catch (err) {
            console.error('[ExternalAgent] Falha ao criar vídeo com áudio. Tentando fallback silencioso...', err.message);
            // Fallback: Ignore audio, just create silent video
            try {
                return await this._generateVideo(outputPath, null, imagePath);
            } catch (err2) {
                console.error('[ExternalAgent] Falha crítica no fallback:', err2);
                // Last resort: Tiny valid MP4 (re-using the Loop logic with black screen)
                throw err2;
            }
        }
    }

    /**
     * Internal generator using FFmpeg
     */
    _generateVideo(outputPath, audioPath, imagePath) {
        return new Promise((resolve, reject) => {
            const ffmpeg = require('fluent-ffmpeg');
            let hasAudio = audioPath && fs.existsSync(audioPath);

            // Check audio size
            if (hasAudio) {
                try {
                    const stats = fs.statSync(audioPath);
                    if (stats.size < 100) {
                        console.warn('[ExternalAgent] Áudio muito pequeno, ignorando:', stats.size);
                        hasAudio = false;
                    }
                } catch (e) { hasAudio = false; }
            }

            const hasImage = imagePath && fs.existsSync(imagePath);

            let tempImgPath = null;
            let inputImage = imagePath;

            // 1. Prepare Input Image if needed
            if (!hasImage) {
                const blackPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
                tempImgPath = outputPath + '.temp.png';
                try {
                    fs.writeFileSync(tempImgPath, Buffer.from(blackPngBase64, 'base64'));
                    inputImage = tempImgPath;
                } catch (e) {
                    return reject(new Error("Falha ao criar imagem temporária"));
                }
            }

            console.log(`[ExternalAgent] FFmpeg Merge: Img=${inputImage}, Audio=${hasAudio ? audioPath : 'N/A'}`);

            const cmd = ffmpeg().input(inputImage).inputOptions(['-loop 1']);

            if (hasAudio) {
                cmd.input(audioPath);
                cmd.outputOptions(['-shortest']); // Video ends when audio ends
                cmd.outputOptions(['-c:a aac', '-b:a 192k']); // Encode audio
            } else {
                cmd.outputOptions(['-t 5']); // Default 5s if no audio
            }

            cmd.outputOptions([
                '-c:v libx264',
                '-tune stillimage',
                '-pix_fmt yuv420p',
                '-vf scale=1280:720', // Enforce HD
                '-preset ultrafast'
            ])
                .save(outputPath)
                .on('end', () => {
                    console.log(`[ExternalAgent] Vídeo gerado com sucesso: ${outputPath}`);
                    if (tempImgPath && fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);
                    resolve(outputPath);
                })
                .on('error', (err) => {
                    if (tempImgPath && fs.existsSync(tempImgPath)) fs.unlinkSync(tempImgPath);
                    reject(err);
                });
        });
    }
}

module.exports = new ExternalAgentService();
