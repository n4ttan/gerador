/**
 * workerSystem.js
 * Sistema de workers para processamento controlado de roteiros e áudio
 */

// Filas globais
let scriptQueue = [];
let audioQueue = [];
let scriptWorkers = [];
let audioWorkers = [];
let allScriptTasksCompleted = false;
let allAudioTasksCompleted = false;

// Exporta as variáveis para uso externo
export { scriptWorkers, audioWorkers };

// Configurações
const WORKER_CHECK_INTERVAL = 200; // 200ms entre verificações
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 segundos base

// Sistema de auto-limpeza
let autoCleanupWatcher = null;

/**
 * Verifica se todo o trabalho foi concluído
 * @returns {boolean} - True se não há mais trabalho pendente
 */
export function isAllWorkCompleted() {
    // CRÍTICO: Se processo multi-etapas está ativo, nunca considerar concluído
    if (window.isProcessActive) {
        return false;
    }
    
    // Verifica workers de script
    const hasScriptWork = scriptQueue.length > 0 || scriptWorkers.some(worker => worker.isRunning);
    
    // Verifica workers de áudio
    const hasAudioWork = audioQueue.length > 0 || audioWorkers.some(worker => worker.isRunning);
    
    // Verifica GeminiQueue
    const hasGeminiWork = window.geminiQueue?.isRunning && 
                         (window.geminiQueue.queue?.length > 0 || window.geminiQueue.processing?.size > 0);
    
    const allCompleted = !hasScriptWork && !hasAudioWork && !hasGeminiWork;
    
    if (allCompleted) {
        // console.log("🏁 Detecção de conclusão: Todo trabalho foi finalizado");
        // console.log(`📊 Script: queue=${scriptQueue.length}, workers=${scriptWorkers.filter(w => w.isRunning).length}`);
        // console.log(`📊 Audio: queue=${audioQueue.length}, workers=${audioWorkers.filter(w => w.isRunning).length}`);
        console.log(`📊 Gemini: running=${window.geminiQueue?.isRunning}, queue=${window.geminiQueue?.queue?.length || 0}, processing=${window.geminiQueue?.processing?.size || 0}`);
        console.log(`📊 ProcessActive: ${window.isProcessActive || false}`);
    }
    
    return allCompleted;
}

/**
 * Inicializa o sistema de workers
 * @param {Array} apiKeys - Array de chaves API do Gemini
 * @param {Array} ttsApiKeys - Array de chaves API do TTS
 * @param {Object} agent - Configuração do agente
 */
export function initializeWorkers(apiKeys, ttsApiKeys, agent) {
    // console.log(`[WORKERS] Inicializando sistema com ${apiKeys.length} APIs Gemini e ${ttsApiKeys.length} APIs TTS`);
    
    // Limpa workers anteriores
    cleanupWorkers();
    
    // Inicializa workers de roteiro
    for (let i = 0; i < apiKeys.length; i++) {
        const worker = createScriptWorker(i, apiKeys, ttsApiKeys, agent);
        scriptWorkers.push(worker);
    }
    
    // Inicializa workers de áudio
    for (let i = 0; i < ttsApiKeys.length; i++) {
        const worker = createAudioWorker(i, ttsApiKeys, agent);
        audioWorkers.push(worker);
    }
    
    // console.log(`[WORKERS] ${scriptWorkers.length} workers de roteiro e ${audioWorkers.length} workers de áudio criados`);
}

/**
 * Cria um worker para processamento de roteiros
 * @param {number} workerId - ID do worker
 * @param {Array} apiKeys - Array de chaves API
 * @param {Object} agent - Configuração do agente
 */
