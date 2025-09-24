/**
 * agentManager.js
 * * This module handles all logic related to creating, saving, editing,
 * and deleting agents.
 */

import { state, agents } from './state.js';
import { DEFAULT_AGENTS, LANGUAGES_CONFIG } from './config.js';
import { updateAgentDropdown, updateTtsVoiceSelectors } from './ui.js';
import { saveCustomAgents, loadCustomAgents } from './api.js';

let agentModal, agentNameInput, agentTypeSelect, editingAgentKeyInput,
    singlePromptContainer, pairPromptContainer, agentPromptTextarea,
    premisePromptInput, scriptPromptInput, scriptStructureInput, adaptationPromptInput,
    primaryLanguageInput, addPrimaryLanguageBtn, primaryLanguageSuggestions, primaryLanguageTagContainer,
    newLanguageInput, addLanguageBtn, additionalLanguageSuggestions, additionalLanguagesTags,
    ttsEnabledCheckbox, ttsConfigContainer,
    saveAgentBtn, cancelAgentBtn, deleteAgentBtn, editAgentBtn, agentSelect;

export function initializeAgentLogic() {
    agentModal = document.getElementById('agent-modal');
    agentNameInput = document.getElementById('agent-name');
    agentTypeSelect = document.getElementById('agent-type');
    editingAgentKeyInput = document.getElementById('editing-agent-key');
    
    singlePromptContainer = document.getElementById('single-prompt-container');
    pairPromptContainer = document.getElementById('pair-prompt-container');
    agentPromptTextarea = document.getElementById('agent-prompt');
    
    premisePromptInput = document.getElementById('premise-prompt-input');
    scriptPromptInput = document.getElementById('script-prompt-input');
    scriptStructureInput = document.getElementById('script-structure-input');
    adaptationPromptInput = document.getElementById('adaptation-prompt-input');

    primaryLanguageInput = document.getElementById('primary-language-input');
    addPrimaryLanguageBtn = document.getElementById('add-primary-language-btn');
    primaryLanguageSuggestions = document.getElementById('primary-language-suggestions');
    primaryLanguageTagContainer = document.getElementById('primary-language-tag-container');
    
    newLanguageInput = document.getElementById('new-language-input');
    addLanguageBtn = document.getElementById('add-language-btn');
    additionalLanguageSuggestions = document.getElementById('additional-language-suggestions');
    additionalLanguagesTags = document.getElementById('additional-languages-tags');

    ttsEnabledCheckbox = document.getElementById('tts-enabled-checkbox');
    ttsConfigContainer = document.getElementById('tts-config-container');

    saveAgentBtn = document.getElementById('save-agent-btn');
    cancelAgentBtn = document.getElementById('cancel-agent-btn');
    deleteAgentBtn = document.getElementById('delete-agent-btn');
    editAgentBtn = document.getElementById('edit-agent-btn');
    agentSelect = document.getElementById('agent-select');

    document.getElementById('new-agent-btn').addEventListener('click', openAgentMethodModal);
    editAgentBtn.addEventListener('click', () => {
        const selectedAgent = agentSelect.value;
        if (selectedAgent) {
            editAgent(selectedAgent);
        }
    });
    
    agentSelect.addEventListener('change', updateEditButtonState);
    
    document.querySelectorAll('input[name="generation-mode"]').forEach(radio => {
        radio.addEventListener('change', updateAgentDropdown);
    });

    agentTypeSelect.addEventListener('change', handleAgentTypeChange);
    saveAgentBtn.addEventListener('click', saveAgent);
    deleteAgentBtn.addEventListener('click', deleteAgent);
    cancelAgentBtn.addEventListener('click', () => agentModal.classList.add('hidden'));
    
    addPrimaryLanguageBtn.addEventListener('click', () => setPrimaryLanguageTag(primaryLanguageInput.value));
    primaryLanguageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); setPrimaryLanguageTag(primaryLanguageInput.value); } });
    primaryLanguageInput.addEventListener('input', () => showLanguageSuggestions(primaryLanguageInput, primaryLanguageSuggestions));

    addLanguageBtn.addEventListener('click', () => addAdditionalLanguageTag(newLanguageInput.value));
    newLanguageInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAdditionalLanguageTag(newLanguageInput.value); } });
    newLanguageInput.addEventListener('input', () => showLanguageSuggestions(newLanguageInput, additionalLanguageSuggestions));

    document.addEventListener('click', (e) => {
        if (primaryLanguageInput && !primaryLanguageInput.parentElement.contains(e.target)) {
            primaryLanguageSuggestions.classList.add('hidden');
        }
        if (newLanguageInput && !newLanguageInput.parentElement.contains(e.target)) {
            additionalLanguageSuggestions.classList.add('hidden');
        }
    });

    ttsEnabledCheckbox.addEventListener('change', () => ttsConfigContainer.classList.toggle('hidden', !ttsEnabledCheckbox.checked));
    
    // Initialize edit button state
    updateEditButtonState();
}

// Function to update the edit button state based on selected agent
export function updateEditButtonState() {
    // Fail-safe: se elementos não estão inicializados ainda, retorna
    if (!agentSelect || !editAgentBtn) return;
    
    const selectedAgent = agentSelect.value;
    const isCustomAgent = selectedAgent && !DEFAULT_AGENTS[selectedAgent];
    
    editAgentBtn.disabled = !isCustomAgent;
}

// Função para carregar agentes do banco de dados
export async function loadAgentsFromDatabase() {
    try {
        // Verifica se o usuário está logado
        const user = firebase.auth().currentUser;
        if (!user) {
            // console.log('Usuário não está logado, pulando carregamento de agentes');
            return;
        }
        
        // Limpa agentes antigos do localStorage (migração)
        clearOldAgentsFromLocalStorage();
        
        const customAgents = await loadCustomAgents();
        
        // Atualiza o estado local
        state.customAgents = customAgents;
        
        // Atualiza o objeto agents combinando default + custom
        Object.assign(agents, DEFAULT_AGENTS, customAgents);
        
        // Atualiza o dropdown
        updateAgentDropdown();
        
        // console.log('Agentes carregados do banco de dados:', Object.keys(customAgents).length);
        
    } catch (error) {
        console.error('Erro ao carregar agentes do banco de dados:', error);
        // Só mostra erro se o usuário estiver logado
        const user = firebase.auth().currentUser;
        if (user) {
            showAgentSaveFeedback('Erro ao carregar agentes do banco de dados', 'error');
        }
    }
}

