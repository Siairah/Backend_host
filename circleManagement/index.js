import { Router } from "express";
import dashboardRoutes from "./dashboard.js";
import membersRoutes from "./members.js";
import requestsRoutes from "./requests.js";
import settingsRoutes from "./settings.js";
import moderationPostsRoutes from "./moderation/posts.js";
import moderationUsersRoutes from "./moderation/users.js";

const router = Router();

// Dashboard route (must come first as it has /manage/:circle_id)
router.use(dashboardRoutes);

// Member management routes
router.use(membersRoutes);

// Join request routes
router.use(requestsRoutes);

// Circle settings routes
router.use(settingsRoutes);

// Moderation routes
router.use(moderationPostsRoutes);
router.use(moderationUsersRoutes);

export default router;

