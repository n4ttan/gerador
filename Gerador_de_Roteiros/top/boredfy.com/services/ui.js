/**
 * ui.js
 * * This module contains all functions that directly manipulate the DOM.
 */

import { saveState, state, agents } from './state.js';
import { DEFAULT_AGENTS } from './config.js';
import { LANGUAGES_CONFIG, AVAILABLE_VOICES } from './config.js';
import { updateEditButtonState } from './agentManager.js';
import { validateApiKey, getAuthHeaders } from './api.js';

// Função para aguardar autenticação
function waitForAuth(maxWait = 10000) {
    return new Promise((resolve, reject) => {
        const checkAuth = () => {
            try {
                if (window.auth && window.auth.currentUser) {
                    resolve(window.auth.currentUser);
                    return;
                }
            } catch (error) {
                // Continua tentando
            }
            
            setTimeout(checkAuth, 500);
        };
        
        checkAuth();
        
        // Timeout após maxWait ms
        setTimeout(() => {
            reject(new Error('Timeout aguardando autenticação'));
        }, maxWait);
    });
}

export function populateUIFromState() {
    updateAgentDropdown();

    const { apiKeys, ttsApiKeys, selectedGeminiModel } = state;
    
    // Initialize Gemini model selector
    const modelSelector = document.getElementById('gemini-model-select');
    if (modelSelector && selectedGeminiModel) {
        modelSelector.value = selectedGeminiModel;
    }
    const geminiKeysContainer = document.getElementById('gemini-keys-container');
    geminiKeysContainer.innerHTML = '';
    if (apiKeys && apiKeys.length > 0) {
        apiKeys.forEach(key => addApiKeyInput(key, 'gemini'));
    } else {
        addApiKeyInput('', 'gemini');
    }

    const ttsKeysContainer = document.getElementById('tts-keys-container');
    ttsKeysContainer.innerHTML = '';
    if (ttsApiKeys && ttsApiKeys.length > 0) {
        ttsApiKeys.forEach(key => addApiKeyInput(key, 'tts'));
    } else {
        addApiKeyInput('', 'tts');
    }
    
    // Atualizar contadores após popular a UI
    setTimeout(() => {
        if (window.updateKeyCounters) {
            window.updateKeyCounters();
        }
    }, 1000);
}

export function updateAgentDropdown() {
    const selectedMode = document.querySelector('input[name="generation-mode"]:checked').value;
    const agentSelect = document.getElementById('agent-select');
    const currentAgent = agentSelect.value;
    agentSelect.innerHTML = '';

    // Conta agentes personalizados
    const customAgentsCount = Object.keys(agents).filter(key => 
        agents[key] && agents[key].type === selectedMode && !DEFAULT_AGENTS[key]
    ).length;

    Object.keys(agents).forEach(key => {
        if (agents[key] && agents[key].type === selectedMode) {
            const option = document.createElement('option');
            option.value = key;
            const isCustom = !DEFAULT_AGENTS[key];
            option.textContent = `${agents[key].name}${isCustom ? ' (Personalizado)' : ''}`;
            agentSelect.appendChild(option);
        }
    });

    if (currentAgent && agentSelect.querySelector(`option[value="${currentAgent}"]`)) {
        agentSelect.value = currentAgent;
    }
    
    // Atualiza o contador de agentes personalizados
    updateAgentCounter(customAgentsCount);
    
    // Atualiza o estado do botão editar
    updateEditButtonState();
}

// Função para atualizar o contador de agentes personalizados
function updateAgentCounter(count) {
    const counterElement = document.querySelector('.custom-agents-counter');
    if (counterElement) {
        counterElement.textContent = count > 0 ? ` (${count} personalizado${count > 1 ? 's' : ''})` : '';
    }
}

// Cache de validações para evitar re-testar APIs recém validadas
const validationCache = new Map();
const VALIDATION_CACHE_DURATION = 60000; // 1 minuto

