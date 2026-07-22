// Suspense requires compiler-level support to create the boundary
// before children are evaluated (children are pre-evaluated by
// emitComponentCall before the component function runs).
//
// For now, use the `if (loading)` pattern with createResource:
//   const &[data] = createResource(fetchData);
//   if (data) return <div>{data}</div>;
//   return <p>Loading...</p>;
//
// This compiles to OpaqueDynamicRegion and works reactively.
//
// Full Suspense with coordinated boundaries across multiple resources
// will be added as a compiler intrinsic in a future phase.
