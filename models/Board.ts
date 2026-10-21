import mongoose from "mongoose";

const BoardSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  document: { type: Object, default: null },
  passwordHash: { type: String, default: null },
  adminHash: { type: String, default: null },
  locked: { type: Boolean, default: false },
  banned: { type: [String], default: [] },
});

export default mongoose.models.Board || mongoose.model("Board", BoardSchema);