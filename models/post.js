import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// Post Model (Django pattern)
const postSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  circle: {
    type: Schema.Types.ObjectId,
    ref: 'Circle',
    default: null
  },
  content: {
    type: String,
    required: true
  },
  is_public: {
    type: Boolean,
    default: true
  },
  is_approved: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  collection: 'posts'
});

// PostMedia Model (Django pattern)
const postMediaSchema = new Schema({
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  file: {
    type: String,
    required: true
  },
  type: {
    type: String,
    enum: ['image', 'video'],
    default: 'image'
  }
}, {
  timestamps: true,
  collection: 'post_media'
});

// Comment Model (Django pattern)
const commentSchema = new Schema({
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true
  },
  is_deleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  collection: 'comments'
});

// Like Model (Django pattern - unique constraint)
const likeSchema = new Schema({
  post: {
    type: Schema.Types.ObjectId,
    ref: 'Post',
    required: true
  },
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  collection: 'likes'
});

likeSchema.index({ post: 1, user: 1 }, { unique: true });

if (models.Post) delete models.Post;
if (models.PostMedia) delete models.PostMedia;
if (models.Comment) delete models.Comment;
if (models.Like) delete models.Like;

const Post = model("Post", postSchema);
const PostMedia = model("PostMedia", postMediaSchema);
const Comment = model("Comment", commentSchema);
const Like = model("Like", likeSchema);

export { Post, PostMedia, Comment, Like };

