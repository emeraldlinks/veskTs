import { JsonLd, ArticleSchema, ProductSchema, FAQPageSchema, BreadcrumbListSchema, OrganizationSchema, LocalBusinessSchema, VideoSchema } from './seo.js';

let passed = 0;
let failed = 0;

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

function it(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
  }
}

function expect(actual) {
  const self = {
    toBe(expected) {
      if (actual !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
    },
    toContain(expected) {
      if (!actual.includes(expected)) throw new Error(`Expected "${actual}" to contain "${expected}"`);
    },
    toBeDefined() {
      if (actual == null) throw new Error('Expected value to be defined');
    },
    toBeNull() {
      if (actual !== null) throw new Error(`Expected null, got ${typeof actual}`);
    },
    toBeGreaterThan(expected) {
      if (actual <= expected) throw new Error(`Expected ${actual} > ${expected}`);
    },
    not: {},
  };
  self.not.toContain = (expected) => {
    if (actual.includes(expected)) throw new Error(`Expected "${actual}" not to contain "${expected}"`);
  };
  return self;
}

describe('JsonLd', () => {
  it('renders script tag in SSR', () => {
    const result = JsonLd({ schema: { '@type': 'WebSite', name: 'Test' } });
    expect(result).toContain('<script type="application/ld+json">');
    expect(result).toContain('"@type":"WebSite"');
    expect(result).toContain('"name":"Test"');
    expect(result).toContain('"@context":"https://schema.org"');
  });

  it('sanitizes </script> in JSON content', () => {
    const result = JsonLd({ schema: { name: '</script><script>alert(1)' } });
    expect(result).toContain('<\\/script>');
    // The closing </script> tag is valid - only the one in JSON content should be escaped
    expect(result.indexOf('<\\/script>')).toBeGreaterThan(-1);
  });

  it('returns script tag in SSR (document undefined)', () => {
    const result = JsonLd({ schema: { '@type': 'WebSite' } });
    expect(result).toContain('<script');
    expect(result).toContain('"@type":"WebSite"');
  });
});

describe('ArticleSchema', () => {
  it('builds Article schema object', () => {
    const result = ArticleSchema({
      headline: 'Hello World',
      description: 'A test article',
      author: 'John Doe',
      datePublished: '2026-01-01',
      image: 'https://example.com/img.jpg',
    });
    expect(result['@type']).toBe('Article');
    expect(result.headline).toBe('Hello World');
    expect(result.author.name).toBe('John Doe');
    expect(result.author['@type']).toBe('Person');
    expect(result.datePublished).toBe('2026-01-01');
    expect(result.image[0]).toBe('https://example.com/img.jpg');
  });

  it('handles multiple authors', () => {
    const result = ArticleSchema({
      headline: 'Multi',
      description: 'desc',
      author: ['Alice', 'Bob'],
      datePublished: '2026-01-01',
    });
    expect(result.author.length).toBe(2);
    expect(result.author[0].name).toBe('Alice');
    expect(result.author[1].name).toBe('Bob');
  });
});

describe('ProductSchema', () => {
  it('builds Product schema', () => {
    const result = ProductSchema({
      name: 'Widget',
      description: 'A widget',
      price: '29.99',
      currency: 'USD',
      inStock: true,
      sku: 'WID-001',
      brand: 'Acme',
      url: 'https://example.com/widget',
    });
    expect(result['@type']).toBe('Product');
    expect(result.name).toBe('Widget');
    expect(result.offers.price).toBe('29.99');
    expect(result.offers.availability).toBe('https://schema.org/InStock');
    expect(result.brand.name).toBe('Acme');
  });

  it('marks out of stock', () => {
    const result = ProductSchema({ name: 'Gadget', description: 'g', price: '10', inStock: false });
    expect(result.offers.availability).toBe('https://schema.org/OutOfStock');
  });

  it('supports reviews and aggregate rating', () => {
    const result = ProductSchema({
      name: 'Thing', description: 't', price: '5',
      reviews: [{ rating: 5, author: 'Jane', body: 'Great' }],
      aggregateRating: { value: '4.5', count: 10 },
    });
    expect(result.review[0].reviewRating.ratingValue).toBe(5);
    expect(result.review[0].author.name).toBe('Jane');
    expect(result.aggregateRating.ratingValue).toBe('4.5');
    expect(result.aggregateRating.reviewCount).toBe(10);
  });
});

describe('FAQPageSchema', () => {
  it('builds FAQ schema from array', () => {
    const result = FAQPageSchema([
      { question: 'Q1?', answer: 'A1' },
      { question: 'Q2?', answer: 'A2' },
    ]);
    expect(result['@type']).toBe('FAQPage');
    expect(result.mainEntity.length).toBe(2);
    expect(result.mainEntity[0].name).toBe('Q1?');
    expect(result.mainEntity[0].acceptedAnswer.text).toBe('A1');
    expect(result.mainEntity[1].name).toBe('Q2?');
  });
});

describe('BreadcrumbListSchema', () => {
  it('builds breadcrumb list', () => {
    const result = BreadcrumbListSchema([
      { name: 'Home', url: '/' },
      { name: 'Products', url: '/products' },
    ]);
    expect(result['@type']).toBe('BreadcrumbList');
    expect(result.itemListElement[0].position).toBe(1);
    expect(result.itemListElement[0].name).toBe('Home');
    expect(result.itemListElement[0].item).toBe('/');
    expect(result.itemListElement[1].position).toBe(2);
  });
});

describe('OrganizationSchema', () => {
  it('builds organization schema', () => {
    const result = OrganizationSchema({
      name: 'Vesk Inc',
      url: 'https://vesk.dev',
      logo: 'https://vesk.dev/logo.png',
      sameAs: ['https://twitter.com/vesk'],
    });
    expect(result['@type']).toBe('Organization');
    expect(result.name).toBe('Vesk Inc');
    expect(result.sameAs[0]).toBe('https://twitter.com/vesk');
  });

  it('includes contact and address', () => {
    const result = OrganizationSchema({
      name: 'Co',
      url: 'https://co.com',
      contactPoint: { telephone: '+1-555-0000', email: 'hi@co.com' },
      address: { streetAddress: '123 Main', addressLocality: 'City', addressRegion: 'ST', postalCode: '12345', addressCountry: 'US' },
    });
    expect(result.contactPoint.telephone).toBe('+1-555-0000');
    expect(result.address.streetAddress).toBe('123 Main');
  });
});

describe('LocalBusinessSchema', () => {
  it('extends organization with business fields', () => {
    const result = LocalBusinessSchema({
      name: 'Shop',
      url: 'https://shop.com',
      hours: [{ days: 'Mon-Fri', open: '09:00', close: '17:00' }],
      priceRange: '$$',
      telephone: '+1-555-1234',
    });
    expect(result['@type']).toBe('LocalBusiness');
    expect(result.openingHoursSpecification[0].dayOfWeek).toBe('Mon-Fri');
    expect(result.openingHoursSpecification[0].opens).toBe('09:00');
    expect(result.priceRange).toBe('$$');
    expect(result.telephone).toBe('+1-555-1234');
  });
});

describe('VideoSchema', () => {
  it('builds video schema', () => {
    const result = VideoSchema({
      name: 'My Video',
      description: 'Great video',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      uploadDate: '2026-01-15',
      duration: 'PT5M',
      contentUrl: 'https://example.com/video.mp4',
      viewCount: 1000,
    });
    expect(result['@type']).toBe('VideoObject');
    expect(result.name).toBe('My Video');
    expect(result.thumbnailUrl[0]).toBe('https://example.com/thumb.jpg');
    expect(result.duration).toBe('PT5M');
    expect(result.interactionStatistic.userInteractionCount).toBe(1000);
  });
});

console.log(`\nResults: ${passed} passed, ${failed} failed, ${passed + failed} total`);
process.exit(failed > 0 ? 1 : 0);
