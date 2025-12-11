import { CircleMembership } from "../models/circle.js";

/**
 * Check if a user is an admin of a circle
 */
export async function isCircleAdmin(userId, circleId) {
  const membership = await CircleMembership.findOne({
    user: userId,
    circle: circleId,
    is_admin: true
  });
  return !!membership;
}

/**
 * Safe populate options to prevent errors when users are deleted
 */
export const safePopulateOptions = {
  select: '_id email',
  options: { strictPopulate: false }
};

