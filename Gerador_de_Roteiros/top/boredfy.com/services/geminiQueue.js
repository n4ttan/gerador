/**
 * services/geminiQueue.js
 * Sistema de fila inteligente para processar jobs Gemini com múltiplos workers
 */

import { GeminiWorker } from './geminiWorker.js';

export class GeminiQueueManager {
  constructor() {
    this.queue = []; // Fila de jobs aguardando
    this.workers = new Map(); // Workers disponíveis
    this.processing = new Map(); // Jobs em processamento
    this.completed = []; // Jobs completados
    this.failed = []; // Jobs que falharam definitivamente
    
    this.isRunning = false;
    this.abortController = null;
    this.maxConcurrent = 1; // Será redefinido dinamicamente baseado no número de API keys
    
    // Sistema de retry distribuído
    this.jobAttemptsByWorker = new Map(); // Rastreia tentativas por job
    this.maxUniqueWorkerAttempts = 3; // Máximo de workers diferentes que podem tentar
    
    // Callbacks para eventos
    this.onJobComplete = null;
    this.onJobFailed = null;
    this.onWorkerStatusChange = null;
    this.onQueueStatusChange = null;
    
    // Estatísticas
    this.stats = {
      totalJobs: 0,
      completed: 0,
      failed: 0,
      inQueue: 0,
      processing: 0
    };
    
    this.processingInterval = null;
    
    // NOVO: Sistema de throttling para logs
    this.logThrottler = {
      lastWorkerStatus: null,
      lastLogTime: 0,
      logCooldown: 5000 // 5 segundos entre logs similares
    };
  }

  /**
   * Determina se deve fazer log do status dos workers (throttling)
   */
  shouldLogWorkerStatus(availableCount) {
    const now = Date.now();
    const currentStatus = `${availableCount}/${this.workers.size}`;
    
    // Log sempre se status mudou ou se passou tempo suficiente
    if (currentStatus !== this.logThrottler.lastWorkerStatus || 
        now - this.logThrottler.lastLogTime > this.logThrottler.logCooldown) {
      this.logThrottler.lastWorkerStatus = currentStatus;
      this.logThrottler.lastLogTime = now;
      return true;
    }
    
    return false;
  }

  /**
   * Inicializa workers com as API keys fornecidas
   */
  initializeWorkers(apiKeys) {
    // Remove workers existentes
    this.workers.clear();
    
    // Cria novo worker para cada API key
    apiKeys.forEach((apiKey, index) => {
      if (apiKey && apiKey.trim()) {
        const worker = new GeminiWorker(apiKey.trim(), `worker-${index + 1}`);
        
        // Configura callback para mudanças de status
        worker.onStatusChange = (statusData) => {
          if (this.onWorkerStatusChange) {
            this.onWorkerStatusChange(statusData);
          }
        };
        
        this.workers.set(worker.id, worker);
      }
    });
    
    // Define workers simultâneos = número de API keys disponíveis
    this.maxConcurrent = Math.max(1, this.workers.size);
    
    // LOG CRÍTICO para debug
    // console.log(`🔧 GeminiQueue: Inicializados ${this.workers.size} workers com API keys válidas`);
    // console.log(`📊 Workers criados: ${Array.from(this.workers.keys()).join(', ')}`);
    // console.log(`⚙️ MaxConcurrent definido para: ${this.maxConcurrent}`);
    
    this.emitQueueStatusChange();
  }

  /**
   * Adiciona jobs à fila
   */
  addJobs(jobs) {
    const timestamp = Date.now();
    const newJobs = jobs.map((job, index) => ({
      id: `job-${timestamp}-${index}-${Math.random().toString(36).substr(2, 9)}`,
      title: job.title,
      prompt: job.prompt,
      metadata: job.metadata || {},
      addedAt: new Date(),
      attempts: 0,
      status: 'queued'
    }));
    
    this.queue.push(...newJobs);
    this.stats.totalJobs += newJobs.length;
    this.stats.inQueue = this.queue.length;
    
    // console.log(`📝 Adicionados ${newJobs.length} jobs à fila (total: ${this.queue.length})`);
    // Log detalhado dos IDs para debug
    newJobs.forEach(job => {
      // console.log(`🆔 Job criado: ${job.id} | Título: ${job.title}`);
    });
    this.emitQueueStatusChange();
    
    return newJobs.map(job => job.id);
  }

