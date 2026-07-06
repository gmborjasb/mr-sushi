const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Endpoint de AWS API Gateway (ms-pedidos)
const AWS_API_URL = "https://sjpoxrretc.execute-api.us-east-1.amazonaws.com/pedidos";

// RUTA 1: Crear pedido (Simula compra en app de Rappi)
app.post('/rappi/pedidos', async (req, res) => {
    try {
        const pedidoData = req.body;
        
        // Agregar la marca de origen para AWS
        pedidoData.origen = "Rappi";
        
        console.log("RAPPI SIMULADOR: Enviando nuevo pedido a AWS Mr Sushi:", pedidoData);
        
        // Hacer POST al API de AWS
        const response = await axios.post(AWS_API_URL, pedidoData);
        
        res.status(200).json({
            message: "Pedido de Rappi enviado exitosamente a Mr Sushi (AWS)",
            aws_response: response.data
        });
    } catch (error) {
        console.error("Error al enviar pedido a AWS:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// RUTA 2: Webhook de Actualización de Estado (Llamado por AWS)
app.post('/rappi/estado', (req, res) => {
    const { pedidoId, estado } = req.body;
    
    console.log(`\n========================================`);
    console.log(`🔔 RAPPI SIMULADOR: NOTIFICACIÓN RECIBIDA`);
    console.log(`El pedido ${pedidoId} ahora está en estado: ${estado}`);
    console.log(`(Pantalla del motorizado/cliente de Rappi actualizada)`);
    console.log(`========================================\n`);
    
    res.status(200).json({ message: "Estado recibido correctamente por Rappi" });
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rappi Simulator API corriendo en el puerto ${PORT}...`);
});
