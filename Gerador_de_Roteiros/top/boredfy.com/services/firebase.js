// frontend/firebase.js
// Configuração segura do Firebase - configurações carregadas do backend

let firebaseInitialized = false;

// Função para inicializar o Firebase com configurações seguras
async function initializeFirebase() {
  if (firebaseInitialized) return;
  
  try {
    // Carrega configurações do backend
    const response = await fetch('/api/firebase-config');
    
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Erro de autenticação no backend. Verifique se o endpoint /api/firebase-config está acessível.');
      } else if (response.status === 500) {
        throw new Error('Erro interno no backend. Verifique se as variáveis de ambiente estão configuradas.');
      } else {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }
    }
    
    const data = await response.json();
    
    if (data.success && data.config) {
      firebase.initializeApp(data.config);
      window.auth = firebase.auth();
      window.db = firebase.firestore();
      firebaseInitialized = true;
      console.log('✅ Firebase inicializado com configurações seguras');
    } else {
      throw new Error(data.message || 'Falha ao carregar configurações do Firebase');
    }
  } catch (error) {
    console.error('❌ Erro ao inicializar Firebase:', error.message);
    
    // Mensagens específicas para diferentes tipos de erro
    if (error.message.includes('autenticação')) {
      console.error('🔧 SOLUÇÃO: O endpoint /api/firebase-config precisa estar desprotegido');
    } else if (error.message.includes('variáveis de ambiente')) {
      console.error('🔧 SOLUÇÃO: Execute "npm run setup-env" no backend');
    } else if (error.message.includes('fetch')) {
      console.error('🔧 SOLUÇÃO: Verifique se o backend está rodando');
    }
    
    console.error('❌ Sistema não pode funcionar sem configurações seguras');
    throw new Error(`Configurações do Firebase não disponíveis: ${error.message}`);
  }
}

window.loginWithEmail = async function(email, password) {
  await initializeFirebase();
  return window.auth.signInWithEmailAndPassword(email, password);
};

window.registerWithEmail = async function(email, password, extraData = {}) {
  await initializeFirebase();
  return window.auth.createUserWithEmailAndPassword(email, password)
    .then(async (userCredential) => {
      const user = userCredential.user;
      await window.db.collection("users").doc(user.uid).set({
        email: user.email,
        createdAt: new Date(),
        role: "user", // padrão
        premiumUntil: null, // padrão
        ...extraData
      });
      return userCredential;
    });
};

window.logout = async function() {
  await initializeFirebase();
  return window.auth.signOut();
};

window.onUserStateChanged = async function(callback) {
  await initializeFirebase();
  return window.auth.onAuthStateChanged(callback);
};

// Função para inicializar Firebase imediatamente se necessário
window.initializeFirebase = initializeFirebase;
