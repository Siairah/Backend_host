import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// ChatRoom Model (Django pattern)
// For both group chats (inside circles) and one-on-one DMs
const chatRoomSchema = new Schema({
  is_group: {
    type: Boolean,
    default: false
  },
  name: {
    type: String,
    default: ''
  },
  circle: {
    type: Schema.Types.ObjectId,
    ref: 'Circle',
    default: null  // null for one-on-one DMs
  },
  members: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'chat_rooms'
});

// ChatMessage Model (Django pattern)
const chatMessageSchema = new Schema({
  room: {
    type: Schema.Types.ObjectId,
    ref: 'ChatRoom',
    required: true
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    default: ''
  },
  message_type: {
    type: String,
    enum: ['text', 'media', 'call_log'],
    default: 'text'
  },
  media: {
    type: String,
    default: null  // Cloudinary URL
  },
  reply_to: {
    type: Schema.Types.ObjectId,
    ref: 'ChatMessage',
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  seen_by: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  is_deleted_for_everyone: {
    type: Boolean,
    default: false
  },
  deleted_by: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  call_status: {
    type: String,
    enum: ['missed', 'answered', 'declined', 'cancelled', null],
    default: null
  },
  call_duration: {
    type: Number,  // seconds
    default: null
  }
}, {
  timestamps: true,
  collection: 'chat_messages'
});

// Indexes for performance
chatRoomSchema.index({ circle: 1 });
chatRoomSchema.index({ members: 1 });
chatMessageSchema.index({ room: 1, timestamp: -1 });

// Clean up existing models if they exist
if (models.ChatRoom) delete models.ChatRoom;
if (models.ChatMessage) delete models.ChatMessage;

const ChatRoom = model("ChatRoom", chatRoomSchema);
const ChatMessage = model("ChatMessage", chatMessageSchema);

export { ChatRoom, ChatMessage };

