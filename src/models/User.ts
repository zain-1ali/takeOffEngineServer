import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  /** Absent for Google-only accounts until a password is set. */
  passwordHash?: string;
  name: string;
  googleId?: string;
  emailVerified: boolean;
  emailVerificationTokenHash?: string;
  emailVerificationExpires?: Date;
  passwordResetTokenHash?: string;
  passwordResetExpires?: Date;
  tokenVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
    },
    emailVerified: {
      type: Boolean,
      // Existing accounts predate verification; new password signups set false explicitly.
      default: true,
    },
    emailVerificationTokenHash: { type: String },
    emailVerificationExpires: { type: Date },
    passwordResetTokenHash: { type: String },
    passwordResetExpires: { type: Date },
    tokenVersion: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true },
);

export const User = mongoose.model<IUser>('User', userSchema);
