/**
 * api.js
 * * This module centralizes all interactions with external APIs by
 * calling our own backend server.
 */

import { state } from "./state.js";

// Apontar para o backend local da própria aplicação
export const BACKEND_URL = "/api";

// Função auxiliar para obter headers de autenticação com sessão
export async function getAuthHeaders() {
  if (window.fingerprintManager && window.fingerprintManager.getAuthHeaders) {
    return await window.fingerprintManager.getAuthHeaders();
  } else {
    // Fallback para método antigo se fingerprintManager não estiver disponível
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("Usuário não autenticado");

    const token = await user.getIdToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  }
}

export async function callGenerativeAI(
  apiKey,
  userPrompt,
  signal,
  isPremise = false,
  isBlockOfScript = false
) {
  const headers = await getAuthHeaders();

  const response = await fetch(`${BACKEND_URL}/generate-text`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      apiKey: apiKey,
      prompt: userPrompt,
      model: state.selectedGeminiModel,
      isPremise: isPremise,
      isBlockOfScript: isBlockOfScript, // Nova flag para blocos individuais
    }),
    signal: signal,
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    throw new Error(
      data.message || "Erro desconhecido ao gerar texto no servidor."
    );
  }

  return data.text;
}

export async function trackCompleteScript(scriptData) {
  const headers = await getAuthHeaders();

  const response = await fetch(`${BACKEND_URL}/track-complete-script`, {
    method: "POST",
    headers,
    body: JSON.stringify(scriptData),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    console.warn("Falha ao trackear roteiro completo:", data.message);
    // Não interrompe o fluxo se tracking falhar
  }

  return data;
}

export async function trackCompleteTTS(ttsData) {
  const headers = await getAuthHeaders();

  const response = await fetch(`${BACKEND_URL}/track-complete-tts`, {
    method: "POST",
    headers,
    body: JSON.stringify(ttsData),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    console.warn("Falha ao trackear TTS completo:", data.message);
    // Não interrompe o fluxo se tracking falhar
  }

  return data;
}

export async function generateTTS(
  textChunks,
  languageCode,
  voiceId,
  ttsApiKey
) {
  // console.log(`Enviando requisição de TTS para o backend: ${languageCode}`);

  const headers = await getAuthHeaders();

  try {
    const response = await fetch(`${BACKEND_URL}/tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ textChunks, languageCode, voiceId, ttsApiKey }),
      // Aumentar timeout para dar mais tempo ao servidor
      signal: AbortSignal.timeout(180000), // 3 minutos
    });

    // Verificar content-type antes de ler o body
    const contentType = response.headers.get("content-type");
    // console.log(
    //   `Resposta TTS - Status: ${response.status}, Content-Type: ${contentType}`
    // );

    // Ler o response apenas UMA vez
    const responseText = await response.text();

    if (!response.ok) {
      // Tentar fazer parse do JSON se possível
      if (contentType && contentType.includes("application/json")) {
        try {
          const error = JSON.parse(responseText);
          return {
            success: false,
            message: error.message || "Falha na geração de TTS no servidor.",
          };
        } catch (parseError) {
          console.error("Erro ao fazer parse da resposta de erro:", parseError);
        }
      }

      console.error(
        "Resposta de erro do servidor:",
        responseText.substring(0, 500)
      );
      return {
        success: false,
        message: `Erro do servidor (${
          response.status
        }): ${responseText.substring(0, 100)}...`,
      };
    }

    // Verificar se é JSON antes de fazer parse
    if (!contentType || !contentType.includes("application/json")) {
      console.error("Resposta não é JSON:", responseText.substring(0, 500));
      return {
        success: false,
        message: "Servidor retornou resposta inválida (não JSON)",
      };
    }

    const data = JSON.parse(responseText);
    // console.log(`TTS concluído - Sucesso: ${data.success}`);
    return data;
  } catch (error) {
    console.error("Erro na requisição TTS:", error);

    if (error.name === "TimeoutError") {
      return {
        success: false,
        message:
          "Timeout na geração de áudio - servidor demorou muito para responder",
      };
    }

    return { success: false, message: `Erro de comunicação: ${error.message}` };
  }
}

export async function generateTTSChunkByChunk(
  textChunks,
  languageCode,
  voiceId,
  ttsApiKeys,
  resultContainer,
  addResultLog
) {
  // console.log(
  //   `🎵 Iniciando geração de aúdio: ${textChunks.length} pedaços para ${languageCode}`
  // );
  // console.log(
  //   `🔑 Usando ${ttsApiKeys.length} API keys - processando ${Math.min(
  //     ttsApiKeys.length,
  //     textChunks.length
  //   )} pedaços por vez`
  // );

  const headers = await getAuthHeaders();
  const audioChunks = new Array(textChunks.length); // Array com tamanho fixo para manter ordem
  const allJobIds = []; // Para capturar TODOS os jobIds dos chunks

  // Processar chunks em grupos baseado no número de API keys
  const batchSize = ttsApiKeys.length;

  for (
    let batchStart = 0;
    batchStart < textChunks.length;
    batchStart += batchSize
  ) {
    const batchEnd = Math.min(batchStart + batchSize, textChunks.length);
    const currentBatch = [];

    const batchNumber = Math.floor(batchStart / batchSize) + 1;
    const totalBatches = Math.ceil(textChunks.length / batchSize);

    // console.log(
    //   `📦 Processando lote ${batchNumber}: pedaços ${
    //     batchStart + 1
    //   }-${batchEnd}/${textChunks.length}`
    // );
    addResultLog(
      resultContainer,
      `📦 Processando lote ${batchNumber}/${totalBatches}: pedaços ${
        batchStart + 1
      }-${batchEnd}/${textChunks.length}`
    );

    // Criar promises para o lote atual
    for (let i = batchStart; i < batchEnd; i++) {
      const chunkIndex = i;
      const textChunk = textChunks[chunkIndex];
      const apiKeyIndex = chunkIndex % ttsApiKeys.length; // Round-robin das API keys
      const ttsApiKey = ttsApiKeys[apiKeyIndex];

      // console.log(
      //   `🔄 Preparando pedaço ${chunkIndex + 1}/${
      //     textChunks.length
      //   } com API key ${ttsApiKey.substring(0, 10)}...`
      // );
      addResultLog(
        resultContainer,
        `🔄 Preparando pedaço ${chunkIndex + 1}/${
          textChunks.length
        } com API key ${ttsApiKey.substring(0, 10)}...`
      );

      const chunkPromise = processChunk(
        textChunk,
        chunkIndex,
        textChunks.length,
        languageCode,
        voiceId,
        ttsApiKey,
        headers
      );
      currentBatch.push({ promise: chunkPromise, index: chunkIndex });
    }

    // Processar lote atual em paralelo
    try {
      const batchResults = await Promise.all(
        currentBatch.map((item) => item.promise)
      );

      // Armazenar resultados na posição correta e capturar TODOS os jobIds
      batchResults.forEach((result, idx) => {
        const chunkIndex = currentBatch[idx].index;
        audioChunks[chunkIndex] = result.audio_base_64; // Extrair apenas o áudio

        // Capturar TODOS os jobIds (cada chunk tem seu próprio jobId)
        if (result.jobId) {
          allJobIds.push(result.jobId);
        }

        // console.log(
        //   `✅ Pedaço ${chunkIndex + 1}/${
        //     textChunks.length
        //   } processado com sucesso!`
        // );
        addResultLog(
          resultContainer,
          `✅ Pedaço ${chunkIndex + 1}/${
            textChunks.length
          } processado com sucesso!`
        );
      });

      // Delay entre lotes (exceto no último)
      if (batchEnd < textChunks.length) {
        // console.log(`⏳ Aguardando 3 segundos antes do próximo lote...`);
        addResultLog(
          resultContainer,
          `⏳ Aguardando 3 segundos antes do próximo lote...`
        );
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(`❌ Erro no lote ${batchNumber}:`, error);
      addResultLog(
        resultContainer,
        `❌ Erro no lote ${batchNumber}: ${error.message}`,
        "error"
      );
      throw new Error(
        `Falha no lote de pedaços ${batchStart + 1}-${batchEnd}: ${
          error.message
        }`
      );
    }
  }

  // Verificar se todos os chunks foram processados
  const missingChunks = audioChunks
    .map((chunk, idx) => (chunk ? null : idx))
    .filter((idx) => idx !== null);
  if (missingChunks.length > 0) {
    const errorMsg = `Pedaços faltando: ${missingChunks
      .map((idx) => idx + 1)
      .join(", ")}`;
    addResultLog(resultContainer, `❌ ${errorMsg}`, "error");
    throw new Error(errorMsg);
  }

  // Combinar todos os chunks de áudio
  // console.log(`🔗 Combinando ${audioChunks.length} pedaços de áudio...`);
  addResultLog(
    resultContainer,
    `🔗 Combinando ${audioChunks.length} pedaços de áudio...`
  );

  const combinedAudio = combineAudioChunks(audioChunks);

  // console.log(
  //   `✅ TTS paralelo concluído com sucesso! (${ttsApiKeys.length} APIs simultâneas)`
  // );
  addResultLog(
    resultContainer,
    `🔗 TTS paralelo concluído com sucesso! Salvando no servidor...`
  );

  // NOVA FUNCIONALIDADE: Salvar áudio no servidor ao invés de retornar base64
  try {
    const saveResponse = await fetch(`${BACKEND_URL}/save-generated-content`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        type: 'audio',
        content: combinedAudio,
        metadata: {
          language: languageCode,
          voice: voiceId,
          chunks: audioChunks.length,
          apis_used: ttsApiKeys.length
        }
      })
    });

    if (!saveResponse.ok) {
      throw new Error('Falha ao salvar áudio no servidor');
    }

    const saveData = await saveResponse.json();
    
    if (!saveData.success) {
      throw new Error(saveData.message || 'Erro ao salvar áudio');
    }

    addResultLog(
      resultContainer,
      `💾 Áudio salvo no servidor! (${(saveData.size/1024/1024).toFixed(1)}MB)`
    );

    return {
      success: true,
      serverPath: saveData.serverPath, // NOVO: Caminho no servidor
      fileId: saveData.fileId,
      chunks_processed: audioChunks.length,
      apis_used: ttsApiKeys.length,
      parallel_processing: true,
      jobIds: allJobIds, // Array com TODOS os jobIds para tracking posterior
      size: saveData.size,
      // NÃO retornar mais audio_base_64 para economizar memória!
    };

  } catch (saveError) {
    console.error('❌ Erro crítico ao salvar áudio no servidor:', saveError);
    addResultLog(
      resultContainer,
      `❌ ERRO: Falha ao salvar áudio no servidor: ${saveError.message}`,
      'error'
    );

    // SEM FALLBACK - sistema novo deve funcionar sempre
    throw new Error(`Falha crítica ao salvar áudio no servidor: ${saveError.message}`);
  }
}

// Função auxiliar para processar um chunk individual
async function processChunk(
  textChunk,
  chunkIndex,
  totalChunks,
  languageCode,
  voiceId,
  ttsApiKey,
  headers
) {
  try {
    const response = await fetch(`${BACKEND_URL}/tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        textChunk,
        chunkIndex,
        totalChunks,
        languageCode,
        voiceId,
        ttsApiKey,
      }),
      // Timeout por chunk individual
      signal: AbortSignal.timeout(90000), // 90 segundos por chunk
    });

    // Verificar content-type antes de ler o body
    const contentType = response.headers.get("content-type");

    // Ler o response apenas UMA vez
    const responseText = await response.text();

    if (!response.ok) {
      // Tentar fazer parse do JSON se possível
      if (contentType && contentType.includes("application/json")) {
        try {
          const error = JSON.parse(responseText);
          throw new Error(
            error.message || "Falha na geração de TTS no servidor."
          );
        } catch (parseError) {
          console.error("Erro ao fazer parse da resposta de erro:", parseError);
        }
      }

      console.error(
        `Erro no chunk ${chunkIndex + 1}:`,
        responseText.substring(0, 500)
      );
      throw new Error(
        `Erro do servidor no chunk ${chunkIndex + 1} (${
          response.status
        }): ${responseText.substring(0, 100)}...`
      );
    }

    // Verificar se é JSON antes de fazer parse
    if (!contentType || !contentType.includes("application/json")) {
      console.error(
        `Chunk ${chunkIndex + 1} - Resposta não é JSON:`,
        responseText.substring(0, 500)
      );
      throw new Error(
        `Servidor retornou resposta inválida para chunk ${
          chunkIndex + 1
        } (não JSON)`
      );
    }

    const data = JSON.parse(responseText);

    if (!data.success) {
      throw new Error(data.message || `Falha no chunk ${chunkIndex + 1}`);
    }

    return {
      audio_base_64: data.audio_base_64,
      jobId: data.jobId, // Capturar jobId do response
    };
  } catch (error) {
    console.error(`❌ Erro no chunk ${chunkIndex + 1}:`, error);

    if (error.name === "TimeoutError") {
      throw new Error(
        `Timeout no pedaço ${
          chunkIndex + 1
        } - servidor demorou muito para responder`
      );
    }

    throw new Error(`Falha no pedaço ${chunkIndex + 1}: ${error.message}`);
  }
}

// Função para combinar chunks de áudio base64
function combineAudioChunks(audioChunks) {
  // console.log(`🔗 Combinando ${audioChunks.length} pedaços de áudio...`);

  // Converter cada chunk base64 para bytes e combinar
  const audioBuffers = audioChunks.map((chunk) => {
    // Decodificar base64 para bytes
    const binaryString = atob(chunk);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  });

  // Calcular tamanho total
  const totalLength = audioBuffers.reduce(
    (sum, buffer) => sum + buffer.length,
    0
  );

  // Criar buffer combinado
  const combinedBuffer = new Uint8Array(totalLength);
  let offset = 0;

  for (const buffer of audioBuffers) {
    combinedBuffer.set(buffer, offset);
    offset += buffer.length;
  }

  // Converter de volta para base64
  let binaryString = "";
  for (let i = 0; i < combinedBuffer.length; i++) {
    binaryString += String.fromCharCode(combinedBuffer[i]);
  }

  const combinedBase64 = btoa(binaryString);
  // console.log(`✅ Áudio combinado: ${combinedBase64.length} caracteres`);

  return combinedBase64;
}

export async function fetchUrlContent(urlToFetch) {
  // console.log(
  //   `Enviando requisição de fetch de URL para o backend: ${urlToFetch}`
  // );

  const headers = await getAuthHeaders();
  delete headers["Content-Type"]; // Remove Content-Type para GET request

  const response = await fetch(
    `${BACKEND_URL}/fetch-url?url=${encodeURIComponent(urlToFetch)}`,
    {
      headers,
    }
  );

  if (!response.ok) {
    const error = await response.json();
    return {
      success: false,
      error: error.error || "Falha ao buscar conteúdo da URL no servidor.",
    };
  }

  return await response.json();
}

// Função principal para criar ZIP - NOVA IMPLEMENTAÇÃO OTIMIZADA
export async function createZipFromInlineFiles(files) {
  console.log('🔄 [Compatibility] createZipFromInlineFiles redirecionando para sistema otimizado');
  return await createOptimizedZip(files);
}

// IMPLEMENTAÇÃO LEGACY (desabilitada) - mantida para referência  
async function createZipFromInlineFilesLegacy(files) {
  const headers = await getAuthHeaders();

  // Verificar tamanho total antes de enviar
  const totalSize = files.reduce((sum, f) => {
    const contentSize = f?.content?.length || 0;
    return sum + contentSize;
  }, 0);

  console.log(
    `📊 Tamanho total dos arquivos: ${(totalSize / 1024 / 1024).toFixed(2)} MB`
  );

  // Limite de segurança: 50MB para UPLOAD (proxy reverso/nginx limita)
  const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB em bytes

  if (totalSize > MAX_UPLOAD_SIZE) {
    // Se for muito grande para UPLOAD, dividir em chunks, mas o servidor criará 1 ZIP único
    console.log(
      `⚠️ Arquivos muito grandes para upload (${(
        totalSize /
        1024 /
        1024
      ).toFixed(2)} MB), enviando em partes... Servidor criará 1 ZIP único.`
    );
    return await uploadInChunksAndCreateSingleZip(files, totalSize);
  }

  // SEMPRE usar inlineFiles - o backend salva no servidor primeiro
  const response = await fetch(`${BACKEND_URL}/create-zip-from-server-files`, {
    method: "POST",
    headers,
    body: JSON.stringify({ inlineFiles: files }),
  });

  // Verifica content-type antes de tentar fazer .json()
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    const textResponse = await response.text();
    throw new Error(
      `Resposta não JSON (possível HTML/Cloudflare): ${textResponse.substring(
        0,
        100
      )}...`
    );
  }

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Erro ao criar o zip no backend.");
  }
  return data.downloadUrl;
}

// Função para enviar arquivos grandes em chunks e criar 1 ZIP único no servidor
async function uploadInChunksAndCreateSingleZip(files, totalSize) {
  const CHUNK_SIZE = 40 * 1024 * 1024; // 40MB por chunk (seguro para proxies)
  const chunks = [];
  let currentChunk = [];
  let currentChunkSize = 0;

  console.log(
    `📦 Dividindo ${files.length} arquivos em chunks de ${(
      CHUNK_SIZE /
      1024 /
      1024
    ).toFixed(1)}MB para upload...`
  );

  // Dividir arquivos em chunks
  for (const file of files) {
    const fileSize = file?.content?.length || 0;

    // Se adicionar este arquivo ultrapassar o limite do chunk atual
    if (currentChunkSize + fileSize > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push([...currentChunk]);
      currentChunk = [];
      currentChunkSize = 0;
    }

    currentChunk.push(file);
    currentChunkSize += fileSize;
  }

  // Adicionar último chunk se não estiver vazio
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  console.log(`📦 Criados ${chunks.length} chunks para upload`);

  // Criar um sessionId único para esta operação
  const sessionId = `session_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  console.log(`🔗 Sessão criada: ${sessionId}`);

  // Enviar cada chunk para o servidor (que vai salvá-los)
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkSize = chunk.reduce(
      (sum, f) => sum + (f?.content?.length || 0),
      0
    );

    console.log(
      `📦 Enviando chunk ${i + 1}/${chunks.length} (${(
        chunkSize /
        1024 /
        1024
      ).toFixed(2)} MB)...`
    );

    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`${BACKEND_URL}/upload-chunk-for-zip`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          sessionId,
          chunkIndex: i,
          totalChunks: chunks.length,
          files: chunk,
          isLastChunk: i === chunks.length - 1,
        }),
      });

      // Verifica content-type antes de tentar fazer .json()
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await response.text();
        throw new Error(
          `Resposta não JSON no chunk ${i + 1}: ${textResponse.substring(
            0,
            100
          )}...`
        );
      }

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || `Erro ao enviar chunk ${i + 1}`);
      }

      console.log(`✅ Chunk ${i + 1}/${chunks.length} enviado com sucesso`);

      // Se é o último chunk, o servidor criou o ZIP único
      if (i === chunks.length - 1 && data.zipCreated) {
        console.log(
          `🎉 ZIP único criado com sucesso! ${data.totalFiles} arquivos`
        );
        return data.downloadUrl; // Retorna URL do ZIP único
      }
    } catch (error) {
      console.error(`❌ Erro no chunk ${i + 1}:`, error);
      throw error;
    }
  }

  throw new Error(
    "Erro inesperado: ZIP não foi criado após enviar todos os chunks"
  );
}