function createScriptWorker(workerId, apiKeys, ttsApiKeys, agent) {
    const apiKey = apiKeys[workerId];
    const apiKeySuffix = apiKey.slice(-8);
    
    // console.log(`[WORKERS] Criando worker de roteiro ${workerId + 1} com API: ...${apiKeySuffix}`);
    
    return {
        id: workerId,
        apiKey: apiKey,
        apiKeySuffix: apiKeySuffix,
        ttsApiKeys: ttsApiKeys,
        isRunning: false,
        tasksProcessed: 0,
        errors: 0,
        
        async start() {
            this.isRunning = true;
            // console.log(`[WORKERS] Worker de roteiro ${workerId + 1} iniciado`);
            
            while (this.isRunning) {
                const task = scriptQueue.shift();
                if (task) {
                    await this.processScriptTask(task);
                } else {
                    if (allScriptTasksCompleted || (scriptQueue.length === 0 && this.tasksProcessed > 0)) {
                        // console.log(`[WORKERS] Worker de roteiro ${workerId + 1} finalizado - todas as tarefas concluídas`);
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, WORKER_CHECK_INTERVAL));
                }
            }
        },
        
        async processScriptTask(task) {
            const { originalTitleKey, displayTitle, lang, agent: taskAgent, resultContainer, basePremiseText } = task;
            
            // Isolar variáveis críticas para evitar confusão de contexto entre workers
            const langName = lang.name;
            const langId = lang.id;
            
            try {
                this.tasksProcessed++;
                // console.log(`[WORKERS] Worker ${workerId + 1} processando roteiro para ${displayTitle} [${lang.name}] - API: ...${this.apiKeySuffix}`);
                
                addResultLog(resultContainer, `Worker ${workerId + 1} iniciando roteiro para ${langName}...`);
                
                let premiseForScript = basePremiseText;
                const isPrimaryLang = langId === getLanguageDataByName(taskAgent.primary_language).id;

                if (!isPrimaryLang) {
                    addResultLog(resultContainer, `Adaptando premissa para ${langName}...`);
                    const adaptationPrompt = `${taskAgent.adaptation_template}\n\nPREMISSA ORIGINAL (PARA ADAPTAR):\n${basePremiseText}\n\nADAPTAR PARA O IDIOMA E CULTURA DE: ${langName}`;
                    premiseForScript = await callGenerativeAIWithRetry(this.apiKey, adaptationPrompt, 
                        (msg, type) => addResultLog(resultContainer, msg, type), 
                        `Adaptação para ${langName}`
                    );
                }
                
                showPremise(resultContainer, premiseForScript, langName);

                const blocos = parseBlockStructure(taskAgent.script_structure);
                if (blocos.length === 0) throw new Error("Nenhuma estrutura de blocos definida no agente.");

                let roteiroCompleto = "";
                const scriptContentArea = createScriptContainerAndGetContentArea(resultContainer, langName);

                for (const bloco of blocos) {
                    if (isGenerationCancelled()) throw new Error("Cancelled");
                    
                    addResultLog(resultContainer, `Gerando bloco '${bloco.nome}'...`);
                    
                    const promptDoBloco = `[INSTRUÇÃO DE IDIOMA - CRÍTICO E OBRIGATÓRIO]\nO TEXTO PARA ESTE BLOCO DEVE SER GERADO OBRIGATORIAMENTE NO IDIOMA: ${langName}\n\n[PROMPT MESTRE DO ROTEIRISTA]\n${taskAgent.script_template}\n\n[CONTEXTO DA HISTÓRIA ATÉ AGORA]\n${roteiroCompleto || "Este é o primeiro bloco."}\n\n[TAREFA ATUAL E ESPECÍFICA]\n# ${bloco.nome}\n${bloco.instrucao}\n\nUse a PREMISSA a seguir (que está em ${langName}) como base para toda a história:\n--- PREMISSA ---\n${premiseForScript}\n--- FIM DA PREMISSA ---\n\nEscreva APENAS o texto para o bloco '${bloco.nome}' no idioma ${langName}.`;
                    
                    const textoDoBloco = await callGenerativeAIWithRetry(this.apiKey, promptDoBloco, 
                        (msg, type) => addResultLog(resultContainer, msg, type), 
                        `Bloco '${bloco.nome}'`
                    );
                    
                    roteiroCompleto += (roteiroCompleto ? "\n\n" : "") + textoDoBloco;
                    scriptContentArea.textContent = roteiroCompleto;
                }

                const uniqueKey = `${originalTitleKey}-${lang.id}`;
                if (!generationResults[uniqueKey]) generationResults[uniqueKey] = [];
                const result = { 
                    lang, 
                    premise: premiseForScript, 
                    script: roteiroCompleto, 
                    resultContainer 
                };
                generationResults[uniqueKey].push(result);

                // Se TTS estiver habilitado, adiciona tarefa de áudio à fila
                if (taskAgent.tts_enabled && taskAgent.tts_voices?.[langName]) {
                    const audioTask = { result, agent: taskAgent, ttsApiKeys };
                    audioQueue.push(audioTask);
                    // console.log(`[WORKERS] Tarefa de áudio adicionada para ${langName} após conclusão do roteiro (${audioQueue.length} tarefas na fila)`);
                }

                addResultLog(resultContainer, `Roteiro para ${langName} concluído com sucesso!`, 'success');
                // console.log(`[WORKERS] Worker ${workerId + 1} concluiu roteiro para ${displayTitle} [${langName}]`);
                
            } catch (error) {
                this.errors++;
                console.error(`[WORKERS] Worker ${workerId + 1} erro no roteiro para ${displayTitle} [${langName}]:`, error.message);
                
                if (error.name !== 'AbortError' && error.message !== "Cancelled") {
                    addResultLog(resultContainer, `ERRO GERAL: ${error.message}`, 'error');
                }
            }
        },
        
        stop() {
            this.isRunning = false;
        }
    };
}