// Função para limpar agentes antigos do localStorage
function clearOldAgentsFromLocalStorage() {
    try {
        const savedState = localStorage.getItem('scriptGeneratorState');
        if (savedState) {
            const parsedState = JSON.parse(savedState);
            if (parsedState.customAgents) {
                // Remove agentes do localStorage
                delete parsedState.customAgents;
                localStorage.setItem('scriptGeneratorState', JSON.stringify(parsedState));
                // console.log('Agentes antigos removidos do localStorage');
            }
        }
    } catch (error) {
        console.error('Erro ao limpar agentes antigos do localStorage:', error);
    }
}

// Função para recarregar agentes do banco de dados
export async function reloadAgentsFromDatabase() {
    try {
        // Carrega do banco de dados
        const dbAgents = await loadCustomAgents();
        
        // Atualiza o estado local
        state.customAgents = dbAgents;
        Object.assign(agents, DEFAULT_AGENTS, dbAgents);
        
        updateAgentDropdown();
        // console.log('Agentes recarregados do banco de dados');
        
    } catch (error) {
        console.error('Erro ao recarregar agentes:', error);
        showAgentSaveFeedback('Erro ao recarregar agentes', 'error');
    }
}

function openNewAgentModal() {
    // ... (nenhuma mudança nesta função, ela continua a mesma)
    editingAgentKeyInput.value = '';
    agentNameInput.value = '';
    agentPromptTextarea.value = '';
    
    const currentMode = document.querySelector('input[name="generation-mode"]:checked').value;
    agentTypeSelect.value = currentMode;
    
    const defaultPairAgent = DEFAULT_AGENTS['agente-premissa-exemplo'];
    premisePromptInput.value = defaultPairAgent.premise_template;
    scriptPromptInput.value = defaultPairAgent.script_template;
    scriptStructureInput.value = defaultPairAgent.script_structure;
    adaptationPromptInput.value = defaultPairAgent.adaptation_template;
    
    primaryLanguageTagContainer.innerHTML = '';
    additionalLanguagesTags.innerHTML = '';
    setPrimaryLanguageTag(defaultPairAgent.primary_language);
    defaultPairAgent.additional_languages.forEach(addAdditionalLanguageTag);

    ttsEnabledCheckbox.checked = defaultPairAgent.tts_enabled;
    ttsConfigContainer.classList.toggle('hidden', !defaultPairAgent.tts_enabled);
    updateTtsVoiceSelectors(defaultPairAgent.tts_voices);

    deleteAgentBtn.classList.add('hidden');
    handleAgentTypeChange();
    agentModal.classList.remove('hidden');
}

function editAgent(key) {
    // ... (nenhuma mudança nesta função, ela continua a mesma)
    const agent = agents[key];
    if (!agent) return;

    editingAgentKeyInput.value = key;
    agentNameInput.value = agent.name;
    agentTypeSelect.value = agent.type || 'classic';

    if (agent.type === 'pair') {
        premisePromptInput.value = agent.premise_template || '';
        scriptPromptInput.value = agent.script_template || '';
        scriptStructureInput.value = agent.script_structure || '';
        adaptationPromptInput.value = agent.adaptation_template || '';
        
        primaryLanguageTagContainer.innerHTML = '';
        additionalLanguagesTags.innerHTML = '';
        setPrimaryLanguageTag(agent.primary_language || 'Portuguese (Brazil)');
        (agent.additional_languages || []).forEach(addAdditionalLanguageTag);

        ttsEnabledCheckbox.checked = agent.tts_enabled || false;
        ttsConfigContainer.classList.toggle('hidden', !agent.tts_enabled);
        updateTtsVoiceSelectors(agent.tts_voices || {});
    } else {
        agentPromptTextarea.value = agent.template || '';
    }

    deleteAgentBtn.classList.toggle('hidden', !!DEFAULT_AGENTS[key]);
    handleAgentTypeChange();
    agentModal.classList.remove('hidden');
}

async function saveAgent() {
    const name = agentNameInput.value.trim();
    if (!name) {
        alert('Por favor, preencha o nome do agente.');
        return;
    }
    
    const type = agentTypeSelect.value;
    const existingKey = editingAgentKeyInput.value;
    const newKey = existingKey || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    if (existingKey && existingKey !== newKey) {
        delete state.customAgents[existingKey];
    }

    let agentData;
    if (type === 'pair') {
        const primaryLangTag = primaryLanguageTagContainer.querySelector('.language-tag-text');
        if (!primaryLangTag) {
            alert('Por favor, defina um idioma principal.');
            return;
        }
        
        agentData = {
            name, type,
            primary_language: primaryLangTag.textContent,
            premise_template: premisePromptInput.value.trim(),
            script_template: scriptPromptInput.value.trim(),
            script_structure: scriptStructureInput.value.trim(),
            adaptation_template: adaptationPromptInput.value.trim(),
            additional_languages: Array.from(additionalLanguagesTags.querySelectorAll('.language-tag-text')).map(el => el.textContent),
            tts_enabled: ttsEnabledCheckbox.checked,
            tts_voices: {}
        };

        if (agentData.tts_enabled) {
            document.querySelectorAll('.tts-voice-select').forEach(select => {
                agentData.tts_voices[select.dataset.langName] = select.value;
            });
        }
    } else {
        agentData = {
            name, type,
            template: agentPromptTextarea.value.trim()
        };
    }

    state.customAgents[newKey] = agentData;
    agents[newKey] = agentData;
    
    try {
        // Salva apenas no banco de dados
        await saveCustomAgents(state.customAgents);
        
        // Feedback visual de sucesso
        showAgentSaveFeedback('Agente salvo com sucesso!', 'success');
        
        updateAgentDropdown();
        agentModal.classList.add('hidden');
    } catch (error) {
        console.error('Erro ao salvar agente:', error);
        showAgentSaveFeedback('Erro ao salvar agente: ' + error.message, 'error');
    }
}

