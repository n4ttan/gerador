/**
 * main.js
 * * This is the main entry point for the application.
 */

import { loadState, saveState, state, agents } from "./state.js";
import {
  populateUIFromState,
  addTitleToList,
  updateMainStatus,
  createResultContainer,
  getLanguageDataByName,
  addResultLog,
  createScriptContainerAndGetContentArea,
  showPremise,
  addApiKeyInput,
  getUsableApiKeys,
  hasUsableApiKeys,
  getApiKeyStats,
} from "./ui.js";
import {
  callGenerativeAI,
  generateTTS,
  generateTTSChunkByChunk,
  fetchUrlContent,
  createZipNoBackend,
  createZipFromInlineFiles,
  createOptimizedZip,
  downloadUserFile,
  trackCompleteScript,
  trackCompleteTTS,
} from "./api.js";
import {
  initializeAgentLogic,
  loadAgentsFromDatabase,
  playSuccessSound,
  initAudioContext,
} from "./agentManager.js";
import { GeminiQueueManager } from "./services/geminiQueue.js";
import {
  isAllWorkCompleted,
  startAutoCleanupWatcher,
  stopAutoCleanupWatcher,
  cleanupWorkers,
  stopAllWorkers,
} from "./workerSystem.js";
// Removido: import { auth } from './firebase.js';

// Função utilitária para criar delays
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Função de delay que verifica cancelamento a cada segundo
function cancellableDelay(ms, checkCancellation = true) {
  return new Promise((resolve, reject) => {
    if (!checkCancellation) {
      setTimeout(resolve, ms);
      return;
    }

    let elapsed = 0;
    const interval = 1000; // Verifica a cada 1 segundo

    const timer = setInterval(() => {
      if (isGenerationCancelled) {
        clearInterval(timer);
        reject(new Error("Cancelled"));
        return;
      }

      elapsed += interval;
      if (elapsed >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, interval);
  });
}

// Função para redirecionar para página de login
function redirectToLogin() {
  // Limpa a sessão local antes de redirecionar
  if (window.fingerprintManager) {
    window.fingerprintManager.clearSession();
  }
  window.location.href = "login.html";
}

// Função para verificar sessão e tratar erros de autenticação
async function checkSessionAndHandleErrors() {
  try {
    // Sessão baseada em fingerprint/IP desativada. Apenas verificar se há usuário logado.
    const user = window.auth?.currentUser;
    return !!user;
  } catch (error) {
    console.error("❌ Erro ao verificar sessão:", error);
    redirectToLogin();
    return false;
  }
}

// Intercepta erros de autenticação nas requisições
function setupAPIErrorInterceptor() {
  // Intercepta erros de fetch globalmente
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const response = await originalFetch.apply(this, args);

      // Só intercepta chamadas para nossa API (/api)
      let url = "";
      if (typeof args[0] === "string") {
        url = args[0];
      } else if (args[0] && typeof args[0] === "object" && args[0].url) {
        url = args[0].url;
      }

      const isOurApiCall = (() => {
        try {
          const u = new URL(url, window.location.origin);
          return u.pathname.startsWith("/api");
        } catch (e) {
          return false;
        }
      })();

      // Verifica se é erro de autenticação (apenas para nossa API)
      if (isOurApiCall && response.status === 401) {
        console.log("🔒 Não autenticado - redirecionando para login...");
        redirectToLogin();
        return response;
      }

      return response;
    } catch (error) {
      // Não logar erros de cancelamento intencional
      if (
        error.name !== "AbortError" &&
        !error.message.includes("cancelada pelo usuário")
      ) {
        console.error("❌ Erro na requisição:", error);
      }
      throw error;
    }
  };
}

// Configura interceptor de erros de API
setupAPIErrorInterceptor();

// Inicializa Firebase e checa autenticação ao carregar
window.initializeFirebase().then(async () => {
  window.auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log("❌ Usuário não logado, redirecionando para login...");
      redirectToLogin();
      return;
    }
    if (user) {
      console.log("✅ Usuário logado:", user.email);

      // Sessões desativadas; apenas prosseguir

      try {
        const userDoc = await window.db.collection("users").doc(user.uid).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          const now = new Date();
          let role = userData.role || "free";

          if (role === "premium" && userData.premiumUntil) {
            const premiumUntil = new Date(userData.premiumUntil);
            if (premiumUntil < now) {
              // Premium expirou, faz downgrade para free
              try {
                await window.db.collection("users").doc(user.uid).update({
                  role: "free",
                  premiumUntil: null,
                });
                console.log("⚠️ Premium expirado, usuário rebaixado para free");
              } catch (permErr) {
                console.warn(
                  "⚠️ Sem permissão para atualizar premium no cliente. Continuando como free.",
                  permErr
                );
              }
              role = "free";
            }
          }

          window.currentUserRole = role;
          window.currentUserData = userData;
          console.log("👤 Cargo do usuário:", role);

          // Mostra informações do usuário na interface
          const userInfo = document.getElementById("user-info");
          if (userInfo) {
            userInfo.innerHTML = `
              <div class="flex items-center justify-between">
                <span class="text-sm text-gray-400">
                  <i class="fas fa-user mr-1"></i>${user.email} (${role})
                </span>
                <div class="flex items-center space-x-2">
                  <button 
                    id="stats-btn" 
                    class="text-purple-400 hover:text-purple-300 text-sm transition-colors" 
                    title="Dashboard de Performance"
                  >
                    <i class="fas fa-chart-line mr-1"></i>Stats
                  </button>
                  <button id="logout-btn" class="text-red-400 hover:text-red-300 text-sm">
                    <i class="fas fa-sign-out-alt mr-1"></i>Sair
                  </button>
                </div>
              </div>
            `;

            // Adiciona listener para logout (garante que é o botão recém-criado dentro de #user-info)
            const logoutBtn = userInfo.querySelector("#logout-btn");
            logoutBtn?.addEventListener("click", async () => {
              try {
                // Limpa a sessão local
                if (window.fingerprintManager) {
                  window.fingerprintManager.clearSession();
                }

                await window.auth.signOut();
                console.log("👤 Usuário deslogado");
                // Redireciona para página de login após logout
                window.location.href = "login.html";
              } catch (error) {
                console.error("❌ Erro ao fazer logout:", error);
              }
            });

            // Adiciona listener para o botão de stats
            const statsBtn = userInfo.querySelector("#stats-btn");
            statsBtn?.addEventListener("click", () => {
              if (window.statsManager) {
                window.statsManager.openModal();
              }
            });
          }
        } else {
          console.log("⚠️ Usuário não encontrado no banco, criando perfil...");
          // Cria perfil básico se não existir
          await window.db.collection("users").doc(user.uid).set({
            email: user.email,
            role: "free",
            createdAt: new Date().toISOString(),
          });
          window.currentUserRole = "free";
          window.currentUserData = { email: user.email, role: "free" };
        }

        // Carrega dados do usuário após login
        // console.log("📥 Carregando dados do usuário...");
        await loadUserData();
        console.log("✅ Sistema pronto para uso");
      } catch (error) {
        console.error("❌ Erro ao carregar dados do usuário:", error);
        alert(
          "Erro ao carregar dados do usuário. Tente fazer login novamente."
        );
        await window.auth.signOut();
      }
    } else {
      console.log("👤 Usuário não logado, redirecionando para login");
      redirectToLogin();
      return;
    }
  });
});

// Função global para admin adicionar dias de premium a um usuário
window.setPremium = async function (uid, days) {
  const now = new Date();
  const premiumUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  await window.db.collection("users").doc(uid).update({
    role: "premium",
    premiumUntil: premiumUntil.toISOString(),
  });
};

let generationResults = {};
let lastOrderedTitles = [];
let isGenerationCancelled = false;
let abortController;

// Contador de roteiros processados
let scriptsStats = {
  total: 0,
  successful: 0,
  failed: 0,
};

// Sistema de fila Gemini
window.geminiQueue = null;

// Funções para gerenciar contador de roteiros
function resetScriptsCounter() {
  scriptsStats = { total: 0, successful: 0, failed: 0 };
  updateScriptsCounterUI();
  hideScriptsCounter();
}

function incrementScriptsCounter(isSuccess = true) {
  scriptsStats.total++;
  if (isSuccess) {
    scriptsStats.successful++;
    // OTIMIZAÇÃO: Invalida cache de stats após geração bem-sucedida
    if (window.statsManager) {
      window.statsManager.invalidateCache();
    }
  } else {
    scriptsStats.failed++;
  }
}

function updateScriptsCounterUI() {
  const counterElement = document.getElementById("scripts-counter");
  if (counterElement) {
    const successText = scriptsStats.successful.toString().padStart(2, "0");
    const totalText = scriptsStats.total.toString().padStart(2, "0");

    // Manter o ícone de informação e tooltip e apenas atualizar o texto
    const infoIcon = counterElement.querySelector("i");
    const tooltip = counterElement.querySelector(".tooltip");
    counterElement.innerHTML = `(${successText}/${totalText})`;
    if (infoIcon && tooltip) {
      counterElement.appendChild(infoIcon);
      counterElement.appendChild(tooltip);
    } else {
      // Adicionar ícone e tooltip se não existir
      const newIcon = document.createElement("i");
      newIcon.className =
        "fas fa-info-circle text-xs ml-1 cursor-help tooltip-trigger";
      newIcon.setAttribute("data-tooltip", "Sucessos / Total processados");

      const newTooltip = document.createElement("div");
      newTooltip.className =
        "tooltip absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded shadow-lg opacity-0 pointer-events-none transition-opacity duration-200 whitespace-nowrap z-50";
      newTooltip.textContent = "Sucessos / Total processados";

      counterElement.appendChild(newIcon);
      counterElement.appendChild(newTooltip);
    }
  }
}

function showScriptsCounter() {
  const counterElement = document.getElementById("scripts-counter");
  if (counterElement && scriptsStats.total > 0) {
    updateScriptsCounterUI();
    counterElement.classList.remove("hidden");
  }
}

function hideScriptsCounter() {
  const counterElement = document.getElementById("scripts-counter");
  if (counterElement) {
    counterElement.classList.add("hidden");
  }
}

// Função para buscar e preencher as API Keys do usuário
async function loadApiKeys() {
  const user = firebase.auth().currentUser;
  if (!user) {
    // console.log("Usuário não está logado, pulando carregamento de API Keys");
    return;
  }

  try {
    const token = await user.getIdToken();
    const res = await fetch("/api/get-api-keys", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.success) {
      // Limpa os containers existentes
      const geminiContainer = document.getElementById("gemini-keys-container");
      const ttsContainer = document.getElementById("tts-keys-container");

      if (geminiContainer) {
        geminiContainer.innerHTML = "";
        // Adiciona as chaves Gemini salvas
        if (data.geminiApiKeys && data.geminiApiKeys.length > 0) {
          data.geminiApiKeys.forEach((key) => {
            addApiKeyInput(key, "gemini");
          });
        } else {
          // Adiciona pelo menos um campo vazio
          addApiKeyInput("", "gemini");
        }
      }

      if (ttsContainer) {
        ttsContainer.innerHTML = "";
        // Adiciona as chaves TTS salvas
        if (data.ttsApiKeys && data.ttsApiKeys.length > 0) {
          data.ttsApiKeys.forEach((key) => {
            addApiKeyInput(key, "tts");
          });
        } else {
          // Adiciona pelo menos um campo vazio
          addApiKeyInput("", "tts");
        }
      }

      // console.log("API Keys carregadas com sucesso");
    }
  } catch (error) {
    console.error("Erro ao carregar API Keys:", error);
  }
}

// Função para salvar todas as API Keys
async function saveAllApiKeys() {
  const user = firebase.auth().currentUser;
  if (!user) return;
  const token = await user.getIdToken();

  // Coleta todas as chaves Gemini
  const geminiInputs = document.querySelectorAll(".gemini-api-key-input");
  const geminiApiKeys = Array.from(geminiInputs)
    .map((input) => input.value.trim())
    .filter((key) => key);

  // Coleta todas as chaves TTS
  const ttsInputs = document.querySelectorAll(".tts-api-key-input");
  const ttsApiKeys = Array.from(ttsInputs)
    .map((input) => input.value.trim())
    .filter((key) => key);

  const payload = {
    geminiApiKeys,
    ttsApiKeys,
  };

  try {
    const response = await fetch("/api/save-api-keys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      // Feedback de sucesso removido - sem aviso chato
      // Atualiza contadores
      updateKeyCounters();
    } else {
      throw new Error("Erro na resposta do servidor");
    }
  } catch (error) {
    console.error("Erro ao salvar API Keys:", error);
    showSaveFeedback("Erro ao salvar API Keys", "error");
  }
}

// Debounce para salvar API keys (evita múltiplas requisições)
let saveApiKeysTimeout = null;
function debouncedSaveAllApiKeys() {
  clearTimeout(saveApiKeysTimeout);
  // Salva no localStorage imediatamente (rápido)
  saveState();
  // Salva no Firestore após 2 segundos de inatividade
  saveApiKeysTimeout = setTimeout(() => {
    saveAllApiKeys();
  }, 2000);
}

// Função para mostrar feedback visual
function showSaveFeedback(message, type = "info") {
  // Remove feedback anterior se existir
  const existingFeedback = document.querySelector(".api-key-feedback");
  if (existingFeedback) {
    existingFeedback.remove();
  }

  const feedback = document.createElement("div");
  feedback.className = `api-key-feedback fixed top-4 right-4 p-3 rounded-md text-white z-50 transition-all duration-300 ${
    type === "success"
      ? "bg-green-600"
      : type === "error"
      ? "bg-red-600"
      : "bg-blue-600"
  }`;
  feedback.innerHTML = `
    <i class="fas fa-${
      type === "success" ? "check" : type === "error" ? "exclamation" : "info"
    } mr-2"></i>
    ${message}
  `;

  document.body.appendChild(feedback);

  // Remove após 3 segundos
  setTimeout(() => {
    feedback.style.opacity = "0";
    setTimeout(() => feedback.remove(), 300);
  }, 3000);
}