export function addApiKeyInput(key = '', type) {
    const container = type === 'gemini' ? document.getElementById('gemini-keys-container') : document.getElementById('tts-keys-container');
    const inputClass = type === 'gemini' ? 'gemini-api-key-input' : 'tts-api-key-input';
    const placeholder = type === 'gemini' ? 'Cole uma chave da API Gemini aqui' : 'Cole a chave da API Text-to-Speech aqui';
    
    const div = document.createElement('div');
    div.className = 'flex items-center space-x-2 api-key-row';
    div.innerHTML = `
        <div class="flex-1 relative">
            <input type="password" value="${key}" class="${inputClass} w-full bg-gray-800 border border-gray-600 rounded-md p-2 text-white pr-16" placeholder="${placeholder}">
            <div class="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-1">
                <button class="password-toggle-btn text-gray-400 hover:text-gray-300 p-1" title="Mostrar/Esconder API Key">
                    <i class="fas fa-eye text-xs"></i>
                </button>
                <span class="validation-status text-xs text-gray-500" title="Status da API Key">
                    ${key ? '○' : '○'}
                </span>
            </div>
        </div>
        <button class="remove-api-key-btn bg-red-700 hover:bg-red-800 text-white font-bold py-1 px-3 rounded-md transition-colors" title="Remover chave"><i class="fas fa-trash"></i></button>
    `;
    container.appendChild(div);
    
    const inputField = div.querySelector(`.${inputClass}`);
    const statusIndicator = div.querySelector('.validation-status');
    const toggleButton = div.querySelector('.password-toggle-btn');
    const toggleIcon = toggleButton.querySelector('i');
    
    let isVisible = false;
    let validationTimeout = null;
    
    // Toggle de visibilidade da senha
    const togglePasswordVisibility = () => {
        isVisible = !isVisible;
        inputField.type = isVisible ? 'text' : 'password';
        toggleIcon.className = isVisible ? 'fas fa-eye-slash text-xs' : 'fas fa-eye text-xs';
        toggleButton.title = isVisible ? 'Esconder API Key' : 'Mostrar API Key';
    };
    
    toggleButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePasswordVisibility();
    });
    
    // Função para atualizar status visual
    const updateValidationStatus = (validation = null, isValidating = false) => {
        if (isValidating) {
            statusIndicator.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            statusIndicator.className = 'validation-status text-xs text-yellow-400';
            statusIndicator.title = 'Validando API Key...';
            inputField.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
            inputField.classList.add('border-yellow-400');
            return;
        }
        
        const hasValue = inputField.value.trim().length > 0;
        
        if (!hasValue) {
            statusIndicator.textContent = '○';
            statusIndicator.className = 'validation-status text-xs text-gray-500';
            statusIndicator.title = 'API Key vazia';
            inputField.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
            return;
        }
        
        if (!validation) {
            statusIndicator.textContent = '○';
            statusIndicator.className = 'validation-status text-xs text-gray-400';
            statusIndicator.title = 'API Key não validada';
            inputField.classList.remove('border-red-500', 'border-green-500', 'border-yellow-500');
            return;
        }
        
        if (validation.valid) {
            if (validation.details?.errorCode === 'RATE_LIMITED') {
                statusIndicator.textContent = '⚠';
                statusIndicator.className = 'validation-status text-xs text-yellow-400';
                statusIndicator.title = `API Key válida: ${validation.message}`;
                inputField.classList.remove('border-red-500', 'border-green-500');
                inputField.classList.add('border-yellow-400');
            } else {
                statusIndicator.textContent = '✓';
                statusIndicator.className = 'validation-status text-xs text-green-400';
                statusIndicator.title = `API Key válida: ${validation.message}`;
                inputField.classList.remove('border-red-500', 'border-yellow-500');
                inputField.classList.add('border-green-500');
            }
        } else {
            statusIndicator.textContent = '✗';
            statusIndicator.className = 'validation-status text-xs text-red-400';
            statusIndicator.title = `API Key inválida: ${validation.message}`;
            inputField.classList.remove('border-green-500', 'border-yellow-500');
            inputField.classList.add('border-red-500');
        }
        
        // Atualizar contadores após mudança de status
        setTimeout(() => {
            if (window.updateKeyCounters) {
                window.updateKeyCounters();
            }
        }, 100);
    };
    
    // Função para validar API Key
    const performValidation = async (apiKey) => {
        if (!apiKey || apiKey.length < 10) {
            updateValidationStatus();
            return;
        }
        
        // Verificar cache primeiro
        const cacheKey = `${type}:${apiKey}`;
        const cached = validationCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < VALIDATION_CACHE_DURATION) {
            updateValidationStatus(cached.validation);
            return;
        }
        
        // Verificar se usuário está autenticado antes de validar
        try {
            await getAuthHeaders();
        } catch (authError) {
            console.log('Usuário não autenticado, pulando validação de API key');
            updateValidationStatus({
                valid: false,
                message: "Login necessário para validar"
            });
            return;
        }
        
        updateValidationStatus(null, true);
        
        try {
            const result = await validateApiKey(apiKey, type);
            
            if (result.success && result.validation) {
                // Salvar no cache
                validationCache.set(cacheKey, {
                    validation: result.validation,
                    timestamp: Date.now()
                });
                
                updateValidationStatus(result.validation);
            } else {
                updateValidationStatus({
                    valid: false,
                    message: "Erro na validação"
                });
            }
        } catch (error) {
            updateValidationStatus({
                valid: false,
                message: "Erro de comunicação"
            });
        }
    };
    
    // Debounce para evitar muitas validações
    const debouncedValidation = (apiKey) => {
        if (validationTimeout) {
            clearTimeout(validationTimeout);
        }
        validationTimeout = setTimeout(() => {
            performValidation(apiKey);
        }, 1500); // 1.5 segundos de delay
    };
    
    // Status inicial
    updateValidationStatus();
    if (key && key.trim()) {
        // Validar chave carregada somente após autenticação
        waitForAuth().then(() => {
            setTimeout(() => performValidation(key.trim()), 1000);
        }).catch(() => {
            // Se não conseguir autenticar, não valida
            console.log('Validação de API key adiada até autenticação');
        });
    }
    
    // Event listeners
    inputField.addEventListener('input', () => {
        updateValidationStatus(); // Limpa status imediatamente
        const apiKey = inputField.value.trim();
        if (apiKey.length >= 10) {
            debouncedValidation(apiKey);
        }
        // Atualizar contadores imediatamente quando o conteúdo muda
        setTimeout(() => {
            if (window.updateKeyCounters) {
                window.updateKeyCounters();
            }
        }, 50);
    });
    
    inputField.addEventListener('blur', () => {
        if (window.debouncedSaveAllApiKeys) {
            window.debouncedSaveAllApiKeys();
        }
    });
    
    inputField.addEventListener('change', () => {
        if (window.debouncedSaveAllApiKeys) {
            window.debouncedSaveAllApiKeys();
        }
    });

    div.querySelector('.remove-api-key-btn').addEventListener('click', () => {
        if (container.children.length > 1) {
            div.remove();
            if (window.debouncedSaveAllApiKeys) {
                window.debouncedSaveAllApiKeys();
            }
            // Atualizar contadores após remoção
            setTimeout(() => {
                if (window.updateKeyCounters) {
                    window.updateKeyCounters();
                }
            }, 100);
        } else {
            alert("É necessário ter pelo menos uma chave de API.");
        }
    });
}

