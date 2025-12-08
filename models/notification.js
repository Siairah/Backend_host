import mongoose from "mongoose";

const { Schema, model } = mongoose;

const notificationSchema = new Schema({
  recipient: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  sender: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    default: null
  },
  circle: {
    type: Schema.Types.ObjectId,
    ref: 'Circle',
    default: null
  },
  notification_type: {
    type: String,
    enum: [
      'like',
      'comment',
      'join_request',
      'approval',
      'rejection',
      'flagged',
      'warning',
      'restriction',
      'ban',
      'unban',
      'post_approved',
      'post_removed',
      'post_flagged',
      'comment_delete',
      'comment_restore',
      'report_dismissed',
      'circle_action',
      'user_restricted',
      'user_banned',
      'user_unbanned',
      'new_post',
      'post_reported',
      'post_flagged_auto'
    ],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  is_read: {
    type: Boolean,
    default: false
  },
  target_url: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  collection: 'notifications'
});

// Index for faster queries
notificationSchema.index({ recipient: 1, is_read: 1, createdAt: -1 });

const Notification = model('Notification', notificationSchema);

export default Notification;

