const mongoose = require('mongoose');

const DeletionTombstoneSchema = new mongoose.Schema(
  {
    opId: {
      type: String,
      required: true,
      unique: true,
    },
    entityType: {
      type: String,
      required: true,
      enum: ['batch', 'product'],
    },
    entityId: {
      type: String,
      required: true,
    },
    entityName: {
      type: String,
      default: '',
    },
    deletedPacketUniqueIds: [
      {
        type: String,
      },
    ],
    deletedDesktopRecordIds: [
      {
        type: String,
      },
    ],
    deletedCounts: {
      batches: { type: Number, default: 0 },
      packets: { type: Number, default: 0 },
      sessions: { type: Number, default: 0 },
      desktopRecords: { type: Number, default: 0 },
      products: { type: Number, default: 0 },
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    firebaseSynced: {
      type: Boolean,
      default: false,
    },
    firebaseNote: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

DeletionTombstoneSchema.index({ createdAt: 1 });
DeletionTombstoneSchema.index({ 'deletedPacketUniqueIds': 1 });
DeletionTombstoneSchema.index({ 'deletedDesktopRecordIds': 1 });

module.exports = mongoose.model('DeletionTombstone', DeletionTombstoneSchema);

