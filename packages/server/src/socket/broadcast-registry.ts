// Minimal fixture for eslint-rules/socket-registry-broadcasts.test.js.
// The real Musi file also validates payloads and emits/logs through helper
// functions; this reference dump keeps only the registry shape the rule tracks.

export const BROADCAST_REGISTRY = {
  "campaign:updated": {},
  "character:updated": {},
  "chat:newMessage": {},
  "encounter:updated": {},
  "map:layerUpdated": {},
  "map:tokenUpdated": {},
  "notification:new": {},
};
