import { Router } from "express";
import Event from "./models/event.js";
import { CircleMembership } from "./models/circle.js";

const router = Router();

async function isCircleAdmin(userId, circleId) {
  const membership = await CircleMembership.findOne({
    user: userId,
    circle: circleId,
    is_admin: true
  });
  return !!membership;
}

async function isCircleMember(userId, circleId) {
  const membership = await CircleMembership.findOne({
    user: userId,
    circle: circleId
  });
  return !!membership;
}

/* GET /events/dashboard?user_id=X - Events from all user's circles (must be before /) */
router.get("/dashboard", async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const memberships = await CircleMembership.find({ user: user_id }).distinct("circle");
    const now = new Date();

    const events = await Event.find({
      circle: { $in: memberships },
      event_date: { $gte: now }
    })
      .sort({ event_date: 1 })
      .limit(20)
      .populate("circle", "name")
      .lean();

    const formatted = events.map((e) => ({
      id: e._id.toString(),
      title: e.title,
      event_date: e.event_date,
      location: e.location || "",
      reserve_count: e.reserve_count || 0,
      user_has_reserved: (e.reserved_by || []).some(
        (id) => id && id.toString() === user_id
      ),
      circle_id: e.circle?._id?.toString(),
      circle_name: e.circle?.name || ""
    }));

    return res.json({ success: true, events: formatted });
  } catch (error) {
    console.error("❌ Dashboard events error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* GET /events?circle_id=X&user_id=Y - List upcoming events (members only, past events excluded) */
router.get("/", async (req, res) => {
  try {
    const { circle_id, user_id } = req.query;

    if (!circle_id || !user_id) {
      return res.status(400).json({ success: false, message: "Circle ID and User ID required" });
    }

    const isMember = await isCircleMember(user_id, circle_id);
    if (!isMember) {
      return res.status(403).json({ success: false, message: "Must be a circle member to view events" });
    }

    const now = new Date();
    const events = await Event.find({
      circle: circle_id,
      event_date: { $gte: now }
    })
      .sort({ event_date: 1 })
      .populate("created_by", "email")
      .lean();

    const formatted = events.map((e) => ({
      id: e._id.toString(),
      title: e.title,
      description: e.description || "",
      event_date: e.event_date,
      location: e.location || "",
      reserve_count: e.reserve_count || 0,
      user_has_reserved: (e.reserved_by || []).some(
        (id) => id && id.toString() === user_id
      ),
      created_by: e.created_by?.email || null
    }));

    return res.json({ success: true, events: formatted });
  } catch (error) {
    console.error("❌ Get events error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* POST /events - Create event (admin only) */
router.post("/", async (req, res) => {
  try {
    const { circle_id, user_id, title, description, event_date, location } = req.body;

    if (!circle_id || !user_id || !title || !event_date) {
      return res.status(400).json({ success: false, message: "Circle ID, User ID, title, and event date required" });
    }

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Only circle admins can add events" });
    }

    const eventDate = new Date(event_date);
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({ success: false, message: "Invalid event date" });
    }

    const event = await Event.create({
      circle: circle_id,
      title: title.trim(),
      description: (description || "").trim(),
      event_date: eventDate,
      location: (location || "").trim(),
      created_by: user_id,
      reserve_count: 0,
      reserved_by: []
    });

    return res.status(201).json({
      success: true,
      event: {
        id: event._id.toString(),
        title: event.title,
        description: event.description,
        event_date: event.event_date,
        location: event.location,
        reserve_count: 0,
        user_has_reserved: false,
        created_by: user_id
      },
      message: "Event created"
    });
  } catch (error) {
    console.error("❌ Create event error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* DELETE /events/:id - Delete event (admin only) */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const isAdmin = await isCircleAdmin(user_id, event.circle.toString());
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "Only circle admins can delete events" });
    }

    await Event.deleteOne({ _id: id });
    return res.json({ success: true, message: "Event deleted" });
  } catch (error) {
    console.error("❌ Delete event error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/* POST /events/:id/reserve - Reserve (members only, one per user per event) */
router.post("/:id/reserve", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({ success: false, message: "Event not found" });
    }

    const isMember = await isCircleMember(user_id, event.circle.toString());
    if (!isMember) {
      return res.status(403).json({ success: false, message: "Must be a circle member to reserve" });
    }

    if (new Date(event.event_date) < new Date()) {
      return res.status(400).json({ success: false, message: "Event has already passed" });
    }

    const reservedBy = (event.reserved_by || []).map((x) => x.toString());
    if (reservedBy.includes(user_id)) {
      return res.status(400).json({ success: false, message: "You have already reserved" });
    }

    const mongoose = await import("mongoose");
    event.reserved_by = event.reserved_by || [];
    event.reserved_by.push(new mongoose.Types.ObjectId(user_id));
    event.reserve_count = event.reserved_by.length;
    await event.save();

    return res.json({
      success: true,
      reserve_count: event.reserve_count,
      user_has_reserved: true,
      message: "Reserved successfully"
    });
  } catch (error) {
    console.error("❌ Reserve event error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
