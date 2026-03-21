import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { ChatRoom, ChatMessage } from "./models/chatRoom.js";
import { Circle, CircleMembership } from "./models/circle.js";
import User from "./models/models.js";

const router = Router();
// Configure multer for file uploads (max 10MB for images only)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Only allow image files
    const allowedMimes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed. Only images are supported.`));
    }
  }
});

/* ---------------------------
   CREATE GROUP INSIDE CIRCLE
---------------------------- */
router.post("/create-group-in-circle", async (req, res) => {
  try {
    const { circle_id, name, member_ids, created_by } = req.body;

    if (!circle_id || !name || !created_by) {
      return res.status(400).json({ success: false, message: "Circle ID, name, and creator required" });
    }

    const membership = await CircleMembership.findOne({
      user: created_by,
      circle: circle_id,
      is_admin: true
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: "Only circle admins can create groups" });
    }

    // validate all members are circle members
    if (member_ids?.length > 0) {
      const validMembers = await CircleMembership.find({
        circle: circle_id,
        user: { $in: member_ids }
      });

      if (validMembers.length !== member_ids.length) {
        return res.status(400).json({ success: false, message: "All members must be circle members" });
      }
    }

    let members = Array.isArray(member_ids) ? [...member_ids] : [];
    
    const mongoose = await import("mongoose");
    const createdByStr = created_by.toString();
    const memberIdsSet = new Set(members.map(m => m.toString()));
    
    if (!memberIdsSet.has(createdByStr)) {
      members.push(created_by);
    }
    
    members = [...new Set(members.map(m => m.toString()))].map(id => {
      if (mongoose.Types.ObjectId.isValid(id)) {
        return new mongoose.Types.ObjectId(id);
      }
      return id;
    });

    const chatRoom = await ChatRoom.create({
      is_group: true,
      name: name.trim(),
      circle: circle_id,
      members,
      created_by
    });

    await chatRoom.populate("members", "email");
    await chatRoom.populate("circle", "name");

    const Profile = (await import("./models/profile.js")).default;
    const membersWithProfiles = await Promise.all(
      chatRoom.members.map(async (m) => {
        const profile = await Profile.findOne({ user: m._id }).lean();
        return {
          id: m._id.toString(),
          email: m.email,
          full_name: profile?.full_name || m.email,
          profile_pic: profile?.profile_pic || null,
        };
      })
    );

    const Circle = (await import("./models/circle.js")).Circle;
    const circle = await Circle.findById(circle_id).lean();

    const memberIdsForSocket = members.map((m) => {
      if (m && typeof m.toString === 'function') {
        return m.toString();
      }
      return String(m);
    });
    
    req.io.to(memberIdsForSocket).emit("group_created", {
      room_id: chatRoom._id.toString(),
      name: chatRoom.name,
      circle_id,
      members: memberIdsForSocket,
    });

    return res.status(201).json({
      success: true,
      message: "Group created successfully",
      room: {
        id: chatRoom._id.toString(),
        is_group: true,
        name: chatRoom.name,
        circle: circle ? { id: circle._id.toString(), name: circle.name } : null,
        members: membersWithProfiles,
        member_count: chatRoom.members.length,
        unread_count: 0,
        created_at: chatRoom.created_at || new Date().toISOString(),
        display_name: chatRoom.name,
        profile_pic: chatRoom.profile_pic || null,
        created_by: chatRoom.created_by?.toString() || created_by,
      },
    });

  } catch (error) {
    console.error("❌ Create group error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

/* ---------------------------
        CREATE DM
---------------------------- */
router.post("/create-dm", async (req, res) => {
  try {
    const { user1_id, user2_id } = req.body;

    if (!user1_id || !user2_id) {
      return res.status(400).json({ success: false, message: "Both user IDs required" });
    }

    if (user1_id === user2_id) {
      return res.status(400).json({ success: false, message: "Cannot DM yourself" });
    }

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

    const chatRoom = await ChatRoom.create({
      is_group: false,
      name: "",
      circle: null,
      members: [user1_id, user2_id],
      created_by: user1_id
    });

    // 🔥 REAL-TIME: Notify 2 users
    req.io.to([user1_id, user2_id]).emit("dm_created", {
      room_id: chatRoom._id,
      members: chatRoom.members
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
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

/* ---------------------------
          SEND MESSAGE
---------------------------- */
router.post("/send-message", upload.single("media"), async (req, res) => {
  try {
    const { room_id, sender_id, content, message_type, reply_to } = req.body;

    if (!room_id || !sender_id) {
      return res.status(400).json({ success: false, message: "Room ID and sender required" });
    }

    const room = await ChatRoom.findById(room_id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    if (!room.members.includes(sender_id)) {
      return res.status(403).json({ success: false, message: "Not a member" });
    }

    let mediaUrl = null;
    if (req.file) {
      try {
        console.log(`📤 Uploading media to Cloudinary: ${req.file.originalname} (${req.file.size} bytes, type: ${req.file.mimetype})`);
        
        // Only accept image files
        if (!req.file.mimetype.startsWith('image/')) {
          return res.status(400).json({ 
            success: false, 
            message: "Only image files are supported" 
          });
        }
        
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { 
              folder: "chat_media",
              resource_type: "image" // Only images
            },
            (err, result) => {
              if (err) {
                console.error('❌ Cloudinary upload error:', err);
                reject(err);
              } else {
                console.log(`✅ Media uploaded successfully: ${result.secure_url}`);
                resolve(result);
              }
            }
          );
          stream.end(req.file.buffer);
        });
        
        if (uploaded && uploaded.secure_url) {
          mediaUrl = uploaded.secure_url;
        } else {
          console.error('❌ Cloudinary upload returned no URL');
          return res.status(500).json({ 
            success: false, 
            message: "Failed to upload media to Cloudinary" 
          });
        }
      } catch (uploadError) {
        console.error('❌ Media upload error:', uploadError);
        return res.status(500).json({ 
          success: false, 
          message: "Failed to upload media: " + uploadError.message 
        });
      }
    }

    const message = await ChatMessage.create({
      room: room_id,
      sender: sender_id,
      content: content || "",
      message_type: message_type || "text",
      media: mediaUrl,
      reply_to: reply_to || null,
      seen_by: [] // Start empty - only recipients who view the message should be added
    });

    await message.populate("sender", "email");
    await message.populate("reply_to");

    // Get Profile data for sender
    const Profile = (await import("./models/profile.js")).default;
    const senderProfile = await Profile.findOne({ user: sender_id }).lean();

    const msgPayload = {
      id: message._id.toString(),
      room: room_id.toString(),
      sender: {
        id: message.sender._id?.toString() || message.sender.toString(),
        email: message.sender.email || '',
        full_name: senderProfile?.full_name || message.sender.email || '',
        profile_pic: senderProfile?.profile_pic || '/images/default_profile.png',
      },
      content: message.content,
      message_type: message.message_type,
      media: message.media,
      reply_to: message.reply_to || null,
      timestamp: message.timestamp || new Date().toISOString(),
      seen_by: message.seen_by || [],
      is_deleted_for_everyone: message.is_deleted_for_everyone || false,
      call_status: message.call_status || null,
      call_duration: message.call_duration || null,
    };

    req.io.to(room_id.toString()).emit("new_message", msgPayload);

    const unreadCounts = await Promise.all(
      room.members.map(async (memberId) => {
        if (memberId.toString() === sender_id) return null;
        const unreadCount = await ChatMessage.countDocuments({
          room: room_id,
          sender: { $ne: memberId },
          seen_by: { $ne: memberId },
        });
        return { user_id: memberId.toString(), unread_count: unreadCount };
      })
    );

    unreadCounts.forEach((data) => {
      if (data) {
        req.io.to(`notif_${data.user_id}`).emit("unread_update", {
          room_id: room_id.toString(),
          unread_count: data.unread_count,
        });
      }
    });

    return res.status(201).json({
      success: true,
      message: "Message sent",
      chat_message: msgPayload
    });

  } catch (error) {
    console.error("❌ Send message error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

/* ---------------------------
        GET MESSAGES
---------------------------- */
router.get("/get-messages", async (req, res) => {
  try {
    const { room_id, user_id, limit = 50 } = req.query;

    if (!room_id || !user_id)
      return res.status(400).json({ success: false, message: "Room ID and User ID required" });

    const room = await ChatRoom.findById(room_id);
    if (!room) return res.status(404).json({ success: false, message: "Room not found" });

    if (!room.members.includes(user_id))
      return res.status(403).json({ success: false, message: "Not a member" });

    const messages = await ChatMessage.find({
      room: room_id,
      is_deleted_for_everyone: false,
      deleted_by: { $ne: user_id } // Exclude messages deleted by this user
    })
      .populate("sender", "email")
      .populate("reply_to")
      .sort({ timestamp: 1 })
      .limit(parseInt(limit));

    // Get Profile data for all senders
    const Profile = (await import("./models/profile.js")).default;
    const formattedMessages = await Promise.all(
      messages.map(async (msg) => {
        const senderProfile = await Profile.findOne({ user: msg.sender._id || msg.sender }).lean();
        return {
          id: msg._id.toString(),
          room: msg.room.toString(),
          sender: {
            id: msg.sender._id?.toString() || msg.sender.toString(),
            email: msg.sender.email || '',
            full_name: senderProfile?.full_name || msg.sender.email || '',
            profile_pic: senderProfile?.profile_pic || '/images/default_profile.png',
          },
          content: msg.content,
          message_type: msg.message_type,
          media: msg.media,
          reply_to: msg.reply_to,
          timestamp: msg.timestamp || msg.createdAt,
          seen_by: msg.seen_by ? msg.seen_by.map((id) => id.toString()) : [],
          deleted_by: msg.deleted_by ? msg.deleted_by.map((id) => id.toString()) : [],
          is_deleted_for_everyone: msg.is_deleted_for_everyone || false,
          call_status: msg.call_status || null,
          call_duration: msg.call_duration || null,
        };
      })
    );

    // Don't automatically mark messages as seen when fetching
    // Messages should only be marked as seen when user actually views them
    // This will be handled by the /mark-messages-seen endpoint

    const unreadCount = await ChatMessage.countDocuments({
      room: room_id,
      sender: { $ne: user_id },
      seen_by: { $ne: user_id },
    });

    if (req.io) {
      req.io.to(`notif_${user_id}`).emit("unread_update", {
        room_id: room_id.toString(),
        unread_count: unreadCount,
      });
    }

    return res.json({ success: true, messages: formattedMessages });

  } catch (error) {
    console.error("❌ Get messages error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

// Mark messages as seen when user actually views them
router.post("/mark-messages-seen", async (req, res) => {
  try {
    const { room_id, user_id } = req.body;

    if (!room_id || !user_id) {
      return res.status(400).json({ success: false, message: "Room ID and User ID required" });
    }

    const room = await ChatRoom.findById(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    if (!room.members.includes(user_id)) {
      return res.status(403).json({ success: false, message: "Not a member" });
    }

    // Mark all messages in this room as seen by this user (except their own messages)
    const updateResult = await ChatMessage.updateMany(
      {
        room: room_id,
        sender: { $ne: user_id },
        seen_by: { $ne: user_id }
      },
      { $push: { seen_by: user_id } }
    );

    console.log(`✅ Marked ${updateResult.modifiedCount} messages as seen for user ${user_id} in room ${room_id}`);

    // Get updated unread count
    const unreadCount = await ChatMessage.countDocuments({
      room: room_id,
      sender: { $ne: user_id },
      seen_by: { $ne: user_id },
    });

    // Emit unread count update
    if (req.io) {
      req.io.to(`notif_${user_id}`).emit("unread_update", {
        room_id: room_id.toString(),
        unread_count: unreadCount,
      });

      // Notify others in the room that this user saw the messages
      req.io.to(room_id).emit("seen_update", {
        room_id: room_id.toString(),
        user_id: user_id
      });
    }

    return res.json({ 
      success: true, 
      message: "Messages marked as seen",
      marked_count: updateResult.modifiedCount,
      unread_count: unreadCount
    });

  } catch (error) {
    console.error("❌ Mark messages as seen error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

/* ---------------------------
         DELETE MESSAGE
---------------------------- */
router.post("/delete-message", async (req, res) => {
  try {
    const { message_id, user_id, delete_for_everyone } = req.body;

    if (!message_id || !user_id)
      return res.status(400).json({ success: false, message: "Message ID and User ID required" });

    const message = await ChatMessage.findById(message_id);
    if (!message)
      return res.status(404).json({ success: false, message: "Message not found" });

    if (delete_for_everyone === "true" || delete_for_everyone === true) {
      if (message.sender.toString() !== user_id) {
        return res.status(403).json({
          success: false,
          message: "Only sender can delete for everyone"
        });
      }

      message.is_deleted_for_everyone = true;
      message.content = "This message was deleted";
      message.media = null;
      await message.save();

      // 🔥 REAL-TIME notify (only if io is available)
      if (req.io) {
        req.io.to(message.room.toString()).emit("deleted_message", {
          message_id,
          room_id: message.room.toString()
        });
      }

      return res.json({ success: true, message: "Message deleted for everyone" });
    }

    // delete for self
    const deletedBy = message.deleted_by || [];
    if (!deletedBy.some((id) => id.toString() === user_id)) {
      message.deleted_by = deletedBy;
      message.deleted_by.push(user_id);
      await message.save();
    }

    // 🔥 REAL-TIME notify user that message was deleted for them (only if io is available)
    if (req.io) {
      req.io.to(message.room.toString()).emit("message_deleted_for_user", {
        message_id,
        user_id,
        room_id: message.room.toString()
      });
    }

    return res.json({ success: true, message: "Message deleted for you" });

  } catch (error) {
    console.error("❌ Delete message error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

/* ---------------------------
    GET CIRCLE MEMBERS
---------------------------- */
router.get("/get-circle-members", async (req, res) => {
  try {
    const { circle_id, user_id } = req.query;

    if (!circle_id || !user_id) {
      return res.status(400).json({ success: false, message: "Circle ID and User ID required" });
    }

    const { CircleMembership } = await import("./models/circle.js");
    const Profile = (await import("./models/profile.js")).default;
    const mongoose = await import("mongoose");

    // Find all memberships for this circle with safe populate
    const memberships = await CircleMembership.find({ circle: circle_id })
      .populate({
        path: "user",
        select: "_id email",
        options: { strictPopulate: false } // Don't throw error if user doesn't exist
      })
      .lean();

    // Process members with error handling
    const members = await Promise.all(
      memberships.map(async (membership) => {
        try {
          // Check if user exists (might have been deleted or populate failed)
          if (!membership || !membership.user || !membership.user._id) {
            console.warn('Skipping membership with missing user:', membership?._id);
            return null;
          }

          const user = membership.user;
          const userId = user._id?.toString() || user._id;
          
          if (!userId) {
            console.warn('Skipping membership with invalid user ID:', membership?._id);
            return null;
          }

          // Find profile for this user
          const profile = await Profile.findOne({ user: userId }).lean();

          return {
            id: userId,
            email: user.email || 'Unknown',
            full_name: profile?.full_name || user.email || 'Unknown User',
            profile_pic: profile?.profile_pic || "/images/default_profile.png",
            is_admin: membership.is_admin || false,
          };
        } catch (error) {
          console.error('Error processing membership:', membership?._id, error);
          return null; // Skip this member if there's an error
        }
      })
    );

    // Filter out null values (failed memberships)
    const validMembers = members.filter(m => m !== null);

    console.log(`✅ Fetched ${validMembers.length} members for circle ${circle_id}`);

    return res.json({ success: true, members: validMembers });
  } catch (error) {
    console.error("❌ Get circle members error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ 
      success: false, 
      message: sanitizeError(error),
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/* ---------------------------
        GET ROOMS
---------------------------- */
router.get("/get-rooms", async (req, res) => {
  try {
    const { user_id, circle_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    let query = { members: user_id };

    if (circle_id) {
      query.circle = circle_id;
      query.is_group = true;
    }

    const rooms = await ChatRoom.find(query)
      .populate("members", "email")
      .populate("circle", "name")
      .sort({ created_at: -1 })
      .lean();

    const Profile = (await import("./models/profile.js")).default;

    const roomsData = await Promise.all(
      rooms.map(async (room) => {
        const lastMessage = await ChatMessage.findOne({ room: room._id })
          .sort({ timestamp: -1 })
          .populate("sender", "email")
          .lean();

        const unreadCount = await ChatMessage.countDocuments({
          room: room._id,
          sender: { $ne: user_id },
          seen_by: { $ne: user_id },
        });

        let displayName = "";
        let profilePic = null;

        if (room.is_group) {
          displayName = room.name;
          profilePic = room.profile_pic || null;
        } else {
          const otherMember = room.members.find((m) => m._id.toString() !== user_id);
          if (otherMember) {
            const profile = await Profile.findOne({ user: otherMember._id }).lean();
            displayName = profile?.full_name || otherMember.email;
            profilePic = profile?.profile_pic || null;
          }
        }

        // Get profile data for all members
        const membersWithProfiles = await Promise.all(
          room.members.map(async (m) => {
            const profile = await Profile.findOne({ user: m._id }).lean();
            return {
              id: m._id.toString(),
              email: m.email,
              full_name: profile?.full_name || m.email,
              profile_pic: profile?.profile_pic || null,
            };
          })
        );

        // Get sender profile for last message
        let lastMessageSender = null;
        if (lastMessage && lastMessage.sender) {
          const senderProfile = await Profile.findOne({ user: lastMessage.sender._id }).lean();
          lastMessageSender = {
            id: lastMessage.sender._id.toString(),
            email: lastMessage.sender.email,
            full_name: senderProfile?.full_name || lastMessage.sender.email,
            profile_pic: senderProfile?.profile_pic || null,
          };
        }

        return {
          id: room._id.toString(),
          is_group: room.is_group,
          name: room.name,
          circle: room.circle
            ? { id: room.circle._id.toString(), name: room.circle.name }
            : null,
          members: membersWithProfiles,
          member_count: room.members.length,
          last_message: lastMessage
            ? {
                content: lastMessage.content,
                sender: lastMessageSender,
                timestamp: lastMessage.timestamp,
              }
            : null,
          unread_count: unreadCount,
          created_at: room.created_at,
          display_name: displayName,
          profile_pic: profilePic,
          created_by: room.created_by?.toString() || null,
        };
      })
    );

    return res.json({ success: true, rooms: roomsData });
  } catch (error) {
    console.error("❌ Get rooms error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

router.post("/remove-member", async (req, res) => {
  try {
    const { room_id, user_id, member_id } = req.body;

    if (!room_id || !user_id || !member_id) {
      return res.status(400).json({ success: false, message: "Room ID, User ID, and Member ID required" });
    }

    const room = await ChatRoom.findById(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    if (!room.is_group) {
      return res.status(400).json({ success: false, message: "This is not a group chat" });
    }

    if (room.created_by.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Only group admin can remove members" });
    }

    if (!room.members.includes(member_id)) {
      return res.status(400).json({ success: false, message: "Member is not in this group" });
    }

    if (room.created_by.toString() === member_id) {
      return res.status(400).json({ success: false, message: "Cannot remove group creator" });
    }

    room.members = room.members.filter(m => m.toString() !== member_id);
    await room.save();

    await room.populate("members", "email");
    await room.populate("circle", "name");
    
    const Profile = (await import("./models/profile.js")).default;
    const membersWithProfiles = await Promise.all(
      room.members.map(async (m) => {
        const profile = await Profile.findOne({ user: m._id }).lean();
        return {
          id: m._id.toString(),
          email: m.email,
          full_name: profile?.full_name || m.email,
          profile_pic: profile?.profile_pic || null,
        };
      })
    );

    // Get last message for unread count
    const lastMessage = await ChatMessage.findOne({ room: room._id })
      .sort({ timestamp: -1 })
      .populate("sender", "email")
      .lean();

    const unreadCount = await ChatMessage.countDocuments({
      room: room._id,
      sender: { $ne: user_id },
      seen_by: { $ne: user_id },
    });

    // Get sender profile for last message
    let lastMessageSender = null;
    if (lastMessage && lastMessage.sender) {
      const senderProfile = await Profile.findOne({ user: lastMessage.sender._id }).lean();
      lastMessageSender = {
        id: lastMessage.sender._id.toString(),
        email: lastMessage.sender.email,
        full_name: senderProfile?.full_name || lastMessage.sender.email,
        profile_pic: senderProfile?.profile_pic || null,
      };
    }

    req.io.to(room_id.toString()).emit("member_removed", {
      room_id: room_id.toString(),
      member_id: member_id
    });

    req.io.to(`notif_${member_id}`).emit("group_updated", {
      room_id: room_id.toString(),
      action: "removed"
    });

    return res.json({ 
      success: true, 
      message: "Member removed from group",
      room: {
        id: room._id.toString(),
        is_group: room.is_group,
        name: room.name,
        circle: room.circle
          ? { id: room.circle._id.toString(), name: room.circle.name }
          : null,
        members: membersWithProfiles,
        member_count: room.members.length,
        last_message: lastMessage
          ? {
              content: lastMessage.content,
              sender: lastMessageSender,
              timestamp: lastMessage.timestamp,
            }
          : null,
        unread_count: unreadCount,
        created_at: room.created_at || new Date().toISOString(),
        display_name: room.name,
        profile_pic: room.profile_pic || null,
        created_by: room.created_by?.toString() || null,
      }
    });

  } catch (error) {
    console.error("❌ Remove member error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

router.post("/leave-group", async (req, res) => {
  try {
    const { room_id, user_id } = req.body;

    if (!room_id || !user_id) {
      return res.status(400).json({ success: false, message: "Room ID and User ID required" });
    }

    const room = await ChatRoom.findById(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    if (!room.is_group) {
      return res.status(400).json({ success: false, message: "This is not a group chat" });
    }

    if (!room.members.includes(user_id)) {
      return res.status(400).json({ success: false, message: "You are not a member of this group" });
    }

    if (room.created_by.toString() === user_id && room.members.length > 1) {
      return res.status(400).json({ success: false, message: "Group admin must transfer admin or delete group before leaving" });
    }

    room.members = room.members.filter(m => m.toString() !== user_id);
    await room.save();

    req.io.to(room_id.toString()).emit("member_left", {
      room_id: room_id.toString(),
      member_id: user_id
    });

    req.io.to(`notif_${user_id}`).emit("group_updated", {
      room_id: room_id.toString(),
      action: "left"
    });

    return res.json({ success: true, message: "Left group successfully" });

  } catch (error) {
    console.error("❌ Leave group error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

router.post("/add-member", async (req, res) => {
  try {
    const { room_id, user_id, member_ids } = req.body;

    if (!room_id || !user_id || !member_ids || !Array.isArray(member_ids) || member_ids.length === 0) {
      return res.status(400).json({ success: false, message: "Room ID, User ID, and Member IDs required" });
    }

    const room = await ChatRoom.findById(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    if (!room.is_group) {
      return res.status(400).json({ success: false, message: "This is not a group chat" });
    }

    if (room.created_by.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Only group admin can add members" });
    }

    const mongoose = await import("mongoose");
    const existingMemberIds = new Set(room.members.map(m => m.toString()));
    const newMembers = member_ids.filter(id => !existingMemberIds.has(id.toString()));
    
    if (newMembers.length === 0) {
      return res.status(400).json({ success: false, message: "All selected users are already members" });
    }

    if (room.circle) {
      const { CircleMembership } = await import("./models/circle.js");
      const validMembers = await CircleMembership.find({
        circle: room.circle,
        user: { $in: newMembers }
      });

      if (validMembers.length !== newMembers.length) {
        return res.status(400).json({ success: false, message: "All members must be circle members" });
      }
    }

    const membersToAdd = newMembers.map(id => {
      if (mongoose.Types.ObjectId.isValid(id)) {
        return new mongoose.Types.ObjectId(id);
      }
      return id;
    });

    room.members = [...room.members, ...membersToAdd];
    await room.save();

    await room.populate("members", "email");
    await room.populate("circle", "name");
    
    const Profile = (await import("./models/profile.js")).default;
    const membersWithProfiles = await Promise.all(
      room.members.map(async (m) => {
        const profile = await Profile.findOne({ user: m._id }).lean();
        return {
          id: m._id.toString(),
          email: m.email,
          full_name: profile?.full_name || m.email,
          profile_pic: profile?.profile_pic || null,
        };
      })
    );

    // Get last message for unread count
    const lastMessage = await ChatMessage.findOne({ room: room._id })
      .sort({ timestamp: -1 })
      .populate("sender", "email")
      .lean();

    const unreadCount = await ChatMessage.countDocuments({
      room: room._id,
      sender: { $ne: user_id },
      seen_by: { $ne: user_id },
    });

    const memberIdsForSocket = newMembers.map(id => id.toString());
    req.io.to(room_id.toString()).emit("member_added", {
      room_id: room_id.toString(),
      member_ids: memberIdsForSocket
    });

    memberIdsForSocket.forEach(memberId => {
      req.io.to(`notif_${memberId}`).emit("group_updated", {
        room_id: room_id.toString(),
        action: "added"
      });
    });

    // Get sender profile for last message
    let lastMessageSender = null;
    if (lastMessage && lastMessage.sender) {
      const senderProfile = await Profile.findOne({ user: lastMessage.sender._id }).lean();
      lastMessageSender = {
        id: lastMessage.sender._id.toString(),
        email: lastMessage.sender.email,
        full_name: senderProfile?.full_name || lastMessage.sender.email,
        profile_pic: senderProfile?.profile_pic || null,
      };
    }

    return res.json({ 
      success: true, 
      message: "Members added successfully",
      room: {
        id: room._id.toString(),
        is_group: room.is_group,
        name: room.name,
        circle: room.circle
          ? { id: room.circle._id.toString(), name: room.circle.name }
          : null,
        members: membersWithProfiles,
        member_count: room.members.length,
        last_message: lastMessage
          ? {
              content: lastMessage.content,
              sender: lastMessageSender,
              timestamp: lastMessage.timestamp,
            }
          : null,
        unread_count: unreadCount,
        created_at: room.created_at || new Date().toISOString(),
        display_name: room.name,
        profile_pic: room.profile_pic || null,
        created_by: room.created_by?.toString() || null,
      }
    });

  } catch (error) {
    console.error("❌ Add member error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

/* ---------------------------
   UPDATE GROUP AVATAR
---------------------------- */
router.post("/update-group-avatar", upload.single("avatar"), async (req, res) => {
  try {
    const { room_id, user_id } = req.body;

    if (!room_id || !user_id) {
      return res.status(400).json({ success: false, message: "Room ID and User ID required" });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: "Avatar image required" });
    }

    const room = await ChatRoom.findById(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    if (!room.is_group) {
      return res.status(400).json({ success: false, message: "Only group chats have avatars" });
    }

    if (room.created_by.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Only group admin can update avatar" });
    }

    const uploaded = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder: "chat_avatars", resource_type: "image" },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    if (!uploaded?.secure_url) {
      return res.status(500).json({ success: false, message: "Failed to upload avatar" });
    }

    room.profile_pic = uploaded.secure_url;
    await room.save();

    if (req.io) {
      req.io.to(room_id.toString()).emit("group_avatar_updated", {
        room_id: room_id.toString(),
        profile_pic: room.profile_pic,
      });
    }

    return res.json({
      success: true,
      profile_pic: room.profile_pic,
      message: "Group avatar updated",
    });
  } catch (error) {
    console.error("❌ Update group avatar error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

router.post("/delete-group", async (req, res) => {
  try {
    const { room_id, user_id } = req.body;

    if (!room_id || !user_id) {
      return res.status(400).json({ success: false, message: "Room ID and User ID required" });
    }

    const room = await ChatRoom.findById(room_id);
    if (!room) {
      return res.status(404).json({ success: false, message: "Room not found" });
    }

    if (!room.is_group) {
      return res.status(400).json({ success: false, message: "This is not a group chat" });
    }

    if (room.created_by.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Only group admin can delete group" });
    }

    const memberIds = room.members.map(m => m.toString());

    await ChatMessage.deleteMany({ room: room_id });
    await ChatRoom.deleteOne({ _id: room_id });

    req.io.to(room_id.toString()).emit("group_deleted", {
      room_id: room_id.toString()
    });

    memberIds.forEach(memberId => {
      req.io.to(`notif_${memberId}`).emit("group_updated", {
        room_id: room_id.toString(),
        action: "deleted"
      });
    });

    return res.json({ success: true, message: "Group deleted successfully" });

  } catch (error) {
    console.error("❌ Delete group error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: sanitizeError(error) });
  }
});

export default router;
