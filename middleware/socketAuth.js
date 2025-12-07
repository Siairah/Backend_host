// Middleware to get auth token from Socket.IO connection
// Use this in routes that need tab-specific authentication

import tabAuthManager from "../tabAuthManager.js";

/**
 * Get auth token from Socket.IO connection
 * This allows different tabs to have different auth tokens
 * 
 * @param {string} socketId - Socket.IO connection ID
 * @returns {Object|null} - { userId, token, tabId } or null
 */
export function getAuthFromSocket(socketId) {
  return tabAuthManager.getAuth(socketId);
}

/**
 * Middleware to attach socket auth to request
 * Call this before routes that need tab-specific auth
 */
export function attachSocketAuth(req, res, next) {
  // Get socket ID from query or headers
  const socketId = req.query.socket_id || req.headers['x-socket-id'];
  
  if (socketId) {
    const auth = tabAuthManager.getAuth(socketId);
    if (auth) {
      req.socketAuth = auth;
      req.userId = auth.userId;
      req.token = auth.token;
    }
  }
  
  next();
}

