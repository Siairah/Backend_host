import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

// Profile Schema - Separate from User
const profileSchema = new Schema({
  user: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  full_name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 255
  },
  bio: {
    type: String,
    default: '',
    maxlength: 500
  },
  dob: {
    type: Date,
    required: true
  },
  gender: {
    type: String,
    enum: ['M', 'F', 'O'], // Male, Female, Other
    required: true,
    default: 'O'
  },
  profile_pic: {
    type: String,
    default: '/images/default_profile.png'
  }
}, {
  timestamps: true,
  collection: 'profiles'
});

// Create model only once
if (models.Profile) {
  delete models.Profile;
}

const Profile = model("Profile", profileSchema);

export default Profile;
