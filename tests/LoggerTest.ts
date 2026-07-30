import express from "express";
import customLogger from "../src/main.js";
import type { Response } from "express";

const app = express();

// Activa tu logger propio para TODAS las llamadas entrantes
app.use(customLogger);

app.get("/api/saludo", (res: Response) => {
  res.status(200).json({ mensaje: "Hola Mundo" });
});

app.listen(3000, () => {
  console.log("Servidor escuchando en http://localhost:3000");
});
