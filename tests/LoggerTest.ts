import express from "express";
import Logger from "../src/index.js";

const app = express();
const PORT = 3000;
const logger = new Logger();

logger.logInfo("Servidor iniciado");

// Captura TODAS las requests entrantes y monta el monitoreo en /api/monitoring
app.use(express.json());
await logger.attach(app, "/api/monitoring");

// Ruta GET simple (Éxito 200)
app.get("/api/users", (_req, res) => {
  res.json([
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ]);
});

// Ruta POST para probar lectura de Body (Éxito 201)
app.post("/api/users", (req, res) => {
  const newUser = req.body;
  res.status(201).json({
    message: "Usuario creado exitosamente",
    user: newUser,
  });
});

// Ruta que simula un error de cliente (400)
app.get("/api/error-400", (_req, res) => {
  res.status(400).json({ error: "Parámetros inválidos" });
});

// Ruta que simula un error de servidor (500)
app.get("/api/error-500", (_req, res) => {
  res.status(500).json({ error: "Error interno del servidor" });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Prueba hacer peticiones a http://localhost:${PORT}/api/users`);
  console.log(`Monitoreo: http://localhost:${PORT}/api/monitoring (admin/admin)`);
});