// Função para atualizar contadores de chaves
function updateKeyCounters() {
  const geminiInputs = document.querySelectorAll(".gemini-api-key-input");
  const ttsInputs = document.querySelectorAll(".tts-api-key-input");

  const geminiActive = Array.from(geminiInputs).filter((input) =>
    input.value.trim()
  ).length;
  const ttsActive = Array.from(ttsInputs).filter((input) =>
    input.value.trim()
  ).length;

  // Obter estatísticas de validação
  const geminiStats = getApiKeyStats("gemini");
  const ttsStats = getApiKeyStats("tts");
  const geminiUsable = geminiStats.valid + geminiStats.warning;
  const ttsUsable = ttsStats.valid + ttsStats.warning;

  // Atualiza contador Gemini
  const geminiHeader = document.querySelector("#gemini-api-section h2");
  if (geminiHeader) {
    const counter = geminiHeader.querySelector(".key-counter");
    let tooltip = "";

    if (geminiActive === 0) {
      tooltip = "Nenhuma API key inserida";
    } else {
      // Construir tooltip apenas com valores > 0
      const statusParts = [];
      if (geminiStats.valid > 0)
        statusParts.push(`${geminiStats.valid} funcionando`);
      if (geminiStats.warning > 0)
        statusParts.push(`${geminiStats.warning} com rate limit`);
      if (geminiStats.invalid > 0)
        statusParts.push(`${geminiStats.invalid} inválidas`);
      if (geminiStats.unvalidated > 0)
        statusParts.push(`${geminiStats.unvalidated} não testadas`);

      if (statusParts.length > 0) {
        tooltip = statusParts.join(", ");
      } else {
        tooltip = "Status das keys indisponível";
      }
    }

    if (counter) {
      counter.textContent = ` (${geminiActive}/${geminiInputs.length})`;
      counter.className = `key-counter text-sm text-gray-400`;
      counter.title = tooltip;
    } else {
      const newCounter = document.createElement("span");
      newCounter.className = `key-counter text-sm text-gray-400`;
      newCounter.textContent = ` (${geminiActive}/${geminiInputs.length})`;
      newCounter.title = tooltip;
      geminiHeader.appendChild(newCounter);
    }
  }

  // Atualiza contador TTS
  const ttsHeader = document.querySelector("#tts-api-section h2");
  if (ttsHeader) {
    const counter = ttsHeader.querySelector(".key-counter");
    let tooltip = "";

    if (ttsActive === 0) {
      tooltip = "Nenhuma API key inserida";
    } else {
      // Construir tooltip apenas com valores > 0
      const statusParts = [];
      if (ttsStats.valid > 0) statusParts.push(`${ttsStats.valid} funcionando`);
      if (ttsStats.warning > 0)
        statusParts.push(`${ttsStats.warning} com rate limit`);
      if (ttsStats.invalid > 0)
        statusParts.push(`${ttsStats.invalid} inválidas`);
      if (ttsStats.unvalidated > 0)
        statusParts.push(`${ttsStats.unvalidated} não testadas`);

      if (statusParts.length > 0) {
        tooltip = statusParts.join(", ");
      } else {
        tooltip = "Status das keys indisponível";
      }
    }

    if (counter) {
      counter.textContent = ` (${ttsActive}/${ttsInputs.length})`;
      counter.className = `key-counter text-sm text-gray-400`;
      counter.title = tooltip;
    } else {
      const newCounter = document.createElement("span");
      newCounter.className = `key-counter text-sm text-gray-400`;
      newCounter.textContent = ` (${ttsActive}/${ttsInputs.length})`;
      newCounter.title = tooltip;
      ttsHeader.appendChild(newCounter);
    }
  }
}

// Listeners são adicionados diretamente em ui.js para evitar duplicação

// Expor funções globalmente
window.saveAllApiKeys = saveAllApiKeys;
window.debouncedSaveAllApiKeys = debouncedSaveAllApiKeys;
window.addApiKeyInput = addApiKeyInput;
window.updateKeyCounters = updateKeyCounters;

// Inicializa a aplicação quando o DOM estiver pronto
if (!window.appInitialized) {
  window.addEventListener("DOMContentLoaded", () => {
    console.log("Aplicação inicializada - aguardando login do usuário");
  });
  window.appInitialized = true;
}

// Função para carregar todos os dados do usuário
async function loadUserData() {
  try {
    // Verifica se o usuário ainda está logado
    const user = firebase.auth().currentUser;
    if (!user) {
      console.log(
        "Usuário não está mais logado, pulando carregamento de dados"
      );
      return;
    }

    console.log("Carregando dados do usuário:", user.email);

    // Carrega dados em paralelo para melhor performance
    await Promise.all([
      loadApiKeys().catch((error) =>
        console.error("Erro ao carregar API Keys:", error)
      ),
      loadAgentsFromDatabase().catch((error) =>
        console.error("Erro ao carregar agentes:", error)
      ),
    ]);

    // Atualiza contadores da interface
    updateKeyCounters();

    console.log("Dados do usuário carregados com sucesso");
  } catch (error) {
    console.error("Erro ao carregar dados do usuário:", error);
  }
}

/**
 * Inicializa o sistema de fila Gemini (funcionamento nos bastidores)
 */
function initializeQueueSystem() {
  // Inicializa apenas o queue manager para funcionar como middleware
  if (!window.geminiQueue) {
    window.geminiQueue = new GeminiQueueManager();
    console.log(
      "🔧 Sistema de fila Gemini inicializado (middleware invisível)"
    );
  }
}

// Função getNextAvailableApiKey antiga removida - duplicada

/**
 * Marca API key como em uso (para evitar sobrecarga)
 */
function markApiKeyInUse(apiKey) {
  if (window.geminiQueue && window.geminiQueue.workers) {
    for (const worker of window.geminiQueue.workers.values()) {
      if (worker.apiKey === apiKey) {
        worker.isAvailable = false;
        setTimeout(() => {
          worker.isAvailable = true;
        }, 5000); // Libera após 5 segundos
        break;
      }
    }
  }
}
document.addEventListener("DOMContentLoaded", () => {
  // Limpar configurações obsoletas
  localStorage.removeItem("autoDownloadEnabled");

  loadState();
  populateUIFromState();
  initializeAgentLogic();
  initializeEventListeners();
  initializeQueueSystem(); // Inicializar sistema de fila
  console.log("Application initialized successfully.");
});

function initializeEventListeners() {
  const generateBtn = document.getElementById("generate-btn");
  const stopBtn = document.getElementById("stop-btn");
  const addTitleBtn = document.getElementById("add-title-btn");
  const newTitleInput = document.getElementById("new-title-input");
  const fileUpload = document.getElementById("file-upload");
  const downloadAllBtn = document.getElementById("download-all-btn");
  const userFilesBtn = document.getElementById("user-files-btn");
  const userFilesModal = document.getElementById("user-files-modal");
  const closeUserFilesModal = document.getElementById("close-user-files-modal");
  const cancelModal = document.getElementById("cancel-modal");
  const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
  const rejectCancelBtn = document.getElementById("reject-cancel-btn");

  generateBtn.addEventListener("click", handleGeneration);
  stopBtn.addEventListener("click", () =>
    cancelModal.classList.remove("hidden")
  );

  addTitleBtn.addEventListener("click", () => {
    addTitleToList(newTitleInput.value);
    newTitleInput.value = "";
  });
  newTitleInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTitleToList(newTitleInput.value);
      newTitleInput.value = "";
    }
  });

  fileUpload.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        e.target.result
          .split("\n")
          .filter((line) => line.trim() !== "")
          .forEach(addTitleToList);
      };
      reader.readAsText(file);
      event.target.value = "";
    }
  });

  confirmCancelBtn.addEventListener("click", () => {
    isGenerationCancelled = true;
    if (abortController) {
      abortController.abort("Geração cancelada pelo usuário");
    }

    // Parar queue imediatamente
    if (window.geminiQueue) {
      window.geminiQueue.stop();
    }
    
    // CRÍTICO: Limpeza imediata quando cancelado
    console.log("🛑 Cancelamento detectado - iniciando limpeza imediata de workers");
    stopAutoCleanupWatcher(); // Para o watcher automático
    
    // Delay mínimo para permitir que workers terminem adequadamente 
    setTimeout(() => {
      console.log("🧹 Executando limpeza manual após cancelamento");
      cleanupWorkers(); // Agora podemos chamar diretamente
    }, 1000); // 1 segundo para permitir paradas graceful

    cancelModal.classList.add("hidden");

    // Atualizar interface imediatamente
    document.getElementById("generate-btn").classList.remove("hidden");
    document.getElementById("stop-btn").classList.add("hidden");
    updateMainStatus("⏹️ Cancelando operação...", "info");
  });
  rejectCancelBtn.addEventListener("click", () =>
    cancelModal.classList.add("hidden")
  );

  downloadAllBtn.addEventListener("click", () =>
    triggerZipDownload(lastOrderedTitles)
  );

  userFilesBtn.addEventListener("click", () => openUserFilesModal());
  closeUserFilesModal.addEventListener("click", () =>
    userFilesModal.classList.add("hidden")
  );

  document.querySelectorAll(".collapsible-header").forEach((header) => {
    header.addEventListener("click", () => {
      const section = header.closest(".space-y-4");
      section.classList.toggle("collapsed");
    });
  });

  document
    .getElementById("add-gemini-key-btn")
    .addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation(); // Evita que o click se propague para o header colapsível
      addApiKeyInput("", "gemini");
      // Não salva automaticamente campo vazio
    });
  document.getElementById("add-tts-key-btn").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation(); // Evita que o click se propague para o header colapsível
    addApiKeyInput("", "tts");
    // Não salva automaticamente campo vazio
  });

  // Listener para mudança do modelo Gemini
  document
    .getElementById("gemini-model-select")
    .addEventListener("change", (e) => {
      e.stopPropagation(); // Evita que o click se propague para o header colapsível
      state.selectedGeminiModel = e.target.value;
      debouncedSaveAllApiKeys(); // Salva a preferência automaticamente
      // Log removido - informação já visível na interface
    });

  // Listener adicional para prevenir propagação no click do select
  document
    .getElementById("gemini-model-select")
    .addEventListener("click", (e) => {
      e.stopPropagation(); // Evita que o click se propague para o header colapsível
    });
}