// ============= NOVO SISTEMA ZIP OTIMIZADO =============

/**
 * Função otimizada para criação de ZIP usando streaming
 * Substitui sistema fragmentado por solução unificada
 */
/**
 * NOVA FUNÇÃO: createOptimizedZip usando STREAMING PURO
 * Esta é a solução DEFINITIVA que contorna o limite de 100MB do Cloudflare
 */
export async function createOptimizedZip(files, options = {}) {
  // Validação básica
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new Error('Nenhum arquivo fornecido para criação do ZIP');
  }

  const startTime = Date.now();

  // Preparar arquivos para streaming (apenas referências e pequenos arquivos)
  const streamFiles = files.map(file => {
    // Priorizar serverPath (arquivos já no servidor)
    if (file.serverPath) {
      return {
        name: file.name,
        serverPath: file.serverPath
        // NÃO enviar content para economizar bandwidth
      };
    } 
    
    // Para arquivos pequenos sem serverPath, manter inline
    if (file.content && file.content.length < 1024 * 1024) { // < 1MB
      return {
        name: file.name,
        content: file.content
      };
    }

    // Arquivos grandes sem serverPath - problema!
    console.warn(`⚠️ Arquivo grande sem serverPath: ${file.name} (${(file.content?.length || 0 / 1024).toFixed(1)}KB)`);
    return {
      name: file.name,
      content: file.content || '[Conteúdo não disponível]'
    };
  });

  // Calcular payload (deve ser muito pequeno agora)
  const payloadSize = JSON.stringify(streamFiles).length;
  console.log(`🚀 [StreamZIP] Iniciando download streaming: ${files.length} arquivos, payload: ${(payloadSize/1024).toFixed(1)}KB`);

  try {
    // Usar novo endpoint de streaming
    const response = await fetch(`${BACKEND_URL}/download-zip-stream`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({ 
        files: streamFiles,
        name: options.name || null
      }),
    });

    if (!response.ok) {
      // Para streaming, erro pode vir como JSON ou text
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Erro no servidor de streaming");
      } else {
        const errorText = await response.text();
        throw new Error(`Erro do servidor: ${errorText.substring(0, 100)}...`);
      }
    }

    // Para streaming, response é o arquivo ZIP diretamente
    const blob = await response.blob();
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ [StreamZIP] Download concluído em ${processingTime}ms (${(blob.size/1024/1024).toFixed(2)}MB)`);
    
    // Retornar blob para download direto
    return blob;

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ [StreamZIP] Erro após ${processingTime}ms:`, error.message);
    throw new Error(`Erro no streaming de ZIP: ${error.message}`);
  }
}

