"use strict";
//lib/posts/authz.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.canMutateOwnedResource = canMutateOwnedResource;
exports.canToggleFollow = canToggleFollow;
const content_1 = require("./content");
function canMutateOwnedResource(actorAddress, ownerAddress) {
    return (0, content_1.normalizeAddress)(actorAddress) === (0, content_1.normalizeAddress)(ownerAddress);
}
function canToggleFollow(actorAddress, targetAddress) {
    return (0, content_1.normalizeAddress)(actorAddress) !== (0, content_1.normalizeAddress)(targetAddress);
}
