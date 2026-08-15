package sidecar

import _ "embed"

// SidecarJS is the esbuild-bundled compiler sidecar (compiled from server.ts
// by packages/haul-platforms/build-platform.mjs). The haul binary embeds it so
// a separate sidecar.js file or VESK_SIDECAR env var is not required. At
// runtime cli extracts it into the project's .vesk/haul dir, where `node` can
// resolve @vesk/compiler/@vesk/runtime/@vesk/adapter from the project's
// node_modules.
//
//go:embed sidecar.js
var SidecarJS []byte