export function addTitleToList(title) {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const titlesList = document.getElementById('titles-list');
    const div = document.createElement('div');
    div.className = 'title-item bg-gray-800 p-3 rounded-md border border-gray-700 flex items-center justify-between';
    div.innerHTML = `
        <span class="flex-1 mr-4 truncate" title="${trimmedTitle}">${trimmedTitle}</span>
        <button class="remove-title-btn text-red-500 hover:text-red-400 ml-2"><i class="fas fa-trash"></i></button>
    `;
    titlesList.appendChild(div);
    div.querySelector('.remove-title-btn').addEventListener('click', () => div.remove());
}

export function updateMainStatus(msg, type = 'info') {
    const mainStatusBar = document.getElementById('main-status-bar');
    if (!msg) {
        mainStatusBar.classList.add('hidden');
        return;
    }
    mainStatusBar.className = 'p-3 mb-4 text-center text-white rounded-md transition-colors duration-300';
    mainStatusBar.classList.remove('hidden');
    
    if (type === 'error') mainStatusBar.classList.add('bg-red-800');
    else if (type === 'success') mainStatusBar.classList.add('bg-green-700');
    else mainStatusBar.classList.add('bg-indigo-600');
    
    mainStatusBar.innerHTML = `<i class="fas fa-info-circle mr-2"></i> ${msg}`;
}

