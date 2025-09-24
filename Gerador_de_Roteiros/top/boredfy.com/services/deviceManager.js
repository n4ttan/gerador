/**
 * deviceManager.js
 * Interface para visualizar dispositivos conhecidos e logs de segurança
 */

// Função utilitária para formatar datas do Firestore
//function formatFirestoreDate(dateField) {
//  console.log('🔍 Debug - Campo de data recebido:', dateField);
//  console.log('🔍 Debug - Tipo:', typeof dateField);
//  console.log('🔍 Debug - É Date?', dateField instanceof Date);
//  console.log('🔍 Debug - Tem seconds?', dateField && dateField.seconds);
//  console.log('🔍 Debug - Tem _seconds?', dateField && dateField._seconds);
//  console.log('🔍 Debug - Tem toDate?', dateField && typeof dateField.toDate === 'function');
//
//  if (!dateField) return 'Data não disponível';
//
//  try {
//    let date;
//    if (dateField.seconds) {
//      // Formato Timestamp do Firestore (sem underscore)
//      console.log('🔍 Debug - Usando seconds:', dateField.seconds);
//      date = new Date(dateField.seconds * 1000);
//    } else if (dateField._seconds) {
//      // Formato Timestamp do Firestore (com underscore)
//      console.log('🔍 Debug - Usando _seconds:', dateField._seconds);
//      date = new Date(dateField._seconds * 1000);
//    } else if (dateField.toDate) {
//      // Formato Timestamp do Firestore (método toDate)
//      console.log('🔍 Debug - Usando toDate()');
//      date = dateField.toDate();
//    } else if (dateField instanceof Date) {
//      // Já é um objeto Date
//      console.log('🔍 Debug - Já é Date');
//      date = dateField;
//    } else if (typeof dateField === 'string') {
//      // String ISO
//      console.log('🔍 Debug - Usando string ISO:', dateField);
//      date = new Date(dateField);
//    } else {
//      console.log('🔍 Debug - Formato não reconhecido');
//      return 'Data inválida';
//    }
//
//    console.log('🔍 Debug - Data final:', date);
//    console.log('🔍 Debug - É válida?', !isNaN(date.getTime()));
//
//    if (isNaN(date.getTime())) {
//      return 'Data inválida';
//    }
//
//    return date.toLocaleString('pt-BR', {
//      year: 'numeric',
//      month: '2-digit',
//      day: '2-digit',
//      hour: '2-digit',
//      minute: '2-digit',
//      second: '2-digit'
//    });
//  } catch (error) {
//    console.error('❌ Erro ao formatar data:', dateField, error);
//    return 'Data inválida';
//  }
//}

// Função para mostrar modal com dispositivos do usuário
async function showUserDevices() {
  try {
    if (!window.fingerprintManager) {
      throw new Error("Gerenciador de fingerprint não disponível");
    }

    const headers = await window.fingerprintManager.getAuthHeaders();
    delete headers["Content-Type"];

    const response = await fetch("/api/auth/devices", {
      method: "GET",
      headers,
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || "Erro ao carregar dispositivos");
    }

    const devices = data.devices || [];

    // Criar modal
    const modal = createDevicesModal(devices);
    document.body.appendChild(modal);

    // Mostrar modal
    modal.classList.remove("hidden");
  } catch (error) {
    console.error("❌ Erro ao mostrar dispositivos:", error);
    alert("Erro ao carregar dispositivos: " + error.message);
  }
}

// Função para mostrar logs de dispositivos
async function showDeviceLogs() {
  try {
    if (!window.fingerprintManager) {
      throw new Error("Gerenciador de fingerprint não disponível");
    }

    const headers = await window.fingerprintManager.getAuthHeaders();
    delete headers["Content-Type"];

    const response = await fetch("/api/auth/device-logs?limit=100", {
      method: "GET",
      headers,
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.message || "Erro ao carregar logs");
    }

    const logs = data.logs || [];

    // Criar modal
    const modal = createLogsModal(logs);
    document.body.appendChild(modal);

    // Mostrar modal
    modal.classList.remove("hidden");
  } catch (error) {
    console.error("❌ Erro ao mostrar logs:", error);
    alert("Erro ao carregar logs: " + error.message);
  }
}

