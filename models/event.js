import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const eventSchema = new Schema({
  circle: {
    type: Schema.Types.ObjectId,
    ref: 'Circle',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    default: '',
    maxlength: 500
  },
  event_date: {
    type: Date,
    required: true
  },
  location: {
    type: String,
    default: '',
    maxlength: 200
  },
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  reserve_count: {
    type: Number,
    default: 0
  },
  reserved_by: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'circle_events'
});

eventSchema.index({ circle: 1, event_date: 1 });

if (models.Event) delete models.Event;
const Event = model("Event", eventSchema);
export default Event;
