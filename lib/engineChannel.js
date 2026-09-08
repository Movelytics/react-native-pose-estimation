"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCTION_SQUAT_IDS = exports.JUMP_EXERCISE_IDS = exports.V4_ONLY_EXERCISE_IDS = void 0;
exports.isProductionSquatId = isProductionSquatId;
exports.normalizeEngineChannel = normalizeEngineChannel;
exports.resolveMovementEngine = resolveMovementEngine;
exports.requiresEngineV4 = requiresEngineV4;
exports.isJumpExercise = isJumpExercise;
/** Wellness ids with no V3 FSM. */
exports.V4_ONLY_EXERCISE_IDS = [
    'shoulder_roll',
    'shoulder_deep_breath',
    'chair_forward_fold',
    'chair_side_stretch',
];
/** Existing jump handlers — not V4 JSON. */
exports.JUMP_EXERCISE_IDS = ['jump_analysis', 'air_time_jump'];
exports.PRODUCTION_SQUAT_IDS = ['squat', 'face_squat'];
function isProductionSquatId(exerciseId) {
    const id = String(exerciseId || '')
        .trim()
        .toLowerCase();
    return id === 'squat' || id === 'face_squat';
}
/** Handshake default is V4. Pass `'v3'` to force the V3 bundle. */
function normalizeEngineChannel(raw) {
    return raw === 'v3' ? 'v3' : 'v4';
}
/**
 * Session interpreter for this id. Production squat stays V3 unless `engine`
 * is explicitly `'v4'`. Other ids follow the handshake (default V4).
 */
function resolveMovementEngine(opts = {}) {
    if (opts.userExercise)
        return 'v4';
    const requested = String(opts.engine || '')
        .trim()
        .toLowerCase();
    if (isProductionSquatId(opts.exercise) && requested !== 'v4')
        return 'v3';
    return normalizeEngineChannel(opts.engine);
}
function requiresEngineV4(exerciseId) {
    return exports.V4_ONLY_EXERCISE_IDS.includes(exerciseId);
}
function isJumpExercise(exerciseId) {
    return exports.JUMP_EXERCISE_IDS.includes(exerciseId);
}