async function handleGeneration() {
  // Verificar se o usuário está logado
  const user = firebase.auth().currentUser;
  if (!user) {
    alert(
      "❌ Você precisa estar logado para usar o sistema. Faça login primeiro."
    );
    redirectToLogin();
    return;
  }

  // CRÍTICO: Sinalizar que processo multi-etapas está ativo
  window.isProcessActive = true;
  
  isGenerationCancelled = false;
  abortController = new AbortController();
  saveState();
  // Salva também no Firestore ao iniciar geração (garante dados atualizados)
  saveAllApiKeys();

  // === NOVA VALIDAÇÃO DE API KEYS ===
  // Verificar API Keys do Gemini utilizáveis (verde + amarelo)
  const usableGeminiKeys = getUsableApiKeys("gemini");
  const geminiStats = getApiKeyStats("gemini");

  if (!hasUsableApiKeys("gemini")) {
    const message =
      geminiStats.total === 0
        ? "Por favor, insira pelo menos uma Google API Key para o Gemini."
        : `Nenhuma API Key do Gemini está utilizável (${geminiStats.valid} verdes, ${geminiStats.warning} amarelas, ${geminiStats.invalid} vermelhas, ${geminiStats.unvalidated} não validadas).\n\nApenas keys com status verde (✓) ou amarelo (⚠) podem ser utilizadas.`;

    updateMainStatus(message, "error");
    alert(message);
    return;
  }

  // Verificar agente selecionado
  const agentKey = document.getElementById("agent-select").value;
  if (!agentKey) {
    alert("Por favor, escolha um agente.");
    return;
  }
  const agent = agents[agentKey];

  // Verificar API Keys do TTS se necessário
  let usableTtsKeys = [];
  if (agent.type === "pair" && agent.tts_enabled) {
    usableTtsKeys = getUsableApiKeys("tts");
    const ttsStats = getApiKeyStats("tts");

    if (!hasUsableApiKeys("tts")) {
      const message =
        ttsStats.total === 0
          ? "A narração de áudio está habilitada, mas nenhuma API Key para Text-to-Speech foi fornecida."
          : `A narração de áudio está habilitada, mas nenhuma API Key do TTS está utilizável (${ttsStats.valid} verdes, ${ttsStats.warning} amarelas, ${ttsStats.invalid} vermelhas, ${ttsStats.unvalidated} não validadas).\n\nApenas keys com status verde (✓) ou amarelo (⚠) podem ser utilizadas.`;

      updateMainStatus(message, "error");
      alert(message);
      return;
    }
  }

  // Verificar títulos
  const titleItems = Array.from(document.querySelectorAll(".title-item"));
  if (titleItems.length === 0) {
    alert("Por favor, forneça pelo menos um título ou link.");
    return;
  }

  // Mostrar estatísticas das keys que serão utilizadas
  // console.log(
  //   `🔑 Keys do Gemini utilizáveis: ${usableGeminiKeys.length} (${geminiStats.valid} verdes, ${geminiStats.warning} amarelas)`
  // );
  if (agent.type === "pair" && agent.tts_enabled) {
    const ttsStats = getApiKeyStats("tts");
    // console.log(
    //   `🎵 Keys do TTS utilizáveis: ${usableTtsKeys.length} (${ttsStats.valid} verdes, ${ttsStats.warning} amarelas)`
    // );
  }

  // =================================================================================
  // CORREÇÃO: Lógica de limpeza da UI para evitar o erro na segunda geração.
  // =================================================================================
  const resultsArea = document.getElementById("results-area");
  const placeholder = document.getElementById("placeholder");

  // Esconde o placeholder e limpa apenas os resultados anteriores.
  if (placeholder) {
    placeholder.classList.add("hidden");
  }
  resultsArea.querySelectorAll(".result-item").forEach((item) => item.remove());
  // =================================================================================

  document.getElementById("generate-btn").classList.add("hidden");
  document.getElementById("stop-btn").classList.remove("hidden");
  document.getElementById("download-all-btn").classList.add("hidden");
  generationResults = {};
  window.premiseLocks = {}; // Limpar locks da geração anterior
  // console.log("🧹 Iniciando nova geração - locks anteriores limpos");
  lastOrderedTitles = titleItems.map(
    (item) => item.querySelector("span").textContent
  );

  // Resetar contador de roteiros
  resetScriptsCounter();

  // Garantir que o sistema de fila está inicializado
  if (!window.geminiQueue) {
    initializeQueueSystem();
  }

  // Inicializar sistema de fila Gemini com as API keys (funcionará como middleware invisível)
  window.geminiQueue.initializeWorkers(usableGeminiKeys);
  
  // CRÍTICO: Sistema de callbacks POR JOB para evitar interferência
  // Implementa cleanup automático para prevenir memory leaks
  if (!window.jobLogFunctions) {
    window.jobLogFunctions = new Map(); // job ID -> logFunction
    window.jobLogCleanupTimers = new Map(); // job ID -> timer
  } else {
    // Limpa callbacks de gerações anteriores
    window.jobLogFunctions.clear();
    // Limpa timers pendentes
    if (window.jobLogCleanupTimers) {
      window.jobLogCleanupTimers.forEach(timer => clearTimeout(timer));
      window.jobLogCleanupTimers.clear();
    } else {
      window.jobLogCleanupTimers = new Map();
    }
  }
  
  window.geminiQueue.onWorkerStatusChange = (statusData) => {
    const jobId = statusData.jobId;
    
    // Buscar função de log específica para este job
    const jobLogFunction = window.jobLogFunctions.get(jobId);
    
    if (jobLogFunction) {
      const msg = statusData.message;
      
      // LOGS ORIGINAIS RESTAURADOS:
      if (statusData.status === 'attempting') {
        // ⚙️ TaskName: Tentativa X/5...
        jobLogFunction(msg, 'info');
      }
      else if (statusData.status === 'error') {
        // ❌ TaskName: Tentativa X falhou (erro).
        jobLogFunction(msg, 'error');
      }
      else if (statusData.status === 'waiting') {
        // ⏳ Aguardando X segundos...
        jobLogFunction(msg, 'info');
      }
      else if (statusData.status === 'success') {
        // ✅ TaskName gerado com sucesso!
        jobLogFunction(msg, 'success');
      }
      // LOGS NOVOS DE FAILOVER:
      else if (statusData.status === 'cooldown') {
        jobLogFunction(`🔄 Tentativa falhou, buscando próxima API key...`, 'info');
      }
      else if (statusData.status === 'error' && statusData.message.includes('liberado para outro worker')) {
        jobLogFunction(`🔄 Tentando com outro worker...`, 'info');
      }
    }
    // Log de callback sem função registrada removido para produção
  };
  
  // CRÍTICO: Iniciar processamento da fila
  // console.log(`🚀 Iniciando processamento da fila Gemini com ${usableGeminiKeys.length} workers`);
  window.geminiQueue.start();
  
  // CRÍTICO: Iniciar sistema de auto-limpeza inteligente
  startAutoCleanupWatcher();
  try {
    const selectedMode = document.querySelector(
      'input[name="generation-mode"]:checked'
    ).value;
    if (agent.type !== selectedMode) {
      throw new Error(
        "O agente selecionado não corresponde à modalidade de geração ativa."
      );
    }

    if (agent.type === "pair") {
      await runPremiseGenerationProcess(
        agent,
        titleItems,
        usableGeminiKeys,
        usableTtsKeys
      );
    } else {
      updateMainStatus(
        "O modo Clássico ainda não foi implementado nesta versão modular.",
        "error"
      );
    }
  } catch (e) {
    if (e.name !== "AbortError" && e.message !== "Cancelled") {
      console.error("Critical error during generation:", e);
      updateMainStatus(`ERRO CRÍTICO: ${e.message}`, "error");
    }
  } finally {
    // CRÍTICO: Sinalizar que processo multi-etapas terminou
    window.isProcessActive = false;
    
    // Limpar workers após cancelamento/conclusão
    if (window.geminiQueue) {
      if (window.geminiQueue.workers) {
        window.geminiQueue.workers.forEach(worker => {
          worker.currentJob = null;
          worker.isAvailable = true;
        });
      }
      
      if (window.geminiQueue.queue) {
        window.geminiQueue.queue = [];
      }
      
      // CORREÇÃO: usar 'processing' ao invés de 'activeJobs'
      if (window.geminiQueue.processing) {
        window.geminiQueue.processing.clear();
      }
      
      // console.log("🧹 Workers limpos após finalização/cancelamento");
    }
    
    // Limpar locks se cancelado
    if (isGenerationCancelled) {
      window.premiseLocks = {};
      // console.log("🧹 Locks limpos após cancelamento");
    }
    
    document.getElementById("generate-btn").classList.remove("hidden");
    document.getElementById("stop-btn").classList.add("hidden");
    if (isGenerationCancelled) {
      updateMainStatus("Operação cancelada pelo usuário.", "info");
    } else {
      updateMainStatus("Processo Finalizado!", "success");
      if (Object.keys(generationResults).length > 0) {
        // Tocar som de conclusão quando roteiros são gerados com sucesso
        playSuccessSound();
        document.getElementById("download-all-btn").classList.remove("hidden");

        // AUTO-ADICIONAR aos "Meus Arquivos" quando processamento finalizar
        try {
          await addGeneratedFilesToMyFiles();
        } catch (error) {
          console.error("Erro ao adicionar arquivos automaticamente:", error);
          // Não interrompe o fluxo principal se isso falhar
        }
      }

      // Mostrar contador de roteiros processados após finalização
      showScriptsCounter();
    }
  }
}

async function runPremiseGenerationProcess(
  agent,
  titleItems,
  apiKeys,
  ttsApiKeys
) {
  const primaryLang = getLanguageDataByName(agent.primary_language);
  if (!primaryLang)
    throw new Error("Idioma principal não configurado ou inválido no agente.");

  const additionalLangs = (agent.additional_languages || [])
    .map(getLanguageDataByName)
    .filter(Boolean);
  const uniqueLangs = new Map();
  [primaryLang, ...additionalLangs].forEach((lang) => {
    if (lang) uniqueLangs.set(lang.id, lang);
  });
  const languagesToGenerate = Array.from(uniqueLangs.values());

  updateMainStatus("Fase 1/4: Preparando conteúdo...");
  const contentTasks = [];
  for (const titleItem of titleItems) {
    if (isGenerationCancelled) throw new Error("Cancelled");
    const rawTitle = titleItem.querySelector("span").textContent;
    let contentForAgent = rawTitle;
    let titleForDisplay = rawTitle;

    if (rawTitle.startsWith("http")) {
      updateMainStatus(`Buscando conteúdo do link: ${rawTitle}...`, "info");
      try {
        const response = await fetchUrlContent(rawTitle);
        if (isGenerationCancelled) throw new Error("Cancelled");
        if (response.success && response.text) {
          contentForAgent = response.text;
          titleForDisplay = `Notícia: ${rawTitle.substring(0, 50)}...`;
          updateMainStatus(
            `Conteúdo de "${rawTitle.substring(0, 30)}..." obtido.`,
            "success"
          );
        } else {
          throw new Error(
            response.error || "A extração de texto retornou vazia."
          );
        }
      } catch (e) {
        if (e.message === "Cancelled") throw e;
        updateMainStatus(
          `Falha ao ler o link (backend de extração indisponível). Usando o link como texto.`,
          "error"
        );
        contentForAgent = rawTitle;
      }
    }
    contentTasks.push({
      title: rawTitle,
      displayTitle: titleForDisplay,
      content: contentForAgent,
    });
  }

  // Mostrar qual modelo está sendo usado
  const modelDisplayName =
    state.selectedGeminiModel === "gemini-2.5-flash" ? "2.5-Flash" : "2.5-Pro";
  updateMainStatus(
    `Fase 2A/4: Gerando premissas primárias... (Modelo: ${modelDisplayName})`
  );
  const primaryPremises = {};

  // Criar containers para todas as combinações task+language (serão reutilizados na Fase 3)
  const containerMap = new Map();
  for (const task of contentTasks) {
    for (const lang of languagesToGenerate) {
      const resultContainer = createResultContainer(
        task.displayTitle,
        lang.name
      );
      containerMap.set(`${task.title}-${lang.id}`, resultContainer);
    }
  }

  // Processar premissas com FILA DINÂMICA - cada API key trabalha independentemente
  const premiseResults = [];
  const premiseTaskQueue = [...contentTasks];
  let premiseTaskIndex = 0;

  // Criar workers independentes que não se bloqueiam
  const premiseWorkers = apiKeys.map((apiKey) => {
    const worker = async () => {
      while (premiseTaskIndex < contentTasks.length) {
        if (isGenerationCancelled) break;

        // Pegar próxima tarefa da fila
        const currentIndex = premiseTaskIndex++;
        if (currentIndex >= contentTasks.length) break;

        const task = contentTasks[currentIndex];
        const resultContainer = containerMap.get(
          `${task.title}-${primaryLang.id}`
        );

        try {
          const result = await processSinglePremise({
            task,
            agent,
            primaryLang,
            apiKey,
            resultContainer,
          });

          if (result && result.success) {
            showPremise(resultContainer, result.premise, primaryLang.name);
          }
          premiseResults.push(result);
        } catch (error) {
          premiseResults.push({
            taskTitle: task.title,
            premise: `[ERRO AO GERAR PREMISSA: ${error.message}]`,
            success: false,
          });
        }
      }
    };

    return worker();
  });

  // Aguardar todos os workers terminarem (quando não há mais tarefas)
  if (isGenerationCancelled) return;
  await Promise.all(premiseWorkers);

  // Armazenar resultados no formato esperado
  let failedPremises = 0;
  let cancelledPremises = 0;
  for (const result of premiseResults) {
    if (result) {
      primaryPremises[result.taskTitle] = result.premise;
      if (!result.success) {
        if (result.cancelled) {
          cancelledPremises++;
        } else {
          failedPremises++;
        }
      }
    }
  }

  // Feedback final da fase de premissas
  if (cancelledPremises > 0 && failedPremises === 0) {
    // Só cancelamentos, não é erro
    updateMainStatus("⏹️ Operação cancelada pelo usuário.", "info");
    return; // Para a execução aqui
  } else if (failedPremises > 0) {
    updateMainStatus(
      `⚠️ Fase 2A/4: Premissas primárias concluídas (${failedPremises}/${contentTasks.length} falharam)`,
      "error"
    );
    console.warn(
      `⚠️ ${failedPremises} de ${contentTasks.length} premissas falharam. Scripts afetados serão cancelados.`
    );
  } else {
    updateMainStatus(
      "✅ Fase 2A/4: Todas as premissas primárias geradas com sucesso!",
      "success"
    );
  }

  // NOVA FASE 2B: Adaptações de premissas para idiomas secundários
  updateMainStatus(
    "Fase 2B/4: Adaptando premissas para idiomas secundários..."
  );

  // Armazenar todas as premissas (primárias + adaptadas)
  const allPremises = {};

  // Inicializar estrutura completa para evitar race conditions
  for (const task of contentTasks) {
    allPremises[task.title] = {};
    // Inicializar todas as línguas com null primeiro
    for (const lang of languagesToGenerate) {
      allPremises[task.title][lang.id] = null;
    }
    // Depois setar a primária
    allPremises[task.title][primaryLang.id] = primaryPremises[task.title];
    // console.log(`🔧 Estrutura inicializada: ${task.title} para ${languagesToGenerate.length} línguas`);
  }

  // Identificar idiomas secundários que precisam de adaptação
  const secondaryLanguages = languagesToGenerate.filter(
    (lang) => lang.id !== primaryLang.id
  );

  if (secondaryLanguages.length > 0) {
    // Criar tarefas de adaptação para todos os idiomas secundários
    const adaptationTasks = [];
    for (const task of contentTasks) {
      for (const lang of secondaryLanguages) {
        // Pular se a premissa primária falhou
        if (
          primaryPremises[task.title] &&
          !primaryPremises[task.title].startsWith("[ERRO AO GERAR PREMISSA:")
        ) {
          adaptationTasks.push({
            originalTask: task,
            targetLang: lang,
            basePremise: primaryPremises[task.title],
            resultContainer: containerMap.get(`${task.title}-${lang.id}`),
          });
        }
      }
    }

    // Processar adaptações com FILA DINÂMICA - cada API key trabalha independentemente
    let adaptationTaskIndex = 0;

    const adaptationWorkers = apiKeys.map((apiKey) => {
      const worker = async () => {
        while (adaptationTaskIndex < adaptationTasks.length) {
          if (isGenerationCancelled) break;

          // Pegar próxima tarefa da fila
          const currentIndex = adaptationTaskIndex++;
          if (currentIndex >= adaptationTasks.length) break;

          const adaptTask = adaptationTasks[currentIndex];

          try {
            const result = await processAdaptationPremise({
              ...adaptTask,
              agent,
              apiKey,
            });

            if (result && result.success) {
              // SISTEMA DE LOCKS: Verificar se não está sendo processado simultaneamente
              const targetKey = `${adaptTask.originalTask.title}-${adaptTask.targetLang.id}`;
              if (window.premiseLocks && window.premiseLocks[targetKey]) {
                console.warn(`🔒 Premissa já sendo processada simultaneamente: ${targetKey}, ignorando duplicata`);
                return;
              }
              window.premiseLocks = window.premiseLocks || {};
              window.premiseLocks[targetKey] = true;
              
              // Garantir que a estrutura existe
              if (!allPremises[adaptTask.originalTask.title]) {
                allPremises[adaptTask.originalTask.title] = {};
              }
              
              // LOG para debug da race condition
              const existingValue = allPremises[adaptTask.originalTask.title][adaptTask.targetLang.id];
              if (existingValue) {
                console.warn(`⚠️ SOBRESCREVENDO premissa existente para ${adaptTask.originalTask.title} - ${adaptTask.targetLang.id}`);
                console.warn(`⚠️ Valor anterior (${existingValue.length} chars): ${existingValue.substring(0,50)}...`);
                console.warn(`⚠️ Novo valor (${result.adaptedPremise.length} chars): ${result.adaptedPremise.substring(0,50)}...`);
              }
              
              // Salvar com identificação única
              allPremises[adaptTask.originalTask.title][adaptTask.targetLang.id] = result.adaptedPremise;
              
              // Log de confirmação com mais detalhes
              // console.log(`✅ Premissa salva: ${adaptTask.originalTask.title} - ${adaptTask.targetLang.id} (${result.adaptedPremise.length} chars: ${result.adaptedPremise.substring(0,30)}...)`);
              
              showPremise(
                adaptTask.resultContainer,
                result.adaptedPremise,
                adaptTask.targetLang.name
              );
              
              // Liberar lock
              delete window.premiseLocks[targetKey];
            }
          } catch (error) {
            console.error("Erro na adaptação:", error);
          }
        }
      };

      return worker();
    });

    // Aguardar todos os workers de adaptação terminarem
    if (isGenerationCancelled) return;
    await Promise.all(adaptationWorkers);
  }

  if (isGenerationCancelled) return;
  updateMainStatus(
    `Fase 3/4: Gerando roteiros... (Modelo: ${modelDisplayName})`
  );

  // Processar roteiros em LOTES baseado no número de API keys disponíveis
  const allScriptTasks = [];
  for (const task of contentTasks) {
    for (const lang of languagesToGenerate) {
      // Reutilizar container existente criado na Fase 2
      const resultContainer = containerMap.get(`${task.title}-${lang.id}`);
      // Usar premissa específica do idioma (primária ou adaptada)
      const premiseForLang =
        allPremises[task.title] && allPremises[task.title][lang.id]
          ? allPremises[task.title][lang.id]
          : primaryPremises[task.title];

      // Log detalhado para debug
      // console.log(`📖 Lendo premissa: ${task.title} - ${lang.id} = ${premiseForLang ? premiseForLang.substring(0,30) : 'FALLBACK'}...`);

      allScriptTasks.push({
        originalTitleKey: task.title,
        displayTitle: task.displayTitle,
        lang: { ...lang },        // FIX: Cópia do objeto para evitar compartilhamento entre workers
        agent: { ...agent },      // FIX: Cópia do objeto para evitar compartilhamento entre workers
        resultContainer,
        basePremiseText: premiseForLang,
      });
      // console.log(`📋 TASK CRIADA: ${task.displayTitle} | Língua: ${lang.name} (${lang.id}) | Premissa: ${premiseForLang ? premiseForLang.substring(0, 50) + '...' : 'NENHUMA'} | Hash: ${premiseForLang ? premiseForLang.length : 0}`);
      // Log adicional para detecção de mistura de idiomas
      if (premiseForLang && premiseForLang.includes('Μια') && lang.id !== 'el-GR') {
        console.error(`🚨 ALERTA: Premissa em GREGO detectada para ${lang.id}! Título: ${task.displayTitle}`);
      }
      if (premiseForLang && premiseForLang.includes('João Pereira') && lang.id !== 'pt-BR') {
        console.error(`🚨 ALERTA: Premissa em PORTUGUÊS detectada para ${lang.id}! Título: ${task.displayTitle}`);
      }
    }
  }

  // Processar scripts com FILA DINÂMICA - cada API key trabalha independentemente
  let scriptTaskIndex = 0;
  const taskMutex = new Set(); // Controlar tasks já atribuídas
  
  // Função atômica para pegar próxima task (evita race condition)
  const getNextScriptTask = () => {
    for (let i = scriptTaskIndex; i < allScriptTasks.length; i++) {
      const taskId = `${allScriptTasks[i].originalTitleKey}-${allScriptTasks[i].lang.id}`;
      if (!taskMutex.has(taskId)) {
        taskMutex.add(taskId);
        scriptTaskIndex = Math.max(scriptTaskIndex, i + 1);
        return { task: allScriptTasks[i], index: i, taskId };
      }
    }
    return null;
  };

  const scriptWorkers = apiKeys.map((apiKey) => {
    const worker = async () => {
      while (scriptTaskIndex < allScriptTasks.length) {
        if (isGenerationCancelled) break;

        // Operação atômica para pegar próxima task
        const taskResult = getNextScriptTask();
        if (!taskResult) break;
        
        const { task: scriptTask, taskId } = taskResult;

        try {
          await processSingleScript({
            ...scriptTask,
            apiKey,
          });
        } catch (error) {
          console.error("Erro no script:", error);
        } finally {
          // Remover do mutex quando terminar (sucesso ou erro)
          taskMutex.delete(taskId);
        }
      }
    };

    return worker();
  });

  // Aguardar todos os workers de script terminarem
  if (isGenerationCancelled) return;
  await Promise.all(scriptWorkers);

  // CRÍTICO: Parar todos os workers imediatamente após roteiros terminarem
  // console.log('✅ Todos os roteiros concluídos - parando workers para prevenir memory leak');
  stopAllWorkers();
  cleanupWorkers();

  if (agent.tts_enabled) {
    updateMainStatus("Fase 4/4: Gerando narrações de áudio...");
    // NOTE: Object.values() funciona com as novas chaves únicas (título-idioma)
    const audioQueue = Object.values(generationResults)
      .flat()
      .filter((r) => r.script);

    // Processar áudios SEQUENCIALMENTE com delay para evitar sobrecarga do servidor
    for (let i = 0; i < audioQueue.length; i++) {
      if (isGenerationCancelled) break;

      updateMainStatus(
        `Fase 4/4: Gerando narrações de áudio... (${i + 1}/${
          audioQueue.length
        })`
      );
      await processSingleAudio(audioQueue[i], agent, ttsApiKeys, i);

      // Adicionar delay de 20 segundos entre requisições (exceto na última)
      if (i < audioQueue.length - 1) {
        updateMainStatus(`Aguardando 20 segundos antes do próximo áudio...`);
        await cancellableDelay(20000);
      }
    }
  }
}

