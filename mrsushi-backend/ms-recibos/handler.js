const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const s3 = new S3Client();

module.exports.generarRecibo = async (event) => {
  console.log("🔔 EVENTO RECIBIDO EN EVENTBRIDGE:", JSON.stringify(event));
  
  // EventBridge encapsula el payload original dentro de 'detail'
  const detail = event.detail || {};
  const pedidoId = detail.pedidoId || "unknown-" + Date.now();
  
  // Plantilla del recibo
  const reciboContent = `====================================
           RECIBO MR SUSHI
====================================
ID Pedido: ${pedidoId}
Sede: ${detail.sedeId || "N/A"}
Origen: ${detail.origin || "Local"}
Estado: ENTREGADO EXITOSAMENTE
Fecha de Cierre: ${new Date().toISOString()}
====================================
¡Gracias por su compra en Mr Sushi!
`;
  
  const bucketName = process.env.BUCKET_NAME;
  const fileName = `recibo-${pedidoId}.txt`;
  
  try {
    console.log(`Generando recibo y guardando en S3: ${bucketName}/${fileName}`);
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: fileName,
      Body: reciboContent,
      ContentType: "text/plain"
    }));
    
    console.log("✅ Recibo guardado exitosamente en S3.");
    return { success: true, fileName };
  } catch (error) {
    console.error("❌ Error guardando recibo en S3:", error);
    throw error;
  }
};
