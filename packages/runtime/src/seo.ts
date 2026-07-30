interface JsonLdProps {
	schema?: Record<string, unknown>;
	children?: Record<string, unknown>;
	key?: string;
	[k: string]: unknown;
}

export function JsonLd(props: JsonLdProps): string | null {
	const schema = props.schema || props.children || {};
	const json = JSON.stringify({
		'@context': 'https://schema.org',
		...schema,
	});
	if (typeof document === 'undefined') {
		return `<script type="application/ld+json">${json.replace(/<\/script>/g, '<\\/script>')}</script>`;
	}
	if (!document.querySelector(`script[type="application/ld+json"][data-key="${props.key || ''}"]`)) {
		const el = document.createElement('script');
		el.type = 'application/ld+json';
		el.textContent = json;
		if (props.key) el.setAttribute('data-key', props.key);
		document.head.appendChild(el);
	}
	return null;
}

interface ArticleData {
	headline: string;
	description?: string;
	author: string | string[];
	datePublished: string;
	dateModified?: string;
	image?: string | string[];
	publisher?: string;
	url?: string;
}

export function ArticleSchema(article: ArticleData): Record<string, unknown> {
	return {
		'@type': 'Article',
		headline: article.headline,
		description: article.description,
		author: Array.isArray(article.author)
			? article.author.map(a => ({ '@type': 'Person', name: a }))
			: { '@type': 'Person', name: article.author },
		datePublished: article.datePublished,
		dateModified: article.dateModified || article.datePublished,
		image: article.image ? (Array.isArray(article.image) ? article.image : [article.image]) : undefined,
		publisher: article.publisher || undefined,
		mainEntityOfPage: article.url ? { '@type': 'WebPage', '@id': article.url } : undefined,
	};
}

interface ProductData {
	name: string;
	description?: string;
	image?: string | string[];
	sku?: string;
	brand?: string;
	price?: string;
	currency?: string;
	inStock?: boolean;
	url?: string;
	reviews?: { rating: number; author: string; body?: string }[];
	aggregateRating?: { value: number; count: number };
}

export function ProductSchema(product: ProductData): Record<string, unknown> {
	return {
		'@type': 'Product',
		name: product.name,
		description: product.description,
		image: product.image ? (Array.isArray(product.image) ? product.image : [product.image]) : undefined,
		sku: product.sku,
		brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
		offers: {
			'@type': 'Offer',
			price: product.price,
			priceCurrency: product.currency || 'USD',
			availability: product.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
			url: product.url,
		},
		review: product.reviews ? product.reviews.map(r => ({
			'@type': 'Review',
			reviewRating: { '@type': 'Rating', ratingValue: r.rating },
			author: { '@type': 'Person', name: r.author },
			reviewBody: r.body,
		})) : undefined,
		aggregateRating: product.aggregateRating ? {
			'@type': 'AggregateRating',
			ratingValue: product.aggregateRating.value,
			reviewCount: product.aggregateRating.count,
		} : undefined,
	};
}

interface FAQItem {
	question: string;
	answer: string;
}

export function FAQPageSchema(faqs: FAQItem[]): Record<string, unknown> {
	return {
		'@type': 'FAQPage',
		mainEntity: faqs.map(f => ({
			'@type': 'Question',
			name: f.question,
			acceptedAnswer: { '@type': 'Answer', text: f.answer },
		})),
	};
}

interface BreadcrumbItem {
	name: string;
	url: string;
}

export function BreadcrumbListSchema(items: BreadcrumbItem[]): Record<string, unknown> {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: items.map((item, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: item.name,
			item: item.url,
		})),
	};
}

interface OrganizationData {
	type?: string;
	name: string;
	url?: string;
	logo?: string;
	description?: string;
	sameAs?: string[];
	contactPoint?: { telephone: string; contactType?: string; email?: string };
	address?: {
		streetAddress?: string;
		addressLocality?: string;
		addressRegion?: string;
		postalCode?: string;
		addressCountry?: string;
	};
}

export function OrganizationSchema(org: OrganizationData): Record<string, unknown> {
	return {
		'@type': org.type || 'Organization',
		name: org.name,
		url: org.url,
		logo: org.logo,
		description: org.description,
		sameAs: org.sameAs || undefined,
		contactPoint: org.contactPoint ? {
			'@type': 'ContactPoint',
			telephone: org.contactPoint.telephone,
			contactType: org.contactPoint.contactType || 'customer service',
			email: org.contactPoint.email,
		} : undefined,
		address: org.address ? {
			'@type': 'PostalAddress',
			streetAddress: org.address.streetAddress,
			addressLocality: org.address.addressLocality,
			addressRegion: org.address.addressRegion,
			postalCode: org.address.postalCode,
			addressCountry: org.address.addressCountry,
		} : undefined,
	};
}

interface LocalBusinessData extends OrganizationData {
	subtype?: string;
	hours?: { days: string; open: string; close: string }[];
	priceRange?: string;
	telephone?: string;
}

export function LocalBusinessSchema(biz: LocalBusinessData): Record<string, unknown> {
	return {
		...OrganizationSchema(biz),
		'@type': biz.subtype || 'LocalBusiness',
		openingHoursSpecification: biz.hours ? biz.hours.map(h => ({
			'@type': 'OpeningHoursSpecification',
			dayOfWeek: h.days,
			opens: h.open,
			closes: h.close,
		})) : undefined,
		priceRange: biz.priceRange,
		telephone: biz.telephone,
	};
}

interface VideoData {
	name: string;
	description?: string;
	thumbnailUrl?: string | string[];
	uploadDate?: string;
	duration?: string;
	contentUrl?: string;
	embedUrl?: string;
	viewCount?: number;
}

export function VideoSchema(video: VideoData): Record<string, unknown> {
	return {
		'@type': 'VideoObject',
		name: video.name,
		description: video.description,
		thumbnailUrl: video.thumbnailUrl ? (Array.isArray(video.thumbnailUrl) ? video.thumbnailUrl : [video.thumbnailUrl]) : undefined,
		uploadDate: video.uploadDate,
		duration: video.duration,
		contentUrl: video.contentUrl,
		embedUrl: video.embedUrl,
		interactionStatistic: video.viewCount ? {
			'@type': 'InteractionCounter',
			interactionType: 'https://schema.org/WatchAction',
			userInteractionCount: video.viewCount,
		} : undefined,
	};
}
