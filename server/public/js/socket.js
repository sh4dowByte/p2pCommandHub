// Connect to Socket.io with role metadata
export const socket = io({
  auth: {
    role: 'dashboard'
  }
});
