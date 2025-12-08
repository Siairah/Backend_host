import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// Circle Model - Communities
const circleSchema = new Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    maxlength: 100,
    trim: true
  },
  description: {
    type: String,
    maxlength: 100,
    default: ''
  },
  rules: {
    type: String,
    maxlength: 500,
    default: ''
  },
  cover_image: {
    type: String,
    default: null
  },
  created_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  visibility: {
    type: String,
    enum: ['public', 'private'],
    default: 'public'
  }
}, {
  timestamps: true,
  collection: 'circles'
});

// CircleMembership Model
const circleMembershipSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  circle: {
    type: Schema.Types.ObjectId,
    ref: 'Circle',
    required: true
  },
  is_admin: {
    type: Boolean,
    default: false
  },
  joined_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'circle_memberships'
});

circleMembershipSchema.index({ user: 1, circle: 1 }, { unique: true });

// CircleJoinRequest Model
const circleJoinRequestSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  circle: {
    type: Schema.Types.ObjectId,
    ref: 'Circle',
    required: true
  },
  message: {
    type: String,
    default: ''
  },
  is_approved: {
    type: Boolean,
    default: false
  },
  requested_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'circle_join_requests'
});

circleJoinRequestSchema.index({ user: 1, circle: 1 }, { unique: true });

// CircleRestriction Model
const circleRestrictionSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  circle: {
    type: Schema.Types.ObjectId,
    ref: 'Circle',
    required: true
  },
  reason: {
    type: String,
    maxlength: 255,
    required: true
  },
  restricted_until: {
    type: Date,
    required: true
  },
  created_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'circle_restrictions'
});

circleRestrictionSchema.index({ user: 1, circle: 1 });

// CircleBanList Model 
const circleBanListSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  circle: {
    type: Schema.Types.ObjectId,
    ref: 'Circle',
    required: true
  },
  reason: {
    type: String,
    default: ''
  },
  banned_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'circle_bans'
});

circleBanListSchema.index({ user: 1, circle: 1 }, { unique: true });

if (models.Circle) delete models.Circle;
if (models.CircleMembership) delete models.CircleMembership;
if (models.CircleJoinRequest) delete models.CircleJoinRequest;
if (models.CircleRestriction) delete models.CircleRestriction;
if (models.CircleBanList) delete models.CircleBanList;

const Circle = model("Circle", circleSchema);
const CircleMembership = model("CircleMembership", circleMembershipSchema);
const CircleJoinRequest = model("CircleJoinRequest", circleJoinRequestSchema);
const CircleRestriction = model("CircleRestriction", circleRestrictionSchema);
const CircleBanList = model("CircleBanList", circleBanListSchema);

export { Circle, CircleMembership, CircleJoinRequest, CircleRestriction, CircleBanList };

