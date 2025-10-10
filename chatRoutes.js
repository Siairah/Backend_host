import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { ChatRoom, ChatMessage } from "./models/chatRoom.js";
import { Circle, CircleMembership } from "./models/circle.js";
import User from "./models/models.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /chat/create-group-in-circle (Django logic: Admin creates group inside circle)
router.post("/create-group-in-circle", async (req, res) => {
  try {
    const { circle_id, name, member_ids, created_by } = req.body;
    
    if (!circle_id || !name || !created_by) {
      return res.status(400).json({ success: false, message: "Circle ID, name, and creator required" });
    }

    // Check if user is admin of circle
    const membership = await CircleMembership.findOne({ user: created_by, circle: circle_id, is_admin: true });
    if (!membership) {
      return res.status(403).json({ success: false, message: "Only circle admins can create groups" });
    }

    // Verify all members are circle members
    if (member_ids && member_ids.length > 0) {
      const validMembers = await CircleMembership.find({
        circle: circle_id,
        user: { $in: member_ids }
      });
      
      if (validMembers.length !== member_ids.length) {
        return res.status(400).json({ success: false, message: "All members must be circle members" });
      }
    }

    // Create group chat room
    const members = member_ids || [];
    if (!members.includes(created_by)) {
      members.push(created_by);  // Creator is automatically a member
    }

    const chatRoom = await ChatRoom.create({
      is_group: true,
      name: name.trim(),
      circle: circle_id,
      members: members,
      created_by: created_by
    });

    return res.status(201).json({
      success: true,
      message: "Group created successfully",
      room: {
        id: chatRoom._id,
        name: chatRoom.name,
        member_count: chatRoom.members.length
      }
    });

  } catch (error) {
    console.error("❌ Create group error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// POST /chat/create-dm (Django logic: Create one-on-one chat)
router.post("/create-dm", async (req, res) => {
  try {
    const { user1_id, user2_id } = req.body;
    
    if (!user1_id || !user2_id) {
      return res.status(400).json({ success: false, message: "Both user IDs required" });
    }

    if (user1_id === user2_id) {
      return res.status(400).json({ success: false, message: "Cannot create DM with yourself" });
    }

    // Check if DM already exists
    const existingRoom = await ChatRoom.findOne({
      is_group: false,
      members: { $all: [user1_id, user2_id], $size: 2 }
    });

    if (existingRoom) {
      return res.json({
        success: true,
        message: "DM already exists",
        room: {
          id: existingRoom._id,
          members: existingRoom.members
        }
      });
    }

    // Create new DM room
    const chatRoom = await ChatRoom.create({
      is_group: false,
      name: '',  // DMs don't have names
      circle: null,
      members: [user1_id, user2_id],
      created_by: user1_id
    });

    return res.status(201).json({
      success: true,
      message: "DM created successfully",
      room: {
        id: chatRoom._id,
        members: chatRoom.members
      }
    });

  } catch (error) {
    console.error("❌ Create DM error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// POST /chat/send-message (Django logic)
router.post("/send-message", upload.single("media"), async (req, res) => {
  try {
    const { room_id, sender_id, content, message_type, reply_to } = req.body;
    
    if (!room_id || !sender_id) {
      return res.status(400).json({ success: false, message: "Room ID and sender ID required" });
    }

    // Check if room exists and user is member
    const room = await ChatRoom.findById(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Chat room not found" });
    }

    if (!room.members.includes(sender_id)) {
      return res.status(403).json({ success: false, message: "You are not a member of this room" });
    }

    let mediaUrl = null;
    if (req.file) {
      try {
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "chat_media" }, 
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        mediaUrl = uploaded.secure_url;
      } catch (err) {
        console.error('Media upload error:', err);
      }
    }

    const message = await ChatMessage.create({
      room: room_id,
      sender: sender_id,
      content: content || '',
      message_type: message_type || 'text',
      media: mediaUrl,
      reply_to: reply_to || null,
      seen_by: [sender_id]  // Sender has seen their own message
    });

    // Populate sender info
    await message.populate('sender', 'email');
    
    return res.status(201).json({
      success: true,
      message: "Message sent",
      chat_message: {
        id: message._id,
        sender: message.sender,
        content: message.content,
        message_type: message.message_type,
        media: message.media,
        timestamp: message.timestamp
      }
    });

  } catch (error) {
    console.error("❌ Send message error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// GET /chat/get-rooms (Django logic: Get all chat rooms for user)
router.get("/get-rooms", async (req, res) => {
  try {
    const { user_id, circle_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    let query = { members: user_id };
    
    // If circle_id provided, get only groups in that circle
    if (circle_id) {
      query.circle = circle_id;
      query.is_group = true;
    }

    const rooms = await ChatRoom.find(query)
      .populate('members', 'email')
      .populate('circle', 'name')
      .sort({ created_at: -1 });

    const roomsData = await Promise.all(rooms.map(async (room) => {
      // Get last message
      const lastMessage = await ChatMessage.findOne({ room: room._id })
        .sort({ timestamp: -1 })
        .populate('sender', 'email');

      // Get unread count
      const unreadCount = await ChatMessage.countDocuments({
        room: room._id,
        sender: { $ne: user_id },
        seen_by: { $ne: user_id }
      });

      return {
        id: room._id,
        is_group: room.is_group,
        name: room.name,
        circle: room.circle,
        members: room.members,
        member_count: room.members.length,
        last_message: lastMessage ? {
          content: lastMessage.content,
          sender: lastMessage.sender,
          timestamp: lastMessage.timestamp
        } : null,
        unread_count: unreadCount,
        created_at: room.created_at
      };
    }));

    return res.json({ success: true, rooms: roomsData });

  } catch (error) {
    console.error("❌ Get rooms error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// GET /chat/get-messages (Django logic: Get messages in room)
router.get("/get-messages", async (req, res) => {
  try {
    const { room_id, user_id, limit = 50 } = req.query;
    
    if (!room_id || !user_id) {
      return res.status(400).json({ success: false, message: "Room ID and User ID required" });
    }

    // Check if user is member
    const room = await ChatRoom.findById(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    if (!room.members.includes(user_id)) {
      return res.status(403).json({ success: false, message: "Not a member" });
    }

    const messages = await ChatMessage.find({ 
      room: room_id,
      is_deleted_for_everyone: false 
    })
      .populate('sender', 'email')
      .populate('reply_to')
      .sort({ timestamp: 1 })  // Oldest first
      .limit(parseInt(limit));

    // Mark messages as seen
    await ChatMessage.updateMany(
      {
        room: room_id,
        sender: { $ne: user_id },
        seen_by: { $ne: user_id }
      },
      {
        $push: { seen_by: user_id }
      }
    );

    const messagesData = messages.map(msg => ({
      id: msg._id,
      sender: msg.sender,
      content: msg.content,
      message_type: msg.message_type,
      media: msg.media,
      reply_to: msg.reply_to,
      timestamp: msg.timestamp,
      seen_by: msg.seen_by,
      is_deleted_for_everyone: msg.is_deleted_for_everyone
    }));

    return res.json({ success: true, messages: messagesData });

  } catch (error) {
    console.error("❌ Get messages error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// POST /chat/delete-message (Django logic)
router.post("/delete-message", async (req, res) => {
  try {
    const { message_id, user_id, delete_for_everyone } = req.body;
    
    if (!message_id || !user_id) {
      return res.status(400).json({ success: false, message: "Message ID and User ID required" });
    }

    const message = await ChatMessage.findById(message_id);
    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found" });
    }

    if (delete_for_everyone === 'true' || delete_for_everyone === true) {
      // Only sender can delete for everyone
      if (message.sender.toString() !== user_id) {
        return res.status(403).json({ success: false, message: "Only sender can delete for everyone" });
      }
      
      message.is_deleted_for_everyone = true;
      message.content = "This message was deleted";
      message.media = null;
      await message.save();
      
      return res.json({ success: true, message: "Message deleted for everyone" });
    } else {
      // Delete for self only
      if (!message.deleted_by.includes(user_id)) {
        message.deleted_by.push(user_id);
        await message.save();
      }
      
      return res.json({ success: true, message: "Message deleted for you" });
    }

  } catch (error) {
    console.error("❌ Delete message error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// GET /chat/get-circle-members (Helper: Get members of circle for group creation)
router.get("/get-circle-members", async (req, res) => {
  try {
    const { circle_id, user_id } = req.query;
    
    if (!circle_id || !user_id) {
      return res.status(400).json({ success: false, message: "Circle ID and User ID required" });
    }

    // Check if user is admin
    const isAdmin = await CircleMembership.findOne({ 
      user: user_id, 
      circle: circle_id, 
      is_admin: true 
    });

    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Only admins can view members" });
    }

    const memberships = await CircleMembership.find({ circle: circle_id })
      .populate('user', 'email');

    const members = await Promise.all(memberships.map(async (membership) => {
      const user = membership.user;
      const profile = await mongoose.model('Profile').findOne({ user: user._id });
      
      return {
        id: user._id,
        email: user.email,
        full_name: profile?.full_name || user.email,
        profile_pic: profile?.profile_pic || '/images/default_profile.png',
        is_admin: membership.is_admin
      };
    }));

    return res.json({ success: true, members });

  } catch (error) {
    console.error("❌ Get circle members error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

