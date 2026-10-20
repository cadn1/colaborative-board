import mongoose from "mongoose";

const BoardFileSchema = new mongoose.Schema({
  roomId: { type: String, required: true },
  fileId: { type: String, required: true },
  mimeType: { type: String, required: true },
  dataURL: { type: String, required: true },
  created: { type: Number, default: () => Date.now() },
});

BoardFileSchema.index({ roomId: 1, fileId: 1 }, { unique: true });

export default mongoose.models.BoardFile ||
  mongoose.model("BoardFile", BoardFileSchema);