async function deleteAgent() {
    const key = editingAgentKeyInput.value;
    if (key && !DEFAULT_AGENTS[key] && confirm(`Tem certeza que deseja deletar o agente "${agents[key].name}"?`)) {
        delete state.customAgents[key];
        delete agents[key];
        
        try {
            // Salva apenas no banco de dados
            await saveCustomAgents(state.customAgents);
            
            // Feedback visual de sucesso
            showAgentSaveFeedback('Agente deletado com sucesso!', 'success');
            
            updateAgentDropdown();
            agentModal.classList.add('hidden');
        } catch (error) {
            console.error('Erro ao deletar agente:', error);
            showAgentSaveFeedback('Erro ao deletar agente: ' + error.message, 'error');
        }
    }
}

function handleAgentTypeChange() {
    // ... (nenhuma mudança nesta função, ela continua a mesma)
    const isPairMode = agentTypeSelect.value === 'pair';
    singlePromptContainer.classList.toggle('hidden', isPairMode);
    pairPromptContainer.classList.toggle('hidden', !isPairMode);
}

function setPrimaryLanguageTag(langName) {
    // ... (nenhuma mudança nesta função, ela continua a mesma)
    createLanguageTag(langName, primaryLanguageTagContainer, true);
    primaryLanguageInput.value = '';
    primaryLanguageSuggestions.classList.add('hidden');
}

function addAdditionalLanguageTag(langName) {
    // ... (nenhuma mudança nesta função, ela continua a mesma)
    createLanguageTag(langName, additionalLanguagesTags, false);
    newLanguageInput.value = '';
    newLanguageInput.focus();
    additionalLanguageSuggestions.classList.add('hidden');
}

function createLanguageTag(langName, container, isPrimary = false) {
    // ... (nenhuma mudança nesta função, ela continua a mesma)
    const lang = langName.trim();
    if (!lang) return;

    if (isPrimary) {
        container.innerHTML = '';
    } else {
        const existingTags = Array.from(container.querySelectorAll('.language-tag-text')).map(el => el.textContent.toLowerCase());
        if (existingTags.includes(lang.toLowerCase())) return;
    }
    
    const tag = document.createElement('div');
    tag.className = 'language-tag';
    tag.innerHTML = `<span class="language-tag-text">${lang}</span><button type="button"><i class="fas fa-times-circle"></i></button>`;
    
    tag.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        tag.remove();
        updateTtsVoiceSelectors(collectSelectedTtsVoices());
    });
    
    container.appendChild(tag);
    updateTtsVoiceSelectors(collectSelectedTtsVoices());
}

function collectSelectedTtsVoices() {
    // ... (nenhuma mudança nesta função, ela continua a mesma)
    const voices = {};
    document.querySelectorAll('.tts-voice-select').forEach(select => {
        voices[select.dataset.langName] = select.value;
    });
    return voices;
}

function showLanguageSuggestions(inputElement, suggestionsContainer) {
    const query = inputElement.value.toLowerCase().trim();
    suggestionsContainer.innerHTML = '';
    if (!query) {
        suggestionsContainer.classList.add('hidden');
        return;
    }
    
    const normalizeLangName = (name) => name ? name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : '';

    // CORREÇÃO: Acessa LANGUAGES_CONFIG diretamente, que já foi importado no topo do arquivo.
    if (!LANGUAGES_CONFIG) return; // Adiciona uma guarda para segurança
    const matches = Object.values(LANGUAGES_CONFIG).filter(lang => {
        const normalizedQuery = normalizeLangName(query);
        return normalizeLangName(lang.name).includes(normalizedQuery) || 
               (lang.aliases && lang.aliases.some(alias => normalizeLangName(alias).includes(normalizedQuery)));
    });

    if (matches.length > 0) {
        matches.forEach(lang => {
            const suggestionDiv = document.createElement('div');
            suggestionDiv.textContent = lang.name;
            suggestionDiv.addEventListener('click', () => {
                if (inputElement === primaryLanguageInput) {
                    setPrimaryLanguageTag(lang.name);
                } else {
                    addAdditionalLanguageTag(lang.name);
                }
            });
            suggestionsContainer.appendChild(suggestionDiv);
        });
        suggestionsContainer.classList.remove('hidden');
    } else {
        suggestionsContainer.classList.add('hidden');
    }
}

