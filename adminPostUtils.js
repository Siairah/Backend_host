import cloudinary from "./cloudinaryConfig.js";
import { Post, PostMedia, Comment, Like, PostReport, ModerationQueue } from "./models/post.js";

/**
 * Platform admin: delete post and related media (same cleanup as user delete-post route).
 */
export async function adminHardDeletePost(postId) {
  const id = String(postId);
  const post = await Post.findById(id);
  if (!post) return { ok: false, message: "Post not found" };

  const mediaFiles = await PostMedia.find({ post: id });
  for (const media of mediaFiles) {
    try {
      if (media.file && media.file.includes("cloudinary")) {
        const urlParts = media.file.split("/");
        const publicId = urlParts.slice(-2).join("/").split(".")[0];
        await cloudinary.uploader.destroy(publicId);
      }
    } catch (err) {
      console.error("Cloudinary delete error:", err);
    }
  }

  await PostMedia.deleteMany({ post: id });
  await Comment.deleteMany({ post: id });
  await Like.deleteMany({ post: id });
  await PostReport.deleteMany({ post: id });
  await ModerationQueue.deleteMany({ post: id });
  await Post.deleteOne({ _id: id });

  return { ok: true };
}