/**
 * Aguarda um job específico ser completado na fila
 */
async function waitForJobCompletion(jobId, resultContainer, logFunction = null, taskName = '') {
  return new Promise((resolve, reject) => {
    // PROTEÇÃO: Verificar se há muitos jobs na memória (failsafe)
    if (window.jobLogFunctions && window.jobLogFunctions.size > 500) {
      // Limpar os 100 mais antigos como emergência
      const entries = Array.from(window.jobLogFunctions.entries());
      entries.slice(0, 100).forEach(([id]) => {
        window.jobLogFunctions.delete(id);
        const timer = window.jobLogCleanupTimers.get(id);
        if (timer) {
          clearTimeout(timer);
          window.jobLogCleanupTimers.delete(id);
        }
      });
      console.warn("⚠️ Limpeza de emergência: muitos jobs na memória");
    }
    const checkInterval = 1000; // Verifica a cada 1 segundo
    const maxWait = 300000; // Timeout de 5 minutos
    const startTime = Date.now();
    let lastLoggedAttempt = 0;

    // LOG INICIAL apenas debug console
    // console.log(`⏳ Aguardando completamento do job: ${jobId}`);
    
    // CRÍTICO: Registrar função de log específica para este job
    if (logFunction) {
      window.jobLogFunctions.set(jobId, logFunction);
      
      // Adicionar cleanup automático com timeout de segurança (10 minutos)
      const cleanupTimer = setTimeout(() => {
        if (window.jobLogFunctions.has(jobId)) {
          console.log(`🧹 Cleanup automático do job ${jobId} após timeout`);
          window.jobLogFunctions.delete(jobId);
        }
        if (window.jobLogCleanupTimers.has(jobId)) {
          window.jobLogCleanupTimers.delete(jobId);
        }
      }, 600000); // 10 minutos
      
      window.jobLogCleanupTimers.set(jobId, cleanupTimer);
    }
    
    // Verificar se a fila está rodando
    if (!window.geminiQueue || !window.geminiQueue.isRunning) {
      console.error(`❌ GeminiQueue não está rodando! isRunning: ${window.geminiQueue?.isRunning}`);
      if (logFunction) {
        logFunction('❌ Sistema de fila não está ativo', 'error');
      }
      reject(new Error('Sistema de fila não está ativo'));
      return;
    }

    const checkJob = () => {
      if (Date.now() - startTime > maxWait) {
        console.error(`⏰ Timeout aguardando job ${jobId} após ${Math.round((Date.now() - startTime) / 1000)}s`);
        if (logFunction) {
          logFunction('⏰ Timeout - processamento demorou mais que 5 minutos', 'error');
        }
        
        // Limpar função de log específica deste job e cancelar timer
        window.jobLogFunctions.delete(jobId);
        if (window.jobLogCleanupTimers?.has(jobId)) {
          clearTimeout(window.jobLogCleanupTimers.get(jobId));
          window.jobLogCleanupTimers.delete(jobId);
        }
        
        reject(new Error('Timeout aguardando processamento do job'));
        return;
      }

      // LOG periódico apenas no console (sem UI)
      const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
      if (elapsedSeconds > 0 && elapsedSeconds % 10 === 0) { // A cada 10 segundos
        const status = window.geminiQueue.getStatus();
        // console.log(`📊 Status fila: ${status.processing} processando, ${status.queue} na fila, ${status.completed} completados`);
      }

      // Verificar se job foi completado
      const completedJobs = window.geminiQueue.getCompletedResults();
      const completedJob = completedJobs.find(job => job.id === jobId);
      
      if (completedJob) {
        // console.log(`✅ Job ${jobId} completado com sucesso`);
        
        // Limpar função de log específica deste job e cancelar timer
        window.jobLogFunctions.delete(jobId);
        if (window.jobLogCleanupTimers?.has(jobId)) {
          clearTimeout(window.jobLogCleanupTimers.get(jobId));
          window.jobLogCleanupTimers.delete(jobId);
        }
        
        resolve(completedJob.result);
        return;
      }

      // Verificar se job falhou
      const failedJobs = window.geminiQueue.getFailedJobs();
      const failedJob = failedJobs.find(job => job.id === jobId);
      
      if (failedJob) {
        console.error(`❌ Job ${jobId} falhou: ${failedJob.error}`);
        if (logFunction) {
          logFunction(`❌ Falha no processamento: ${failedJob.error}`, 'error');
        }
        
        // Limpar função de log específica deste job e cancelar timer
        window.jobLogFunctions.delete(jobId);
        if (window.jobLogCleanupTimers?.has(jobId)) {
          clearTimeout(window.jobLogCleanupTimers.get(jobId));
          window.jobLogCleanupTimers.delete(jobId);
        }
        
        reject(new Error(failedJob.error));
        return;
      }

      // Continuar aguardando
      setTimeout(checkJob, checkInterval);
    };

    checkJob();
  });
}

async function processSinglePremise(premiseTask) {
  if (isGenerationCancelled) return;

  const { task, agent, primaryLang, apiKey, resultContainer } = premiseTask;
  const premisePrompt = `${agent.premise_template}\n\nGERAR PREMISSA NO IDIOMA: ${primaryLang.name}\n\nCONTEÚDO-BASE:\n${task.content}`;

  try {
    addResultLog(
      resultContainer,
      `🔄 Gerando premissa para "${task.displayTitle}"...`
    );

    // USAR O SISTEMA DE WORKERS CORRETO
    if (!window.geminiQueue) {
      throw new Error('Sistema de fila não inicializado');
    }

    // Adicionar job à fila e aguardar resultado
    const jobIds = window.geminiQueue.addJobs([{
      title: `Premissa para "${task.displayTitle}"`,
      prompt: premisePrompt,
      metadata: { type: 'premise', taskTitle: task.title, isPremise: true }
    }]);

    // Aguardar processamento
    const premiseResult = await waitForJobCompletion(jobIds[0], resultContainer, (msg, type) => addResultLog(resultContainer, msg, type), `Premissa para "${task.displayTitle}"`);

    const modelDisplayName =
      state.selectedGeminiModel === "gemini-2.5-flash"
        ? "2.5-Flash"
        : "2.5-Pro";
    addResultLog(
      resultContainer,
      `✅ Premissa gerada com sucesso! (${modelDisplayName})`,
      "success"
    );

    return {
      taskTitle: task.title,
      premise: premiseResult,
      success: true,
    };
  } catch (error) {
    if (error.name === "AbortError" || error.message === "Cancelled") {
      addResultLog(
        resultContainer,
        `⏹️ Geração cancelada pelo usuário`,
        "info"
      );
      return {
        taskTitle: task.title,
        premise: `[CANCELADO PELO USUÁRIO]`,
        success: false,
        cancelled: true,
      };
    }

    addResultLog(
      resultContainer,
      `❌ Falha na geração da premissa: ${error.message}`,
      "error"
    );

    return {
      taskTitle: task.title,
      premise: `[ERRO AO GERAR PREMISSA: ${error.message}]`,
      success: false,
    };
  }
}