export function createResultContainer(title, langName) {
    const resultsArea = document.getElementById('results-area');
    const resultContainer = document.createElement('div');
    // CORREÇÃO: Adicionada a classe 'result-item' para identificação.
    resultContainer.className = 'result-item bg-gray-800 rounded-lg mb-4 border border-gray-700';
    resultContainer.innerHTML = `
        <button class="w-full text-left p-4 font-bold text-lg text-white flex justify-between items-center bg-gray-800 rounded-t-lg" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <span>Roteiro para "${title}" [${langName}]</span>
            <i class="fas fa-chevron-down"></i>
        </button>
        <div class="px-4 pb-4 border-t border-gray-700 bg-gray-800 rounded-b-lg hidden">
            <div class="log-area bg-gray-900 p-2 rounded-md my-2 max-h-48 overflow-y-auto text-xs"></div>
            <div class="content-wrapper"></div>
        </div>
    `;
    resultsArea.appendChild(resultContainer);
    return resultContainer;
}

export function addResultLog(resultContainer, msg, type = 'generating') {
    const logArea = resultContainer.querySelector('.log-area');
    
    // Auto-expandir container no primeiro log
    const contentDiv = resultContainer.querySelector('.px-4.pb-4');
    if (contentDiv && contentDiv.classList.contains('hidden')) {
        contentDiv.classList.remove('hidden');
    }
    
    const p = document.createElement('p');
    p.className = `text-gray-400 ${type === 'error' ? 'text-red-400' : ''} ${type === 'success' ? 'text-green-400' : ''}`;
    const icon = type === 'error' ? 'exclamation-circle' : (type === 'success' ? 'check-circle' : 'cog fa-spin');
    p.innerHTML = `<i class="fas fa-${icon} mr-2"></i> ${msg}`;
    logArea.appendChild(p);
    logArea.scrollTop = logArea.scrollHeight;
}

export function showPremise(resultContainer, premiseText, langName) {
    // Auto-expandir container quando premissa é mostrada
    const contentDiv = resultContainer.querySelector('.px-4.pb-4');
    if (contentDiv && contentDiv.classList.contains('hidden')) {
        contentDiv.classList.remove('hidden');
    }
    
    const contentWrapper = resultContainer.querySelector('.content-wrapper');
    const premiseDiv = document.createElement('div');
    premiseDiv.innerHTML = `
        <button class="w-full text-left p-3 font-semibold text-md text-white bg-gray-700 rounded-t-md mt-2 flex justify-between items-center" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <span>Premissa (${langName})</span>
            <span class="ml-2 text-gray-300 hover:text-white cursor-pointer relative inline-block" 
                  onclick="event.stopPropagation(); copyToClipboard(this.closest('div').querySelector('pre').textContent, this)" 
                  title="Copiar premissa"
                  style="width: 16px; height: 16px;">
                <span style="position: absolute; top: 0; left: 0; width: 10px; height: 10px; border: 1px solid currentColor; border-radius: 2px;"></span>
                <span style="position: absolute; top: 3px; left: 3px; width: 10px; height: 10px; border: 1px solid currentColor; border-radius: 2px; background: #374151;"></span>
            </span>
        </button>
        <div class="border border-t-0 border-gray-700 rounded-b-md p-4 hidden">
            <pre class="result-script text-gray-300">${premiseText}</pre>
        </div>
    `;
    contentWrapper.appendChild(premiseDiv);
}