// Função para mostrar feedback visual para agentes
function showAgentSaveFeedback(message, type = 'info') {
    // Remove feedback anterior se existir
    const existingFeedback = document.querySelector('.agent-feedback');
    if (existingFeedback) {
        existingFeedback.remove();
    }
    
    const feedback = document.createElement('div');
    feedback.className = `agent-feedback fixed top-4 right-4 p-3 rounded-md text-white z-50 transition-all duration-300 ${
        type === 'success' ? 'bg-green-600' : 
        type === 'error' ? 'bg-red-600' : 'bg-blue-600'
    }`;
    feedback.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation' : 'info'} mr-2"></i>
        ${message}
    `;
    
    document.body.appendChild(feedback);
    
    // Remove após 3 segundos
    setTimeout(() => {
        feedback.style.opacity = '0';
        setTimeout(() => feedback.remove(), 300);
    }, 3000);
}

// ============= NOVA FUNCIONALIDADE: AI AGENT CREATOR =============
// Variáveis para modais AI
let methodModal, aiModal;

// Função para abrir modal de seleção de método
function openAgentMethodModal() {
    if (!methodModal) {
        methodModal = document.getElementById('agent-method-modal');
        
        // Adicionar listeners apenas uma vez
        document.getElementById('create-manual-btn').addEventListener('click', () => {
            closeMethodModal();
            openManualAgentModal();
        });
        
        document.getElementById('create-ai-btn').addEventListener('click', () => {
            closeMethodModal();
            openAIAgentModal();
        });
        
        document.getElementById('cancel-method-btn').addEventListener('click', closeMethodModal);
    }
    
    methodModal.classList.remove('hidden');
}

// Função para fechar modal de método
function closeMethodModal() {
    if (methodModal) {
        methodModal.classList.add('hidden');
    }
}

// Função para abrir criação manual (mesma lógica antiga)
function openManualAgentModal() {
    openNewAgentModal();
}

// Função para abrir criação com AI
function openAIAgentModal() {
    if (!aiModal) {
        aiModal = document.getElementById('ai-agent-modal');
        
        // Adicionar listeners apenas uma vez
        document.getElementById('cancel-ai-btn').addEventListener('click', closeAIModal);
        document.getElementById('start-ai-analysis-btn').addEventListener('click', startAIAnalysis);
        document.getElementById('restart-ai-btn').addEventListener('click', restartAIProcess);
        document.getElementById('edit-ai-agent-btn').addEventListener('click', editAIAgent);
        document.getElementById('save-ai-agent-btn').addEventListener('click', saveAIAgent);
        document.getElementById('minimize-ai-modal-btn').addEventListener('click', minimizeAIModal);
        
        // Event listeners para upload de arquivos
        const filesInput = document.getElementById('ai-scripts-files');
        filesInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFilesSelected(Array.from(e.target.files));
            }
        });
        
        // Event listener para nome do agente
        const agentNameInput = document.getElementById('ai-agent-name');
        agentNameInput.addEventListener('input', validateAIInput);
        
        // Inicializar contexto de áudio na primeira interação
        agentNameInput.addEventListener('focus', () => {
            initAudioContext();
        }, { once: true });
        
        // Drag and drop support
        const dropArea = filesInput.closest('.border-dashed');
        dropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropArea.classList.add('border-purple-500', 'bg-gray-700');
        });
        
        dropArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            dropArea.classList.remove('border-purple-500', 'bg-gray-700');
        });
        
        dropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            dropArea.classList.remove('border-purple-500', 'bg-gray-700');
            
            const files = Array.from(e.dataTransfer.files).filter(file => 
                file.name.toLowerCase().endsWith('.txt') || 
                file.name.toLowerCase().endsWith('.md')
            );
            
            if (files.length > 0) {
                handleFilesSelected(files);
            } else {
                alert('Apenas arquivos .txt e .md são aceitos');
            }
        });
        
        // Event listener para indicador flutuante
        const floatingIndicator = document.getElementById('ai-floating-indicator');
        if (floatingIndicator) {
            floatingIndicator.addEventListener('click', maximizeAIModal);
        }
    }
    
    // Reset do modal
    resetAIModal();
    aiModal.classList.remove('hidden');
}

// Função para fechar modal AI
function closeAIModal() {
    if (aiModal) {
        aiModal.classList.add('hidden');
    }
}

// Função para resetar modal AI
function resetAIModal() {
    // Mostrar apenas o primeiro step
    document.getElementById('ai-input-step').classList.remove('hidden');
    document.getElementById('ai-processing-step').classList.add('hidden');
    document.getElementById('ai-preview-step').classList.add('hidden');
    
    // Limpar campo de nome
    const agentNameInput = document.getElementById('ai-agent-name');
    if (agentNameInput) agentNameInput.value = '';
    
    // Limpar arquivos
    selectedFiles = [];
    totalFilesContent = '';
    const filesInput = document.getElementById('ai-scripts-files');
    if (filesInput) filesInput.value = '';
    
    // Resetar botão
    document.getElementById('start-ai-analysis-btn').disabled = true;
    
    // Resetar progress (verificar se elemento existe)
    const progressText = document.getElementById('ai-progress-text');
    if (progressText) progressText.textContent = 'Analisando roteiros...';
    const connectionStatus = document.getElementById('ai-connection-status');
    if (connectionStatus) connectionStatus.textContent = 'Conectando ao servidor...';
    
    // Resetar status dos passos
    resetStepsStatus();
    
    // Resetar estados do modal minimizado
    aiProcessingInBackground = false;
    isAIModalMinimized = false;
    
    // Esconder indicador flutuante se estiver visível
    const floatingIndicator = document.getElementById('ai-floating-indicator');
    if (floatingIndicator) {
        floatingIndicator.classList.add('hidden');
    }
    
    // Esconder lista de arquivos
    updateFilesDisplay();
}

// Variáveis para gerenciar arquivos
let selectedFiles = [];
let totalFilesContent = '';

// Função para validar arquivos selecionados
function validateAIInput() {
    const button = document.getElementById('start-ai-analysis-btn');
    const agentNameInput = document.getElementById('ai-agent-name');
    const agentName = agentNameInput ? agentNameInput.value.trim() : '';
    
    // Validar nome do agente
    const isNameValid = agentName.length >= 3;
    
    // Atualizar visual do campo de nome
    if (agentNameInput) {
        if (agentName.length === 0) {
            agentNameInput.className = 'w-full bg-gray-700 border border-gray-600 rounded-md p-2 text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500';
        } else if (isNameValid) {
            agentNameInput.className = 'w-full bg-gray-700 border border-green-500 rounded-md p-2 text-white focus:ring-2 focus:ring-green-500 focus:border-green-500';
        } else {
            agentNameInput.className = 'w-full bg-gray-700 border border-red-500 rounded-md p-2 text-white focus:ring-2 focus:ring-red-500 focus:border-red-500';
        }
    }
    
    const isValid = selectedFiles.length > 0 && 
                   totalFilesContent.length >= 100 && 
                   isNameValid;
    
    button.disabled = !isValid;
}

// Função para processar arquivos selecionados
async function handleFilesSelected(files) {
    const maxFiles = 6;
    const maxTotalSize = 5 * 1024 * 1024; // 5MB
    
    // Filtrar arquivos que já existem na lista (mesmo nome)
    const newFiles = Array.from(files).filter(file => 
        !selectedFiles.some(existing => existing.name === file.name)
    );
    
    // Verificar se há arquivos duplicados sendo adicionados
    const duplicates = Array.from(files).filter(file => 
        selectedFiles.some(existing => existing.name === file.name)
    );
    
    if (duplicates.length > 0) {
        alert(`Arquivos já adicionados serão ignorados: ${duplicates.map(f => f.name).join(', ')}`);
    }
    
    // Validar número total de arquivos após adicionar
    const totalAfterAdd = selectedFiles.length + newFiles.length;
    if (totalAfterAdd > maxFiles) {
        alert(`Máximo ${maxFiles} arquivos permitidos. Você já tem ${selectedFiles.length} arquivo(s). Pode adicionar apenas ${maxFiles - selectedFiles.length} arquivo(s) a mais.`);
        return;
    }
    
    // Validar número de arquivos novos
    if (newFiles.length === 0) {
        if (duplicates.length > 0) {
            return; // Todos eram duplicados, já mostrou o alerta
        }
        alert('Selecione pelo menos 1 arquivo MD ou TXT para análise.');
        return;
    }
    
    // Calcular tamanho total (arquivos existentes + novos)
    const currentTotalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    let newFilesTotalSize = 0;
    
    for (let file of newFiles) {
        newFilesTotalSize += file.size;
    }
    
    if (currentTotalSize + newFilesTotalSize > maxTotalSize) {
        const currentMB = (currentTotalSize / 1024 / 1024).toFixed(2);
        const newMB = (newFilesTotalSize / 1024 / 1024).toFixed(2);
        const totalMB = ((currentTotalSize + newFilesTotalSize) / 1024 / 1024).toFixed(2);
        alert(`Tamanho total máximo: 5MB. Atual: ${currentMB}MB + Novos: ${newMB}MB = ${totalMB}MB (excede limite)`);
        return;
    }
    
    // Ler conteúdo dos novos arquivos e adicionar à lista
    for (let file of newFiles) {
        try {
            const content = await readFileContent(file);
            if (content.trim()) {
                selectedFiles.push({
                    name: file.name,
                    size: file.size,
                    content: content
                });
            }
        } catch (error) {
            console.error(`Erro ao ler arquivo ${file.name}:`, error);
            alert(`Erro ao ler arquivo ${file.name}`);
            return;
        }
    }
    
    // Reconstituir conteúdo total de todos os arquivos selecionados
    const allFileContents = selectedFiles.map(file => 
        `\n\n=== ROTEIRO: ${file.name} ===\n${file.content}`
    );
    totalFilesContent = allFileContents.join('\n');
    
    // Atualizar UI
    updateFilesDisplay();
    validateAIInput();
}

// Função para ler conteúdo de um arquivo
function readFileContent(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file, 'UTF-8');
    });
}

// Função para atualizar display dos arquivos
function updateFilesDisplay() {
    const filesList = document.getElementById('ai-files-list');
    const filesContainer = document.getElementById('ai-files-container');
    const filesCount = document.getElementById('ai-files-count');
    const filesSize = document.getElementById('ai-files-size');
    
    if (selectedFiles.length === 0) {
        filesList.classList.add('hidden');
        return;
    }
    
    filesList.classList.remove('hidden');
    
    // Atualizar lista de arquivos
    filesContainer.innerHTML = '';
    selectedFiles.forEach((file, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between bg-gray-700 p-2 rounded text-sm';
        div.innerHTML = `
            <span class="text-gray-300">
                <i class="fas fa-file-text mr-2"></i>
                ${file.name} (${(file.size / 1024).toFixed(1)} KB)
            </span>
            <button onclick="removeFile(${index})" class="text-red-400 hover:text-red-300">
                <i class="fas fa-times"></i>
            </button>
        `;
        filesContainer.appendChild(div);
    });
    
    // Atualizar contadores
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    filesCount.textContent = `${selectedFiles.length} arquivo${selectedFiles.length !== 1 ? 's' : ''}`;
    filesSize.textContent = `${(totalSize / 1024).toFixed(1)} KB`;
}

// Função para remover arquivo
window.removeFile = function(index) {
    selectedFiles.splice(index, 1);
    
    // Reprocessar conteúdo
    const fileContents = selectedFiles.map(file => 
        `\n\n=== ROTEIRO: ${file.name} ===\n${file.content}`
    );
    totalFilesContent = fileContents.join('\n');
    
    updateFilesDisplay();
    validateAIInput();
}

// Variável global para armazenar dados do agente AI
let currentAIAgentData = null;

// Variáveis de controle do modal minimizado
let isAIModalMinimized = false;
let aiProcessingInBackground = false;

// Variáveis de controle de som
let audioContext = null;
let soundEnabled = true;

// Função para inicializar contexto de áudio
export function initAudioContext() {
    if (!audioContext && soundEnabled) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            console.warn('Web Audio API não suportada:', error);
            soundEnabled = false;
        }
    }
}

// Função para tocar som de sucesso
export function playSuccessSound() {
    if (!soundEnabled || !audioContext) {
        initAudioContext();
        if (!audioContext) return;
    }
    
    try {
        // Criar sons harmoniosos (acordes maiores)
        const notes = [523.25, 659.25, 783.99]; // Dó, Mi, Sol (C Major chord)
        const duration = 0.6;
        
        notes.forEach((frequency, index) => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
            oscillator.type = 'sine';
            
            // Envelope ADSR suave
            gainNode.gain.setValueAtTime(0, audioContext.currentTime);
            gainNode.gain.linearRampToValueAtTime(0.1, audioContext.currentTime + 0.05);
            gainNode.gain.exponentialRampToValueAtTime(0.05, audioContext.currentTime + duration * 0.3);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
            
            const startTime = audioContext.currentTime + (index * 0.1);
            oscillator.start(startTime);
            oscillator.stop(startTime + duration);
        });
    } catch (error) {
        console.warn('Erro ao reproduzir som:', error);
    }
}

// Função para mostrar notificação especial de conclusão
function showCompletionNotification(agentName) {
    // Tocar som de sucesso
    playSuccessSound();
    
    // Criar notificação especial
    const notification = document.createElement('div');
    notification.className = 'completion-notification fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-green-500 to-emerald-600 text-white p-6 rounded-xl shadow-2xl z-60 transition-all duration-500 opacity-0 scale-75';
    
    notification.innerHTML = `
        <div class="text-center space-y-4">
            <div class="relative">
                <i class="fas fa-robot text-4xl animate-bounce"></i>
                <div class="absolute -top-1 -right-1 w-4 h-4 bg-yellow-400 rounded-full animate-ping"></div>
            </div>
            <div>
                <h3 class="text-xl font-bold mb-2">🎉 Agente Criado com Sucesso!</h3>
                <p class="text-green-100 text-lg font-semibold">"${agentName}"</p>
                <p class="text-green-200 text-sm mt-2">Agente pronto para uso. Você pode editá-lo ou salvá-lo agora.</p>
            </div>
            <div class="flex justify-center space-x-3 mt-4">
                <button
                    onclick="this.parentElement.parentElement.parentElement.remove(); showAIPreview(currentAIAgentData);"
                    class="bg-white text-green-600 px-4 py-2 rounded-md font-semibold hover:bg-green-50 transition-colors"
                >
                    <i class="fas fa-eye mr-2"></i>Ver Agente
                </button>
                <button
                    onclick="this.parentElement.parentElement.parentElement.remove();"
                    class="bg-green-700 text-white px-4 py-2 rounded-md font-semibold hover:bg-green-800 transition-colors"
                >
                    <i class="fas fa-times mr-2"></i>Fechar
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animar entrada
    setTimeout(() => {
        notification.classList.remove('opacity-0', 'scale-75');
        notification.classList.add('opacity-100', 'scale-100');
    }, 100);
    
    // Auto-remover após 8 segundos
    setTimeout(() => {
        notification.classList.add('opacity-0', 'scale-75');
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 500);
    }, 8000);
}

