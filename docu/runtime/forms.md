# Forms & Validation

Vesk provides `<Form>` and `<Field>` components with built-in
client-side validation and server action integration.

## Form component

```vsk
import { Form, Field, required, email, minLength } from '@vesk/runtime';

component SignupForm() {
  return (
    <Form onSubmit={(data) => console.log(data)} action="/api/signup" method="POST">
      <Field name="name" label="Name" rules={[required('Name is required')]} />
      <Field name="email" label="Email" rules={[required(), email('Invalid email')]} />
      <Field name="password" label="Password" rules={[minLength(8, 'Min 8 chars')]} />
      <button type="submit">Sign up</button>
    </Form>
  );
}
```

### Form props

| Prop | Type | Description |
|------|------|-------------|
| `onSubmit` | `(data: Record<string, unknown>) => void` | Called with validated field values |
| `onError` | `(errors: Record<string, string>) => void` | Called when validation fails |
| `onSuccess` | `() => void` | Called after successful action execution |
| `action` | `string` | Server action URL (for native form submission) |
| `method` | `string` | HTTP method (`POST`, `PUT`, etc.) |
| `children` | content | Form fields and elements |

## Field component

```vsk
<Field
  name="email"
  label="Email address"
  rules={[required(), email()]}
  errorClass="border-red-500"
/>
```

### Field props

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Field name (used as key in form data) |
| `label` | `string` | Label text rendered above the input |
| `rules` | `ValidationRule[]` | Validation rules to apply |
| `errorClass` | `string` | CSS class added when validation fails |
| `children` | content | Custom input element |

## Validation rules

All auto-imported from `@vesk/runtime`.

### required

```ts
required()              // default: "This field is required"
required('Name needed') // custom message
```

### email

```ts
email()              // default: "Invalid email address"
email('Bad email')   // custom message
```

### minLength / maxLength

```ts
minLength(3, 'Min 3 characters')
maxLength(100, 'Max 100 characters')
```

### pattern

```ts
pattern(/^[A-Z]/, 'Must start with uppercase')
```

### custom

```ts
custom(
  (value) => value !== 'admin',
  'Username "admin" is reserved'
)
```

### Stacking rules

```vsk
<Field
  name="username"
  rules={[
    required('Username is required'),
    minLength(3, 'Min 3 characters'),
    maxLength(20, 'Max 20 characters'),
    pattern(/^[a-z]+$/, 'Lowercase letters only'),
  ]}
/>
```

Rules run in order. First failure wins.

## Server actions with forms

```ts
import { defineAction, required, email } from '@vesk/runtime';

const signup = defineAction({
  input: {
    name: required('Name required'),
    email: [required(), email()],
    password: minLength(8, 'Min 8 characters'),
  },
  async execute(input, ctx) {
    const user = await createUser(input);
    ctx.redirect('/dashboard');
    return { user };
  },
});
```

### Action context

The `execute` function receives:

| Property | Type | Description |
|----------|------|-------------|
| `request` | `Request` | The incoming request |
| `params` | `Record<string, string>` | Route parameters |
| `url` | `string` | Request URL |
| `headers()` | `() => Map<string, string>` | Response headers |
| `cookies()` | `() => Record<string, string>` | Request cookies |
| `locals()` | `() => Record<string, unknown>` | Per-request local data |
| `redirect(url, status?)` | function | Return a redirect response |

### Validating action input

```ts
const issues = validateActionInput(actionDef, inputData);
const fieldErrors = issuesToFieldMap(issues);
// { email: 'Invalid email', password: 'Min 8 characters' }
```

## Verified against

- `packages/runtime/src/form.ts` — `Form`, `Field`, validation rules
- `packages/runtime/src/action.ts` — `defineAction`, `validateActionInput`,
  `issuesToFieldMap`
- `packages/runtime/src/index-client.ts` — form/action exports