// Função legada (mantida para compatibilidade) - agora usa sistema otimizado
export async function createZipNoBackend(files) {
  console.log('⚠️ [Compatibility] Usando createZipNoBackend legado - redirecionando para sistema otimizado');
  return await createOptimizedZip(files);
}

// Lista arquivos do usuário autenticado (zips salvos)
export async function listUserFiles() {
  const headers = await getAuthHeaders();
  delete headers["Content-Type"]; // GET
  const response = await fetch(`${BACKEND_URL}/user-files`, { headers });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Erro ao listar arquivos");
  }
  return data.files || [];
}

// Adiciona arquivos aos "Meus Arquivos" automaticamente (sem download imediato)
export async function addToMyFiles(files, name = null) {
  // console.log(`🔄 addToMyFiles iniciado com ${files.length} arquivos`);
  
  // SIMPLES: Enviar OS MESMOS arquivos que o download usa!
  const headers = await getAuthHeaders();
  
  const response = await fetch(`${BACKEND_URL}/add-user-file`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      files, // OS MESMOS ARQUIVOS (com serverPath quando disponível)
      name,
    }),
  });

  // Verifica content-type antes de tentar fazer .json()
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    const textResponse = await response.text();
    throw new Error(
      `Resposta não JSON (possível HTML/Cloudflare): ${textResponse.substring(
        0,
        100
      )}...`
    );
  }

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Erro ao adicionar arquivos");
  }

  // console.log(`✅ ZIP salvo em 'Meus Arquivos': ${data.name}`);
  return data;
}