/**
 * Cria um worker para processamento de áudio
 * @param {number} workerId - ID do worker
 * @param {Array} ttsApiKeys - Array de chaves API TTS
 * @param {Object} agent - Configuração do agente
 */
function createAudioWorker(workerId, ttsApiKeys, agent) {
    const ttsApiKey = ttsApiKeys[workerId];
    const ttsApiKeySuffix = ttsApiKey.slice(-8);
    
    // console.log(`[WORKERS] Criando worker de áudio ${workerId + 1} com API TTS: ...${ttsApiKeySuffix}`);
    
    return {
        id: workerId,
        ttsApiKey: ttsApiKey,
        ttsApiKeySuffix: ttsApiKeySuffix,
        isRunning: false,
        tasksProcessed: 0,
        errors: 0,
        
        async start() {
            this.isRunning = true;
            // console.log(`[WORKERS] Worker de áudio ${workerId + 1} iniciado`);
            
            while (this.isRunning) {
                const task = audioQueue.shift();
                if (task) {
                    await this.processAudioTask(task);
                } else {
                    // Só sai se todos os roteiros estiverem concluídos E não houver mais tarefas de áudio
                    if (allScriptTasksCompleted && allAudioTasksCompleted) {
                        // console.log(`[WORKERS] Worker de áudio ${workerId + 1} finalizado - todas as tarefas concluídas`);
                        break;
                    }
                    await new Promise(resolve => setTimeout(resolve, WORKER_CHECK_INTERVAL));
                }
            }
        },
        
        async processAudioTask(task) {
            const { result, agent, ttsApiKeys } = task;
            const { resultContainer, lang, script } = result;
            
            try {
                this.tasksProcessed++;
                // console.log(`[WORKERS] Worker ${workerId + 1} processando áudio para ${lang.name} - API TTS: ...${this.ttsApiKeySuffix}`);
                
                const voiceId = agent.tts_voices?.[lang.name];
                if (!voiceId) {
                    addResultLog(resultContainer, `Voz não configurada para ${lang.name}. Áudio não gerado.`, 'error');
                    return;
                }

                addResultLog(resultContainer, `Worker ${workerId + 1} iniciando áudio para ${lang.name}...`);
                
                const textChunks = splitTextIntoChunks(script);
                if (textChunks.length > 1) {
                    addResultLog(resultContainer, `Roteiro longo, dividindo em ${textChunks.length} pedaços para o áudio...`);
                }
                
                // Retry com delay progressivo
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        if (attempt > 1) {
                            addResultLog(resultContainer, `Tentativa ${attempt}/${MAX_RETRIES} para gerar áudio (Worker ${workerId + 1})...`);
                        }
                        
                        const response = await generateTTS(textChunks, lang.id, voiceId, this.ttsApiKey, ttsApiKeys.length);

                        if (response.success) {
                            result.audio_base_64 = response.audio_base_64;
                            addResultLog(resultContainer, `Áudio para ${lang.name} gerado com sucesso! (Worker ${workerId + 1})`, 'success');
                            // console.log(`[WORKERS] Worker ${workerId + 1} concluiu áudio para ${lang.name}`);
                            return; // Sucesso, sai da função
                        } else {
                            throw new Error(response.message);
                        }
                    } catch (error) {
                        if (isGenerationCancelled()) return;
                        
                        const isLastAttempt = attempt === MAX_RETRIES;
                        const isRetryableError = error.message.includes('Timeout') || 
                                               error.message.includes('timeout') || 
                                               error.message.includes('429') ||
                                               error.message.includes('servidor') ||
                                               error.message.includes('conexão') ||
                                               error.message.includes('524') ||
                                               error.message.includes('Cloudflare');
                        
                        if (isRetryableError && !isLastAttempt) {
                            const retryDelay = RETRY_DELAY * attempt;
                            addResultLog(resultContainer, `Tentativa ${attempt} falhou: ${error.message}. Tentando novamente em ${retryDelay/1000}s... (Worker ${workerId + 1})`, 'warning');
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                        } else {
                            throw error;
                        }
                    }
                }
                
            } catch (error) {
                this.errors++;
                console.error(`[WORKERS] Worker ${workerId + 1} erro no áudio para ${lang.name}:`, error.message);
                
                if (isGenerationCancelled()) return;
                addResultLog(resultContainer, `Falha no áudio para ${lang.name}: ${error.message} (Worker ${workerId + 1})`, 'error');
            }
        },
        
        stop() {
            this.isRunning = false;
        }
    };
}

