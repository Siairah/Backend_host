import mongoose from "mongoose";
import Notification from "./models/notification.js";
import Profile from "./models/profile.js";
import { User } from "./models/index.js";
import { CircleMembership, CircleJoinRequest } from "./models/circle.js";
import { Post, Comment, Like, PostReport, ModerationQueue } from "./models/post.js";
import { adminHardDeletePost } from "./adminPostUtils.js";

/**
 * Superadmin: permanently remove a user and owned content (posts hard-deleted via adminHardDeletePost).
 */
export async function adminHardDeleteUser(userId) {
  const id = String(userId);
  if (!mongoose.isValidObjectId(id)) return { ok: false, message: "Invalid user id" };
  const user = await User.findById(id);
  if (!user) return { ok: false, message: "User not found" };

  const postIds = await Post.find({ user: id }).distinct("_id");
  for (const pid of postIds) {
    await adminHardDeletePost(String(pid));
  }

  await Comment.deleteMany({ user: id });
  await Like.deleteMany({ user: id });
  await PostReport.deleteMany({ reported_by: id });
  await ModerationQueue.deleteMany({ user: id });
  await Notification.deleteMany({
    $or: [{ recipient: id }, { sender: id }],
  });
  await CircleMembership.deleteMany({ user: id });
  await CircleJoinRequest.deleteMany({ user: id });
  await Profile.deleteMany({ user: id });

  await User.deleteOne({ _id: id });
  return { ok: true };
}
