import jwt from "jsonwebtoken";

export function adminJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || "admin-stats-dev-only";
}

export function verifyAdmin(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Admin authentication required" });
  }
  try {
    const token = h.slice(7);
    const payload = jwt.verify(token, adminJwtSecret());
    if (payload?.type !== "admin") throw new Error("invalid");
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid or expired admin session" });
  }
}