/**
 * Adiciona tarefas de roteiro à fila
 * @param {Array} scriptTasks - Array de tarefas de roteiro
 */
export function addScriptTasks(scriptTasks) {
    scriptQueue.push(...scriptTasks);
    allScriptTasksCompleted = false;
    // console.log(`[WORKERS] ${scriptTasks.length} tarefas de roteiro adicionadas à fila`);
}

/**
 * Adiciona tarefas de áudio à fila
 * @param {Array} audioTasks - Array de tarefas de áudio
 */
export function addAudioTasks(audioTasks) {
    audioQueue.push(...audioTasks);
    allAudioTasksCompleted = false;
    // console.log(`[WORKERS] ${audioTasks.length} tarefas de áudio adicionadas à fila`);
}

/**
 * Inicia todos os workers
 */
export async function startAllWorkers() {
    // console.log(`[WORKERS] Iniciando todos os workers...`);
    
    // Inicia workers de roteiro
    const scriptPromises = scriptWorkers.map(worker => worker.start());
    
    // Inicia workers de áudio em paralelo (eles aguardarão tarefas na fila)
    const audioPromises = audioWorkers.map(worker => worker.start());
    
    // Aguarda conclusão de todos os workers
    await Promise.all([...scriptPromises, ...audioPromises]);
    allScriptTasksCompleted = true;
    allAudioTasksCompleted = true;
    
    // console.log(`[WORKERS] Todos os workers finalizados`);
}

/**
 * Para todos os workers
 */
export function stopAllWorkers() {
    // console.log(`[WORKERS] Parando todos os workers...`);
    
    scriptWorkers.forEach(worker => worker.stop());
    audioWorkers.forEach(worker => worker.stop());
    
    allScriptTasksCompleted = true;
    allAudioTasksCompleted = true;
}

/**
 * Limpa workers anteriores com limpeza agressiva de recursos
 */
export function cleanupWorkers() {
    // console.log("🧹 Iniciando limpeza agressiva de workers e recursos...");
    
    // Para todos os workers ativos
    stopAllWorkers();
    
    // Limpa timers/intervals ativos em workers de script
    scriptWorkers.forEach(worker => {
        if (worker.activeTimeouts) {
            worker.activeTimeouts.forEach(timeout => clearTimeout(timeout));
            worker.activeTimeouts.clear();
        }
        if (worker.activeIntervals) {
            worker.activeIntervals.forEach(interval => clearInterval(interval));
            worker.activeIntervals.clear();
        }
        // Força parada do worker
        worker.stop();
        worker.isRunning = false;
    });
    
    // Limpa timers/intervals ativos em workers de áudio
    audioWorkers.forEach(worker => {
        if (worker.activeTimeouts) {
            worker.activeTimeouts.forEach(timeout => clearTimeout(timeout));
            worker.activeTimeouts.clear();
        }
        if (worker.activeIntervals) {
            worker.activeIntervals.forEach(interval => clearInterval(interval));
            worker.activeIntervals.clear();
        }
        // Força parada do worker
        worker.stop();
        worker.isRunning = false;
    });
    
    // Limpa GeminiQueue interval se existir
    if (window.geminiQueue?.processingInterval) {
        // console.log("🔧 Limpando GeminiQueue interval...");
        clearInterval(window.geminiQueue.processingInterval);
        window.geminiQueue.processingInterval = null;
    }
    
    // Para GeminiQueue completamente
    if (window.geminiQueue?.isRunning) {
        // console.log("🛑 Parando GeminiQueue...");
        window.geminiQueue.stop();
    }
    
    // NOVO: Limpa sistema de callbacks para prevenir memory leak
    if (window.jobLogFunctions) {
        // console.log("🧹 Limpando callbacks de jobs pendentes...");
        window.jobLogFunctions.clear();
    }
    
    // NOVO: Limpa timers de cleanup automático
    if (window.jobLogCleanupTimers) {
        // console.log("🧹 Cancelando timers de cleanup automático...");
        window.jobLogCleanupTimers.forEach(timer => clearTimeout(timer));
        window.jobLogCleanupTimers.clear();
    }
    
    // Limpa watchers de auto-limpeza
    if (autoCleanupWatcher) {
        // console.log("🔧 Limpando auto-cleanup watcher...");
        clearInterval(autoCleanupWatcher);
        autoCleanupWatcher = null;
    }
    
    
    // CRITICAL: Força garbage collection das referências
    scriptWorkers.splice(0); // Remove todos os elementos
    audioWorkers.splice(0);
    scriptQueue.splice(0);
    audioQueue.splice(0);
    
    // Reset flags
    allScriptTasksCompleted = false;
    allAudioTasksCompleted = false;
    
    // console.log("✅ Limpeza agressiva concluída - todos os recursos foram liberados");
}

