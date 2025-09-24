/**
 * services/geminiWorker.js
 * Sistema de Worker individual para processar jobs Gemini com retry inteligente
 */

import { callGenerativeAI } from '../api.js';

export class GeminiWorker {
  constructor(apiKey, workerId) {
    this.id = workerId;
    this.apiKey = apiKey;
    this.isAvailable = true;
    this.isActive = true; // Se false, worker está temporariamente desabilitado
    this.currentJob = null;
    this.consecutiveFailures = 0; // Contador de falhas consecutivas (diferentes de retry)
    this.maxRetries = 5;
    this.retryDelay = 20000; // 20 segundos
    this.cooldownDuration = 60000; // 60 segundos de cooldown
    this.lastError = null;
    this.cooldownUntil = null;
    this.stats = {
      processed: 0,
      successful: 0,
      failed: 0,
      totalRetries: 0
    };
    
    this.onStatusChange = null; // Callback para mudanças de status
  }

  /**
   * Verifica se o worker está disponível para pegar novo job
   */
  isReadyForWork() {
    if (!this.isActive) return false;
    if (!this.isAvailable) return false;
    if (this.cooldownUntil && new Date() < this.cooldownUntil) return false;
    return true;
  }

  /**
   * Processa um job com retry automático
   */
  async processJob(job, abortSignal) {
    if (!this.isReadyForWork()) {
      throw new Error(`Worker ${this.id} não está disponível`);
    }

    this.isAvailable = false;
    this.currentJob = job;
    this.stats.processed++;
    
    this.emitStatusChange('processing', `Processando: ${job.title.substring(0, 50)}...`);

    let localAttempts = 0;
    let lastError = null;

    while (localAttempts < this.maxRetries && this.isActive) {
      try {
        // Verifica se foi cancelado
        if (abortSignal && abortSignal.aborted) {
          throw new Error('Job cancelado pelo usuário');
        }

        localAttempts++;
        this.stats.totalRetries += (localAttempts > 1 ? 1 : 0);
        
        // console.log(`🔄 Worker ${this.id} tentativa ${localAttempts}/${this.maxRetries} para "${job.title.substring(0, 40)}..."`); 
        
        // LOG ORIGINAL: ⚙️ TaskName: Tentativa X/5...
        this.emitStatusChange('attempting', `⚙️ ${job.title}: Tentativa ${localAttempts}/${this.maxRetries}...`, job.id);
        
        if (localAttempts > 1) {
          await this.delay(this.retryDelay);
        }

        // Chama a API Gemini com flags corretas
        const result = await callGenerativeAI(
          this.apiKey, 
          job.prompt, 
          abortSignal,
          job.metadata?.isPremise || false,
          job.metadata?.isBlockOfScript || false
        );
        
        // Sucesso! Reset contador de falhas consecutivas
        this.stats.successful++;
        this.consecutiveFailures = 0;
        this.lastError = null;
        this.currentJob = null;
        this.isAvailable = true;
        
        // LOG ORIGINAL DE SUCESSO: ✅ TaskName gerado com sucesso!
        this.emitStatusChange('success', `✅ ${job.title} gerado com sucesso!`, job.id);
        
        return {
          success: true,
          result: result,
          attempts: localAttempts,
          workerId: this.id
        };

      } catch (error) {
        lastError = error;
        this.lastError = error.message;
        
        console.warn(`Worker ${this.id} falhou na tentativa ${localAttempts}:`, error.message);
        
        // LOG ORIGINAL DE ERRO: ❌ TaskName: Tentativa X falhou (erro).
        this.emitStatusChange('error', `❌ ${job.title}: Tentativa ${localAttempts} falhou (${error.message}).`, job.id);
        
        // Se foi cancelado, não tentar mais
        if (error.message.includes('cancelado') || (abortSignal && abortSignal.aborted)) {
          break;
        }
        
        // Se é erro de API key inválida, desativar worker permanentemente
        if (this.isApiKeyError(error)) {
          this.isActive = false;
          this.emitStatusChange('disabled', `API Key inválida`);
          break;
        }
        
        // LOG DE AGUARDO entre tentativas (se não for a última)
        if (localAttempts < this.maxRetries) {
          this.emitStatusChange('waiting', `⏳ Aguardando ${this.retryDelay / 1000} segundos...`, job.id);
        }
      }
    }

    // Falhou todas as 5 tentativas locais
    this.stats.failed++;
    this.consecutiveFailures++;
    
    // CRÍTICO: Liberar worker imediatamente
    this.currentJob = null;
    this.isAvailable = true;
    
    // APLICAR COOLDOWN APENAS APÓS 5 FALHAS
    // Se foi "model overloaded", aplicar cooldown de 60s para dar descanso à API
    if (lastError && (lastError.message.includes('overloaded') || lastError.message.includes('model is overloaded'))) {
      console.log(`🔄 Worker ${this.id} falhou 5x com "model overloaded" - aplicando cooldown de 60s`);
      this.applyCooldown();
    } else {
      // Para outros erros, aplicar cooldown padrão
      this.applyCooldown();
    }
    
    console.log(`❌ Worker ${this.id} falhou ${localAttempts}x no job "${job.title.substring(0, 30)}..." - liberando para outro worker tentar`);
    
    this.emitStatusChange('error', `Falhou ${localAttempts}x - job liberado para outro worker`);
    
    return {
      success: false,
      error: lastError?.message || 'Erro desconhecido',
      shouldRequeue: true, // IMPORTANTE: Indica que job deve voltar para fila
      attempts: localAttempts,
      workerId: this.id
    };
  }

