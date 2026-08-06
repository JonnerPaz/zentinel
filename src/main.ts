import { createCaptureMiddleware } from "./middleware/capture.js";
import { AsyncQueue, BatchProcessor } from "./core/queue/processor.js";
import type { Storage } from "./core/storage/interface.js";

class zentinel {
  private queue: AsyncQueue;
  private batchProcessor: BatchProcessor;
  constructor(private storage: Storage = null as any) {
    this.queue = new AsyncQueue();
    this.batchProcessor = new BatchProcessor(this.queue, this.storage, {
      batchSize: 50,
      flushIntervalMs: 1000,
    });
    this.batchProcessor.start();
  }

  init() {
    return createCaptureMiddleware({
      captureResponseBody: true,
      onRecordCaptured: (record) => {
        // Por ahora mostramos en consola el objeto capturado para verificar los datos de RF-02
        console.log("\n================ 📊 REGISTRO CAPTURADO ================");
        console.log("Request ID:", record.id);
        console.log("Método & URL:", record.method, record.fullUrl);
        console.log("IP Cliente:", record.clientIp);
        console.log("Request Headers:", record.requestHeaders);
        console.log("Request Body:", record.requestBody);
        console.log("------------------------------------------------------");
        console.log("Status Code:", record.statusCode);
        console.log("Latencia:", `${record.latencyMs} ms`);
        console.log("Tamaño Respuesta:", `${record.responseSizeBytes} bytes`);
        console.log("Response Body:", record.responseBody);
        if (record.errorMessage) {
          console.log("Error:", record.errorMessage);
        }
        console.log("======================================================\n");
      },
    });
  }
}

export default zentinel;