  /**
   * Inicia o processamento da fila
   */
  start() {
    if (this.isRunning) {
      console.warn('⚠️ Queue manager já está rodando');
      return;
    }
    
    if (this.workers.size === 0) {
      throw new Error('Nenhum worker disponível. Inicialize os workers primeiro.');
    }
    
    this.isRunning = true;
    this.abortController = new AbortController();
    
    // console.log(`🚀 Iniciando processamento com ${this.workers.size} workers`);
    
    // Inicia loop de processamento otimizado
    this.processingInterval = setInterval(() => {
      this.processNextJobs();
    }, 500); // Verifica a cada meio segundo para melhor responsividade
    
    // Processa jobs imediatamente
    this.processNextJobs();
    this.emitQueueStatusChange();
  }

  /**
   * Para o processamento da fila com limpeza completa
   */
  stop() {
    if (!this.isRunning) return;
    
    // console.log('🛑 Parando GeminiQueue com limpeza completa...');
    
    this.isRunning = false;
    
    // Para AbortController
    if (this.abortController) {
      this.abortController.abort("Queue parada pelo usuário");
      this.abortController = null;
    }
    
    // Para interval de processamento
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('🔧 GeminiQueue interval limpo');
    }
    
    // Para todos os workers
    this.workers.forEach(worker => {
      worker.stop();
    });
    