export function createScriptContainerAndGetContentArea(resultContainer, langName) {
    // Auto-expandir container quando script container é criado
    const contentDiv = resultContainer.querySelector('.px-4.pb-4');
    if (contentDiv && contentDiv.classList.contains('hidden')) {
        contentDiv.classList.remove('hidden');
    }
    
    const contentWrapper = resultContainer.querySelector('.content-wrapper');
    const scriptDiv = document.createElement('div');
    scriptDiv.innerHTML = `
        <button class="w-full text-left p-3 font-semibold text-md text-white bg-gray-700 rounded-t-md mt-4 flex justify-between items-center" onclick="this.nextElementSibling.classList.toggle('hidden')">
            <span>Roteiro Final (${langName})</span>
            <span class="ml-2 text-gray-300 hover:text-white cursor-pointer relative inline-block" 
                  onclick="event.stopPropagation(); copyToClipboard(this.closest('div').querySelector('pre').textContent, this)" 
                  title="Copiar roteiro"
                  style="width: 16px; height: 16px;">
                <span style="position: absolute; top: 0; left: 0; width: 10px; height: 10px; border: 1px solid currentColor; border-radius: 2px;"></span>
                <span style="position: absolute; top: 3px; left: 3px; width: 10px; height: 10px; border: 1px solid currentColor; border-radius: 2px; background: #374151;"></span>
            </span>
        </button>
        <div class="border border-t-0 border-gray-700 rounded-b-md p-4 hidden">
            <pre class="result-script text-gray-300 bg-black p-4 rounded-md"></pre>
        </div>
    `;
    contentWrapper.appendChild(scriptDiv);
    return scriptDiv.querySelector('pre');
}

function normalizeLangName(name) {
    return name ? name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';
}

export function getLanguageDataByName(langName) {
    const normalizedInput = normalizeLangName(langName);
    for (const id in LANGUAGES_CONFIG) {
        if (LANGUAGES_CONFIG[id].aliases.some(alias => normalizeLangName(alias) === normalizedInput)) {
            return { id: id, name: LANGUAGES_CONFIG[id].name };
        }
    }
    console.warn(`Idioma "${langName}" não encontrado na configuração.`);
    return null;
}

// Função para obter apenas API keys válidas (status verde)
export function getValidApiKeys(type = 'gemini') {
    const inputClass = type === 'gemini' ? '.gemini-api-key-input' : '.tts-api-key-input';
    const validKeys = [];
    
    document.querySelectorAll(inputClass).forEach(input => {
        const apiKey = input.value.trim();
        if (!apiKey || apiKey.length < 10) return;
        
        const statusIndicator = input.parentElement.querySelector('.validation-status');
        const isValid = statusIndicator && 
                        statusIndicator.textContent === '✓' && 
                        statusIndicator.classList.contains('text-green-400');
        
        if (isValid) {
            validKeys.push(apiKey);
        }
    });
    
    return validKeys;
}