async function processAdaptationPremise(adaptTask) {
  if (isGenerationCancelled) return;

  const {
    originalTask,
    targetLang,
    basePremise,
    agent,
    apiKey,
    resultContainer,
  } = adaptTask;

  try {
    addResultLog(
      resultContainer,
      `🔄 Adaptando premissa para ${targetLang.name}...`
    );

    const adaptationPrompt = `${agent.adaptation_template}\n\nPREMISSA ORIGINAL (PARA ADAPTAR):\n${basePremise}\n\nADAPTAR PARA O IDIOMA E CULTURA DE: ${targetLang.name}`;

    // USAR O SISTEMA DE WORKERS CORRETO
    if (!window.geminiQueue) {
      throw new Error('Sistema de fila não inicializado');
    }

    // Adicionar job à fila e aguardar resultado
    const jobIds = window.geminiQueue.addJobs([{
      title: `Adaptação para ${targetLang.name}`,
      prompt: adaptationPrompt,
      metadata: { type: 'adaptation', targetLang: targetLang.name, isPremise: true }
    }]);

    // Aguardar processamento
    let adaptedPremise = await waitForJobCompletion(jobIds[0], resultContainer, (msg, type) => addResultLog(resultContainer, msg, type), `Adaptação para ${targetLang.name}`);

    // CRÍTICO: Limpar prefixos anti-cache que possam ter vazado
    if (adaptedPremise) {
      adaptedPremise = adaptedPremise.replace(/^Hello,?\s*I'm\s*\d+\s*-\s*/gi, '');
      adaptedPremise = adaptedPremise.replace(/^ignore this prefix.*?-\s*/gi, '');
      adaptedPremise = adaptedPremise.replace(/^\\.+\\s*/g, ''); // Remover pontos extras
      adaptedPremise = adaptedPremise.trim();
      // console.log(`🧹 Prefixos removidos da premissa adaptada para ${targetLang.name}`);
    }

    const modelDisplayName =
      state.selectedGeminiModel === "gemini-2.5-flash"
        ? "2.5-Flash"
        : "2.5-Pro";
    addResultLog(
      resultContainer,
      `✅ Premissa adaptada para ${targetLang.name}! (${modelDisplayName})`,
      "success"
    );

    return {
      success: true,
      adaptedPremise: adaptedPremise,
    };
  } catch (error) {
    if (error.name === "AbortError" || error.message === "Cancelled") {
      addResultLog(
        resultContainer,
        `⏹️ Adaptação cancelada pelo usuário`,
        "info"
      );
      return {
        success: false,
        adaptedPremise: `[CANCELADO PELO USUÁRIO]`,
        cancelled: true,
      };
    }

    addResultLog(
      resultContainer,
      `❌ Falha na adaptação para ${targetLang.name}: ${error.message}`,
      "error"
    );

    return {
      success: false,
      adaptedPremise: `[ERRO AO ADAPTAR PREMISSA: ${error.message}]`,
    };
  }
}

async function processSingleScript(task) {
  // DEBUGGING: Criar ID único para rastrear este processo
  const taskId = `${task.originalTitleKey}-${task.lang.id}-${Date.now()}`;
  // console.log(`🔵 INICIANDO SCRIPT [${taskId}]: ${task.displayTitle} | Língua: ${task.lang.name} (${task.lang.id})`);
  
  if (isGenerationCancelled) return;
  
  // DEEP COPY para garantir isolamento total entre workers paralelos
  const isolatedTask = {
    ...task,
    lang: JSON.parse(JSON.stringify(task.lang)),
    agent: JSON.parse(JSON.stringify(task.agent))
  };
  
  const {
    resultContainer,
    lang,
    agent,
    basePremiseText,
    apiKey,
    displayTitle,
    originalTitleKey,
  } = isolatedTask;
  
  // console.log(`🔷 PROCESSANDO [${taskId}]: lang.name=${lang.name}, lang.id=${lang.id}, premissa=${basePremiseText ? basePremiseText.substring(0, 30) + '...' : 'NENHUMA'}`);

  try {
    // Validar se a premissa contém erro antes de usar
    if (
      basePremiseText &&
      basePremiseText.startsWith("[ERRO AO GERAR PREMISSA:")
    ) {
      const errorMessage = basePremiseText.substring(
        "[ERRO AO GERAR PREMISSA: ".length,
        basePremiseText.length - 1
      );
      addResultLog(
        resultContainer,
        `❌ Premissa falhou: ${errorMessage}`,
        "error"
      );
      addResultLog(
        resultContainer,
        "⚠️ Geração de roteiro cancelada devido a falha na premissa",
        "error"
      );
      return {
        title: displayTitle,
        language: lang.name,
        script: null,
        premise: basePremiseText,
        error: "Premissa não foi gerada corretamente",
      };
    }

    // Usar premissa que já foi preparada na Fase 2B
    let premiseForScript = basePremiseText;

    const parseBlockStructure = (structureText) => {
      if (!structureText) return [];
      return structureText
        .split(/[\r\n]*#/g)
        .filter(Boolean)
        .map((block) => {
          const [nome, ...instrucaoParts] = block.split("\n");
          return {
            nome: nome.trim(),
            instrucao: instrucaoParts.join("\n").trim(),
          };
        });
    };
    const blocos = parseBlockStructure(agent.script_structure);
    if (blocos.length === 0)
      throw new Error("Nenhuma estrutura de blocos definida no agente.");

    let roteiroCompleto = "";

    const scriptContentArea = createScriptContainerAndGetContentArea(
      resultContainer,
      lang.name
    );

    for (const bloco of blocos) {
      if (isGenerationCancelled) throw new Error("Cancelled");
      
      // console.log(`📝 GERANDO BLOCO [${taskId}]: '${bloco.nome}' em ${lang.name} | Contexto atual: ${roteiroCompleto.length} chars`);
      
      const promptDoBloco = `[INSTRUÇÃO DE IDIOMA - CRÍTICO E OBRIGATÓRIO]\nO TEXTO PARA ESTE BLOCO DEVE SER GERADO OBRIGATORIAMENTE NO IDIOMA: ${
        lang.name
      }\n\n[PROMPT MESTRE DO ROTEIRISTA]\n${
        agent.script_template
      }\n\n[CONTEXTO DA HISTÓRIA ATÉ AGORA]\n${
        roteiroCompleto || "Este é o primeiro bloco."
      }\n\n[TAREFA ATUAL E ESPECÍFICA]\n# ${bloco.nome}\n${
        bloco.instrucao
      }\n\nUse a PREMISSA a seguir (que está em ${
        lang.name
      }) como base para toda a história:\n--- PREMISSA ---\n${premiseForScript}\n--- FIM DA PREMISSA ---\n\nEscreva APENAS o texto para o bloco '${
        bloco.nome
      }' no idioma ${lang.name}.`;

      // USAR O SISTEMA DE WORKERS CORRETO
      if (!window.geminiQueue) {
        throw new Error('Sistema de fila não inicializado');
      }
      
      const jobIds = window.geminiQueue.addJobs([{
        title: `Bloco '${bloco.nome}' para "${task.displayTitle}"`,
        prompt: promptDoBloco,
        metadata: { type: 'script-block', blockName: bloco.nome, taskTitle: task.title, isBlockOfScript: true }
      }]);
      
      const textoDoBloco = await waitForJobCompletion(jobIds[0], resultContainer, (msg, type) => addResultLog(resultContainer, msg, type), `Bloco '${bloco.nome}'`);
      // console.log(`✅ BLOCO CONCLUÍDO [${taskId}]: '${bloco.nome}' | Texto gerado: ${textoDoBloco.length} chars | Língua mantida: ${lang.name}`);
      roteiroCompleto += (roteiroCompleto ? "\n\n" : "") + textoDoBloco;
      scriptContentArea.textContent = roteiroCompleto;
    }

    // FIX: Usar chave única que inclui o idioma para evitar mistura entre workers
    const uniqueKey = `${originalTitleKey}-${lang.id}`;
    // console.log(`💾 SALVANDO RESULTADO: ${uniqueKey} | Língua: ${lang.name} | Script length: ${roteiroCompleto.length}`);
    
    // FIX RACE CONDITION: Verificar duplicatas por taskId antes de adicionar
    if (!generationResults[uniqueKey])
      generationResults[uniqueKey] = [];
    
    // Verificar se já existe resultado com mesmo taskId para evitar duplicação
    const existingResult = generationResults[uniqueKey].find(result => result.taskId === taskId);
    if (!existingResult) {
      // Salvar textos no servidor para aparecerem em "Meus Arquivos"
      let premiseServerPath = null;
      let scriptServerPath = null;
      
      try {
        // Salvar premissa no servidor se existir
        if (premiseForScript && premiseForScript.trim()) {
          const premiseResponse = await fetch(`${BACKEND_URL}/save-generated-content`, {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({
              type: 'premise',
              content: premiseForScript,
              metadata: {
                filename: `premissa_${lang.id}_${Date.now()}.txt`,
                language: lang.id
              }
            }),
          });
          
          if (premiseResponse.ok) {
            const premiseData = await premiseResponse.json();
            premiseServerPath = premiseData.serverPath;
            // console.log(`💾 Premissa salva no servidor: ${premiseServerPath}`);
          } else {
            const errorData = await premiseResponse.json().catch(() => ({ message: 'Erro desconhecido' }));
            console.error(`❌ Erro ao salvar premissa: ${premiseResponse.status} - ${errorData.message}`);
          }
        }
        
        // Salvar script no servidor
        if (roteiroCompleto && roteiroCompleto.trim()) {
          const scriptResponse = await fetch(`${BACKEND_URL}/save-generated-content`, {
            method: "POST",
            headers: await getAuthHeaders(),
            body: JSON.stringify({
              type: 'script',
              content: roteiroCompleto,
              metadata: {
                filename: `roteiro_${lang.id}_${Date.now()}.txt`,
                language: lang.id
              }
            }),
          });
          
          if (scriptResponse.ok) {
            const scriptData = await scriptResponse.json();
            scriptServerPath = scriptData.serverPath;
            // console.log(`💾 Script salvo no servidor: ${scriptServerPath}`);
          } else {
            const errorData = await scriptResponse.json().catch(() => ({ message: 'Erro desconhecido' }));
            console.error(`❌ Erro ao salvar script: ${scriptResponse.status} - ${errorData.message}`);
          }
        }
      } catch (error) {
        console.error("❌ Erro ao salvar textos no servidor:", error);
      }
      
      generationResults[uniqueKey].push({
        taskId,
        lang,
        premise: premiseForScript,
        script: roteiroCompleto,
        premiseServerPath, // NOVO: Referência do arquivo no servidor
        scriptServerPath,  // NOVO: Referência do arquivo no servidor
        resultContainer,
      });
    } else {
      console.log(`⚠️ RESULTADO DUPLICADO EVITADO: ${uniqueKey} | TaskId: ${taskId} já existe`);
    }

    // Track roteiro completo (uma única vez por roteiro)
    try {
      const scriptJobId = `script_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      await trackCompleteScript({
        jobId: scriptJobId,
        model: state.selectedGeminiModel || "gemini-2.5-pro-preview-06-05",
        language: lang.name,
        totalBlocks: blocos.length,
        scriptLength: roteiroCompleto.length,
        premiseLength: premiseForScript ? premiseForScript.length : 0,
        title: task.title || "Roteiro Gerado",
      });
      const modelDisplayName = state.selectedGeminiModel === "gemini-2.5-flash" ? "2.5-Flash" : "2.5-Pro";
      addResultLog(
        resultContainer,
        `✅ Roteiro completo gerado com sucesso! (${blocos.length} blocos - ${modelDisplayName})`,
        "success"
      );
    } catch (error) {
      console.warn("Falha ao registrar roteiro completo:", error);
      // Não interrompe o fluxo se tracking falhar
    }

    // Incrementar contador - roteiro processado com sucesso
    incrementScriptsCounter(true);
  } catch (error) {
    if (error.name !== "AbortError" && error.message !== "Cancelled") {
      console.error(
        `Error processing script for "${displayTitle}" [${lang.name}]:`,
        error
      );
      addResultLog(resultContainer, `❌ ERRO GERAL: ${error.message}`, "error");

      // Incrementar contador - roteiro processado com erro
      incrementScriptsCounter(false);
    }
  }
}

async function processSingleAudio(result, agent, ttsApiKeys, index) {
  if (isGenerationCancelled || !result.script) return;
  const { resultContainer, lang, script } = result;

  const voiceId = agent.tts_voices?.[lang.name];
  if (!voiceId) {
    addResultLog(
      resultContainer,
      `Voz não configurada para ${lang.name}. Áudio não gerado.`,
      "error"
    );
    return;
  }

  addResultLog(
    resultContainer,
    `🎵 Iniciando geração de áudio em ${lang.name}...`
  );
  addResultLog(
    resultContainer,
    `🔑 Processamento paralelo com ${ttsApiKeys.length} API keys simultâneas`
  );

  const maxRetries = 3; // Reduzir tentativas já que agora cada chunk é mais confiável
  let tentativa = 1;

  while (tentativa <= maxRetries) {
    if (isGenerationCancelled) return;

    try {
      const textChunks = splitTextIntoChunks(script);
      const totalBatches = Math.ceil(textChunks.length / ttsApiKeys.length);

      addResultLog(
        resultContainer,
        `📝 Texto dividido em ${
          textChunks.length
        } pedaços para processamento (${Math.min(
          ttsApiKeys.length,
          textChunks.length
        )} por vez - números de API do Text-to-speech)`
      );
      addResultLog(
        resultContainer,
        `📊 Estratégia: ${totalBatches} lotes de processamento com ${ttsApiKeys.length} APIs simultâneas`
      );
      addResultLog(
        resultContainer,
        `🔑 APIs em uso: ${ttsApiKeys
          .map((key) => key.substring(0, 10) + "...")
          .join(", ")}`
      );

      addResultLog(
        resultContainer,
        `🚀 Tentativa ${tentativa}/${maxRetries} - Iniciando processamento...`
      );

      // Usar nova função que processa chunks em paralelo baseado no número de API keys
      const response = await generateTTSChunkByChunk(
        textChunks,
        lang.id,
        voiceId,
        ttsApiKeys,
        resultContainer,
        addResultLog
      );

      if (isGenerationCancelled) return;

      if (response.success) {
        // SISTEMA NOVO: APENAS serverPath (sem fallbacks)
        if (response.serverPath) {
          result.serverPath = response.serverPath;
          result.fileId = response.fileId;
          // console.log(`💾 Áudio salvo no servidor: ${response.serverPath} (${(response.size/1024/1024).toFixed(1)}MB}`);
        } else {
          throw new Error('Sistema de salvamento no servidor falhou - serverPath não retornado');
        }

        // Track TTS completo com duração REAL por SOMA de chunks
        try {
          if (response.jobIds && response.jobIds.length > 0) {
            const totalTextLength = textChunks
              .map((chunk) => chunk.length)
              .reduce((a, b) => a + b, 0);

            await trackCompleteTTS({
              jobIds: response.jobIds, // Array com todos os jobIds
              textLength: totalTextLength,
              totalChunks: response.chunks_processed || textChunks.length,
            });

            addResultLog(
              resultContainer,
              `📊 TTS completo registrado com duração real!`,
              "success"
            );
          }
        } catch (error) {
          console.warn("Falha ao registrar TTS completo:", error);
          // Não interrompe o fluxo se tracking falhar
        }

        addResultLog(
          resultContainer,
          `🎉 Áudio em ${lang.name} gerado com sucesso!`,
          "success"
        );
        return; // Sucesso, sair do loop
      } else {
        throw new Error(response.message || "Falha na geração de áudio");
      }
    } catch (error) {
      if (isGenerationCancelled) return;

      addResultLog(
        resultContainer,
        `❌ Erro na tentativa ${tentativa}/${maxRetries} para ${lang.name}: ${error.message}`,
        "warning"
      );
      tentativa++;

      if (tentativa <= maxRetries) {
        addResultLog(
          resultContainer,
          `⏳ Aguardando 5 segundos antes da próxima tentativa...`
        );
        await cancellableDelay(5000);
      } else {
        addResultLog(
          resultContainer,
          `💥 Falha permanente no áudio para ${lang.name} após ${maxRetries} tentativas: ${error.message}`,
          "error"
        );
      }
    }
  }
}

async function callGenerativeAIWithRetry(
  apiKey,
  userPrompt,
  logFunction,
  taskName,
  isPremise = false,
  isBlockOfScript = false
) {
  const retries = 5;
  const delay = 30000; // Aumentado para 30 segundos entre tentativas
  for (let i = 1; i <= retries; i++) {
    if (isGenerationCancelled) throw new Error("Cancelled");
    try {
      logFunction(`⚙️ ${taskName}: Tentativa ${i}/${retries}...`);
      const result = await callGenerativeAI(
        apiKey,
        userPrompt,
        abortController.signal,
        isPremise,
        isBlockOfScript
      );
      if (result && result.trim() !== "") {
        // Registrar sucesso no worker correspondente
        if (window.geminiQueue && window.geminiQueue.workers) {
          for (const worker of window.geminiQueue.workers.values()) {
            if (worker.apiKey === apiKey) {
              worker.stats.successful++;
              worker.failureCount = 0; // Reset contador de falhas
              break;
            }
          }
        }
        logFunction(`✅ ${taskName} gerado com sucesso!`, "success");
        return result;
      }
      logFunction(
        `⚠️ ${taskName}: Tentativa ${i} falhou (resposta vazia).`,
        "error"
      );
      // Adicionar delay também para respostas vazias
      if (i < retries) {
        logFunction(`⏳ Aguardando ${delay / 1000} segundos...`);
        await cancellableDelay(delay);
      }
    } catch (error) {
      if (error.name === "AbortError" || error.message === "Cancelled") {
        throw new Error("Cancelled");
      }

      // Registrar falha no worker correspondente
      if (window.geminiQueue && window.geminiQueue.workers) {
        for (const worker of window.geminiQueue.workers.values()) {
          if (worker.apiKey === apiKey) {
            worker.failureCount++;
            if (worker.failureCount >= 3) {
              worker.cooldownUntil = new Date(Date.now() + 60000); // 1 minuto cooldown
            }
            break;
          }
        }
      }
      // Tratamento específico para erros de autenticação
      if (
        error.message.includes("não autenticado") ||
        error.message.includes("401")
      ) {
        logFunction(
          `❌ ERRO: Usuário não está logado. Faça login primeiro.`,
          "error"
        );
        throw new Error("Usuário não autenticado. Faça login para continuar.");
      }

      logFunction(
        `❌ ${taskName}: Tentativa ${i} falhou (${error.message}).`,
        "error"
      );
      if (i < retries) {
        logFunction(`⏳ Aguardando ${delay / 1000} segundos...`);
        await cancellableDelay(delay);
      } else {
        throw error;
      }
    }
  }
  throw new Error(
    `A geração de '${taskName}' falhou após ${retries} tentativas.`
  );
}

/**
 * Verifica se um erro justifica tentativa de failover para outra API key
 */
function isErrorEligibleForFailover(errorMessage) {
  const message = errorMessage.toLowerCase();

  // Tipos de erro que justificam failover:
  return (
    // Após múltiplas tentativas (lógica original)
    message.includes("falhou após") ||
    // Problemas com API key ou autorização - failover imediato
    message.includes("api key") ||
    message.includes("unauthorized") ||
    message.includes("invalid key") ||
    message.includes("forbidden") ||
    message.includes("authentication") ||
    // Problemas de quota ou rate limiting - failover imediato
    message.includes("resposta vazia") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("limite atingido") ||
    message.includes("filtro aplicado") ||
    // Problemas de conectividade que podem ser resolvidos com outra key/endpoint
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("connection") ||
    // Erros específicos da API Gemini
    message.includes("safety") ||
    message.includes("blocked") ||
    message.includes("candidate") ||
    // Erros de servidor que podem ser temporários
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("internal server error")
  );
}

/**
 * Verifica se um erro deve acionar failover imediatamente (sem 5 tentativas)
 */
function shouldFailoverImmediately(errorMessage) {
  const message = errorMessage.toLowerCase();

  return (
    // Erros que não se resolvem com retry - trocar key imediatamente
    message.includes("api key") ||
    message.includes("unauthorized") ||
    message.includes("invalid key") ||
    message.includes("forbidden") ||
    message.includes("authentication") ||
    message.includes("resposta vazia") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("limite atingido") ||
    message.includes("filtro aplicado")
  );
}

/**
 * Categoriza o tipo de erro para debug
 */
function categorizeError(errorMessage) {
  const message = errorMessage.toLowerCase();

  if (message.includes("falhou após")) return "RETRY_EXHAUSTED";
  if (message.includes("api key") || message.includes("unauthorized"))
    return "AUTH_ERROR";
  if (message.includes("resposta vazia") || message.includes("quota"))
    return "QUOTA_ERROR";
  if (message.includes("rate limit") || message.includes("429"))
    return "RATE_LIMIT";
  if (message.includes("timeout") || message.includes("network"))
    return "NETWORK_ERROR";
  if (message.includes("safety") || message.includes("blocked"))
    return "SAFETY_FILTER";
  if (message.includes("500") || message.includes("502")) return "SERVER_ERROR";
  return "OTHER";
}

/**
 * Busca próxima API key disponível no sistema de workers
 */
function getNextAvailableApiKeyFromWorkers(triedKeys) {
  if (!window.geminiQueue) {
    return null;
  }

  const allWorkers = Array.from(window.geminiQueue.workers.values());

  // Primeiro: buscar worker pronto para trabalhar que não foi tentado
  for (const worker of allWorkers) {
    if (!triedKeys.has(worker.apiKey) && worker.isReadyForWork()) {
      console.log(
        `🔍 [DEBUG FAILOVER] Worker encontrado (pronto): ${
          worker.id
        } - Status: ${worker.getStatus()}`
      );
      return worker.apiKey;
    }
  }

  // Segundo: buscar worker ativo que não foi tentado (mesmo se em cooldown)
  for (const worker of allWorkers) {
    if (!triedKeys.has(worker.apiKey) && worker.isActive) {
      console.log(
        `🔍 [DEBUG FAILOVER] Worker encontrado (ativo): ${
          worker.id
        } - Status: ${worker.getStatus()}`
      );
      return worker.apiKey;
    }
  }

  console.log(`❌ [DEBUG FAILOVER] Nenhum worker disponível encontrado`);
  return null;
}

async function callGenerativeAIWithRetryWithFailover(
  apiKey,
  userPrompt,
  logFunction,
  taskName,
  isPremise = false,
  isBlockOfScript = false
) {
  // DEBUG: Estado inicial para investigar problema de espera
  console.log('🚀 [FAILOVER DEBUG] Iniciando failover:', {
    taskName: taskName.length > 50 ? taskName.substring(0, 50) + '...' : taskName,
    totalWorkers: window.geminiQueue?.workers?.size || 0,
    initialApiKey: apiKey ? apiKey.substring(0, 8) + '...' : 'null'
  });
  
  const maxFailoverAttempts = 3; // Máximo 3 tentativas de failover
  let currentApiKey = apiKey;
  let failoverAttempts = 0;
  let triedKeys = new Set([apiKey]); // Rastrear keys já tentadas

  while (failoverAttempts <= maxFailoverAttempts) {
    try {
      // Tentar com a API key atual
      return await callGenerativeAIWithRetry(
        currentApiKey,
        userPrompt,
        logFunction,
        taskName,
        isPremise,
        isBlockOfScript
      );
    } catch (error) {
      // Verificar se é um erro que justifica failover
      const isFailoverEligible = isErrorEligibleForFailover(error.message);
      const shouldImmediate = shouldFailoverImmediately(error.message);
      const errorCategory = categorizeError(error.message);

      // Se é um erro válido para failover e ainda temos tentativas
      if (
        isFailoverEligible &&
        window.geminiQueue &&
        failoverAttempts < maxFailoverAttempts
      ) {
        logFunction(
          `🔄 Tentativa ${
            failoverAttempts + 1
          } falhou, buscando próxima API key...`,
          "info"
        );

        // Buscar próxima API key disponível que não foi tentada ainda
        let availableApiKey = null;
        const allWorkers = Array.from(window.geminiQueue.workers.values());

        // Primeiro, tentar achar uma key disponível que não foi testada
        for (const worker of allWorkers) {
          if (!triedKeys.has(worker.apiKey) && worker.isReadyForWork()) {
            availableApiKey = worker.apiKey;
            break;
          }
        }

        // Se não encontrou, tentar achar qualquer key diferente que não foi testada
        if (!availableApiKey) {
          for (const worker of allWorkers) {
            if (!triedKeys.has(worker.apiKey) && worker.isActive) {
              availableApiKey = worker.apiKey;
              break;
            }
          }
        }

        if (availableApiKey) {
          triedKeys.add(availableApiKey); // Marcar como tentada
          logFunction(
            `🔄 Trocando para API key ${failoverAttempts + 2}...`,
            "info"
          );

          // Verificar se a API key encontrada está em cooldown
          const targetWorker = allWorkers.find(
            (w) => w.apiKey === availableApiKey
          );

          if (
            targetWorker &&
            targetWorker.cooldownUntil &&
            new Date() < targetWorker.cooldownUntil
          ) {
            const remainingMs =
              targetWorker.cooldownUntil.getTime() - new Date().getTime();
            const remainingSeconds = Math.ceil(remainingMs / 1000);
            logFunction(
              `⏳ Aguardando ${remainingSeconds}s para worker ficar disponível...`,
              "info"
            );
            await new Promise((resolve) =>
              setTimeout(resolve, remainingMs + 1000)
            ); // +1s de margem
          } else {
            // Aplicar cooldown padrão de 60s para dar tempo da API "descansar"
            logFunction(
              `⏳ Aplicando cooldown de 60 segundos antes da troca...`,
              "info"
            );
            await new Promise((resolve) => setTimeout(resolve, 60000));
          }

          currentApiKey = availableApiKey;
          failoverAttempts++;
          continue; // Tentar novamente com nova API key
        } else {
          // DEBUG: Investigar por que não está esperando
          console.log('🔍 [FAILOVER DEBUG] Investigando workers no failover:');
          console.log('- Total workers encontrados:', allWorkers.length);
          console.log('- Tried keys:', Array.from(triedKeys));
          
          allWorkers.forEach((worker, index) => {
            const isActiveBool = worker.isActive;
            const notTriedBool = !triedKeys.has(worker.apiKey);
            const combinedBool = isActiveBool && notTriedBool;
            
            console.log(`- Worker ${index + 1}:`, {
              id: worker.id,
              apiKey: worker.apiKey ? worker.apiKey.substring(0, 8) + '...' : 'null',
              isActive: isActiveBool,
              notTried: notTriedBool,
              shouldBeEligible: combinedBool,
              isReadyForWork: worker.isReadyForWork ? worker.isReadyForWork() : 'N/A',
              cooldownUntil: worker.cooldownUntil
            });
          });
          
          // Verificar se existem workers ativos (mas ocupados)
          const hasActiveWorkers = allWorkers.some(worker => 
            worker.isActive && !triedKeys.has(worker.apiKey)
          );
          
          console.log('🔍 [FAILOVER DEBUG] Resultado da verificação hasActiveWorkers:', hasActiveWorkers);
          
          if (hasActiveWorkers) {
            // Workers existem mas estão ocupados - aguardar
            logFunction(
              `🕐 Todas as API keys estão ocupadas, aguardando worker disponível... (tentativa ${failoverAttempts + 1})`,
              "info"
            );
            
            // Aguardar 30 segundos e tentar novamente
            await new Promise(resolve => setTimeout(resolve, 30000));
            
            // Resetar tentativas para essa rodada específica
            failoverAttempts--; // Compensa o incremento que virá
            continue; // Tentar novamente
          } else {
            logFunction(
              `❌ Todas as API keys foram testadas - falha definitiva`,
              "error"
            );
            break; // Sair do loop
          }
        }
      } else {
        break; // Sair do loop
      }
    }
  }

  // Se chegou aqui, todas as tentativas falharam
  const finalError = new Error(
    `Todas as ${triedKeys.size} API keys falharam após ${
      failoverAttempts + 1
    } tentativas para '${taskName}'`
  );
  throw finalError;
}

/**
 * Obtém uma API key disponível do queue manager
 */
function getAvailableApiKey() {
  if (!window.geminiQueue || !window.geminiQueue.workers) {
    throw new Error("Queue manager não está inicializado");
  }

  // Buscar por um worker disponível
  for (const worker of window.geminiQueue.workers.values()) {
    if (worker.isReadyForWork()) {
      return worker.apiKey;
    }
  }

  // Se nenhum worker está disponível, usar o primeiro disponível
  const firstWorker = window.geminiQueue.workers.values().next().value;
  if (firstWorker) {
    return firstWorker.apiKey;
  }

  throw new Error("Nenhuma API key disponível no queue manager");
}

/**
 * Obtém próxima API key disponível diferente da que falhou
 */
function getFailoverApiKey(failedApiKey) {
  if (!window.geminiQueue || !window.geminiQueue.workers) {
    return null;
  }

  const allWorkers = Array.from(window.geminiQueue.workers.values());

  // PRIMEIRA PRIORIDADE: Buscar worker disponível que não seja o que falhou
  for (const worker of allWorkers) {
    if (worker.apiKey !== failedApiKey && worker.isReadyForWork()) {
      return worker.apiKey;
    }
  }

  // SEGUNDA PRIORIDADE: Se nenhum está ready, buscar qualquer um diferente (mesmo em cooldown)
  for (const worker of allWorkers) {
    if (worker.apiKey !== failedApiKey && worker.isActive) {
      return worker.apiKey;
    }
  }

  return null;
}

/**
 * Processa jobs usando o sistema de queue com redistribuição automática
 */
async function processJobsWithQueue(queueManager, jobs) {
  return new Promise((resolve, reject) => {
    const results = [];
    let completedJobs = 0;

    // Configurar callbacks do queue
    const originalOnJobComplete = queueManager.onJobComplete;
    const originalOnJobFailed = queueManager.onJobFailed;

    queueManager.onJobComplete = (job, result) => {
      // Adicionar logs detalhados no container correspondente
      if (job.metadata.resultContainer && addResultLog) {
        addResultLog(
          job.metadata.resultContainer,
          `✅ ${job.title} gerado com sucesso! (${result.attempts} tentativas)`,
          "success"
        );
        addResultLog(
          job.metadata.resultContainer,
          `⚙️ Processado com API key: ${result.workerId}`,
          "info"
        );

        // Se é uma premissa, mostrá-la na interface
        if (
          job.metadata.type === "premise" &&
          result.result &&
          job.metadata.agent
        ) {
          const langData = getLanguageDataByName(
            job.metadata.agent.primary_language
          );
          showPremise(
            job.metadata.resultContainer,
            result.result,
            langData.name
          );
        }
      }

      results.push({
        success: true,
        result: result.result,
        metadata: job.metadata,
        jobId: job.id,
        attempts: result.attempts,
      });

      completedJobs++;

      // Verificar se todos os jobs foram processados
      if (completedJobs === jobs.length) {
        // Restaurar callbacks originais
        queueManager.onJobComplete = originalOnJobComplete;
        queueManager.onJobFailed = originalOnJobFailed;
        resolve(results);
      }

      // Chamar callback original se existir
      if (originalOnJobComplete) {
        originalOnJobComplete(job, result);
      }
    };

    queueManager.onJobFailed = (job, result) => {
      // Adicionar logs no container correspondente
      if (job.metadata.resultContainer && addResultLog) {
        addResultLog(
          job.metadata.resultContainer,
          `❌ Falha em ${job.title}: ${result.error}`,
          "error"
        );
      }

      results.push({
        success: false,
        error: result.error,
        metadata: job.metadata,
        jobId: job.id,
        attempts: result.attempts,
      });

      completedJobs++;

      // Verificar se todos os jobs foram processados
      if (completedJobs === jobs.length) {
        // Restaurar callbacks originais
        queueManager.onJobComplete = originalOnJobComplete;
        queueManager.onJobFailed = originalOnJobFailed;
        resolve(results);
      }

      // Chamar callback original se existir
      if (originalOnJobFailed) {
        originalOnJobFailed(job, result);
      }
    };

    // Adicionar jobs à fila e iniciar processamento
    try {
      queueManager.addJobs(jobs);
      queueManager.start();
    } catch (error) {
      // Restaurar callbacks originais em caso de erro
      queueManager.onJobComplete = originalOnJobComplete;
      queueManager.onJobFailed = originalOnJobFailed;
      reject(error);
    }
  });
}

/**
 * Processa jobs de script usando o queue com lógica específica para scripts multi-bloco
 */
async function processScriptJobsWithQueue(queueManager, scriptJobs) {
  return new Promise((resolve, reject) => {
    const results = [];
    let completedJobs = 0;

    // Configurar callbacks do queue
    const originalOnJobComplete = queueManager.onJobComplete;
    const originalOnJobFailed = queueManager.onJobFailed;

    queueManager.onJobComplete = async (job, result) => {
      try {
        // Processar script completo com múltiplos blocos
        const scriptResult = await processCompleteScript(
          job.metadata,
          result.result
        );

        results.push({
          success: scriptResult.success,
          result: scriptResult.script,
          metadata: job.metadata,
          jobId: job.id,
          attempts: result.attempts,
        });
      } catch (error) {
        addResultLog(
          job.metadata.resultContainer,
          `❌ Erro no processamento do script: ${error.message}`,
          "error"
        );
        results.push({
          success: false,
          error: error.message,
          metadata: job.metadata,
          jobId: job.id,
          attempts: result.attempts,
        });
      }

      completedJobs++;

      // Verificar se todos os jobs foram processados
      if (completedJobs === scriptJobs.length) {
        // Restaurar callbacks originais
        queueManager.onJobComplete = originalOnJobComplete;
        queueManager.onJobFailed = originalOnJobFailed;
        resolve(results);
      }

      // Chamar callback original se existir
      if (originalOnJobComplete) {
        originalOnJobComplete(job, result);
      }
    };

    queueManager.onJobFailed = (job, result) => {
      // Adicionar logs no container correspondente
      if (job.metadata.resultContainer && addResultLog) {
        addResultLog(
          job.metadata.resultContainer,
          `❌ Falha em ${job.title}: ${result.error}`,
          "error"
        );
      }

      results.push({
        success: false,
        error: result.error,
        metadata: job.metadata,
        jobId: job.id,
        attempts: result.attempts,
      });

      completedJobs++;

      // Verificar se todos os jobs foram processados
      if (completedJobs === scriptJobs.length) {
        // Restaurar callbacks originais
        queueManager.onJobComplete = originalOnJobComplete;
        queueManager.onJobFailed = originalOnJobFailed;
        resolve(results);
      }

      // Chamar callback original se existir
      if (originalOnJobFailed) {
        originalOnJobFailed(job, result);
      }
    };

    // Processar cada script job individualmente (devido à complexidade dos blocos)
    try {
      // Converter scriptJobs em jobs para o queue, processando a lógica de script
      const processedJobs = scriptJobs.map((scriptJob) => {
        return processScriptJobLogic(scriptJob);
      });

      Promise.all(processedJobs)
        .then((jobs) => {
          queueManager.addJobs(jobs);
          queueManager.start();
        })
        .catch(reject);
    } catch (error) {
      // Restaurar callbacks originais em caso de erro
      queueManager.onJobComplete = originalOnJobComplete;
      queueManager.onJobFailed = originalOnJobFailed;
      reject(error);
    }
  });
}

/**
 * Processa a lógica específica de um job de script
 */
async function processScriptJobLogic(scriptJob) {
  const { metadata } = scriptJob;
  const { lang, agent, basePremiseText, resultContainer } = metadata;

  // Determinar se precisa fazer adaptação da premissa
  const primaryLang = getLanguageDataByName(agent.primary_language);
  const isPrimaryLang = lang.id === primaryLang.id;

  let premiseForScript = basePremiseText;

  if (!isPrimaryLang) {
    // Criar job de adaptação da premissa
    const adaptationPrompt = `${agent.adaptation_template}\n\nPREMISSA ORIGINAL (PARA ADAPTAR):\n${basePremiseText}\n\nADAPTAR PARA O IDIOMA E CULTURA DE: ${lang.name}`;

    return {
      title: `Adaptação + Roteiro ${lang.name}`,
      prompt: adaptationPrompt,
      metadata: {
        ...metadata,
        requiresFullScript: true,
        premiseForScript: basePremiseText,
      },
    };
  } else {
    // Idioma primário - premissa já foi mostrada na Fase 2
    // Job direto para geração do script
    return {
      title: `Roteiro ${lang.name}`,
      prompt: "FULL_SCRIPT_GENERATION",
      metadata: {
        ...metadata,
        requiresFullScript: true,
        premiseForScript,
        isPrimaryLanguage: true,
      },
    };
  }
}

/**
 * Processa o script completo após receber resultado do queue
 */
async function processCompleteScript(metadata, queueResult) {
  const {
    lang,
    agent,
    resultContainer,
    originalTitleKey,
    requiresFullScript,
    premiseForScript,
  } = metadata;

  try {
    let finalPremise = premiseForScript;

    // Se o resultado é uma adaptação de premissa, usá-la e mostrá-la
    if (queueResult && !queueResult.includes("FULL_SCRIPT_GENERATION")) {
      finalPremise = queueResult;
      // Só mostrar premissa se for adaptação (não é idioma primário)
      if (!metadata.isPrimaryLanguage) {
        showPremise(resultContainer, finalPremise, lang.name);
      }
    }

    // Agora gerar o script completo por blocos
    const parseBlockStructure = (structureText) => {
      if (!structureText) return [];
      return structureText
        .split(/[\r\n]*#/g)
        .filter(Boolean)
        .map((block) => {
          const [nome, ...instrucaoParts] = block.split("\n");
          return {
            nome: nome.trim(),
            instrucao: instrucaoParts.join("\n").trim(),
          };
        });
    };

    const blocos = parseBlockStructure(agent.script_structure);
    if (blocos.length === 0) {
      throw new Error("Nenhuma estrutura de blocos definida no agente.");
    }

    let roteiroCompleto = "";
    const scriptContentArea = createScriptContainerAndGetContentArea(
      resultContainer,
      lang.name
    );

    // Gerar cada bloco sequencialmente usando o queue
    for (const bloco of blocos) {
      if (isGenerationCancelled) throw new Error("Cancelled");

      const promptDoBloco = `[INSTRUÇÃO DE IDIOMA - CRÍTICO E OBRIGATÓRIO]\nO TEXTO PARA ESTE BLOCO DEVE SER GERADO OBRIGATORIAMENTE NO IDIOMA: ${
        lang.name
      }\n\n[PROMPT MESTRE DO ROTEIRISTA]\n${
        agent.script_template
      }\n\n[CONTEXTO DA HISTÓRIA ATÉ AGORA]\n${
        roteiroCompleto || "Este é o primeiro bloco."
      }\n\n[TAREFA ATUAL E ESPECÍFICA]\n# ${bloco.nome}\n${
        bloco.instrucao
      }\n\nUse a PREMISSA a seguir (que está em ${
        lang.name
      }) como base para toda a história:\n--- PREMISSA ---\n${finalPremise}\n--- FIM DA PREMISSA ---\n\nEscreva APENAS o texto para o bloco '${
        bloco.nome
      }' no idioma ${lang.name}.`;

      // Usar o sistema de retry antigo para blocos individuais (por agora)
      const availableApiKey = getAvailableApiKey();
      const textoDoBloco = await callGenerativeAIWithRetry(
        availableApiKey,
        promptDoBloco,
        (msg, type) => addResultLog(resultContainer, msg, type),
        `Bloco '${bloco.nome}'`,
        false,
        true // isBlockOfScript = true para não trackear individualmente
      );

      roteiroCompleto += (roteiroCompleto ? "\n\n" : "") + textoDoBloco;
      scriptContentArea.textContent = roteiroCompleto;
    }

    // FIX: Usar chave única que inclui o idioma para evitar mistura entre workers
    const uniqueKey = `${originalTitleKey}-${lang.id}`;
    // console.log(`💾 SALVANDO RESULTADO (processCompleteScript): ${uniqueKey} | Língua: ${lang.name} | Script length: ${roteiroCompleto.length}`);
    
    // Armazenar resultado
    if (!generationResults[uniqueKey]) {
      generationResults[uniqueKey] = [];
    }

    generationResults[uniqueKey].push({
      lang,
      premise: finalPremise,
      script: roteiroCompleto,
      resultContainer,
    });

    // Track roteiro completo (uma única vez por roteiro)
    try {
      const scriptJobId = `script_${Date.now()}_${Math.random()
        .toString(36)
        .substr(2, 9)}`;
      await trackCompleteScript({
        jobId: scriptJobId,
        model: state.selectedGeminiModel || "gemini-2.5-pro-preview-06-05",
        language: lang.name,
        totalBlocks: blocos.length,
        scriptLength: roteiroCompleto.length,
        premiseLength: finalPremise ? finalPremise.length : 0,
        title: originalTitleKey || "Roteiro Gerado",
      });
      addResultLog(
        resultContainer,
        `📊 Roteiro completo registrado!`,
        "success"
      );
    } catch (error) {
      console.warn("Falha ao registrar roteiro completo:", error);
      // Não interrompe o fluxo se tracking falhar
    }

    // Incrementar contador - roteiro processado com sucesso
    incrementScriptsCounter(true);

    return {
      success: true,
      script: roteiroCompleto,
    };
  } catch (error) {
    addResultLog(
      resultContainer,
      `❌ Erro no script: ${error.message}`,
      "error"
    );
    // Incrementar contador - roteiro processado com erro
    incrementScriptsCounter(false);

    return {
      success: false,
      error: error.message,
    };
  }
}

