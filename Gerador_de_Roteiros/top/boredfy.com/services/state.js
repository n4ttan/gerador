/**
 * state.js
 * * Manages the application's state, including API keys and custom agents.
 * Handles loading from and saving to the browser's localStorage.
 * This replaces the file-system-based storage from the PyWebView version.
 */

import { DEFAULT_AGENTS } from './config.js';

// The main state object for the application.
export const state = {
    apiKeys: [],
    ttsApiKeys: [],
    customAgents: {},
    selectedGeminiModel: 'gemini-2.5-pro-preview-06-05' // Default to pro model
};

// A combined object for all agents (default and custom).
export let agents = {};

/**
 * Saves the current state to the browser's localStorage.
 * It serializes the state object into a JSON string.
 */
export function saveState() {
    try {
        // Collect current API keys from the input fields
        state.apiKeys = Array.from(document.querySelectorAll('.gemini-api-key-input'))
            .map(input => input.value.trim())
            .filter(key => key);
            
        state.ttsApiKeys = Array.from(document.querySelectorAll('.tts-api-key-input'))
            .map(input => input.value.trim())
            .filter(key => key);

        // Get selected model from selector
        const modelSelector = document.getElementById('gemini-model-select');
        if (modelSelector) {
            state.selectedGeminiModel = modelSelector.value;
        }

        const stateToSave = {
            apiKeys: state.apiKeys,
            ttsApiKeys: state.ttsApiKeys,
            selectedGeminiModel: state.selectedGeminiModel
            // Removido customAgents - agora salva apenas no banco de dados
        };
        localStorage.setItem('scriptGeneratorState', JSON.stringify(stateToSave));
        // console.log("State saved to localStorage (API keys only).");
    } catch (error) {
        console.error("Failed to save state to localStorage:", error);
        // Optionally, inform the user that settings could not be saved.
    }
}

/**
 * Loads the state from localStorage.
 * If no saved state is found, it initializes with empty values.
 */
export function loadState() {
    try {
        const savedState = localStorage.getItem('scriptGeneratorState');
        if (savedState) {
            const parsedState = JSON.parse(savedState);
            state.apiKeys = parsedState.apiKeys || [];
            state.ttsApiKeys = parsedState.ttsApiKeys || [];
            state.selectedGeminiModel = parsedState.selectedGeminiModel || 'gemini-2.5-pro-preview-06-05';
            // Removido customAgents - agora carrega apenas do banco de dados
            // console.log("State loaded from localStorage (API keys only).");
        } else {
            // console.log("Nenhum estado salvo encontrado, inicializando com padrões.");
            // Initialize with empty keys if nothing is saved
            state.apiKeys = [];
            state.ttsApiKeys = [];
            state.selectedGeminiModel = 'gemini-2.5-pro-preview-06-05';
        }
    } catch (error) {
        console.error("Failed to load state from localStorage:", error);
        // Reset to a clean state in case of corrupted data
        state.apiKeys = [];
        state.ttsApiKeys = [];
        state.selectedGeminiModel = 'gemini-2.5-pro-preview-06-05';
    }
    // Agentes são carregados apenas do banco de dados
    agents = { ...DEFAULT_AGENTS };
}
