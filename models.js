const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullName: String,
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true,
    validate: {
      validator: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      message: props => `${props.value} is not a valid email!`
    }
  },
  password: { type: String, required: true },
  phone: String,
  otp: { 
    type: String,
    minlength: 6,
    maxlength: 6,
    validate: {
      validator: (v) => /^\d{6}$/.test(v),
      message: props => `${props.value} is not a valid 6-digit OTP!`
    }
  },
  otpExpiresAt: {
    type: Date,
    required: function() { return !!this.otp; }
  }
}, {
  timestamps: true,
  bufferCommands: false, // Disable command buffering
  autoCreate: false // Disable automatic collection creation
});

// Create collection explicitly with proper settings
userSchema.set('collection', 'users');
userSchema.set('strict', true); // Enforce strict schema
userSchema.set('validateBeforeSave', true); // Force validation

// Add index for OTP field
userSchema.index({ otp: 1 }, { 
  unique: true, 
  partialFilterExpression: { otp: { $exists: true } }
});

const User = mongoose.models.User || mongoose.model("User", userSchema);

// Verify collection exists and has proper indexes
async function verifyCollection() {
  try {
    const collection = mongoose.connection.db.collection('users');
    await collection.createIndex({ email: 1 }, { unique: true });
    await collection.createIndex({ otp: 1 }, { 
      unique: true, 
      partialFilterExpression: { otp: { $exists: true } }
    });
    console.log('Verified collection and indexes');
  } catch (err) {
    console.error('Collection verification failed:', err);
    throw err;
  }
}

// Call this when your DB connects
mongoose.connection.on('connected', verifyCollection);

module.exports = User;