function splitTextIntoChunks(text, idealChunkSize = 1500) {
  const encoder = new TextEncoder();
  const totalChars = text.length;
  
  // Calcular número de chunks baseado no tamanho ideal
  const estimatedChunks = Math.ceil(totalChars / idealChunkSize);
  
  // console.log(`🔧 TTS Chunking: ${totalChars} chars → ${estimatedChunks} chunks (~${idealChunkSize} chars cada)`);
  
  // Se o texto é pequeno, retornar como um chunk único
  if (totalChars <= idealChunkSize) {
    return [text.trim()];
  }

  const chunks = [];
  let currentPosition = 0;
  
  while (currentPosition < text.length) {
    let chunkEnd = Math.min(currentPosition + idealChunkSize, text.length);
    
    // Se não chegamos ao final do texto, procurar ponto seguro para quebrar
    if (chunkEnd < text.length) {
      chunkEnd = findSafeBreakPoint(text, currentPosition, chunkEnd);
    }
    
    const chunk = text.substring(currentPosition, chunkEnd).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    
    currentPosition = chunkEnd;
  }
  
  // Log final para debug
  const chunkSizes = chunks.map(c => c.length);
  console.log(`✅ TTS Chunks finais: [${chunkSizes.join(', ')}] caracteres`);
  
  return chunks;
}