// Função para obter API keys com warning (status amarelo) - podem ser usadas com cuidado
export function getWarningApiKeys(type = 'gemini') {
    const inputClass = type === 'gemini' ? '.gemini-api-key-input' : '.tts-api-key-input';
    const warningKeys = [];
    
    document.querySelectorAll(inputClass).forEach(input => {
        const apiKey = input.value.trim();
        if (!apiKey || apiKey.length < 10) return;
        
        const statusIndicator = input.parentElement.querySelector('.validation-status');
        const isWarning = statusIndicator && 
                          statusIndicator.textContent === '⚠' && 
                          statusIndicator.classList.contains('text-yellow-400');
        
        if (isWarning) {
            warningKeys.push(apiKey);
        }
    });
    
    return warningKeys;
}

// Função para obter todas as API keys utilizáveis (verde + amarelo)
export function getUsableApiKeys(type = 'gemini') {
    const validKeys = getValidApiKeys(type);
    const warningKeys = getWarningApiKeys(type);
    
    // Prioriza keys verdes sobre amarelas
    return [...validKeys, ...warningKeys];
}

// Função para verificar se há pelo menos uma API key utilizável
export function hasUsableApiKeys(type = 'gemini') {
    return getUsableApiKeys(type).length > 0;
}

// Função para obter estatísticas das API keys
export function getApiKeyStats(type = 'gemini') {
    const inputClass = type === 'gemini' ? '.gemini-api-key-input' : '.tts-api-key-input';
    let total = 0, valid = 0, warning = 0, invalid = 0, unvalidated = 0;
    
    document.querySelectorAll(inputClass).forEach(input => {
        const apiKey = input.value.trim();
        if (!apiKey || apiKey.length < 10) return;
        
        total++;
        const statusIndicator = input.parentElement.querySelector('.validation-status');
        
        if (statusIndicator.textContent === '✓' && statusIndicator.classList.contains('text-green-400')) {
            valid++;
        } else if (statusIndicator.textContent === '⚠' && statusIndicator.classList.contains('text-yellow-400')) {
            warning++;
        } else if (statusIndicator.textContent === '✗' && statusIndicator.classList.contains('text-red-400')) {
            invalid++;
        } else {
            unvalidated++;
        }
    });
    
    return { total, valid, warning, invalid, unvalidated };
}


export function updateTtsVoiceSelectors(agentVoices = {}) {
    const ttsVoicesContainer = document.getElementById('tts-voices-container');
    ttsVoicesContainer.innerHTML = '';

    const primaryLanguageTag = document.getElementById('primary-language-tag-container').querySelector('.language-tag-text');
    const primaryLangName = primaryLanguageTag ? primaryLanguageTag.textContent : null;
    
    const additionalLangNames = Array.from(document.getElementById('additional-languages-tags').querySelectorAll('.language-tag-text')).map(el => el.textContent);
    const allLangNames = [...new Set([primaryLangName, ...additionalLangNames])].filter(Boolean);
    
    allLangNames.forEach(langName => {
        const langData = getLanguageDataByName(langName);
        if (langData) {
            const voicesByGender = AVAILABLE_VOICES[langData.id];
            if (voicesByGender && (voicesByGender.feminine?.length > 0 || voicesByGender.masculine?.length > 0)) {
                const div = document.createElement('div');
                div.className = 'flex items-center space-x-3';
                div.innerHTML = `<label class="w-1/3 text-sm font-medium text-gray-400">${langData.name}:</label>`;
                
                // Container para select + botão preview
                const selectContainer = document.createElement('div');
                selectContainer.className = 'flex items-center space-x-2 w-2/3';
                
                const select = document.createElement('select');
                select.className = 'flex-1 bg-gray-700 border border-gray-600 rounded-md p-2 text-white tts-voice-select';
                select.dataset.langName = langData.name;
                select.dataset.langCode = langData.id;
                
                const createOptGroup = (label, voices) => {
                    const group = document.createElement('optgroup');
                    group.label = label;
                    voices.forEach(voice => {
                        const option = document.createElement('option');
                        option.value = voice;
                        option.textContent = voice.split('-').slice(2).join('-');
                        if (agentVoices[langData.name] === voice) option.selected = true;
                        group.appendChild(option);
                    });
                    return group;
                };

                if (voicesByGender.feminine?.length > 0) {
                    select.appendChild(createOptGroup('Vozes Femininas', voicesByGender.feminine));
                }
                if (voicesByGender.masculine?.length > 0) {
                    select.appendChild(createOptGroup('Vozes Masculinas', voicesByGender.masculine));
                }

                // Botão de preview
                const previewButton = document.createElement('button');
                previewButton.type = 'button';
                previewButton.className = 'voice-preview-btn px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center';
                previewButton.innerHTML = '🔊';
                previewButton.title = 'Clique para ouvir uma amostra desta voz';
                previewButton.dataset.langCode = langData.id;
                previewButton.dataset.langName = langData.name;
                
                // Event listener para o botão de preview
                previewButton.addEventListener('click', async () => {
                    const selectedVoice = select.value;
                    if (!selectedVoice) {
                        alert('Selecione uma voz primeiro');
                        return;
                    }
                    await playVoicePreview(selectedVoice, langData.id, langData.name, previewButton);
                });

                selectContainer.appendChild(select);
                selectContainer.appendChild(previewButton);
                div.appendChild(selectContainer);
                ttsVoicesContainer.appendChild(div);
            }
        }
    });
}

