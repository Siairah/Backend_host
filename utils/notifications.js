import Notification from "../models/notification.js";
import Profile from "../models/profile.js";

export async function sendNotification({
  recipientId,
  senderId = null,
  notificationType,
  message,
  postId = null,
  circleId = null,
  targetUrl = null,
  io = null
}) {
  try {
    const notification = await Notification.create({
      recipient: recipientId,
      sender: senderId,
      post: postId,
      circle: circleId,
      notification_type: notificationType,
      message: message,
      target_url: targetUrl,
      is_read: false
    });

    let senderProfile = null;
    if (senderId) {
      senderProfile = await Profile.findOne({ user: senderId });
    }

    const notificationData = {
      id: notification._id.toString(),
      notification_type: notificationType,
      message: message,
      sender: senderProfile ? {
        id: senderId,
        full_name: senderProfile.full_name || 'User',
        profile_pic: senderProfile.profile_pic || '/images/default_profile.png'
      } : null,
      post_id: postId,
      circle_id: circleId,
      target_url: targetUrl,
      is_read: false,
      created_at: notification.createdAt.toISOString()
    };

    if (io) {
      const recipientIdStr = recipientId.toString();
      
      const notificationRoom = `notif_${recipientIdStr}`;
      
      const room = io.sockets.adapter.rooms.get(notificationRoom);
      const roomSize = room ? room.size : 0;
      
      if (roomSize === 0) {
        const allRooms = Array.from(io.sockets.adapter.rooms.keys()).filter(r => r.startsWith('notif_'));
        console.log(`📋 Available notification rooms:`, allRooms);
      }
      
      if (roomSize > 0) {
        io.to(notificationRoom).emit('notification', notificationData);
        console.log(`✅ Notification sent to room ${notificationRoom} (${roomSize} socket(s) connected)`);
      } else {
        console.warn(`⚠️ No active sockets in room ${notificationRoom}. Notification saved in DB but not delivered in real-time.`);
        console.log(`💡 Make sure user ${recipientIdStr} has registered their tab and joined the room.`);
      }
    } else {
      console.warn('⚠️ Socket.IO not available');
    }

    return notification;
  } catch (error) {
    console.error('❌ Error sending notification:', error);
    throw error;
  }
}

export async function notifyCircleAdmins({
  circleId,
  senderId,
  notificationType,
  message,
  postId = null,
  targetUrl = null,
  io = null
}) {
  try {
    const { CircleMembership } = await import("../models/circle.js");
    
    const adminMemberships = await CircleMembership.find({
      circle: circleId,
      is_admin: true
    }).populate('user');

    const notifications = [];

    for (const membership of adminMemberships) {
      if (membership.user._id.toString() === senderId) {
        continue;
      }

      const notification = await sendNotification({
        recipientId: membership.user._id.toString(),
        senderId: senderId,
        notificationType: notificationType,
        message: message,
        postId: postId,
        circleId: circleId,
        targetUrl: targetUrl,
        io: io
      });

      notifications.push(notification);
    }

    console.log(`📢 Notified ${notifications.length} admins of circle ${circleId}`);
    return notifications;
  } catch (error) {
    console.error('❌ Error notifying circle admins:', error);
    throw error;
  }
}
