import mongoose from 'mongoose';

// 1. Definimos la forma (esquema) de nuestros datos
const BoardSchema = new mongoose.Schema({
  // Guardaremos el ID de la sala (ej. "mi-pizarra-1")
  roomId: { type: String, required: true, unique: true },
  
  // Guardaremos todo el dibujo en formato JSON
  document: { type: Object, required: true }, 
});

// 2. Exportamos el modelo para usarlo en nuestra API
// (El '|| mongoose.model' evita errores si Next.js recarga el archivo varias veces)
export default mongoose.models.Board || mongoose.model('Board', BoardSchema);