// Função para iniciar análise AI
async function startAIAnalysis() {
    const agentNameInput = document.getElementById('ai-agent-name');
    const agentName = agentNameInput.value.trim();
    
    if (!agentName || agentName.length < 3) {
        alert('Por favor, digite um nome para o agente (mínimo 3 caracteres)');
        agentNameInput.focus();
        return;
    }
    
    if (selectedFiles.length === 0) {
        alert('Por favor, selecione pelo menos um arquivo .txt ou .md');
        return;
    }
    
    if (totalFilesContent.length < 100) {
        alert('O conteúdo total dos arquivos deve ter pelo menos 100 caracteres');
        return;
    }
    
    // Mostrar step de processamento e resetar status
    document.getElementById('ai-input-step').classList.add('hidden');
    document.getElementById('ai-processing-step').classList.remove('hidden');
    resetStepsStatus();
    
    try {
        await processAIAgentCreation(totalFilesContent, agentName);
    } catch (error) {
        console.error('Erro na criação com AI:', error);
        showAIError(error.message);
    }
}

// Função para processar criação com AI (NOVA: 4 chamadas sequenciais)
async function processAIAgentCreation(scriptsContent, agentName) {
    // Importar função de API de forma segura
    const apiModule = await import('./api.js');
    const { getAuthHeaders } = apiModule;
    
    if (!getAuthHeaders) {
        throw new Error('Função getAuthHeaders não encontrada');
    }
    
    // Pegar API keys válidas diretamente da interface
    const validGeminiKeys = [];
    
    // Buscar todas as API keys válidas (verde) na interface
    document.querySelectorAll('.gemini-api-key-input').forEach(input => {
        const apiKey = input.value.trim();
        if (!apiKey || apiKey.length < 10) return;
        
        const statusIndicator = input.parentElement.querySelector('.validation-status');
        const isValid = statusIndicator && 
                        statusIndicator.textContent === '✓' && 
                        statusIndicator.classList.contains('text-green-400');
        
        if (isValid) {
            validGeminiKeys.push(apiKey);
        }
    });
    
    if (validGeminiKeys.length === 0) {
        throw new Error('Você precisa ter pelo menos uma API Key do Gemini válida (verde) nas configurações para usar este recurso');
    }
    
    console.log(`[AI-CLIENT] Encontradas ${validGeminiKeys.length} API keys válidas`);
    
    try {
        const headers = await getAuthHeaders();
        const model = state.selectedGeminiModel || 'gemini-2.5-pro';
        
        // PASSO 1: Análise dos roteiros
        updateAIProgress('Iniciando análise de roteiros...', 1, 'Processando...');
        
        const step1Response = await fetch('/api/ai-agent/analyze', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                scriptsContent,
                agentName,
                userApiKeys: validGeminiKeys,
                model
            }),
            signal: AbortSignal.timeout(90000) // 90 segundos por passo
        });
        
        if (!step1Response.ok) {
            let errorMessage = `HTTP ${step1Response.status}: ${step1Response.statusText}`;
            try {
                const errorData = await step1Response.json();
                errorMessage = errorData.message || errorMessage;
            } catch (parseError) {
                console.error('Erro ao parsear resposta de erro do passo 1:', parseError);
                // Se for HTML (erro 524), mostrar mensagem específica
                if (step1Response.headers.get('content-type')?.includes('text/html')) {
                    errorMessage = 'Timeout no servidor (Erro 524). Tente novamente.';
                }
            }
            throw new Error(`Passo 1 - Análise: ${errorMessage}`);
        }
        
        const step1Data = await step1Response.json();
        if (!step1Data.success) {
            throw new Error(`Passo 1 - Análise: ${step1Data.message}`);
        }
        
        updateAIProgress('Análise concluída, criando template de premissa...', 1, 'Concluído');
        
        // PASSO 2: Criação da premissa
        updateAIProgress('Criando template de premissa...', 2, 'Processando...');
        
        const step2Response = await fetch('/api/ai-agent/premise', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                analysisResult: step1Data.analysisResult,
                agentName,
                userApiKeys: validGeminiKeys,
                model
            }),
            signal: AbortSignal.timeout(90000) // 90 segundos por passo
        });
        
        if (!step2Response.ok) {
            let errorMessage = `HTTP ${step2Response.status}: ${step2Response.statusText}`;
            try {
                const errorData = await step2Response.json();
                errorMessage = errorData.message || errorMessage;
            } catch (parseError) {
                console.error('Erro ao parsear resposta de erro do passo 2:', parseError);
                if (step2Response.headers.get('content-type')?.includes('text/html')) {
                    errorMessage = 'Timeout no servidor (Erro 524). Tente novamente.';
                }
            }
            throw new Error(`Passo 2 - Premissa: ${errorMessage}`);
        }
        
        const step2Data = await step2Response.json();
        if (!step2Data.success) {
            throw new Error(`Passo 2 - Premissa: ${step2Data.message}`);
        }
        
        updateAIProgress('Template de premissa concluído, criando roteiro...', 2, 'Concluído');
        
        // PASSO 3: Criação do roteiro
        updateAIProgress('Criando template de roteiro...', 3, 'Processando...');
        
        const step3Response = await fetch('/api/ai-agent/script', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                analysisResult: step1Data.analysisResult,
                premiseResult: step2Data.premiseResult,
                agentName,
                userApiKeys: validGeminiKeys,
                model
            }),
            signal: AbortSignal.timeout(90000) // 90 segundos por passo
        });
        
        if (!step3Response.ok) {
            let errorMessage = `HTTP ${step3Response.status}: ${step3Response.statusText}`;
            try {
                const errorData = await step3Response.json();
                errorMessage = errorData.message || errorMessage;
            } catch (parseError) {
                console.error('Erro ao parsear resposta de erro do passo 3:', parseError);
                if (step3Response.headers.get('content-type')?.includes('text/html')) {
                    errorMessage = 'Timeout no servidor (Erro 524). Tente novamente.';
                }
            }
            throw new Error(`Passo 3 - Roteiro: ${errorMessage}`);
        }
        
        const step3Data = await step3Response.json();
        if (!step3Data.success) {
            throw new Error(`Passo 3 - Roteiro: ${step3Data.message}`);
        }
        
        updateAIProgress('Template de roteiro concluído, criando blocos...', 3, 'Concluído');
        
        // PASSO 4: Criação da estrutura de blocos (final)
        updateAIProgress('Criando estrutura de blocos...', 4, 'Processando...');
        
        const step4Response = await fetch('/api/ai-agent/blocks', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                analysisResult: step1Data.analysisResult,
                premiseResult: step2Data.premiseResult,
                scriptResult: step3Data.scriptResult,
                agentName,
                userApiKeys: validGeminiKeys,
                model
            }),
            signal: AbortSignal.timeout(90000) // 90 segundos por passo
        });
        
        if (!step4Response.ok) {
            let errorMessage = `HTTP ${step4Response.status}: ${step4Response.statusText}`;
            try {
                const errorData = await step4Response.json();
                errorMessage = errorData.message || errorMessage;
            } catch (parseError) {
                console.error('Erro ao parsear resposta de erro do passo 4:', parseError);
                if (step4Response.headers.get('content-type')?.includes('text/html')) {
                    errorMessage = 'Timeout no servidor (Erro 524). Tente novamente.';
                }
            }
            throw new Error(`Passo 4 - Blocos: ${errorMessage}`);
        }
        
        const step4Data = await step4Response.json();
        if (!step4Data.success) {
            throw new Error(`Passo 4 - Blocos: ${step4Data.message}`);
        }
        
        // Armazenar dados do agente criado
        currentAIAgentData = step4Data.agentData;
        
        // Marcar último passo como concluído
        updateAIProgress('Agente criado com sucesso!', 4, 'Concluído');
        
        // Aguardar um pouco antes de mostrar o preview
        setTimeout(() => {
            showAIPreview(step4Data.agentData);
        }, 2000);
        
    } catch (error) {
        console.error('[AI] Erro completo no processamento:', error);
        console.error('[AI] Stack trace:', error.stack);
        
        // Melhorar mensagem de erro para o usuário
        let userMessage = error.message;
        if (error.message.includes('HTTP 500')) {
            userMessage = 'Erro interno no servidor. Verifique suas API keys e tente novamente.';
        } else if (error.message.includes('HTTP 400')) {
            userMessage = 'Dados inválidos enviados. Verifique o nome do agente e arquivos selecionados.';
        } else if (error.message.includes('HTTP 401')) {
            userMessage = 'Erro de autenticação. Faça login novamente.';
        } else if (error.message.includes('timeout')) {
            userMessage = 'Timeout no processamento. Tente com arquivos menores ou mais tarde.';
        } else if (error.message.includes('524')) {
            userMessage = 'Timeout do servidor. O processamento foi interrompido. Tente novamente.';
        }
        
        throw new Error(userMessage);
    }
}



