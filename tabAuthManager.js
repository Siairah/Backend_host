class TabAuthManager {
  constructor() {
    this.socketAuthMap = new Map();
    
    this.tabSocketMap = new Map();
  }

  registerTab(socketId, tabId, userId, token) {
    this.socketAuthMap.set(socketId, {
      userId,
      token,
      tabId,
      connectedAt: new Date()
    });
    this.tabSocketMap.set(tabId, socketId);
    console.log(`✅ Tab registered: ${tabId} -> User: ${userId} (Socket: ${socketId})`);
  }

  getAuth(socketId) {
    return this.socketAuthMap.get(socketId);
  }

  getAuthByTabId(tabId) {
    const socketId = this.tabSocketMap.get(tabId);
    if (socketId) {
      return this.socketAuthMap.get(socketId);
    }
    return null;
  }

  updateToken(socketId, newToken, newUserId) {
    const auth = this.socketAuthMap.get(socketId);
    if (auth) {
      auth.token = newToken;
      auth.userId = newUserId;
      console.log(`🔄 Token updated for Socket: ${socketId} -> User: ${newUserId}`);
      return true;
    }
    return false;
  }

  removeTab(socketId) {
    const auth = this.socketAuthMap.get(socketId);
    if (auth) {
      this.tabSocketMap.delete(auth.tabId);
      this.socketAuthMap.delete(socketId);
      console.log(`🗑️ Tab removed: ${auth.tabId} (Socket: ${socketId})`);
      return true;
    }
    return false;
  }

  getUserTabs(userId) {
    const tabs = [];
    for (const [socketId, auth] of this.socketAuthMap.entries()) {
      if (auth.userId === userId) {
        tabs.push({
          socketId,
          tabId: auth.tabId,
          connectedAt: auth.connectedAt
        });
      }
    }
    return tabs;
  }

  getUserSockets(userId) {
    const sockets = [];
    const userIdStr = userId.toString();
    for (const [socketId, auth] of this.socketAuthMap.entries()) {
      if (auth.userId && auth.userId.toString() === userIdStr) {
        sockets.push(socketId);
      }
    }
    console.log(`🔍 getUserSockets(${userIdStr}): Found ${sockets.length} socket(s) out of ${this.socketAuthMap.size} total connections`);
    return sockets;
  }

  cleanup() {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000;
    
    for (const [socketId, auth] of this.socketAuthMap.entries()) {
      if (now - auth.connectedAt > maxAge) {
        this.removeTab(socketId);
      }
    }
  }
}

export default new TabAuthManager();