// Função para copiar texto para a área de transferência
async function copyToClipboard(text, button) {
    try {
        await navigator.clipboard.writeText(text);
        
        // Feedback visual discreto - só mudar cor para verde
        button.style.color = '#10b981'; // verde
        
        // Restaurar cor original após 1 segundo
        setTimeout(() => {
            button.style.color = ''; // volta para o CSS original
        }, 1000);
        
    } catch (err) {
        console.error('Erro ao copiar texto:', err);
        
        // Fallback para navegadores mais antigos
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        
        try {
            document.execCommand('copy');
            
            // Feedback visual
            button.style.color = '#10b981'; // verde
            setTimeout(() => {
                button.style.color = ''; // volta para o CSS original
            }, 1000);
            
        } catch (fallbackErr) {
            button.style.color = '#f87171'; // vermelho
            setTimeout(() => {
                button.style.color = ''; // volta para o CSS original
            }, 1000);
        }
        
        document.body.removeChild(textArea);
    }
}

// Tornar função global para uso nos botões
window.copyToClipboard = copyToClipboard;

// Cache para armazenar previews de vozes (evita regerar o mesmo preview)
const voicePreviewCache = new Map();

/**
 * Reproduz preview de uma voz TTS
 * @param {string} voiceId - ID da voz (ex: 'pt-BR-Wavenet-A')
 * @param {string} langCode - Código do idioma (ex: 'pt-BR')
 * @param {string} langName - Nome do idioma (ex: 'Portuguese (Brazil)')
 * @param {HTMLElement} button - Botão que foi clicado
 */
