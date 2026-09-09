# Network State

Vesk provides reactive browser network state tracking.

## getNetworkState

Returns the current network state:

```ts
import { getNetworkState } from '@vesk/runtime';

const state = getNetworkState();
console.log(state.online);       // true | false
console.log(state.effectiveType); // '4g' | '3g' | '2g' | 'slow-2g' | 'unknown'
console.log(state.downlink);     // Mbps | null
console.log(state.rtt);          // ms | null
console.log(state.saveData);     // boolean
```

### NetworkState type

```ts
interface NetworkState {
  online: boolean;
  effectiveType: EffectiveType;
  downlink: number | null;
  rtt: number | null;
  saveData: boolean;
}

type EffectiveType = 'slow-2g' | '2g' | '3g' | '4g' | 'unknown';
```

## watchNetwork

Subscribe to network changes:

```vsk
component NetworkStatus() {
  let &[online] = track(navigator.onLine);

  watchNetwork((state) => {
    online = state.online;
  });

  return (
    <p class={online ? 'text-green-600' : 'text-red-600'}>
      {online ? 'Online' : 'Offline'}
    </p>
  );
}
```

Returns an unsubscribe function:

```ts
const unsubscribe = watchNetwork((state) => {
  console.log('Network changed:', state);
});

// Later
unsubscribe();
```

## Verified against

- `packages/runtime/src/network.ts` — `getNetworkState`, `watchNetwork`
- `packages/runtime/src/index-client.ts` — network exports