/**
 * Encontra o melhor ponto para quebrar o texto sem cortar palavras
 * @param {string} text - Texto completo
 * @param {number} start - Posição inicial do chunk
 * @param {number} idealEnd - Posição ideal para terminar
 * @returns {number} - Posição segura para quebrar
 */
function findSafeBreakPoint(text, start, idealEnd) {
  const maxSearchRange = 200; // Máximo de caracteres para procurar ponto seguro
  const minChunkSize = 800; // Tamanho mínimo aceitável para um chunk
  
  // Prioridade 1: Procurar quebra de parágrafo (mais próxima do ideal)
  for (let i = idealEnd; i >= Math.max(start + minChunkSize, idealEnd - maxSearchRange); i--) {
    if (text[i] === '\n' && text[i-1] === '\n') {
      return i;
    }
  }
  
  // Prioridade 2: Procurar final de sentença
  for (let i = idealEnd; i >= Math.max(start + minChunkSize, idealEnd - maxSearchRange); i--) {
    if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
      // Verificar se não é abreviação (próximo char não é espaço seguido de minúscula)
      const nextChar = text[i + 1];
      const charAfterSpace = text[i + 2];
      if (nextChar === ' ' && (!charAfterSpace || charAfterSpace === charAfterSpace.toUpperCase())) {
        return i + 1;
      }
    }
  }
  
  // Prioridade 3: Procurar espaço entre palavras
  for (let i = idealEnd; i >= Math.max(start + minChunkSize, idealEnd - maxSearchRange); i--) {
    if (text[i] === ' ') {
      return i;
    }
  }
  
  // Fallback: usar posição ideal mesmo que corte palavra (melhor que chunks gigantes)
  console.warn(`⚠️ Não encontrou ponto seguro, usando posição ${idealEnd} (pode cortar palavra)`);
  return idealEnd;
}

