"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.V4_ONLY_EXERCISE_IDS = void 0;
exports.normalizeEngineChannel = normalizeEngineChannel;
exports.requiresEngineV4 = requiresEngineV4;
/** Movements that exist only in the V4 catalog (not in V3 FSM / Strapi). */
exports.V4_ONLY_EXERCISE_IDS = [
    'shoulder_roll',
    'shoulder_deep_breath',
    'chair_forward_fold',
];
function normalizeEngineChannel(raw) {
    return raw === 'v4' ? 'v4' : 'v3';
}
function requiresEngineV4(exerciseId) {
    return exports.V4_ONLY_EXERCISE_IDS.includes(exerciseId);
}
