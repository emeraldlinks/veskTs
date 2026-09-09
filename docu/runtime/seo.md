# SEO

Vesk provides structured data (JSON-LD) components for search engine
optimization.

All auto-imported from `@vesk/runtime`.

## JsonLd component

Renders a `<script type="application/ld+json">` tag with structured data.

```vsk
import { JsonLd, ArticleSchema } from '@vesk/runtime';

component BlogPost(props: { title: string, date: string, author: string }) {
  return (
    <div>
      <h1>{props.title}</h1>
      <JsonLd schema={ArticleSchema({
        headline: props.title,
        datePublished: props.date,
        author: { name: props.author },
      })} />
    </div>
  );
}
```

## Schema generators

All return `Record<string, unknown>` objects with `@type` set.

### ArticleSchema

```ts
ArticleSchema({
  headline: 'My Article',
  datePublished: '2026-01-15',
  dateModified: '2026-01-20',
  author: { name: 'Jane Doe', url: 'https://example.com/jane' },
  image: 'https://example.com/hero.jpg',
  publisher: { name: 'My Site', logo: { url: 'https://example.com/logo.png' } },
});
```

### ProductSchema

```ts
ProductSchema({
  name: 'Vesk Pro',
  description: 'The compiler-first framework',
  image: 'https://example.com/product.jpg',
  sku: 'VESK-PRO-001',
  offers: {
    price: '29.00',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
  },
});
```

### FAQPageSchema

```ts
FAQPageSchema([
  {
    question: 'What is Vesk?',
    answer: 'A compiler-first reactive UI framework.',
  },
  {
    question: 'Does it use a virtual DOM?',
    answer: 'No. It compiles to direct DOM mutations.',
  },
]);
```

### BreadcrumbListSchema

```ts
BreadcrumbListSchema([
  { name: 'Home', item: 'https://example.com/' },
  { name: 'Docs', item: 'https://example.com/docs' },
  { name: 'API', item: 'https://example.com/docs/api' },
]);
```

### OrganizationSchema

```ts
OrganizationSchema({
  name: 'Vesk',
  url: 'https://vesk.dev',
  logo: 'https://vesk.dev/logo.png',
  sameAs: ['https://github.com/vesk'],
});
```

### LocalBusinessSchema

```ts
LocalBusinessSchema({
  name: 'Vesk HQ',
  address: {
    streetAddress: '123 Main St',
    addressLocality: 'San Francisco',
    addressRegion: 'CA',
    postalCode: '94105',
  },
  telephone: '+1-555-0100',
  openingHours: 'Mo-Fr 09:00-17:00',
});
```

### VideoSchema

```ts
VideoSchema({
  name: 'Vesk in 5 Minutes',
  description: 'Quick introduction to the Vesk framework',
  thumbnailUrl: 'https://example.com/thumb.jpg',
  uploadDate: '2026-03-15',
  duration: 'PT5M',
});
```

## Verified against

- `packages/runtime/src/seo.ts` — `JsonLd`, schema generator functions
- `packages/runtime/src/index-client.ts` — SEO exports
