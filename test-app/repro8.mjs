import { track, get, set } from '@vesk/runtime/src/index-server'
const c = track([])
console.log('cell keys:', Object.keys(c))
console.log('cell.length:', c.length)
console.log('cell.__v:', c.__v)
set(c, [{ id: 1 }])
console.log('after set, c.__v:', JSON.stringify(c.__v))
console.log('after set, c.length:', c.length)
console.log('get(c):', JSON.stringify(get(c)))
