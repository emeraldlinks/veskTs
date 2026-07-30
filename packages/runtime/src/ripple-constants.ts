export const ROOT_BLOCK = 1 << 1;
export const RENDER_BLOCK = 1 << 2;
export const EFFECT_BLOCK = 1 << 3;
export const BRANCH_BLOCK = 1 << 4;
export const FOR_BLOCK = 1 << 5;
export const TRY_BLOCK = 1 << 6;
export const IF_BLOCK = 1 << 7;
export const SWITCH_BLOCK = 1 << 8;
export const COMPOSITE_BLOCK = 1 << 9;
export const ASYNC_BLOCK = 1 << 10;
export const HEAD_BLOCK = 1 << 11;
export const PRE_EFFECT_BLOCK = 1 << 12;
export const DIRECT_CHILD_BLOCK = 1 << 13;
export const CONTAINS_UPDATE = 1 << 14;
export const CONTAINS_TEARDOWN = 1 << 15;
export const BLOCK_HAS_RUN = 1 << 16;
export const TRACKED = 1 << 17;
export const DERIVED = 1 << 18;
export const DEFERRED = 1 << 19;
export const PAUSED = 1 << 20;
export const DESTROYED = 1 << 21;
export const UPDATE_SOURCE = 1 << 22;

export const CONTROL_FLOW_BLOCK = FOR_BLOCK | IF_BLOCK | SWITCH_BLOCK | TRY_BLOCK | COMPOSITE_BLOCK;

export const UNINITIALIZED: unique symbol = Symbol('uninitialized');
export const TRACKED_ARRAY: unique symbol = Symbol();
export const TRACKED_OBJECT: unique symbol = Symbol();
export const COMPUTED_PROPERTY: unique symbol = Symbol();
export const HMR: unique symbol = Symbol();
export const REF_PROP = 'ref';
export const ARRAY_SET_INDEX_AT: unique symbol = Symbol();
export const MAX_ARRAY_LENGTH = 2 ** 32 - 1;
export const DEFAULT_NAMESPACE = 'html';
export const NAMESPACE_URI = {
	html: 'http://www.w3.org/1999/xhtml',
	svg: 'http://www.w3.org/2000/svg',
	mathml: 'http://www.w3.org/1998/Math/MathML',
};
export const TRACKED_UPDATED: unique symbol = Symbol('TRACKED_UPDATED');
export const SUSPENSE_PENDING: unique symbol = Symbol('suspense_pending');
export const SUSPENSE_REJECTED: unique symbol = Symbol('suspense_rejected');
export const ASYNC_DERIVED_READ_THROWN: unique symbol = Symbol('async_derived_read_thrown');