// Função para atualizar progresso com status dos passos
function updateAIProgress(message, step = null, status = null) {
    // Marcar que processamento está ativo
    aiProcessingInBackground = true;
    
    // Atualizar texto de progresso principal (se existir)
    const progressText = document.getElementById('ai-progress-text');
    if (progressText) {
        progressText.textContent = message;
    }
    
    // Atualizar status de conexão
    const connectionStatus = document.getElementById('ai-connection-status');
    if (connectionStatus) {
        connectionStatus.textContent = message;
    }
    
    // Atualizar indicador flutuante
    const floatingProgress = document.getElementById('ai-floating-progress');
    if (floatingProgress) {
        floatingProgress.textContent = message;
    }
    
    // Atualizar status do passo específico
    if (step && status) {
        const stepElement = document.getElementById(`step${step}-status`);
        if (stepElement) {
            stepElement.textContent = status;
            if (status === 'Concluído') {
                stepElement.className = 'text-green-400 text-sm';
            } else if (status === 'Processando...') {
                stepElement.className = 'text-blue-400 text-sm';
            } else {
                stepElement.className = 'text-gray-400 text-sm';
            }
        }
    }
}

// Função para resetar status dos passos
function resetStepsStatus() {
    for (let i = 1; i <= 4; i++) {
        const stepElement = document.getElementById(`step${i}-status`);
        if (stepElement) {
            stepElement.textContent = 'Aguardando...';
            stepElement.className = 'text-gray-400 text-sm';
        }
    }
}

