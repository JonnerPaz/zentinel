import express from "express";
import Logger from "../src/logger.js";
import type { Response } from "express";

const app = express();
const PORT = 3000;
const logger = new Logger(); // Puedes cambiar a "file" si implementas almacenamiento en archivo
// Activa tu logger propio para TODAS las llamadas entrantes
app.use(express.json());

// Ruta GET simple (Éxito 200)
app.get("/api/users", (req, res: Response) => {
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
app.get("/api/error-400", (req, res) => {
  res.status(400).json({ error: "Parámetros inválidos" });
});

// Ruta que simula un error de servidor (500)
app.get("/api/error-500", (req, res) => {
  res.status(500).json({ error: "Error interno del servidor" });
});

// 4. Iniciar el servidor
app.listen(PORT, () => {
  // logger.attach(app, PORT); // Activa el middleware de captura de logs
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`Prueba hacer peticiones a http://localhost:${PORT}/api/users`);
});