// Download autenticado de um arquivo do usuário
export async function downloadUserFile(downloadUrl) {
  const headers = await getAuthHeaders();
  delete headers["Content-Type"]; // GET
  const response = await fetch(downloadUrl, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Falha no download (${response.status}): ${text.substring(0, 120)}`
    );
  }
  const blob = await response.blob();
  // Tenta extrair nome do arquivo do header
  const cd = response.headers.get("content-disposition") || "";
  let filename = "arquivo.zip";
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  if (match) {
    filename = decodeURIComponent(match[1] || match[2] || filename);
  }
  return { blob, filename };
}

// Função para salvar agentes personalizados
export async function saveCustomAgents(customAgents) {
  const headers = await getAuthHeaders();

  const response = await fetch(`${BACKEND_URL}/save-agents`, {
    method: "POST",
    headers,
    body: JSON.stringify({ customAgents }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Erro ao salvar agentes");
  }
  return data;
}

// Função para carregar agentes personalizados
export async function loadCustomAgents() {
  const headers = await getAuthHeaders();
  delete headers["Content-Type"]; // Remove Content-Type para GET request

  const response = await fetch(`${BACKEND_URL}/get-agents`, {
    headers,
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Erro ao carregar agentes");
  }
  return data.customAgents || {};
}

// Função para validar API Keys
export async function validateApiKey(apiKey, apiType) {
  const headers = await getAuthHeaders();

  try {
    const requestBody = { apiKey, apiType };

    // Incluir modelo apenas para validação do Gemini
    if (apiType === "gemini") {
      requestBody.model = state.selectedGeminiModel;
    }

    const response = await fetch(`${BACKEND_URL}/validate-api-key`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        validation: {
          valid: false,
          message: data.message || "Erro na validação",
          details: { statusCode: response.status },
        },
      };
    }

    return data;
  } catch (error) {
    return {
      success: false,
      validation: {
        valid: false,
        message: "Erro de comunicação com o servidor",
        details: { error: error.message },
      },
    };
  }
}