// Função para mostrar preview do agente
function showAIPreview(agentData) {
    // Parar processamento em background
    aiProcessingInBackground = false;
    
    // Mostrar notificação especial de conclusão
    showCompletionNotification(agentData.name);
    
    // Se estiver minimizado, restaurar modal automaticamente
    if (isAIModalMinimized) {
        maximizeAIModal();
    }
    
    // Esconder processamento, mostrar preview
    document.getElementById('ai-processing-step').classList.add('hidden');
    document.getElementById('ai-preview-step').classList.remove('hidden');
    
    const previewContent = document.getElementById('ai-preview-content');
    previewContent.innerHTML = `
        <div class="space-y-4">
            <div class="bg-gray-700 p-4 rounded-md">
                <h4 class="font-semibold text-white mb-2">Nome do Agente</h4>
                <p class="text-gray-300">${agentData.name}</p>
            </div>
            <div class="bg-gray-700 p-4 rounded-md">
                <h4 class="font-semibold text-white mb-2">Template de Premissa</h4>
                <p class="text-gray-300 text-sm">${agentData.premise_template.substring(0, 200)}...</p>
            </div>
            <div class="bg-gray-700 p-4 rounded-md">
                <h4 class="font-semibold text-white mb-2">Template de Roteiro</h4>
                <p class="text-gray-300 text-sm">${agentData.script_template.substring(0, 200)}...</p>
            </div>
            <div class="bg-gray-700 p-4 rounded-md">
                <h4 class="font-semibold text-white mb-2">Estrutura de Blocos</h4>
                <p class="text-gray-300 text-sm">${agentData.script_structure.substring(0, 200)}...</p>
            </div>
        </div>
    `;
}