async function triggerZipDownload(orderedTitles) {
  const downloadButton = document.getElementById("download-all-btn");
  downloadButton.disabled = true;
  downloadButton.innerHTML =
    '<i class="fas fa-spinner fa-spin mr-2"></i> Preparando ZIP...';

  if (
    !orderedTitles ||
    orderedTitles.length === 0 ||
    Object.keys(generationResults).length === 0
  ) {
    alert("Não há resultados para baixar ou a ordem dos títulos foi perdida.");
    downloadButton.disabled = false;
    downloadButton.innerHTML =
      '<i class="fas fa-file-archive mr-2"></i> Baixar Todos como .zip';
    return;
  }

  // Monta array de arquivos para o backend
  const files = [];
  orderedTitles.forEach((title, index) => {
    // FIX: Buscar todos os resultados com chaves que começam com este título
    const allResults = [];
    Object.keys(generationResults).forEach(key => {
      if (key.startsWith(title + '-')) {
        allResults.push(...generationResults[key]);
      }
    });
    
    const resultsForTitle = allResults;
    if (!resultsForTitle || resultsForTitle.length === 0) return;
    const cleanTitle = title
      .replace(/[^\w\s.-]/gi, "")
      .replace(/\s+/g, "_")
      .substring(0, 50);
    const folderName = `Roteiro_${index + 1}_${cleanTitle}`;
    
    resultsForTitle.forEach((result) => {
      const langPrefix = result.lang.id.split("-")[0].toUpperCase();
      
      // Usar serverPath quando disponível, fallback para conteúdo inline  
      if (result.premise) {
        const file = {
          name: `${folderName}/${langPrefix}_premissa.txt`
        };
        
        if (result.premiseServerPath) {
          file.serverPath = result.premiseServerPath;
          // console.log(`📁 [Download] Usando serverPath de texto: ${result.premiseServerPath}`);
        } else {
          file.content = result.premise;
        }
        
        files.push(file);
      }
      
      if (result.script) {
        const file = {
          name: `${folderName}/${langPrefix}_roteiro.txt`
        };
        
        if (result.scriptServerPath) {
          file.serverPath = result.scriptServerPath;
          // console.log(`📁 [Download] Usando serverPath de script: ${result.scriptServerPath}`);
        } else {
          file.content = result.script;
        }
        
        files.push(file);
      }
      
      if (result.serverPath) {
        const file = {
          name: `${folderName}/${langPrefix}_narracao.mp3`,
          serverPath: result.serverPath
        };
        
        // console.log(`📁 [Download] Usando serverPath de áudio: ${result.serverPath}`);
        files.push(file);
      }
    });
  });

  try {
    // NOVO SISTEMA: ZIP STREAMING DIRETO (contorna limite de 100MB)
    console.log('🚀 [StreamDownload] Iniciando download com streaming direto...');
    
    downloadButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Gerando ZIP em tempo real...';
    
    // Usar nova função que retorna blob diretamente
    const zipBlob = await createOptimizedZip(files, {
      name: `BoredFy-Arquivos-${new Date().toISOString().slice(0, 10)}.zip`
    });
    
    downloadButton.innerHTML = '<i class="fas fa-download fa-spin mr-2"></i> Download em andamento...';
    
    // Download direto do blob (sem necessidade de downloadUserFile)
    const link = document.createElement("a");
    link.href = URL.createObjectURL(zipBlob);
    link.download = `BoredFy-Arquivos-${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Limpar blob URL para liberar memória
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);

    console.log('✅ [StreamDownload] Download por streaming concluído com sucesso!');

    // Exibe botão manual
    downloadButton.disabled = false;
    downloadButton.innerHTML =
      '<i class="fas fa-file-archive mr-2"></i> Baixar Todos como .zip';
  } catch (err) {
    console.error("Erro ao criar ZIP no backend:", err);

    const errorMessage = "Ocorreu um erro ao gerar o arquivo ZIP no servidor.";
    alert(errorMessage);

    downloadButton.disabled = false;
    downloadButton.innerHTML =
      '<i class="fas fa-file-archive mr-2"></i> Baixar Todos como .zip';
  }
}

// Controle para evitar múltiplas chamadas
let isAddingToMyFiles = false;

// Função para adicionar arquivos gerados automaticamente aos "Meus Arquivos"
async function addGeneratedFilesToMyFiles() {
  // Evitar múltiplas chamadas simultâneas
  if (isAddingToMyFiles) {
    console.log("⏸️ addGeneratedFilesToMyFiles já está em execução, pulando");
    return;
  }

  if (
    !lastOrderedTitles ||
    lastOrderedTitles.length === 0 ||
    Object.keys(generationResults).length === 0
  ) {
    console.log("Nenhum resultado para adicionar aos Meus Arquivos");
    return;
  }

  isAddingToMyFiles = true;
  // console.log("🚀 Iniciando adição de arquivos aos Meus Arquivos...");

  // Monta array de arquivos (mesmo formato do triggerZipDownload)
  const files = [];
  lastOrderedTitles.forEach((title, index) => {
    // FIX: Buscar todos os resultados com chaves que começam com este título
    const allResults = [];
    Object.keys(generationResults).forEach(key => {
      if (key.startsWith(title + '-')) {
        allResults.push(...generationResults[key]);
      }
    });
    
    const resultsForTitle = allResults;
    if (!resultsForTitle || resultsForTitle.length === 0) return;

    const cleanTitle = title
      .replace(/[^\w\s.-]/gi, "")
      .replace(/\s+/g, "_")
      .substring(0, 50);
    const folderName = `Roteiro_${index + 1}_${cleanTitle}`;

    resultsForTitle.forEach((result) => {
      const langPrefix = result.lang.id.split("-")[0].toUpperCase();
      
      // Usar serverPath quando disponível, fallback para conteúdo inline
      if (result.premise) {
        const file = {
          name: `${folderName}/${langPrefix}_premissa.txt`
        };
        
        if (result.premiseServerPath) {
          // NOVO: Usar serverPath (arquivos que já existem)
          file.serverPath = result.premiseServerPath;
          // console.log(`📁 Usando serverPath de texto: ${result.premiseServerPath}`);
        } else {
          // COMPATIBILIDADE: Fallback para conteúdo inline
          file.content = result.premise;
        }
        
        files.push(file);
      }
      
      if (result.script) {
        const file = {
          name: `${folderName}/${langPrefix}_roteiro.txt`
        };
        
        if (result.scriptServerPath) {
          // NOVO: Usar serverPath (arquivos que já existem)
          file.serverPath = result.scriptServerPath;
          // console.log(`📁 Usando serverPath de script: ${result.scriptServerPath}`);
        } else {
          // COMPATIBILIDADE: Fallback para conteúdo inline
          file.content = result.script;
        }
        
        files.push(file);
      }
      
      if (result.serverPath) {
        const file = {
          name: `${folderName}/${langPrefix}_narracao.mp3`,
          serverPath: result.serverPath
        };
        
        // console.log(`📁 Usando serverPath de áudio: ${result.serverPath}`);
        files.push(file);
      }
    });
  });

  if (files.length === 0) {
    console.log("Nenhum arquivo válido para adicionar");
    return;
  }

  try {
    // Gera nome descritivo baseado na data e quantidade
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "-"); // HH-MM-SS
    const fileName = `Roteiros_${dateStr}_${timeStr}_${files.length}arquivos`;

    // console.log(`📦 Criando ZIP único com ${files.length} arquivos...`);
    const result = await addToMyFiles(files, fileName);
    // console.log(
    //   `✅ ZIP único adicionado aos Meus Arquivos: ${result.name}`
    // );

    // Invalida cache do statsManager se existir
    if (window.statsManager) {
      window.statsManager.invalidateCache();
    }
  } catch (error) {
    console.error("❌ Falha ao adicionar arquivos automaticamente:", error);
    throw error; // Re-throw para logging no caller
  } finally {
    // Sempre liberar o controle
    isAddingToMyFiles = false;
    // console.log("🔓 Liberando controle do addGeneratedFilesToMyFiles");
  }
}

// ============ User Files (Meus Arquivos) ============
import { listUserFiles, addToMyFiles, getAuthHeaders, BACKEND_URL } from "./api.js";

async function openUserFilesModal() {
  const modal = document.getElementById("user-files-modal");
  const status = document.getElementById("user-files-status");
  const list = document.getElementById("user-files-list");
  list.innerHTML = "";
  status.textContent = "Carregando arquivos...";
  modal.classList.remove("hidden");

  try {
    const files = await listUserFiles();
    if (!files || files.length === 0) {
      status.textContent =
        "Você ainda não possui arquivos gerados nas últimas 24 horas.";
      return;
    }
    status.textContent = `${files.length} arquivo(s) disponível(is).`;
    files.forEach((f) => {
      const expiresInMs = new Date(f.expiresAt).getTime() - Date.now();
      const hoursLeft = Math.max(0, Math.floor(expiresInMs / (60 * 60 * 1000)));
      const item = document.createElement("div");
      item.className =
        "flex items-center justify-between bg-gray-900 p-3 rounded border border-gray-700";
      item.innerHTML = `
        <div class="text-sm text-gray-300">
          <div class="font-semibold text-white">${f.name}</div>
          <div class="text-gray-400">Criado: ${new Date(
            f.createdAt
          ).toLocaleString("pt-BR")} · Expira em ~${hoursLeft}h · ${(
        f.sizeBytes /
        1024 /
        1024
      ).toFixed(2)} MB</div>
        </div>
        <div class="flex gap-2">
          <a href="#" class="download-file-btn bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded" data-url="${
            f.downloadUrl
          }"><i class="fas fa-download mr-1"></i>Baixar</a>
        </div>
      `;
      list.appendChild(item);
    });

    // Wire download buttons
    list.querySelectorAll(".download-file-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const url = btn.getAttribute("data-url");
        btn.classList.add("opacity-70");
        try {
          const { blob, filename } = await downloadUserFile(url);
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = filename || "arquivo.zip";
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (err) {
          alert("Falha no download: " + err.message);
        } finally {
          btn.classList.remove("opacity-70");
        }
      });
    });
  } catch (err) {
    status.textContent = "Erro ao carregar seus arquivos: " + err.message;
  }
}

// ============= SISTEMA DE LIMPEZA NA SAÍDA =============

// Limpeza automática quando usuário sai da página
window.addEventListener('beforeunload', () => {
  console.log("🚪 Detectada saída da página - limpando workers...");
  
  // Para o auto-cleanup watcher
  stopAutoCleanupWatcher();
  
  // Para o GeminiQueue
  if (window.geminiQueue?.isRunning) {
    window.geminiQueue.stop();
  }
  
  console.log("🧹 Limpeza de emergência na saída da página executada");
});

console.log("✅ Sistema de limpeza de workers configurado e ativo");
