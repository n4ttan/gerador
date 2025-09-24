/**
 * fingerprintManager.js
 * Gerencia a identificação única do dispositivo usando FingerprintJS
 */

let fpInstance = null;
let deviceFingerprint = null;

/**
 * Inicializa o FingerprintJS
 */
async function initFingerprint() {
  if (fpInstance) {
    return fpInstance;
  }

  try {
    fpInstance = await FingerprintJS.load();
    console.log("✅ FingerprintJS inicializado");
    return fpInstance;
  } catch (error) {
    console.error("❌ Erro ao inicializar FingerprintJS:", error);
    throw new Error("Falha ao inicializar identificação do dispositivo");
  }
}

/**
 * Obtém o fingerprint único do dispositivo
 */
async function getDeviceFingerprint() {
  if (deviceFingerprint) {
    return deviceFingerprint;
  }

  try {
    const fp = await initFingerprint();
    const result = await fp.get();

    deviceFingerprint = result.visitorId;
    console.log("🔍 Fingerprint do dispositivo obtido:", deviceFingerprint);

    return deviceFingerprint;
  } catch (error) {
    console.error("❌ Erro ao obter fingerprint:", error);
    // Fallback para um ID baseado em timestamp e random
    deviceFingerprint = `fallback_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;
    console.log("⚠️ Usando fingerprint fallback:", deviceFingerprint);
    return deviceFingerprint;
  }
}

/**
 * Obtém informações detalhadas do dispositivo
 */
async function getDeviceInfo() {
  try {
    const fp = await initFingerprint();
    const result = await fp.get();

    // Informações básicas sempre disponíveis
    const deviceInfo = {
      fingerprint: result.visitorId,
      confidence: result.confidence?.score || 0,
      platform: navigator.platform || "unknown",
      language: navigator.language || "unknown",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown",
      screen: {
        width: screen.width || 0,
        height: screen.height || 0,
        colorDepth: screen.colorDepth || 0,
      },
      timestamp: new Date().toISOString(),
    };

    // Componentes do fingerprint (se disponíveis)
    if (result.components) {
      deviceInfo.components = {
        userAgent: result.components.userAgent?.value || "unknown",
        webgl: result.components.webgl?.value || "unknown",
        canvas: result.components.canvas?.value || "unknown",
        audio: result.components.audio?.value || "unknown",
        fonts: result.components.fonts?.value?.length || 0,
        plugins: result.components.plugins?.value?.length || 0,
        cookieEnabled: result.components.cookieEnabled?.value || false,
        localStorage: result.components.localStorage?.value || false,
        sessionStorage: result.components.sessionStorage?.value || false,
        indexedDB: result.components.indexedDB?.value || false,
        cpuClass: result.components.cpuClass?.value || "unknown",
        hardwareConcurrency: result.components.hardwareConcurrency?.value || 0,
      };
    }

    console.log("📊 Informações do dispositivo coletadas:", deviceInfo);
    return deviceInfo;
  } catch (error) {
    console.error("❌ Erro ao obter informações do dispositivo:", error);

    // Informações básicas como fallback
    return {
      fingerprint: await getDeviceFingerprint(),
      confidence: 0,
      platform: navigator.platform || "unknown",
      language: navigator.language || "unknown",
      timezone: "unknown",
      screen: {
        width: screen.width || 0,
        height: screen.height || 0,
        colorDepth: screen.colorDepth || 0,
      },
      timestamp: new Date().toISOString(),
      fallback: true,
    };
  }
}

/**
 * Cria uma sessão no backend com o fingerprint
 */
async function createSession() {
  try {
    const fingerprint = await getDeviceFingerprint();

    // Obtém o token de autenticação atual
    const user = window.auth?.currentUser;
    if (!user) {
      throw new Error("Usuário não autenticado");
    }

    console.log("🔐 Criação de sessão desativada (usando apenas token)");

    // Detecção de IP do cliente removida

    const token = await user.getIdToken();

    // Device info/IP desativados (não enviar)
    const enrichedDeviceInfo = undefined;

    // Não chama backend; não usa sessionId
    localStorage.removeItem("sessionId");
    return null;
  } catch (error) {
    console.error("❌ Erro ao criar sessão:", error);
    throw error;
  }
}

/**
 * Obtém o ID da sessão atual
 */
function getSessionId() {
  return localStorage.getItem("sessionId");
}

/**
 * Remove a sessão atual
 */
function clearSession() {
  localStorage.removeItem("sessionId");
  console.log("🗑️ Sessão local removida");
}

/**
 * Obtém headers de autenticação com sessão
 */
async function getAuthHeaders() {
  try {
    const user = window.auth?.currentUser;
    if (!user) {
      throw new Error("Usuário não autenticado");
    }

    const token = await user.getIdToken();
    const sessionId = getSessionId();

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };

    // Não envia X-Session-ID (sessões desativadas)

    return headers;
  } catch (error) {
    console.error("❌ Erro ao obter headers de autenticação:", error);
    throw error;
  }
}

/**
 * Verifica se a sessão atual é válida
 */
async function isSessionValid() {
  try {
    const sessionId = getSessionId();
    if (!sessionId) {
      return false;
    }

    const headers = await getAuthHeaders();

    // Sessões desativadas: considerar válido se houver token e user
    const response = await fetch("/api/firebase-config", {
      method: "GET",
      headers,
    });

    return response.ok;
  } catch (error) {
    console.error("❌ Erro ao verificar sessão:", error);
    return false;
  }
}

// Exporta as funções
window.fingerprintManager = {
  initFingerprint,
  getDeviceFingerprint,
  getDeviceInfo,
  createSession,
  getSessionId,
  clearSession,
  getAuthHeaders,
  isSessionValid,
};

console.log("📱 Gerenciador de fingerprint carregado");