async function playVoicePreview(voiceId, langCode, langName, button) {
    // Verifica se há API keys TTS disponíveis (coleta diretamente do DOM)
    const ttsApiKeys = Array.from(document.querySelectorAll('.tts-api-key-input'))
        .map(input => input.value.trim())
        .filter(key => key);
        
    if (!ttsApiKeys || ttsApiKeys.length === 0) {
        alert('Configure pelo menos uma chave de API TTS para ouvir previews das vozes.');
        return;
    }

    const cacheKey = `${voiceId}_${langCode}`;
    
    // Estados do botão
    const originalHTML = button.innerHTML;
    const originalClass = button.className;
    
    try {
        // Estado de loading
        button.innerHTML = '⏳';
        button.disabled = true;
        button.classList.add('loading');
        button.className = button.className.replace('bg-blue-600', 'bg-gray-600').replace('hover:bg-blue-700', '');
        
        let audioBase64;
        
        // Verifica cache primeiro
        if (voicePreviewCache.has(cacheKey)) {
            console.log(`🔄 Usando preview em cache para ${voiceId}`);
            audioBase64 = voicePreviewCache.get(cacheKey);
        } else {
            console.log(`🎵 Gerando novo preview para ${voiceId} (${langName})`);
            
            // Chama API para gerar preview
            const response = await generateVoicePreviewApi(langCode, voiceId, ttsApiKeys[0]);
            
            if (response.success) {
                audioBase64 = response.audio_base_64;
                // Salva no cache
                voicePreviewCache.set(cacheKey, audioBase64);
            } else {
                throw new Error(response.message || 'Erro ao gerar preview');
            }
        }
        
        // Estado de reprodução
        button.innerHTML = '▶️';
        button.classList.remove('loading');
        button.classList.add('playing');
        button.className = originalClass.replace('bg-blue-600', 'bg-green-600').replace('hover:bg-blue-700', 'hover:bg-green-700');
        
        // Reproduz o áudio
        await playAudioFromBase64(audioBase64);
        
        console.log(`✅ Preview da voz ${voiceId} reproduzido com sucesso`);
        
    } catch (error) {
        console.error(`❌ Erro ao reproduzir preview da voz ${voiceId}:`, error);
        
        // Estado de erro
        button.innerHTML = '❌';
        button.classList.remove('loading', 'playing');
        button.className = originalClass.replace('bg-blue-600', 'bg-red-600').replace('hover:bg-blue-700', 'hover:bg-red-700');
        
        // Mostra erro para o usuário
        alert(`Erro ao reproduzir preview da voz ${voiceId}: ${error.message}`);
        
        // Restaura botão após 2 segundos
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.className = originalClass;
            button.classList.remove('loading', 'playing');
            button.disabled = false;
        }, 2000);
        return;
    }
    
    // Restaura estado original
    button.innerHTML = originalHTML;
    button.className = originalClass;
    button.classList.remove('loading', 'playing');
    button.disabled = false;
}

/**
 * Chama a API backend para gerar preview de voz
 * @param {string} languageCode - Código do idioma
 * @param {string} voiceId - ID da voz
 * @param {string} ttsApiKey - Chave de API TTS
 * @returns {Promise<Object>} - Resposta da API
 */
async function generateVoicePreviewApi(languageCode, voiceId, ttsApiKey) {
    try {
        const headers = await getAuthHeaders();
        
        const response = await fetch('/api/tts-voice-preview', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                languageCode: languageCode,
                voiceId: voiceId,
                ttsApiKey: ttsApiKey
            })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.message || `Erro HTTP ${response.status}`);
        }
        
        return result;
        
    } catch (error) {
        console.error('Erro na API de preview de voz:', error);
        throw error;
    }
}

/**
 * Reproduz áudio a partir de string base64
 * @param {string} audioBase64 - Áudio codificado em base64
 * @returns {Promise<void>}
 */
function playAudioFromBase64(audioBase64) {
    return new Promise((resolve, reject) => {
        try {
            // Cria blob do áudio
            const audioData = atob(audioBase64);
            const arrayBuffer = new ArrayBuffer(audioData.length);
            const uint8Array = new Uint8Array(arrayBuffer);
            
            for (let i = 0; i < audioData.length; i++) {
                uint8Array[i] = audioData.charCodeAt(i);
            }
            
            const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
            const audioUrl = URL.createObjectURL(blob);
            
            // Cria elemento de áudio temporário
            const audio = new Audio(audioUrl);
            
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                resolve();
            };
            
            audio.onerror = (error) => {
                URL.revokeObjectURL(audioUrl);
                reject(new Error('Erro ao reproduzir áudio: ' + error.message));
            };
            
            audio.play().catch(reject);
            
        } catch (error) {
            reject(new Error('Erro ao processar áudio: ' + error.message));
        }
    });
}

// Tornar funções globais para depuração
window.playVoicePreview = playVoicePreview;
window.voicePreviewCache = voicePreviewCache;