// Função para mostrar erro AI
function showAIError(message) {
    // Parar processamento em background
    aiProcessingInBackground = false;
    
    // Se estiver minimizado, restaurar modal automaticamente
    if (isAIModalMinimized) {
        maximizeAIModal();
    }
    
    // Esconder indicador flutuante se estiver visível
    const floatingIndicator = document.getElementById('ai-floating-indicator');
    if (floatingIndicator && !floatingIndicator.classList.contains('hidden')) {
        floatingIndicator.classList.add('hidden');
    }
    
    document.getElementById('ai-processing-step').classList.add('hidden');
    document.getElementById('ai-input-step').classList.remove('hidden');
    
    showAgentSaveFeedback(`Erro na criação com IA: ${message}`, 'error');
}

// Função para reiniciar processo AI
function restartAIProcess() {
    resetAIModal();
}

// Função para editar agente AI
function editAIAgent() {
    if (!currentAIAgentData) return;
    
    // Fechar modal AI
    closeAIModal();
    
    // Abrir modal de edição manual com dados do AI
    openManualAgentWithData(currentAIAgentData);
}

// Função para abrir modal manual com dados pré-preenchidos
function openManualAgentWithData(agentData) {
    // Preencher campos com dados do agente AI
    editingAgentKeyInput.value = '';
    agentNameInput.value = agentData.name;
    agentTypeSelect.value = agentData.type;
    
    premisePromptInput.value = agentData.premise_template;
    scriptPromptInput.value = agentData.script_template;
    scriptStructureInput.value = agentData.script_structure;
    adaptationPromptInput.value = agentData.adaptation_template;
    
    // Configurar idiomas
    primaryLanguageTagContainer.innerHTML = '';
    additionalLanguagesTags.innerHTML = '';
    setPrimaryLanguageTag(agentData.primary_language);
    
    // TTS
    ttsEnabledCheckbox.checked = agentData.tts_enabled;
    ttsConfigContainer.classList.toggle('hidden', !agentData.tts_enabled);
    
    deleteAgentBtn.classList.add('hidden');
    handleAgentTypeChange();
    agentModal.classList.remove('hidden');
}

// Função para salvar agente AI
async function saveAIAgent() {
    if (!currentAIAgentData) return;
    
    try {
        // Usar mesma lógica de salvamento existente
        const newKey = currentAIAgentData.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        
        state.customAgents[newKey] = currentAIAgentData;
        agents[newKey] = currentAIAgentData;
        
        // Salvar no banco
        const { saveCustomAgents } = await import('./api.js');
        await saveCustomAgents(state.customAgents);
        
        showAgentSaveFeedback('Agente criado com IA salvo com sucesso!', 'success');
        
        updateAgentDropdown();
        closeAIModal();
        
        // Limpar dados temporários
        currentAIAgentData = null;
        
    } catch (error) {
        console.error('Erro ao salvar agente AI:', error);
        showAgentSaveFeedback('Erro ao salvar agente: ' + error.message, 'error');
    }
}

// Função para minimizar modal AI
function minimizeAIModal() {
    
    isAIModalMinimized = true;
    
    // Esconder modal
    const aiModal = document.getElementById('ai-agent-modal');
    if (aiModal) {
        aiModal.classList.add('hidden');
    }
    
    // Mostrar indicador flutuante
    const floatingIndicator = document.getElementById('ai-floating-indicator');
    if (floatingIndicator) {
        floatingIndicator.classList.remove('hidden');
    }
    
    // Feedback de minimização removido - sem aviso chato
}

// Função para maximizar modal AI
function maximizeAIModal() {
    if (!isAIModalMinimized) return;
    
    isAIModalMinimized = false;
    
    // Esconder indicador flutuante
    const floatingIndicator = document.getElementById('ai-floating-indicator');
    if (floatingIndicator) {
        floatingIndicator.classList.add('hidden');
    }
    
    // Mostrar modal
    const aiModal = document.getElementById('ai-agent-modal');
    if (aiModal) {
        aiModal.classList.remove('hidden');
    }
}