    // console.log('✅ GeminiQueue parado completamente');
    this.emitQueueStatusChange();
  }

  /**
   * Processa próximos jobs na fila
   */
  async processNextJobs() {
    if (!this.isRunning) return;
    
    // Encontra workers disponíveis (não em cooldown e não ocupados)
    const availableWorkers = Array.from(this.workers.values())
      .filter(worker => worker.isReadyForWork());
    
    // LOGGING OTIMIZADO - apenas quando há mudanças significativas
    if (this.shouldLogWorkerStatus(availableWorkers.length)) {
      const allWorkers = Array.from(this.workers.values());
      const workerStats = allWorkers.map(w => `${w.id}:${w.getStatus()}`).join(', ');
      // console.log(`📊 Status workers: [${workerStats}] → ${availableWorkers.length}/${allWorkers.length} disponíveis`);
    }
    
    if (availableWorkers.length === 0 || this.queue.length === 0) {
      if (availableWorkers.length === 0 && this.queue.length > 0) {
        console.log(`⏸️ ${this.queue.length} jobs na fila aguardando workers ficarem disponíveis`);
      }
      return; // Sem workers ou jobs
    }
    
    // CORRIGIDO: Usar todos os workers disponíveis, não limitar por processamento atual
    const currentProcessing = this.processing.size;
    const maxCanProcess = Math.min(availableWorkers.length, this.queue.length);
    
    // LOG DEBUG otimizado - apenas em desenvolvimento ou quando necessário
    if (this.queue.length > 0 && availableWorkers.length > 0) {
      // console.log(`🔧 DEBUG: Processing=${currentProcessing}, Available=${availableWorkers.length}, CanProcess=${maxCanProcess}, Queue=${this.queue.length}`);
    }
    
    if (maxCanProcess <= 0) return;
    
    // Ordenar fila: jobs com priority 'high' primeiro
    const sortedQueue = [...this.queue].sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      return 0;
    });
    
    // Processar jobs com workers compatíveis
    let processedCount = 0;
    const processedJobIds = new Set();
    
    for (const worker of availableWorkers) {
      if (processedCount >= maxCanProcess) break;
      
      // Encontrar job que este worker ainda não tentou
      const jobIndex = sortedQueue.findIndex(job => {
        if (processedJobIds.has(job.id)) return false; // Já foi processado nesta iteração
        if (!job.excludedWorkers) return true; // Nenhum worker excluído
        return !job.excludedWorkers.includes(worker.id); // Worker não está excluído
      });
      
      if (jobIndex !== -1) {
        const job = sortedQueue[jobIndex];
        processedJobIds.add(job.id);
        
        // Remover da fila real
        this.queue = this.queue.filter(j => j.id !== job.id);
        
        // Marcar como processando
        job.status = 'processing';
        job.workerId = worker.id;
        job.startedAt = new Date();
        this.processing.set(job.id, job);
        
        // LOGGING OTIMIZADO - info essencial apenas
        // console.log(`🚀 Worker ${worker.id} iniciou job "${job.title.substring(0, 30)}..." (${processedCount + 1}/${maxCanProcess})`);
        
        // Processar de forma assíncrona
        this.processJobWithWorker(job, worker);
        processedCount++;
      }
    }
    
    this.updateStats();
    this.emitQueueStatusChange();
  }

  /**
   * Processa um job específico com um worker
   */
  async processJobWithWorker(job, worker) {
    // Inicializar tracking para este job
    if (!this.jobAttemptsByWorker.has(job.id)) {
      this.jobAttemptsByWorker.set(job.id, {
        workersAttempted: new Set(),
        totalFailures: 0,
        lastError: null
      });
    }
    
    const jobTracking = this.jobAttemptsByWorker.get(job.id);
    jobTracking.workersAttempted.add(worker.id);
    
    try {
      const result = await worker.processJob(job, this.abortController?.signal);
      
      // Remove do processamento
      this.processing.delete(job.id);
      
      if (result.success) {
        // SUCESSO - completar job
        this.completeJob(job, result);
        
      } else if (result.shouldRequeue) {
        // FALHOU mas deve tentar com outro worker
        jobTracking.totalFailures++;
        jobTracking.lastError = result.error;
        
        console.log(`🔄 Job "${job.title.substring(0, 40)}..." falhou no worker ${worker.id} (tentativa ${jobTracking.workersAttempted.size}/${this.maxUniqueWorkerAttempts})`);
        
        if (jobTracking.workersAttempted.size < this.maxUniqueWorkerAttempts) {
          // Ainda pode tentar com outro worker - recolocar na fila
          this.requeueJob(job, worker.id);
        } else {
          // Já tentou com máximo de workers - falha definitiva
          console.log(`❌ Job "${job.title}" falhou em ${jobTracking.workersAttempted.size} workers diferentes - falha definitiva`);
          this.failJob(job, `Falhou após tentativas em ${jobTracking.workersAttempted.size} workers: ${jobTracking.lastError}`);
        }
      } else {
        // Falha definitiva sem requeue (ex: API key inválida)
        this.failJob(job, result.error);
      }
      
    } catch (error) {
      // Erro crítico - recolocar na fila para outro worker tentar
      console.error(`💥 Erro crítico processando job "${job.title}":`, error);
      
      this.processing.delete(job.id);
      this.requeueJob(job, worker.id);
    }
    
    this.updateStats();
    this.emitQueueStatusChange();
    
    // IMPORTANTE: Processar próximos jobs imediatamente
    setTimeout(() => this.processNextJobs(), 100);
  }

  /**
   * Completa um job com sucesso
   */
  completeJob(job, result) {
    job.status = 'completed';
    job.result = result.result;
    job.completedAt = new Date();
    job.attempts = result.attempts;
    job.workerId = result.workerId;
    
    this.completed.push(job);
    this.stats.completed++;
    
    // Limpar tracking
    this.jobAttemptsByWorker.delete(job.id);
    
    // console.log(`✅ Job "${job.title.substring(0, 40)}..." completado com sucesso pelo worker ${result.workerId}`);
    
    if (this.onJobComplete) {
      this.onJobComplete(job, result);
    }
  }

  /**
   * Falha um job definitivamente
   */
  failJob(job, errorMessage) {
    job.status = 'failed';
    job.error = errorMessage;
    job.failedAt = new Date();
    
    this.failed.push(job);
    this.stats.failed++;
    
    // Limpar tracking
    this.jobAttemptsByWorker.delete(job.id);
    
    console.error(`❌ Job "${job.title}" falhou definitivamente: ${errorMessage}`);
    
    if (this.onJobFailed) {
      this.onJobFailed(job, { error: errorMessage });
    }
  }

  /**
   * Recoloca job na fila para outro worker tentar
   */
  requeueJob(job, excludeWorkerId) {
    // Marcar workers que já tentaram
    if (!job.excludedWorkers) {
      job.excludedWorkers = [];
    }
    if (!job.excludedWorkers.includes(excludeWorkerId)) {
      job.excludedWorkers.push(excludeWorkerId);
    }
    
    // Reset status
    job.status = 'queued';
    job.priority = 'high'; // Prioridade alta para jobs que falharam
    delete job.workerId;
    delete job.startedAt;
    
    // IMPORTANTE: Colocar no início da fila para tentar logo
    this.queue.unshift(job);
    this.stats.inQueue = this.queue.length;
    
    // LOGGING MELHORADO
    const availableWorkers = Array.from(this.workers.values()).filter(w => w.isReadyForWork());
    const eligibleWorkers = availableWorkers.filter(w => !job.excludedWorkers.includes(w.id));
    
    // LOGGING OTIMIZADO - apenas info crítica
    console.log(`🔄 Job "${job.title.substring(0, 30)}..." requeued (${eligibleWorkers.length} workers restantes)`);
  }

  /**
   * Atualiza estatísticas
   */
  updateStats() {
    this.stats.inQueue = this.queue.length;
    this.stats.processing = this.processing.size;
  }

  /**
   * Obtém status da fila
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      workers: Array.from(this.workers.values()).map(w => w.getInfo()),
      queue: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.length,
      failed: this.failed.length,
      stats: { ...this.stats },
      nextJobs: this.queue.slice(0, 5).map(job => ({
        id: job.id,
        title: job.title,
        status: job.status
      }))
    };
  }

  /**
   * Limpa fila e resultados
   */
  clear() {
    this.stop();
    this.queue = [];
    this.processing.clear();
    this.completed = [];
    this.failed = [];
    this.stats = {
      totalJobs: 0,
      completed: 0,
      failed: 0,
      inQueue: 0,
      processing: 0
    };
    this.emitQueueStatusChange();
  }

  /**
   * Reprocessa jobs falhados
   */
  retryFailedJobs() {
    if (this.failed.length === 0) return;
    
    const jobsToRetry = this.failed.splice(0); // Move todos os falhados
    
    jobsToRetry.forEach(job => {
      job.status = 'queued';
      job.attempts = 0;
      delete job.error;
      delete job.failedAt;
      delete job.workerId;
    });
    
    this.queue.push(...jobsToRetry);
    this.stats.failed = 0;
    this.stats.inQueue = this.queue.length;
    
    console.log(`🔄 Reprocessando ${jobsToRetry.length} jobs falhados`);
    this.emitQueueStatusChange();
  }

  /**
   * Reinicia workers com problemas
   */
  restartWorkers() {
    this.workers.forEach(worker => {
      if (worker.getStatus() === 'disabled' || worker.getStatus() === 'cooldown') {
        worker.restart();
      }
    });
    console.log('🔄 Workers reiniciados');
  }

  /**
   * Emite mudança de status da fila
   */
  emitQueueStatusChange() {
    if (this.onQueueStatusChange) {
      this.onQueueStatusChange(this.getStatus());
    }
  }

  /**
   * Obtém resultados completados
   */
  getCompletedResults() {
    return this.completed.map(job => ({
      id: job.id,
      title: job.title,
      result: job.result,
      metadata: job.metadata,
      completedAt: job.completedAt,
      attempts: job.attempts
    }));
  }

  /**
   * Obtém jobs falhados
   */
  getFailedJobs() {
    return this.failed.map(job => ({
      id: job.id,
      title: job.title,
      error: job.error,
      metadata: job.metadata,
      failedAt: job.failedAt,
      attempts: job.attempts
    }));
  }
}