/**
 * Inicia watcher para auto-limpeza quando trabalho é concluído
 */
export function startAutoCleanupWatcher() {
    // Limpa watcher anterior se existir
    if (autoCleanupWatcher) {
        clearInterval(autoCleanupWatcher);
    }
    
    // console.log("👁️ Iniciando sistema de cleanup automático (timeout forçado removido)...");
    
    // Verifica a cada 2 segundos se todo trabalho foi concluído
    autoCleanupWatcher = setInterval(() => {
        if (isAllWorkCompleted()) {
            console.log("🧹 Auto-limpeza: Todo trabalho concluído - iniciando limpeza automática");
            cleanupWorkers();
            
            // Para o próprio watcher após a limpeza
            if (autoCleanupWatcher) {
                clearInterval(autoCleanupWatcher);
                autoCleanupWatcher = null;
            }
        } else {
            // AGUARDA: Sistema agora apenas aguarda o cleanup manual explícito após roteiros terminarem
            // SEM timeout forçado que matava workers ativos no meio do processamento
        }
    }, 2000);
    
    // console.log("✅ Sistema de cleanup configurado - sem timeout forçado, apenas cleanup quando trabalho termina");
}

/**
 * Para o sistema de auto-limpeza manualmente
 */
export function stopAutoCleanupWatcher() {
    if (autoCleanupWatcher) {
        console.log("🛑 Parando auto-cleanup watcher manualmente");
        clearInterval(autoCleanupWatcher);
        autoCleanupWatcher = null;
    }
}

/**
 * Obtém estatísticas dos workers
 */
export function getWorkerStats() {
    const scriptStats = scriptWorkers.map(worker => ({
        id: worker.id + 1,
        type: 'script',
        tasksProcessed: worker.tasksProcessed,
        errors: worker.errors,
        apiKeySuffix: worker.apiKeySuffix
    }));
    
    const audioStats = audioWorkers.map(worker => ({
        id: worker.id + 1,
        type: 'audio',
        tasksProcessed: worker.tasksProcessed,
        errors: worker.errors,
        apiKeySuffix: worker.ttsApiKeySuffix
    }));
    
    return {
        script: scriptStats,
        audio: audioStats,
        queueLength: {
            script: scriptQueue.length,
            audio: audioQueue.length
        }
    };
}

// Funções auxiliares (serão passadas como parâmetros)
let getLanguageDataByName;
let addResultLog;
let showPremise;
let parseBlockStructure;
let createScriptContainerAndGetContentArea;
let callGenerativeAIWithRetry;
let splitTextIntoChunks;
let generateTTS;
let generationResults;
let isGenerationCancelled;

// Função para configurar as dependências
export function configureWorkerDependencies(dependencies) {
    getLanguageDataByName = dependencies.getLanguageDataByName;
    addResultLog = dependencies.addResultLog;
    showPremise = dependencies.showPremise;
    parseBlockStructure = dependencies.parseBlockStructure;
    createScriptContainerAndGetContentArea = dependencies.createScriptContainerAndGetContentArea;
    callGenerativeAIWithRetry = dependencies.callGenerativeAIWithRetry;
    splitTextIntoChunks = dependencies.splitTextIntoChunks;
    generateTTS = dependencies.generateTTS;
    generationResults = dependencies.generationResults;
    isGenerationCancelled = dependencies.isGenerationCancelled;
} 