/**
 * Browser Agent Service
 * Controla um navegador Chrome real para interagir com sites (Google Veo, Canva, etc.)
 */

const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

class BrowserAgentService {
    constructor() {
        this.browser = null;
        this.page = null;
    }

    /**
     * Inicia o navegador (Chrome instalado no sistema)
     */
    async launchBrowser() {
        if (this.browser && this.browser.isConnected()) {
            console.log('[BrowserAgent] Navegador já aberto, reutilizando...');
            return;
        }

        console.log('[BrowserAgent] Buscando Chrome instalado...');
        const { Launcher } = await import('chrome-launcher');
        const chromePath = Launcher.getInstallations()[0];
        if (!chromePath) throw new Error('Chrome não encontrado.');

        console.log(`[BrowserAgent] Iniciando Chrome: ${chromePath}`);
        const userDataDir = path.join(__dirname, '../.chrome_agent_data');
        if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir);

        this.browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: false,
            defaultViewport: null,
            userDataDir: userDataDir,
            ignoreDefaultArgs: ['--enable-automation'], // KEY FIX: Removes "Chrome is being controlled by automated software"
            args: [
                '--start-maximized',
                '--no-sandbox',
                '--disable-infobars',
                '--disable-blink-features=AutomationControlled', // KEY FIX: Hides navigator.webdriver
                '--no-first-run',
                '--no-service-autorun',
                '--password-store=basic'
            ]
        });

        // Grant clipboard permissions
        try {
            const context = this.browser.defaultBrowserContext();
            await context.overridePermissions('https://labs.google', ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
        } catch (e) { console.log("Warn: Permissões clipboard ignoradas"); }

        const pages = await this.browser.pages();
        this.page = pages[0];
        console.log('[BrowserAgent] Navegador pronto.');
    }

    /**
     * Executa o fluxo de geração no Google Veo
     * Modo "Co-Piloto Estável"
     */
    async runVeoWorkflow(prompt, outputPath) {
        await this.launchBrowser();

        console.log('[BrowserAgent] Navegando para Google Veo...');
        const VEO_URL = 'https://labs.google/fx/tools/flow';

        try {
            await this.page.goto(VEO_URL, { waitUntil: 'domcontentloaded' });
            console.log(`[BrowserAgent] DEBUG: Current URL: ${this.page.url()}`);
            console.log(`[BrowserAgent] DEBUG: Page Title: ${await this.page.title()}`);
            await this.page.bringToFront();
        } catch (e) {
            console.error("Erro navegação:", e);
        }

        await new Promise(r => setTimeout(r, 3000));

        // 1. NON-BLOCKING Login Check
        try {
            const isLogin = await this.page.evaluate(() => {
                return location.href.includes('accounts.google') || document.body.innerText.includes('Sign in');
            });

            if (isLogin) {
                console.log('[BrowserAgent] Tela de Login detectada. Aguardando usuário...');
                await this.page.evaluate(() => alert("⚠️ POR FAVOR, FAÇA LOGIN NA SUA CONTA GOOGLE. O Agente aguardará 30 segundos."));
                await new Promise(r => setTimeout(r, 30000)); // Give time to login
            }
        } catch (e) { console.log("Erro check login", e); }

        // 2. Clipboard Strategy (Robust)
        console.log('[BrowserAgent] Copiando prompt para Clipboard...');
        const safePrompt = prompt.replace(/`/g, '\\`').replace(/\"/g, '\\"');

        try {
            await this.page.evaluate((p) => {
                // Try to write to clipboard
                navigator.clipboard.writeText(p).catch(err => console.error(err));

                // Visual Helper on Page
                const div = document.createElement('div');
                div.style.position = 'fixed';
                div.style.top = '10px';
                div.style.left = '50%';
                div.style.transform = 'translateX(-50%)';
                div.style.backgroundColor = '#4285f4';
                div.style.color = 'white';
                div.style.padding = '15px';
                div.style.borderRadius = '8px';
                div.style.zIndex = '999999';
                div.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                div.style.fontFamily = 'Arial, sans-serif';
                div.innerHTML = `
                    <strong>🤖 MODO AGENTE: Prompt Copiado!</strong><br>
                    1. Pressione <b>CTRL+V</b> na caixa de texto.<br>
                    2. Clique em <b>Generate</b>.<br>
                    3. Aguarde o vídeo ficar pronto. O sistema cuida do resto em 2 minutos.
                `;
                document.body.appendChild(div);

                // Focus best guess
                const inputs = document.querySelectorAll('textarea');
                if (inputs.length > 0) inputs[inputs.length - 1].focus();
            }, safePrompt);
        } catch (e) { console.log("Erro ao injetar UI helper:", e); }

        // 3. Wait for Generation (Passive) - 10 Minutes extended
        console.log('[BrowserAgent] Aguardando 600s (10 min) para conclusão da geração...');
        await new Promise(r => setTimeout(r, 600000));

        console.log('[BrowserAgent] Finalizando...');
        try { await this.browser.close(); } catch (e) { }
        this.browser = null;
        return null;
    }

    /**
     * Finds the input box (Heuristic)
     */
    /**
     * Helper to traverse Shadow DOMs recursively
     */
    async findAllDeep(page, predicate) {
        return await page.evaluateHandle((predString) => {
            const predicate = new Function('return ' + predString)();
            const results = [];

            function traverse(root) {
                if (!root) return;

                // Check children
                const children = Array.from(root.querySelectorAll('*'));
                for (const child of children) {
                    if (predicate(child)) {
                        results.push(child);
                    }
                    if (child.shadowRoot) {
                        traverse(child.shadowRoot);
                    }
                }
            }

            traverse(document);
            return results;
        }, predicate.toString());
    }

    async findInput(page) {
        // Deep search helper
        const isVisible = async (el) => {
            if (!el) return false;
            const box = await el.boundingBox();
            return box !== null && box.width > 0 && box.height > 0;
        };

        // Strategy A: Find visual label and use it to focus REAL input
        console.log('[BrowserAgent] Buscando alvo visual por texto...');
        const labelHandles = await this.findAllDeep(page, (el) => {
            const txt = el.innerText || '';
            // Strict match on the visible text from the screenshot
            return txt.includes('Crie um vídeo usando texto') || txt.includes('Create a video using text');
        });

        for (const startProp of await labelHandles.getProperties()) {
            const label = startProp.asElement();
            if (label && await isVisible(label)) {
                // Verify it's not a huge container (like body)
                const box = await label.boundingBox();
                if (box.width < 800 && box.height < 300) {
                    console.log('[BrowserAgent] Alvo Visual encontrado e clicado!');

                    // 1. Try clicking Label
                    await label.click();
                    await new Promise(r => setTimeout(r, 500));

                    // 2. Check focus
                    let isActive = await page.evaluate(() => {
                        const act = document.activeElement;
                        return act && act.tagName !== 'BODY' && act.tagName !== 'DIV';
                    });

                    if (isActive) {
                        console.log('[BrowserAgent] Foco adquirido via Click no Label!');
                        return label;
                    }

                    // 3. Try clicking Parent
                    console.log('[BrowserAgent] Foco falhou (Body/Div). Clicando no Pai...');
                    const parent = await page.evaluateHandle(el => el.parentElement, label);
                    if (parent) {
                        await parent.click();
                        await new Promise(r => setTimeout(r, 500));

                        // Check focus again?
                        isActive = await page.evaluate(() => {
                            const act = document.activeElement;
                            return act && act.tagName !== 'BODY' && act.tagName !== 'DIV';
                        });

                        if (isActive) {
                            console.log('[BrowserAgent] Foco adquirido via Click no Pai!');
                            return parent;
                        }

                        // 4. Try clicking Grandparent
                        console.log('[BrowserAgent] Foco falhou again. Clicando no Avô...');
                        const grandpa = await page.evaluateHandle(el => el.parentElement, parent);
                        if (grandpa) {
                            await grandpa.click();
                            await new Promise(r => setTimeout(r, 500));
                            return grandpa;
                        }
                    }

                    return label;
                }
            }
        }

        // Strategy B: Deep Search for Textarea/Input (Fallback)
        const handles = await this.findAllDeep(page, (el) => {
            const tag = el.tagName.toLowerCase();
            const isInput = tag === 'textarea' || tag === 'input' || el.getAttribute('contenteditable') === 'true';
            if (!isInput) return false;

            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && (!el.name || !el.name.includes('recaptcha'));
        });

        const props = await handles.getProperties();
        for (const prop of props.values()) {
            const el = prop.asElement();
            if (el && await isVisible(el)) {
                const ph = await page.evaluate(e => e.getAttribute('placeholder') || e.getAttribute('aria-label') || '', el);
                if (ph.match(/crie|create|texto|text/i)) return el;
            }
        }

        // Return first visible input if specific one not found
        for (const prop of props.values()) {
            const el = prop.asElement();
            if (el && await isVisible(el)) return el;
        }

        return null;
    }

    /**
     * Gera um CLIPE de 8s (Modo Autônomo)
     * Retorna o path do arquivo baixado ou null
     */
    async generateClip(prompt, downloadDir, index) {
        if (!this.page) await this.launchBrowser();

        console.log(`[BrowserAgent] Gerando clipe #${index}...`);
        const VEO_URL = 'https://labs.google/fx/tools/flow';

        // 1. Ensure we are on the page
        if (this.page.url() !== VEO_URL) {
            await this.page.goto(VEO_URL, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 5000));
        }

        // 2. Click "+ Novo projeto" (User Flow)
        try {
            await new Promise(r => setTimeout(r, 5000));
            console.log('[BrowserAgent] Buscando botão "+ Novo projeto" (Deep Search)...');

            // Define predicate for deep search
            const predicate = (el) => {
                const txt = (el.innerText || el.textContent || '').toLowerCase();
                // Match text or icon 'add_2'
                const isText = txt.includes('novo projeto') || txt.includes('new project');
                const isIcon = txt === 'add_2';

                // Basic visibility check in predicate
                const style = window.getComputedStyle(el);
                return (isText || isIcon) && style.display !== 'none' && style.visibility !== 'hidden';
            };

            const handles = await this.findAllDeep(this.page, predicate);
            const props = await handles.getProperties();

            let bestBtn = null;

            for (const prop of props.values()) {
                const el = prop.asElement();
                if (el) {
                    // Log what we found
                    const html = await this.page.evaluate(e => e.outerHTML.substring(0, 100), el);
                    console.log(`[BrowserAgent] Candidato encontrado: ${html}`);

                    // Prefer exact matches or buttons
                    bestBtn = el;
                    // Break if it looks like the main card (heuristic)
                    if (html.includes('card') || html.includes('button')) break;
                }
            }

            if (bestBtn) {
                console.log('[BrowserAgent] Clicando no melhor candidato...');
                await this.page.evaluate(el => el.click(), bestBtn);
                await new Promise(r => setTimeout(r, 2000));
            } else {
                console.log('[BrowserAgent] NENHUM botão encontrado via Deep Search.');
            }
        } catch (e) {
            console.warn('[BrowserAgent] Erro passo Novo Projeto:', e);
        }

        // 3. Find Input & Send
        console.log('[BrowserAgent] Buscando campo de input (Method)...');
        let inputHandle = null;
        for (let i = 0; i < 10; i++) {
            try {
                inputHandle = await this.findInput(this.page);
                if (inputHandle) break;
            } catch (e) { console.warn('Erro buscando input:', e); }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (inputHandle && inputHandle.asElement()) {
            console.log('[BrowserAgent] Input encontrado! Focando e digitando...');
            await inputHandle.click();
            await new Promise(r => setTimeout(r, 1000));
            await this.page.keyboard.type(' ', { delay: 100 }); // Trigger input event

            // Paste Prompt
            const safePrompt = prompt.substring(0, 500);
            await this.page.evaluate((text) => navigator.clipboard.writeText(text), safePrompt);
            await this.page.keyboard.down('Control');
            await this.page.keyboard.press('V');
            await this.page.keyboard.up('Control');
            await new Promise(r => setTimeout(r, 1000));

            // NOTE: We cannot easily validate the value because successful typing happened 
            // on valid activeElement but inputHandle might be just the label <div>.
            // Checking inputHandle.value would return undefined.
            // We just ensure we type manually as well to be safe.

            console.log('[BrowserAgent] Reforçando com digitação manual (caso Paste tenha falhado ou foco perdido)...');
            await this.page.keyboard.type(safePrompt, { delay: 10 });


            // Click Send (Arrow Button) or Enter
            console.log('[BrowserAgent] Enviando (Click Arrow / Enter)...');

            // Try to find the Send button using Deep Search
            const sendBtn = await (async () => {
                const buttonsHandles = await this.findAllDeep(this.page, (el) => {
                    const tag = el.tagName.toLowerCase();
                    if (tag !== 'button' && el.getAttribute('role') !== 'button') return false;
                    // Must be visible
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.visibility !== 'hidden';
                });

                const props = await buttonsHandles.getProperties();
                const visibleButtons = [];
                for (const prop of props.values()) {
                    const el = prop.asElement();
                    if (el) visibleButtons.push(el);
                }

                // 1. Look for specific Aria Labels match
                const exact = await Promise.all(visibleButtons.map(async b => {
                    const lbl = await this.page.evaluate(el => (el.ariaLabel || el.title || el.innerText || '').toLowerCase(), b);
                    return { el: b, lbl };
                }));

                // Strict match for "Create", "Send", "Enviar", "Criar"
                const match = exact.find(x => x.lbl.includes('send') || x.lbl.includes('enviar') || x.lbl.includes('create') || x.lbl.includes('criar') || x.lbl.includes('gerar'));
                if (match) {
                    console.log(`[BrowserAgent] Botão Send encontrado por nome: ${match.lbl}`);
                    return match.el;
                }

                // 2. Fallback: Button with SVG near the input? 
                // Hard to know which one without context.
                return null;
            })();

            if (sendBtn) {
                console.log('[BrowserAgent] Botão Send encontrado! Clicando...');
                await sendBtn.click();
            } else {
                console.log('[BrowserAgent] Botão Send NÃO encontrado via Deep Search. Usando ENTER...');
                await this.page.keyboard.press('Enter');
            }

            await new Promise(r => setTimeout(r, 2000));

        } else {
            console.error('[BrowserAgent] Input não encontrado! Tentando fallback de coordenadas...');
            // Fallback: Click center + Paste
            const viewport = this.page.viewport() || { width: 1280, height: 720 };
            await this.page.mouse.click(viewport.width / 2, viewport.height / 2);
            await this.page.keyboard.down('Control');
            await this.page.keyboard.press('V');
            await this.page.keyboard.up('Control');
            await this.page.keyboard.press('Enter');
        }

        // 4. Wait for Download Button (The long wait)
        console.log('[BrowserAgent] Aguardando renderização (pode levar 2-5 min)...');

        const maxRetries = 120; // 10 mins (5s interval)
        const knownVideos = await this.page.$$('video');
        const initialVideoCount = knownVideos.length;

        for (let i = 0; i < maxRetries; i++) {
            await new Promise(r => setTimeout(r, 5000));

            // 1. Detect New Video
            const currentVideos = await this.page.$$('video');
            if (currentVideos.length > initialVideoCount) {
                console.log('[BrowserAgent] Novo vídeo detectado!');

                // Get the last video (most recent)
                const newVideo = currentVideos[currentVideos.length - 1];

                // 2. Hover to reveal controls
                await newVideo.hover();
                await new Promise(r => setTimeout(r, 1000));

                // 3. Find Download Button nearby
                try {
                    console.log('[BrowserAgent] Buscando botão de Download (Container Scope)...');

                    // Force Hover
                    const loopBox = await newVideo.boundingBox();
                    if (loopBox) {
                        await this.page.mouse.move(loopBox.x + loopBox.width / 2, loopBox.y + loopBox.height / 2);
                        await new Promise(r => setTimeout(r, 1000));
                    }

                    // Targeted Search within the video container only
                    const downloadBtn = await this.page.evaluateHandle((vid) => {
                        // 1. Find the card container
                        // Try various parents to find the one holding the overlay controls
                        let container = vid.closest('div[role="article"]');
                        // Fallback: go up 3-4 levels if role not found
                        if (!container) {
                            let p = vid.parentElement;
                            for (let k = 0; k < 5; k++) {
                                if (!p) break;
                                // Heuristic: container usually has 'relative' positioning or specific class
                                if (p.innerText && (p.innerText.includes('Veo') || p.querySelector('button'))) {
                                    container = p;
                                }
                                p = p.parentElement;
                            }
                        }
                        if (!container) return null;

                        // 2. Get all buttons in this container
                        const buttons = Array.from(container.querySelectorAll('button, div[role="button"], span[role="button"]'));

                        // 3. Filter visible ones
                        const visibleButtons = buttons.filter(b => {
                            const s = window.getComputedStyle(b);
                            return s.display !== 'none' && s.visibility !== 'hidden' && b.offsetParent !== null;
                        });

                        // 4. Try strict name match first (and log what we find)
                        // console.log found buttons not feasible inside evaluate without passing context, purely return correct one

                        const exact = visibleButtons.find(b => {
                            const lbl = (b.ariaLabel || b.title || b.innerText || '').toLowerCase();
                            return lbl.includes('download') || lbl.includes('baixar') || lbl.includes('salvar');
                        });
                        if (exact) return exact;

                        // 5. Fallback: Positional Heuristic (3rd Icon)
                        // Screenshot shows: Edit, Heart, Download, Expand, Menu
                        const icons = visibleButtons.filter(b => {
                            // Assume icons are small-ish or have SVG
                            return b.querySelector('svg') || b.offsetWidth < 80;
                        });

                        // Sort left-to-right based on bounding rect
                        icons.sort((a, b) => {
                            const rectA = a.getBoundingClientRect();
                            const rectB = b.getBoundingClientRect();
                            return rectA.x - rectB.x;
                        });

                        // Return the 3rd icon if available (Index 2)
                        if (icons.length >= 3) return icons[2];

                        return null;
                    }, newVideo);

                    if (downloadBtn && downloadBtn.asElement()) {
                        console.log('[BrowserAgent] Botão Download (ou candidato) encontrado! Clicando...');
                        await downloadBtn.click();
                        await new Promise(r => setTimeout(r, 5000));
                        return true;
                    } else {
                        console.log('[BrowserAgent] Botão Download não encontrado nem por nome nem por posição.');
                    }
                } catch (e) {
                    console.log('Erro ao buscar botão no container:', e);
                }
            }
            process.stdout.write('.');
        }

        console.error('[BrowserAgent] Timeout esperando download.');
        return false;
    }

}

module.exports = new BrowserAgentService();