// Criar modal de dispositivos
function createDevicesModal(devices) {
  const modal = document.createElement("div");
  modal.className =
    "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden";

  const currentFingerprint =
    window.fingerprintManager?.deviceFingerprint || "desconhecido";
  const userEmail =
    devices.length > 0
      ? devices[0].userEmail || "E-mail não disponível"
      : "E-mail não disponível";

  modal.innerHTML = `
    <div class="bg-gray-800 rounded-lg p-6 max-w-4xl w-full max-h-96 overflow-y-auto m-4">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold text-white">
          <i class="fas fa-mobile-alt mr-2"></i>
          Dispositivos Conhecidos
        </h2>
        <button class="close-modal text-gray-400 hover:text-white">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      
      <div class="mb-4 p-3 bg-blue-900 rounded">
        <p class="text-blue-200 text-sm">
          <i class="fas fa-user mr-1"></i>
          Usuário: <strong>${userEmail}</strong>
        </p>
        <p class="text-blue-200 text-sm mt-1">
          <i class="fas fa-info-circle mr-1"></i>
          Dispositivo atual: <code class="bg-blue-800 px-1 rounded">${currentFingerprint}</code>
        </p>
      </div>
      
      <div class="space-y-3">
        ${
          devices.length === 0
            ? '<p class="text-gray-400 text-center py-4">Nenhum dispositivo encontrado</p>'
            : devices
                .map((device) => createDeviceCard(device, currentFingerprint))
                .join("")
        }
      </div>
    </div>
  `;

  // Event listeners
  modal.querySelector(".close-modal").addEventListener("click", () => {
    modal.remove();
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  return modal;
}

// Criar card de dispositivo
function createDeviceCard(device, currentFingerprint) {
  const isCurrentDevice = device.fingerprint === currentFingerprint;

  const firstSeen = device.firstSeen
    ? new Date(
        device.firstSeen._seconds
          ? device.firstSeen._seconds * 1000
          : device.firstSeen
      ).toLocaleString("pt-BR")
    : "—";
  const lastSeen = device.lastSeen
    ? new Date(
        device.lastSeen._seconds
          ? device.lastSeen._seconds * 1000
          : device.lastSeen
      ).toLocaleString("pt-BR")
    : "—";

  const platform =
    device.deviceInfo?.platform || device.lastDeviceInfo?.platform || "—";
  const userAgent =
    device.deviceInfo?.userAgent || device.lastDeviceInfo?.userAgent || "—";

  return `
    <div class="bg-gray-700 rounded p-4 ${
      isCurrentDevice ? "border-l-4 border-green-500" : ""
    }">
      <div class="flex justify-between items-start mb-2">
        <div class="flex items-center">
          <i class="fas fa-${
            platform.toLowerCase().includes("win")
              ? "desktop"
              : platform.toLowerCase().includes("mac")
              ? "laptop"
              : platform.toLowerCase().includes("android") ||
                platform.toLowerCase().includes("iphone")
              ? "mobile"
              : "question"
          } mr-2 text-blue-400"></i>
          <span class="font-medium text-white">${platform}</span>
          ${
            isCurrentDevice
              ? '<span class="ml-2 bg-green-600 text-white text-xs px-2 py-1 rounded">ATUAL</span>'
              : ""
          }
        </div>
        <span class="text-xs text-gray-400">${device.loginCount} login(s)</span>
      </div>
      
      <div class="text-sm text-gray-300 space-y-1">
        <div><strong>E-mail:</strong> ${
          device.userEmail || "Não disponível"
        }</div>
        <div><strong>Fingerprint:</strong> <code class="bg-gray-600 px-1 rounded">${
          device.fingerprint
        }</code></div>
        <div><strong>Primeiro acesso:</strong> ${firstSeen}</div>
        <div><strong>Último acesso:</strong> ${lastSeen}</div>
        <div><strong>User Agent:</strong> <span class="text-xs">${userAgent.substring(
          0,
          100
        )}${userAgent.length > 100 ? "..." : ""}</span></div>
      </div>
    </div>
  `;
}

// Criar modal de logs
function createLogsModal(logs) {
  const modal = document.createElement("div");
  modal.className =
    "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden";

  const userEmail =
    logs.length > 0
      ? logs[0].userEmail || "E-mail não disponível"
      : "E-mail não disponível";

  modal.innerHTML = `
    <div class="bg-gray-800 rounded-lg p-6 max-w-5xl w-full max-h-96 overflow-y-auto m-4">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold text-white">
          <i class="fas fa-clipboard-list mr-2"></i>
          Logs de Segurança
        </h2>
        <button class="close-modal text-gray-400 hover:text-white">
          <i class="fas fa-times text-xl"></i>
        </button>
      </div>
      
      <div class="mb-4 p-3 bg-green-900 rounded">
        <p class="text-green-200 text-sm">
          <i class="fas fa-user mr-1"></i>
          Usuário: <strong>${userEmail}</strong>
        </p>
        <p class="text-green-200 text-sm mt-1">
          <i class="fas fa-info-circle mr-1"></i>
          Mostrando últimos ${logs.length} registros de atividade
        </p>
      </div>
      
      <div class="space-y-2">
        ${
          logs.length === 0
            ? '<p class="text-gray-400 text-center py-4">Nenhum log encontrado</p>'
            : logs.map((log) => createLogEntry(log)).join("")
        }
      </div>
    </div>
  `;

  // Event listeners
  modal.querySelector(".close-modal").addEventListener("click", () => {
    modal.remove();
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  return modal;
}

// Criar entrada de log
function createLogEntry(log) {
  const timestamp = formatFirestoreDate(log.timestamp);
  const actionIcons = {
    LOGIN: "fa-sign-in-alt text-blue-400",
    NEW_DEVICE: "fa-plus text-green-400",
    LOGOUT: "fa-sign-out-alt text-yellow-400",
    SESSION_INVALID: "fa-exclamation-triangle text-red-400",
  };

  const actionLabels = {
    LOGIN: "Login",
    NEW_DEVICE: "Novo Dispositivo",
    LOGOUT: "Logout",
    SESSION_INVALID: "Sessão Inválida",
  };

  const icon = actionIcons[log.action] || "fa-info text-gray-400";
  const label = actionLabels[log.action] || log.action;

  return `
    <div class="bg-gray-700 rounded p-3 text-sm">
      <div class="flex justify-between items-start">
        <div class="flex items-center">
          <i class="fas ${icon} mr-2"></i>
          <span class="font-medium text-white">${label}</span>
        </div>
        <span class="text-xs text-gray-400">${timestamp}</span>
      </div>
      
      <div class="mt-2 text-gray-300 space-y-1">
        <div><strong>E-mail:</strong> ${log.userEmail || "Não disponível"}</div>
        <div><strong>IP:</strong> ${log.ip}</div>
        <div><strong>Fingerprint:</strong> <code class="bg-gray-600 px-1 rounded text-xs">${
          log.fingerprint
        }</code></div>
        ${
          log.deviceInfo?.platform
            ? `<div><strong>Plataforma:</strong> ${log.deviceInfo.platform}</div>`
            : ""
        }
      </div>
    </div>
  `;
}

// Adicionar botões de segurança à interface
function addSecurityButtons() {
  const userInfo = document.getElementById("user-info");
  if (userInfo) {
    // Verificar se já existem os botões
    if (userInfo.querySelector(".security-buttons")) {
      return;
    }

    const securityButtons = document.createElement("div");
    securityButtons.className = "security-buttons mt-2 flex gap-2";
    securityButtons.innerHTML = `
      <button id="show-devices-btn" style="display:none;" class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded">
      <i class="fas fa-mobile-alt mr-1"></i>Dispositivos
      </button>
      <button id="show-logs-btn" style="display:none;" class="text-xs bg-green-600 hover:bg-green-700 text-white px-2 py-1 rounded">
      <i class="fas fa-clipboard-list mr-1"></i>Logs
      </button>
    `;

    userInfo.appendChild(securityButtons);

    // Event listeners
    document
      .getElementById("show-devices-btn")
      .addEventListener("click", showUserDevices);
    document
      .getElementById("show-logs-btn")
      .addEventListener("click", showDeviceLogs);
  }
}

// Observar mudanças no user-info para adicionar botões quando necessário
function observeUserInfo() {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "childList") {
        const userInfo = document.getElementById("user-info");
        if (
          userInfo &&
          userInfo.innerHTML.trim() !== "" &&
          !userInfo.querySelector(".security-buttons")
        ) {
          setTimeout(addSecurityButtons, 100); // Pequeno delay para garantir que a estrutura foi criada
        }
      }
    });
  });

  const userInfo = document.getElementById("user-info");
  if (userInfo) {
    observer.observe(userInfo, { childList: true, subtree: true });
  }
}

// Inicializar quando o DOM estiver carregado
document.addEventListener("DOMContentLoaded", () => {
  observeUserInfo();
});

// Exportar funções para uso global
window.deviceManager = {
  showUserDevices,
  showDeviceLogs,
  addSecurityButtons,
};

console.log("🔐 Gerenciador de dispositivos carregado");
