// import { appendFile } from "fs";
// import { dirname } from "path";
// import { fileURLToPath } from "url";
import { createCaptureMiddleware } from "./middleware/capture.js";

// const __dirname = dirname(fileURLToPath(import.meta.url));

// const logFilePath = join(__dirname, "access.log");

// Middleware personalizado
const loggerMiddleware = createCaptureMiddleware({
  captureResponseBody: true,
  onRecordCaptured: (record) => {
    // Por ahora mostramos en consola el objeto capturado para verificar los datos de RF-02
    console.log("\n================ 📊 REGISTRO CAPTURADO ================");
    console.log("Request ID:", record.request.request_id);
    console.log("Método & URL:", record.request.method, record.request.full_url);
    console.log("IP Cliente:", record.request.client_ip);
    console.log("Request Headers:", record.request.headers);
    console.log("Request Body:", record.request.body);
    console.log("------------------------------------------------------");
    console.log("Status Code:", record.response.status_code);
    console.log("Latencia:", `${record.response.latency_ms} ms`);
    console.log("Tamaño Respuesta:", `${record.response.response_size_bytes} bytes`);
    console.log("Response Body:", record.response.body);
    if (record.response.error_message) {
      console.log("Error:", record.response.error_message);
    }
    console.log("======================================================\n");
  },
});

export default loggerMiddleware;
