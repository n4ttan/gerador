// statsManager.js - Gerenciamento do dashboard de estatísticas

/**
 * Stats Manager - Sistema de dashboard gamificado
 */
class StatsManager {
  constructor() {
    this.modal = null;
    this.currentStats = null;
    this.isLoading = false;
    this.animationTimeouts = [];
    this.cacheKey = 'boredfy_user_stats';
    this.cacheTTL = 2 * 60 * 1000; // 2 minutos cache local
    
    this.init();
  }

  /**
   * Inicializa o manager
   */
  init() {
    this.modal = document.getElementById('stats-modal');
    this.setupEventListeners();
  }

  /**
   * Configura event listeners
   */
  setupEventListeners() {
    // Botão de abrir modal
    const statsBtn = document.getElementById('stats-btn');
    if (statsBtn) {
      statsBtn.addEventListener('click', () => this.openModal());
    }

    // Botão de fechar modal
    const closeBtn = document.getElementById('close-stats-modal');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // Fechar modal clicando no backdrop
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) {
          this.closeModal();
        }
      });
    }

    // Botão de retry
    const retryBtn = document.getElementById('retry-stats-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => this.loadStats());
    }

    // Botão de compartilhar
    const shareBtn = document.getElementById('share-stats-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => this.shareStats());
    }

    // ESC para fechar
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
        this.closeModal();
      }
    });
  }

  /**
   * Abre o modal de stats
   */
  async openModal() {
    if (this.isLoading) return;
    
    this.modal.classList.remove('hidden');
    this.showLoading();
    
    try {
      await this.loadStats();
    } catch (error) {
      console.error('Erro ao abrir modal de stats:', error);
      this.showError();
    }
  }

  /**
   * Fecha o modal
   */
  closeModal() {
    this.modal.classList.add('hidden');
    this.clearAnimationTimeouts();
  }

  /**
   * Mostra estado de loading
   */
  showLoading() {
    document.getElementById('stats-loading').classList.remove('hidden');
    document.getElementById('stats-content').classList.add('hidden');
    document.getElementById('stats-error').classList.add('hidden');
  }

  /**
   * Mostra conteúdo das stats
   */
  showContent() {
    document.getElementById('stats-loading').classList.add('hidden');
    document.getElementById('stats-content').classList.remove('hidden');
    document.getElementById('stats-error').classList.add('hidden');
  }

  /**
   * Mostra estado de erro
   */
  showError() {
    document.getElementById('stats-loading').classList.add('hidden');
    document.getElementById('stats-content').classList.add('hidden');
    document.getElementById('stats-error').classList.remove('hidden');
  }

  /**
   * Verifica cache local válido
   */
  getCachedStats() {
    try {
      const cached = sessionStorage.getItem(this.cacheKey);
      if (!cached) return null;
      
      const data = JSON.parse(cached);
      const now = Date.now();
      
      // Verifica TTL
      if (now - data.timestamp > this.cacheTTL) {
        sessionStorage.removeItem(this.cacheKey);
        return null;
      }
      
      return data.stats;
    } catch (error) {
      console.warn('Erro ao ler cache local:', error);
      sessionStorage.removeItem(this.cacheKey);
      return null;
    }
  }

  /**
   * Salva stats no cache local
   */
  setCachedStats(stats) {
    try {
      const data = {
        stats: stats,
        timestamp: Date.now()
      };
      sessionStorage.setItem(this.cacheKey, JSON.stringify(data));
    } catch (error) {
      console.warn('Erro ao salvar cache local:', error);
    }
  }

  /**
   * Invalida cache local (chamado após script/tts gerados)
   */
  invalidateCache() {
    sessionStorage.removeItem(this.cacheKey);
  }

  /**
   * Carrega estatísticas do servidor (OTIMIZADO COM CACHE LOCAL)
   */
  async loadStats() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.showLoading();

    const startTime = performance.now(); // MONITORAMENTO: Início do timing

    try {
      // OTIMIZADO: Verifica cache local primeiro
      const cachedStats = this.getCachedStats();
      if (cachedStats) {
        this.currentStats = cachedStats;
        this.populateStats(cachedStats);
        this.showContent();
        this.startAnimations();
        this.isLoading = false;
        return;
      }

      // Cache miss - busca do servidor
      const user = window.auth?.currentUser;
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      const token = await user.getIdToken();
      const fetchStartTime = performance.now(); // MONITORAMENTO: Timing do fetch
      
      const response = await fetch('/api/user-stats', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const fetchTime = Math.round(performance.now() - fetchStartTime);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response error text:', errorText);
        throw new Error(`Erro ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const responseText = await response.text();
        console.error('❌ Response não é JSON:', responseText.substring(0, 200));
        throw new Error('Servidor retornou HTML em vez de JSON. Verifique se a API está funcionando.');
      }

      const data = await response.json();
      
      if (data.success) {
        this.currentStats = data.stats;
        this.setCachedStats(data.stats); // Salva no cache local
        this.populateStats(data.stats);
        this.showContent();
        this.startAnimations();
      } else {
        throw new Error(data.message || 'Erro ao carregar estatísticas');
      }

    } catch (error) {
      const errorTime = Math.round(performance.now() - startTime);
      console.error(`❌ Erro ao carregar stats (${errorTime}ms):`, error);
      this.showError();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Popula o modal com as estatísticas
   */
  populateStats(stats) {
    // Level e progresso
    document.getElementById('user-level').textContent = stats.gamification.level;
    document.getElementById('level-progress').style.width = `${stats.gamification.levelProgress}%`;
    
    // Streak
    document.getElementById('streak-count').textContent = stats.gamification.streak;
    
    // Stats principais (configurar targets para animação)
    this.setCountUpTarget('scripts-today', stats.scripts.today);
    this.setCountUpTarget('tts-today', stats.tts.today);
    this.setCountUpTarget('days-active', stats.gamification.daysActive);
    
    // Total de áudio formatado
    document.getElementById('total-audio').textContent = stats.audio.formatted;
    
    // Stats de período
    this.setCountUpTarget('scripts-week', stats.scripts.week);
    this.setCountUpTarget('scripts-month', stats.scripts.month);
    this.setCountUpTarget('scripts-total', stats.scripts.total);
    
    this.setCountUpTarget('tts-week', stats.tts.week);
    this.setCountUpTarget('tts-month', stats.tts.month);
    this.setCountUpTarget('tts-total', stats.tts.total);
  }

  /**
   * Define target para animação countUp
   */
  setCountUpTarget(elementId, target) {
    const element = document.getElementById(elementId);
    if (element) {
      element.setAttribute('data-target', target);
      element.textContent = '0'; // Reset para animação
    }
  }

  /**
   * Inicia animações dos números (OTIMIZADO)
   */
  startAnimations() {
    this.clearAnimationTimeouts();
    
    // OTIMIZADO: Usa requestAnimationFrame para melhor performance
    requestAnimationFrame(() => {
      this.animateProgressBarOptimized();
      this.animateCountersOptimized();
      this.animateStreakOptimized();
    });
  }

  /**
   * Anima progress bar de forma otimizada
   */
  animateProgressBarOptimized() {
    const progressBar = document.getElementById('level-progress');
    if (!progressBar) return;
    
    const targetWidth = progressBar.style.width;
    progressBar.style.width = '0%';
    progressBar.style.transition = 'width 0.8s ease-out';
    
    // Usa timeout único em vez de setTimeout aninhado
    const timeout = setTimeout(() => {
      progressBar.style.width = targetWidth;
    }, 50);
    
    this.animationTimeouts.push(timeout);
  }

  /**
   * Anima todos os contadores de forma otimizada
   */
  animateCountersOptimized() {
    const countUpElements = document.querySelectorAll('.countup');
    const startTime = performance.now();
    
    // OTIMIZADO: Um único requestAnimationFrame loop para todos os contadores
    const animateFrame = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / 1500, 1); // 1.5s duration
      
      countUpElements.forEach(element => {
        const target = parseInt(element.getAttribute('data-target')) || 0;
        const current = Math.floor(target * progress);
        element.textContent = current;
      });
      
      if (progress < 1) {
        requestAnimationFrame(animateFrame);
      }
    };
    
    // Delay inicial pequeno para efeito escalonado
    const timeout = setTimeout(() => {
      requestAnimationFrame(animateFrame);
    }, 300);
    
    this.animationTimeouts.push(timeout);
  }

  /**
   * Anima streak de forma otimizada
   */
  animateStreakOptimized() {
    const streakElement = document.getElementById('streak-count');
    if (!streakElement) return;
    
    const timeout = setTimeout(() => {
      streakElement.classList.add('animate-pulse');
      
      // Remove classe após animação
      const cleanup = setTimeout(() => {
        streakElement.classList.remove('animate-pulse');
      }, 1500); // Reduzido de 2s para 1.5s
      
      this.animationTimeouts.push(cleanup);
    }, 800);
    
    this.animationTimeouts.push(timeout);
  }

  /**
   * Anima um contador individual (FALLBACK - mantido para compatibilidade)
   */
  animateCountUp(element) {
    const target = parseInt(element.getAttribute('data-target')) || 0;
    const duration = 1500; // 1.5 segundos
    const steps = 60;
    const increment = target / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= target) {
        current = target;
        clearInterval(timer);
      }
      element.textContent = Math.floor(current);
    }, duration / steps);
  }

  /**
   * Limpa timeouts de animação
   */
  clearAnimationTimeouts() {
    this.animationTimeouts.forEach(timeout => clearTimeout(timeout));
    this.animationTimeouts = [];
  }

  /**
   * Compartilha estatísticas como imagem usando backend
   */
  async shareStats() {
    if (!this.currentStats) {
      console.error('Nenhuma estatística carregada para compartilhar');
      return;
    }

    try {
      const shareBtn = document.getElementById('share-stats-btn');
      const originalContent = shareBtn.innerHTML;
      
      // Mostra loading no botão
      shareBtn.innerHTML = '<i class="fas fa-spinner animate-spin mr-2"></i>Gerando...';
      shareBtn.disabled = true;


      // Pega token de autenticação
      const user = window.auth?.currentUser;
      if (!user) {
        throw new Error('Usuário não autenticado');
      }

      const token = await user.getIdToken();
      
      // Chama endpoint de geração de imagem
      const response = await fetch('/api/generate-stats-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erro ${response.status}: ${errorText}`);
      }

      // Recebe imagem como blob
      const imageBlob = await response.blob();
      
      // Faz download da imagem
      const url = URL.createObjectURL(imageBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `boredfy-stats-${new Date().getTime()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Feedback visual de sucesso
      shareBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Baixado!';
      shareBtn.disabled = false;
      
      setTimeout(() => {
        shareBtn.innerHTML = originalContent;
      }, 2000);

    } catch (error) {
      console.error('Erro ao gerar imagem de stats:', error);
      
      // Restaura botão em caso de erro
      const shareBtn = document.getElementById('share-stats-btn');
      shareBtn.innerHTML = '<i class="fas fa-exclamation-triangle mr-2"></i>Erro';
      shareBtn.disabled = false;
      
      setTimeout(() => {
        shareBtn.innerHTML = '<i class="fas fa-share-alt mr-2"></i>Compartilhar Stats';
      }, 3000);
      
      // Alerta para o usuário
      alert(`Erro ao gerar imagem: ${error.message}`);
    }
  }


  /**
   * Mostra o botão stats quando usuário estiver logado
   */
  showStatsButton() {
    const statsBtn = document.getElementById('stats-btn');
    if (statsBtn) {
      statsBtn.classList.remove('hidden');
    }
  }

  /**
   * Esconde o botão stats
   */
  hideStatsButton() {
    const statsBtn = document.getElementById('stats-btn');
    if (statsBtn) {
      statsBtn.classList.add('hidden');
    }
    this.closeModal();
  }
}

// Inicializa o manager globalmente
window.statsManager = new StatsManager();

// Compatibilidade para uso em módulos (se necessário)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StatsManager;
}