  /**
   * Verifica se o erro indica problema com API key
   */
  isApiKeyError(error) {
    const message = error.message.toLowerCase();
    return message.includes('api key') || 
           message.includes('unauthorized') || 
           message.includes('invalid key') ||
           message.includes('forbidden');
  }

  /**
   * Verifica se o erro é de quota/limite que precisa cooldown
   */
  isQuotaError(error) {
    const message = error.message.toLowerCase();
    return message.includes('resposta vazia') ||
           message.includes('quota') ||
           message.includes('rate limit') ||
           message.includes('limite atingido') ||
           message.includes('filtro aplicado') ||
           message.includes('overloaded') ||
           message.includes('model is overloaded');
  }

  /**
   * Aplica cooldown de 60s ao worker após falha
   */
  applyCooldown() {
    this.cooldownUntil = new Date(Date.now() + this.cooldownDuration);
    // console.log(`⏸️ Worker ${this.id} em cooldown por 60s após falha`);
    this.emitStatusChange('cooldown', 'Worker em cooldown por 60s');
    
    // Auto-liberar após cooldown
    setTimeout(() => {
      if (this.cooldownUntil && new Date() >= this.cooldownUntil) {
        this.cooldownUntil = null;
        // console.log(`✅ Worker ${this.id} saiu do cooldown - disponível para novos jobs`);
        this.emitStatusChange('idle', 'Cooldown concluído - pronto para trabalhar');
      }
    }, this.cooldownDuration);
  }

  /**
   * Para o worker (marca como indisponível)
   */
  stop() {
    this.isActive = false;
    this.emitStatusChange('stopped', 'Worker parado');
  }

  /**
   * Reinicia o worker
   */
  restart() {
    this.isActive = true;
    this.isAvailable = true;
    this.consecutiveFailures = 0; // Limpar novo contador
    this.cooldownUntil = null;
    this.lastError = null;
    this.emitStatusChange('idle', 'Worker reiniciado');
  }

  /**
   * Obtem status detalhado do worker
   */
  getStatus() {
    if (!this.isActive) return 'disabled';
    if (this.cooldownUntil && new Date() < this.cooldownUntil) return 'cooldown';
    if (!this.isAvailable) return 'busy';
    return 'idle';
  }

  /**
   * Obtem informações detalhadas do worker
   */
  getInfo() {
    return {
      id: this.id,
      apiKey: `${this.apiKey.substring(0, 10)}...`,
      status: this.getStatus(),
      isActive: this.isActive,
      isAvailable: this.isAvailable,
      currentJob: this.currentJob ? this.currentJob.title : null,
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      cooldownUntil: this.cooldownUntil,
      stats: { ...this.stats }
    };
  }

  /**
   * Emite mudança de status
   */
  emitStatusChange(status, message = '', jobId = null) {
    if (this.onStatusChange) {
      this.onStatusChange({
        workerId: this.id,
        jobId: jobId || this.currentJob?.id, // Incluir job ID
        status: status,
        message: message,
        timestamp: new Date().toISOString(),
        info: this.getInfo()
      });
    }
  }

  /**
   * Utilitário para delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}